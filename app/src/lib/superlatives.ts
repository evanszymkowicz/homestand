import { getDistinctScoringPeriods, getMatchupSideEntries, getSidePointsByPeriod } from "./boxScore";
import { BENCH_AND_IR_SLOT_IDS, BENCH_SLOT_ID } from "./lineupSlots";
import { findTeam } from "./schedule";
import { ownerRef, winPct, type OwnerRef } from "./stats";
import type { BoxScoreEntry, Matchup, MatchupSide, Owner, Season, Team } from "../types";

/**
 * League-trivia derivations for the Superlatives page: blowouts, scoring
 * extremes, playoff streaks/droughts, and the worst lineup decision. Same
 * convention as stats.ts — pure functions over already-loaded JSON, nothing
 * written back to data/.
 */

export interface MatchupSideStat {
  espnTeamId: number;
  teamName: string;
  owners: OwnerRef[];
  score: number;
}

function sideOwnerRefs(team: Team, owners: Owner[]): OwnerRef[] {
  // Co-owned teams display the primary owner first.
  const primary = team.primary_owner_id;
  return [primary, ...team.owner_ids.filter(id => id !== primary)].map(id => ownerRef(owners, id));
}

export function resolveSide(teams: Team[], owners: Owner[], year: number, side: MatchupSide): MatchupSideStat | null {
  if (side.espn_team_id === null) return null;
  const team = findTeam(teams, year, side.espn_team_id);
  return {
    espnTeamId: side.espn_team_id,
    teamName: team?.team_name ?? "Unknown team",
    owners: team ? sideOwnerRefs(team, owners) : [],
    score: side.score,
  };
}

function decidedMatchups(matchups: Matchup[]): Matchup[] {
  return matchups.filter(m => m.away !== null && (m.winner === "HOME" || m.winner === "AWAY"));
}

export interface MatchupMarginEntry {
  year: number;
  week: number;
  matchupId: number;
  home: MatchupSideStat;
  away: MatchupSideStat;
  winner: MatchupSideStat;
  loser: MatchupSideStat;
  margin: number;
}

function rankedMatchupMargins(
  matchups: Matchup[],
  teams: Team[],
  owners: Owner[],
  direction: "biggest" | "closest"
): MatchupMarginEntry[] {
  const entries: MatchupMarginEntry[] = [];
  for (const m of decidedMatchups(matchups)) {
    // decidedMatchups guarantees m.away is a real side object, but either
    // side'can still be null in principle so skip rather than assert, so a malformed row can't crash the whole app.
    const home = resolveSide(teams, owners, m.year, m.home);
    const away = resolveSide(teams, owners, m.year, m.away!);
    if (!home || !away) continue;
    const [winner, loser] = m.winner === "HOME" ? [home, away] : [away, home];
    entries.push({
      year: m.year,
      week: m.week,
      matchupId: m.matchup_id,
      home,
      away,
      winner,
      loser,
      margin: Math.abs(home.score - away.score),
    });
  }
  return entries.sort((a, b) => (direction === "biggest" ? b.margin - a.margin : a.margin - b.margin));
}

/** Top N biggest blowouts league-wide (rank 1 first). */
export function getBiggestBlowouts(matchups: Matchup[], teams: Team[], owners: Owner[], n = 3): MatchupMarginEntry[] {
  return rankedMatchupMargins(matchups, teams, owners, "biggest").slice(0, n);
}

/** Top N closest matchups league-wide (rank 1 first). */
export function getClosestMatchups(matchups: Matchup[], teams: Team[], owners: Owner[], n = 3): MatchupMarginEntry[] {
  return rankedMatchupMargins(matchups, teams, owners, "closest").slice(0, n);
}

export interface TeamWeekScoreEntry {
  year: number;
  week: number;
  matchupId: number;
  team: MatchupSideStat;
}

/** A true non-played placeholder row (e.g. 2009 week 22's zero-score rows),
 * distinct from a real playoff-bye score — a bye side can have a real,
 * tabulated score (winner UNDECIDED, away null, score > 0) and must stay in
 * the pool. Exported for reuse by lib/divergingViews.ts's form-strip
 * computation, which needs the same real-week filter. */
export function isPlaceholderByeRow(m: Matchup): boolean {
  return m.away === null && m.winner === "UNDECIDED" && m.home.score === 0;
}

/** A two-sided matchup that hasn't been played yet -- the current (or a future)
 * week of an in-progress season, sitting in matchups.json with both sides at
 * a not-yet-final 0.0 and no winner decided. Distinct from a bye's UNDECIDED
 * winner (see isPlaceholderByeRow): here away is a real side, so there's no
 * score to report at all yet, not just a placeholder for an unopposed team. */
function isUnplayedMatchup(m: Matchup): boolean {
  return m.away !== null && m.winner === "UNDECIDED";
}

/** Every real team-week score league-wide (both matchup sides, decided or
 * not — a bye side's real score still counts). Excludes 0.0 scores outright:
 * a team-week never really scores exactly zero in this league (min. lineup
 * requirements guarantee some production), so every 0.0 in the archive is a
 * no-lineup/checked-out week rather than a genuine "how low can you go"
 * result, and isn't a meaningful single-week score record either direction. */
export function getAllTeamWeekScores(matchups: Matchup[], teams: Team[], owners: Owner[]): TeamWeekScoreEntry[] {
  const entries: TeamWeekScoreEntry[] = [];
  for (const m of matchups) {
    if (isPlaceholderByeRow(m) || isUnplayedMatchup(m)) continue;
    const home = resolveSide(teams, owners, m.year, m.home);
    if (home && home.score !== 0) entries.push({ year: m.year, week: m.week, matchupId: m.matchup_id, team: home });
    if (m.away) {
      const away = resolveSide(teams, owners, m.year, m.away);
      if (away && away.score !== 0) entries.push({ year: m.year, week: m.week, matchupId: m.matchup_id, team: away });
    }
  }
  return entries;
}

/** Top N highest single-week scores league-wide (rank 1 first). */
export function getHighestSingleWeekScores(
  matchups: Matchup[],
  teams: Team[],
  owners: Owner[],
  n = 3
): TeamWeekScoreEntry[] {
  const entries = getAllTeamWeekScores(matchups, teams, owners);
  return [...entries].sort((a, b) => b.team.score - a.team.score).slice(0, n);
}

/** Top N lowest single-week scores league-wide (rank 1 first). */
export function getLowestSingleWeekScores(
  matchups: Matchup[],
  teams: Team[],
  owners: Owner[],
  n = 3
): TeamWeekScoreEntry[] {
  const entries = getAllTeamWeekScores(matchups, teams, owners);
  return [...entries].sort((a, b) => a.team.score - b.team.score).slice(0, n);
}

export interface ResultScoreEntry {
  year: number;
  week: number;
  matchupId: number;
  team: MatchupSideStat;
  opponentScore: number;
}

function decidedSideResults(
  matchups: Matchup[],
  teams: Team[],
  owners: Owner[]
): { entry: ResultScoreEntry; won: boolean }[] {
  const results: { entry: ResultScoreEntry; won: boolean }[] = [];
  for (const m of decidedMatchups(matchups)) {
    const home = resolveSide(teams, owners, m.year, m.home);
    const away = resolveSide(teams, owners, m.year, m.away!);
    if (!home || !away) continue;
    results.push({
      entry: { year: m.year, week: m.week, matchupId: m.matchup_id, team: home, opponentScore: away.score },
      won: m.winner === "HOME",
    });
    results.push({
      entry: { year: m.year, week: m.week, matchupId: m.matchup_id, team: away, opponentScore: home.score },
      won: m.winner === "AWAY",
    });
  }
  return results;
}

/** Top N highest-scoring losses league-wide (rank 1 first). */
export function getHighestScoringLosses(
  matchups: Matchup[],
  teams: Team[],
  owners: Owner[],
  n = 3
): ResultScoreEntry[] {
  const losses = decidedSideResults(matchups, teams, owners)
    .filter(r => !r.won)
    .map(r => r.entry);
  return [...losses].sort((a, b) => b.team.score - a.team.score).slice(0, n);
}

/** Top N lowest-scoring wins league-wide (rank 1 first). */
export function getLowestScoringWins(matchups: Matchup[], teams: Team[], owners: Owner[], n = 3): ResultScoreEntry[] {
  const wins = decidedSideResults(matchups, teams, owners)
    .filter(r => r.won)
    .map(r => r.entry);
  return [...wins].sort((a, b) => a.team.score - b.team.score).slice(0, n);
}

/** The league's one and only tied matchup — a thin named wrapper for
 * call-site clarity. Confirmed unique across all of matchups.json. */
export function getTheOneTie(matchups: Matchup[]): Matchup | null {
  return matchups.find(m => m.winner === "TIE") ?? null;
}

export interface TitleRecordExtreme {
  owners: OwnerRef[];
  teamName: string;
  year: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  finalRank: number;
}

function toTitleRecordExtreme(team: Team, owners: Owner[]): TitleRecordExtreme {
  return {
    owners: team.owner_ids.map(id => ownerRef(owners, id)),
    teamName: team.team_name,
    year: team.year,
    wins: team.overall.wins,
    losses: team.overall.losses,
    ties: team.overall.ties,
    winPct: winPct(team.overall),
    finalRank: team.final_rank,
  };
}

/** Top N best regular-season+overall win% among teams that didn't win the title (rank 1 first). */
export function getBestRecordsToMissTitle(teams: Team[], owners: Owner[], n = 3): TitleRecordExtreme[] {
  const contenders = teams.filter(t => t.final_rank !== 1);
  return [...contenders]
    .sort((a, b) => winPct(b.overall) - winPct(a.overall) || b.overall.wins - a.overall.wins)
    .slice(0, n)
    .map(t => toTitleRecordExtreme(t, owners));
}

/** Top N worst overall win% among teams that won the title anyway (rank 1 first). */
export function getWorstRecordsToWinTitle(teams: Team[], owners: Owner[], n = 3): TitleRecordExtreme[] {
  const champs = teams.filter(t => t.final_rank === 1);
  return [...champs]
    .sort((a, b) => winPct(a.overall) - winPct(b.overall) || a.overall.wins - b.overall.wins)
    .slice(0, n)
    .map(t => toTitleRecordExtreme(t, owners));
}

export interface SeedRankGapEntry {
  owners: OwnerRef[];
  teamName: string;
  year: number;
  seed: number;
  finalRank: number;
  /** playoff_seed - final_rank; positive = overachiever (bad seed, good
   * finish), negative = underachiever (good seed, bad finish). */
  gap: number;
}

function rankedSeedGaps(teams: Team[], owners: Owner[]): SeedRankGapEntry[] {
  return teams.map(t => ({
    owners: t.owner_ids.map(id => ownerRef(owners, id)),
    teamName: t.team_name,
    year: t.year,
    seed: t.playoff_seed,
    finalRank: t.final_rank,
    gap: t.playoff_seed - t.final_rank,
  }));
}

/** Top N biggest overachievers league-wide (rank 1 first). */
export function getBiggestOverachievers(teams: Team[], owners: Owner[], n = 3): SeedRankGapEntry[] {
  const gaps = rankedSeedGaps(teams, owners);
  return [...gaps].sort((a, b) => b.gap - a.gap).slice(0, n);
}

/** Top N biggest underachievers league-wide (rank 1 first). */
export function getBiggestUnderachievers(teams: Team[], owners: Owner[], n = 3): SeedRankGapEntry[] {
  const gaps = rankedSeedGaps(teams, owners);
  return [...gaps].sort((a, b) => a.gap - b.gap).slice(0, n);
}

export interface ChampionshipDroughtEntry {
  owner: OwnerRef;
  titles: number;
  runnerUps: number;
  lastTitleYear: number | null;
  /** latestYear - lastTitleYear; null when titles === 0 ("never"). */
  yearsSince: number | null;
}

/** Years since each owner's last title, or "never" (yearsSince null) if
 * they've never won one — every owner appears, matching getTitlesLeaderboard's
 * complete-roster convention. Also carries runner-up counts, folding in what
 * used to be the separate Records "Season Champion Leaderboard" table. */
export function getChampionshipDroughts(teams: Team[], owners: Owner[]): ChampionshipDroughtEntry[] {
  if (teams.length === 0) return [];
  const latestYear = Math.max(...teams.map(t => t.year));
  const titleCounts = new Map<string, number>();
  const runnerUpCounts = new Map<string, number>();
  const lastTitleYear = new Map<string, number>();
  for (const team of teams) {
    if (team.final_rank === 1) {
      for (const ownerId of team.owner_ids) {
        titleCounts.set(ownerId, (titleCounts.get(ownerId) ?? 0) + 1);
        const prev = lastTitleYear.get(ownerId);
        if (prev === undefined || team.year > prev) lastTitleYear.set(ownerId, team.year);
      }
    } else if (team.final_rank === 2) {
      for (const ownerId of team.owner_ids) {
        runnerUpCounts.set(ownerId, (runnerUpCounts.get(ownerId) ?? 0) + 1);
      }
    }
  }

  return owners
    .map(o => {
      const titles = titleCounts.get(o.owner_id) ?? 0;
      const last = lastTitleYear.get(o.owner_id) ?? null;
      return {
        owner: ownerRef(owners, o.owner_id),
        titles,
        runnerUps: runnerUpCounts.get(o.owner_id) ?? 0,
        lastTitleYear: last,
        yearsSince: last === null ? null : latestYear - last,
      };
    })
    .sort((a, b) => {
      if (a.yearsSince === null && b.yearsSince === null) return 0;
      if (a.yearsSince === null) return -1;
      if (b.yearsSince === null) return 1;
      return b.yearsSince - a.yearsSince;
    });
}

export interface PlayoffStreakEntry {
  owners: OwnerRef[];
  /** This run's own team-season years, ascending. Built over the owner's own
   * chronological team-season sequence, not raw calendar years — a year the
   * owner held no team-slot at all is absent from their sequence rather than
   * counted as a miss or a make. */
  years: number[];
  length: number;
  /** True when this run's last year equals the dataset's latest team-season year. */
  active: boolean;
}

function ownerTeamSeasons(teams: Team[], ownerId: string): Team[] {
  return teams.filter(t => t.owner_ids.includes(ownerId)).sort((a, b) => a.year - b.year);
}

/** Reads playoff_team_count from that team's own season rather than assuming
 * a league-wide constant — 2020's COVID season had 2 playoff spots, not the
 * usual 6, and this handles that without special-casing. */
function madePlayoffs(team: Team, seasons: Season[]): boolean {
  const season = seasons.find(s => s.year === team.year);
  return season != null && team.playoff_seed <= season.playoff_team_count;
}

function runsFor(teams: Team[], owners: Owner[], seasons: Season[], target: boolean): PlayoffStreakEntry[] {
  if (teams.length === 0) return [];
  const latestYear = Math.max(...teams.map(t => t.year));
  const entries: PlayoffStreakEntry[] = [];

  for (const owner of owners) {
    const ownerTeams = ownerTeamSeasons(teams, owner.owner_id);
    let current: number[] = [];
    const flush = () => {
      if (current.length > 0) {
        entries.push({
          owners: [ownerRef(owners, owner.owner_id)],
          years: [...current],
          length: current.length,
          active: current[current.length - 1] === latestYear,
        });
      }
      current = [];
    };
    for (const team of ownerTeams) {
      if (madePlayoffs(team, seasons) === target) {
        current.push(team.year);
      } else {
        flush();
      }
    }
    flush();
  }

  return entries.sort((a, b) => b.length - a.length);
}

/** Longest runs of consecutive team-seasons making the playoffs, per owner. */
export function getPlayoffStreaks(teams: Team[], owners: Owner[], seasons: Season[]): PlayoffStreakEntry[] {
  return runsFor(teams, owners, seasons, true);
}

/** Longest runs of consecutive team-seasons missing the playoffs, per owner. */
export function getPlayoffDroughts(teams: Team[], owners: Owner[], seasons: Season[]): PlayoffStreakEntry[] {
  return runsFor(teams, owners, seasons, false);
}

export interface WorstLineupDecisionEntry {
  year: number;
  week: number;
  matchupId: number;
  espnTeamId: number;
  owners: OwnerRef[];
  scoringPeriod: number;
  benchedPlayerId: number;
  benchedPlayerName: string;
  benchedPoints: number;
  startedPlayerId: number | null;
  startedPlayerName: string | null;
  startedPoints: number;
  inferredSlotId: number;
  gap: number;
}

function teamWeekKey(entry: BoxScoreEntry): string {
  return `${entry.year}:${entry.week}:${entry.matchup_id}:${entry.espn_team_id}`;
}

function groupByTeamWeek(entries: BoxScoreEntry[]): Map<string, BoxScoreEntry[]> {
  const groups = new Map<string, BoxScoreEntry[]>();
  for (const entry of entries) {
    const key = teamWeekKey(entry);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return groups;
}

/**
 * No position-eligibility data exists anywhere in processed data —
 * BoxScoreEntry only records the slot a player actually occupied each day,
 * never which slots they were eligible for. This infers eligibility: a
 * benched player (slot 16, IL excluded) is compared only against slots they
 * themselves started at on some OTHER day within the same team-week — proof
 * of that week's roster eligibility, not a confirmed position rule. The
 * single biggest (benched points - started points) pairing per team-week is
 * kept; ties/negative gaps (bench player scored less) are dropped since
 * those aren't a bad decision.
 */
function bestDecisionForTeamWeek(entries: BoxScoreEntry[]): Omit<WorstLineupDecisionEntry, "owners"> | null {
  const startedByDaySlot = new Map<number, Map<number, { playerId: number; playerName: string; points: number }>>();
  for (const entry of entries) {
    for (const slot of entry.slots) {
      if (BENCH_AND_IR_SLOT_IDS.has(slot.lineup_slot_id)) continue;
      const daySlots = startedByDaySlot.get(slot.scoring_period) ?? new Map();
      daySlots.set(slot.lineup_slot_id, {
        playerId: entry.player_id,
        playerName: entry.player_name,
        points: slot.points,
      });
      startedByDaySlot.set(slot.scoring_period, daySlots);
    }
  }

  let best: Omit<WorstLineupDecisionEntry, "owners"> | null = null;
  for (const entry of entries) {
    const eligibleSlots = new Set(
      entry.slots.filter(s => !BENCH_AND_IR_SLOT_IDS.has(s.lineup_slot_id)).map(s => s.lineup_slot_id)
    );
    if (eligibleSlots.size === 0) continue;

    for (const slot of entry.slots) {
      if (slot.lineup_slot_id !== BENCH_SLOT_ID) continue;
      for (const eligibleSlotId of eligibleSlots) {
        const started = startedByDaySlot.get(slot.scoring_period)?.get(eligibleSlotId);
        const startedPoints = started?.points ?? 0;
        const gap = slot.points - startedPoints;
        if (gap <= 0) continue;
        if (!best || gap > best.gap) {
          best = {
            year: entry.year,
            week: entry.week,
            matchupId: entry.matchup_id,
            espnTeamId: entry.espn_team_id,
            scoringPeriod: slot.scoring_period,
            benchedPlayerId: entry.player_id,
            benchedPlayerName: entry.player_name,
            benchedPoints: slot.points,
            startedPlayerId: started?.playerId ?? null,
            startedPlayerName: started?.playerName ?? null,
            startedPoints,
            inferredSlotId: eligibleSlotId,
            gap,
          };
        }
      }
    }
  }
  return best;
}

/** boxScoresByYear should only contain years with real per-day slot data
 * (season.coverage.stat_lines === "full") — build it from
 * summarizeCoverage(seasons, "stat_lines").coveredYears rather than a
 * hardcoded year, so a future season with real slot data is picked up for free.
 *
 * A still-in-progress week's box scores are a partial day count (only the
 * scoring periods played so far), so a "worst decision" found there could
 * flip once the week finishes -- unlike a completed week, which never
 * changes. `seasons` is used only to find each in-progress year's
 * current_week and exclude that one week; every other week (including
 * earlier weeks of an in-progress season) is a real, decided result and
 * stays in. */
export function getWorstLineupDecisions(
  boxScoresByYear: Map<number, BoxScoreEntry[]>,
  teams: Team[],
  owners: Owner[],
  seasons: Season[],
  n = 10
): WorstLineupDecisionEntry[] {
  const currentWeekByYear = new Map(seasons.filter(s => s.status === "in_progress").map(s => [s.year, s.current_week]));
  const results: WorstLineupDecisionEntry[] = [];
  for (const entries of boxScoresByYear.values()) {
    for (const group of groupByTeamWeek(entries).values()) {
      const best = bestDecisionForTeamWeek(group);
      if (!best) continue;
      if (currentWeekByYear.get(best.year) === best.week) continue;
      const team = findTeam(teams, best.year, best.espnTeamId);
      results.push({ ...best, owners: team ? team.owner_ids.map(id => ownerRef(owners, id)) : [] });
    }
  }
  return results.sort((a, b) => b.gap - a.gap).slice(0, n);
}

export interface SundayCollapseEntry {
  year: number;
  week: number;
  matchupId: number;
  /** Led the matchup entering its final scored day, then lost anyway. */
  collapsed: MatchupSideStat;
  winner: MatchupSideStat;
  /** Size of the lead blown entering the final day -- the ranking metric. */
  leadBeforeFinalDay: number;
  finalMargin: number;
}

/**
 * A team led a matchup entering its last scored day -- this league's fantasy
 * week runs Monday-Sunday, so the highest of a matchup's distinct scoring
 * periods is that week's Sunday -- but lost once that day's points were in.
 * Needs >1 distinct scoring period per matchup, the same gate PointsPerDay
 * uses, so only matchups with real per-day box scores (2019+) can produce an
 * entry; boxScoresByYear should be pre-filtered the same way (see
 * getWorstLineupDecisions above).
 */
export function getBiggestSundayCollapses(
  boxScoresByYear: Map<number, BoxScoreEntry[]>,
  matchups: Matchup[],
  teams: Team[],
  owners: Owner[],
  n = 3
): SundayCollapseEntry[] {
  const results: SundayCollapseEntry[] = [];
  for (const [year, boxScores] of boxScoresByYear) {
    for (const m of decidedMatchups(matchups.filter(mm => mm.year === year))) {
      if (m.away === null) continue;
      const home = resolveSide(teams, owners, year, m.home);
      const away = resolveSide(teams, owners, year, m.away);
      if (!home || !away) continue;

      const homeEntries = getMatchupSideEntries(boxScores, m.matchup_id, home.espnTeamId);
      const awayEntries = getMatchupSideEntries(boxScores, m.matchup_id, away.espnTeamId);
      const periods = getDistinctScoringPeriods([...homeEntries, ...awayEntries]);
      if (periods.length <= 1) continue;

      const homeByPeriod = getSidePointsByPeriod(homeEntries, periods);
      const awayByPeriod = getSidePointsByPeriod(awayEntries, periods);
      const homeBefore = homeByPeriod.slice(0, -1).reduce((sum, p) => sum + p, 0);
      const awayBefore = awayByPeriod.slice(0, -1).reduce((sum, p) => sum + p, 0);
      if (homeBefore === awayBefore) continue;

      const homeLedBeforeFinalDay = homeBefore > awayBefore;
      const homeWon = m.winner === "HOME";
      if (homeLedBeforeFinalDay === homeWon) continue;

      results.push({
        year,
        week: m.week,
        matchupId: m.matchup_id,
        collapsed: homeLedBeforeFinalDay ? home : away,
        winner: homeLedBeforeFinalDay ? away : home,
        leadBeforeFinalDay: Math.abs(homeBefore - awayBefore),
        finalMargin: Math.abs(home.score - away.score),
      });
    }
  }
  return results.sort((a, b) => b.leadBeforeFinalDay - a.leadBeforeFinalDay).slice(0, n);
}
