import { getBenchPoints, getCountedPointsByCategory } from "./boxScore";
import { findTeam } from "./schedule";
import { isPlaceholderByeRow } from "./superlatives";
import { ownerRef, winPct, type OwnerRef } from "./stats";
import { ALL_STAT_IDS } from "./statIds";
import type { BoxScoreEntry, Matchup, Owner, Season, Team } from "../types";

/**
 * Phase 6's five diverging-scale views. Same convention as stats.ts/
 * superlatives.ts/hallOfFame.ts -- pure functions over already-loaded JSON,
 * nothing written back to data/. Mocked up against real data 2026-07-18
 * (see project memory); several judgment calls below (byes excluded from form
 * strips, min-5-game threshold for riser/choker) were resolved during that
 * mockup and are carried through here rather than re-litigated. The mockup's
 * "two-way players count as batting" call was reversed 2026-08-05: the
 * identity view now splits a two-way player's days by the slot they started
 * in.
 */

// ---------------------------------------------------------------------------
// 1. Pitching vs. batting identity
// ---------------------------------------------------------------------------

export interface IdentityRow {
  ownerId: string;
  share: number;
  points: number;
  pitchingPoints: number;
  // Solves for two-way players whose stats were dumped into batting
  battingPoints: number;
}

export interface IdentityYear {
  year: number;
  mean: number;
  rows: IdentityRow[];
}

/** Regular-season matchup_ids, per year -- matchup_id is unique within a
 * season, so one set per year is enough to gate box-score entries. */
function regularSeasonMatchupIds(matchups: Matchup[]): Map<number, Set<number>> {
  const byYear = new Map<number, Set<number>>();
  for (const m of matchups) {
    if (m.playoff_tier !== null) continue;
    const ids = byYear.get(m.year) ?? new Set<number>();
    ids.add(m.matchup_id);
    byYear.set(m.year, ids);
  }
  return byYear;
}

/** Pitching share of each owner-season's counted (started-slot) points,
 * 2019+ only -- the denominator is the team's own official points_for
 * (already the summed counted points for the season) rather than a
 * re-aggregation from box scores, so this always agrees with the rest of
 * the app's scoring. points_for is regular season only, so the numerator is
 * scoped to regular-season matchups to match it. The two sides then reconcile
 * exactly for most team-seasons and to within ~2.4 points for the handful of
 * 2021/2022/2024 ones where ESPN's own day-level and week-level totals
 * disagree. This is also to resolve for two-way players. */
export function getPitchingBattingIdentity(
  boxScoresByYear: Map<number, BoxScoreEntry[]>,
  teams: Team[],
  matchups: Matchup[]
): IdentityYear[] {
  const regularSeasonIds = regularSeasonMatchupIds(matchups);
  const years: IdentityYear[] = [];
  for (const [year, entries] of boxScoresByYear) {
    // No matchups for the year means no basis to scope the numerator, so skip it rather than filtering everything out and reporting a 0% column.
    const yearIds = regularSeasonIds.get(year);
    if (!yearIds) continue;
    const pitchingByTeam = new Map<number, number>();
    const battingByTeam = new Map<number, number>();
    for (const entry of entries) {
      if (!yearIds.has(entry.matchup_id)) continue;
      const split = getCountedPointsByCategory(entry);
      pitchingByTeam.set(entry.espn_team_id, (pitchingByTeam.get(entry.espn_team_id) ?? 0) + split.pitching);
      battingByTeam.set(entry.espn_team_id, (battingByTeam.get(entry.espn_team_id) ?? 0) + split.batting);
    }
    const rows: IdentityRow[] = [];
    for (const team of teams.filter(t => t.year === year)) {
      if (team.overall.points_for === 0) continue;
      const pitchingPts = pitchingByTeam.get(team.espn_team_id) ?? 0;
      rows.push({
        ownerId: team.primary_owner_id,
        share: pitchingPts / team.overall.points_for,
        points: team.overall.points_for,
        pitchingPoints: pitchingPts,
        battingPoints: battingByTeam.get(team.espn_team_id) ?? 0,
      });
    }
    if (rows.length === 0) continue;
    // rows.length > 0 guaranteed by the continue above
    years.push({ year, mean: rows.reduce((sum, r) => sum + r.share, 0) / rows.length, rows });
  }
  return years.sort((a, b) => b.year - a.year);
}

// ---------------------------------------------------------------------------
// 1b. Pitching/batting identity vs. team success
// ---------------------------------------------------------------------------

export interface IdentityWinRow {
  ownerId: string;
  espnTeamId: number;
  year: number;
  share: number;
  winPct: number;
  isChampion: boolean;
  points: number;
  pitchingPoints: number;
  pointsIndex: number;
}

/** Team success replaces batting share as the Y-axis since pitching+batting
 * share always sum to 1 -- plotting both would just draw a diagonal line. */
export function getIdentityVsWinPct(
  boxScoresByYear: Map<number, BoxScoreEntry[]>,
  teams: Team[],
  matchups: Matchup[]
): IdentityWinRow[] {
  const identityYears = getPitchingBattingIdentity(boxScoresByYear, teams, matchups);
  const rows: IdentityWinRow[] = [];
  for (const y of identityYears) {
    const meanPoints = y.rows.length > 0 ? y.rows.reduce((sum, r) => sum + r.points, 0) / y.rows.length : 0;
    for (const r of y.rows) {
      const team = teams.find(t => t.year === y.year && t.primary_owner_id === r.ownerId);
      if (!team) continue;
      rows.push({
        ownerId: r.ownerId,
        espnTeamId: team.espn_team_id,
        year: y.year,
        share: r.share,
        winPct: winPct(team.overall),
        isChampion: team.final_rank === 1,
        points: r.points,
        pitchingPoints: r.pitchingPoints,
        pointsIndex: meanPoints === 0 ? 0 : r.points / meanPoints,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. Hot/cold form strips
// ---------------------------------------------------------------------------

export interface FormWeekEntry {
  week: number;
  score: number;
  z: number;
}

export interface FormStripRow {
  ownerId: string;
  espnTeamId: number;
  mean: number;
  stdev: number;
  weeks: FormWeekEntry[];
}

export interface FormStripYear {
  year: number;
  rows: FormStripRow[];
}

/** Weekly score standardized against each owner's own regular-season mean
 * and stdev (population, not sample) -- self-relative form, not league
 * strength. Playoff weeks and true non-played placeholder rows are excluded;
 * a real playoff-bye score isn't at issue here since only playoff_tier ===
 * null rows are considered in the first place. For an in-progress season,
 * weeks at or after current_week are also excluded -- ESPN schedules the
 * whole season upfront, so unplayed weeks already exist as 0-0 UNDECIDED
 * rows and the current week itself is a partial score. Full 2009+ coverage. */
export function getHotColdFormStrips(matchups: Matchup[], teams: Team[], seasons: Season[]): FormStripYear[] {
  const currentWeekByYear = new Map(seasons.filter(s => s.status === "in_progress").map(s => [s.year, s.current_week]));
  const years = Array.from(new Set(teams.map(t => t.year))).sort((a, b) => b - a);
  const result: FormStripYear[] = [];
  for (const year of years) {
    const scoresByTeam = new Map<number, { week: number; score: number }[]>();
    const currentWeek = currentWeekByYear.get(year);
    for (const m of matchups) {
      if (m.year !== year || m.playoff_tier !== null || isPlaceholderByeRow(m)) continue;
      if (currentWeek !== undefined && m.week >= currentWeek) continue;
      if (m.home.espn_team_id !== null) {
        const list = scoresByTeam.get(m.home.espn_team_id) ?? [];
        list.push({ week: m.week, score: m.home.score });
        scoresByTeam.set(m.home.espn_team_id, list);
      }
      if (m.away && m.away.espn_team_id !== null) {
        const list = scoresByTeam.get(m.away.espn_team_id) ?? [];
        list.push({ week: m.week, score: m.away.score });
        scoresByTeam.set(m.away.espn_team_id, list);
      }
    }
    const rows: FormStripRow[] = [];
    for (const [espnTeamId, weekScores] of scoresByTeam) {
      const team = findTeam(teams, year, espnTeamId);
      if (!team || weekScores.length === 0) continue;
      // weekScores.length > 0 guaranteed by the continue above
      const scores = weekScores.map(w => w.score);
      const mean = scores.reduce((sum, x) => sum + x, 0) / scores.length;
      const variance = scores.reduce((sum, x) => sum + (x - mean) ** 2, 0) / scores.length;
      const stdev = Math.sqrt(variance);
      const weeks = [...weekScores]
        .sort((a, b) => a.week - b.week)
        .map(w => ({ week: w.week, score: w.score, z: stdev === 0 ? 0 : (w.score - mean) / stdev }));
      rows.push({ ownerId: team.primary_owner_id, espnTeamId, mean, stdev, weeks });
    }
    if (rows.length > 0) result.push({ year, rows });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Playoff riser/choker index
// ---------------------------------------------------------------------------

export interface RiserChokerEntry {
  owner: OwnerRef;
  regularWinPct: number;
  playoffWinPct: number;
  diff: number;
  playoffGames: number;
}

type TierRecord = { wins: number; losses: number; ties: number };

/** Wins/losses/ties per (year, espn_team_id) for one playoff_tier (null for
 * regular season) -- derived fresh from matchups.json rather than trusting
 * Team.overall, since that field is the regular-season standings record and
 * this needs the two tiers kept genuinely separate. */
function tierRecordsByTeamKey(matchups: Matchup[], tier: string | null): Map<string, TierRecord> {
  const results = new Map<string, TierRecord>();
  const bump = (key: string, result: "W" | "L" | "T") => {
    const r = results.get(key) ?? { wins: 0, losses: 0, ties: 0 };
    if (result === "W") r.wins += 1;
    else if (result === "L") r.losses += 1;
    else r.ties += 1;
    results.set(key, r);
  };
  for (const m of matchups) {
    if (m.playoff_tier !== tier || !m.away) continue;
    if (m.winner !== "HOME" && m.winner !== "AWAY" && m.winner !== "TIE") continue;
    const homeResult = m.winner === "TIE" ? "T" : m.winner === "HOME" ? "W" : "L";
    const awayResult = m.winner === "TIE" ? "T" : m.winner === "AWAY" ? "W" : "L";
    bump(`${m.year}:${m.home.espn_team_id}`, homeResult);
    bump(`${m.year}:${m.away.espn_team_id}`, awayResult);
  }
  return results;
}

function addRecord(map: Map<string, TierRecord>, ownerId: string, rec: TierRecord): void {
  const existing = map.get(ownerId) ?? { wins: 0, losses: 0, ties: 0 };
  existing.wins += rec.wins;
  existing.losses += rec.losses;
  existing.ties += rec.ties;
  map.set(ownerId, existing);
}

/** Winners-bracket win% minus regular-season win%, per owner, all time.
 * Owners under the games threshold are excluded rather than plotted on thin
 * evidence (mockup's verification run used >=5 winners-bracket games).
 * Positive (red) = rises in October; negative (blue) = the regular season
 * flattered them. */
export function getPlayoffRiserChoker(
  matchups: Matchup[],
  teams: Team[],
  owners: Owner[],
  minWinnersBracketGames = 5
): RiserChokerEntry[] {
  const regularByKey = tierRecordsByTeamKey(matchups, null);
  const winnersByKey = tierRecordsByTeamKey(matchups, "WINNERS_BRACKET");

  const regularByOwner = new Map<string, TierRecord>();
  const winnersByOwner = new Map<string, TierRecord>();
  for (const team of teams) {
    const key = `${team.year}:${team.espn_team_id}`;
    const regRec = regularByKey.get(key);
    const winRec = winnersByKey.get(key);
    for (const ownerId of team.owner_ids) {
      if (regRec) addRecord(regularByOwner, ownerId, regRec);
      if (winRec) addRecord(winnersByOwner, ownerId, winRec);
    }
  }

  const entries: RiserChokerEntry[] = [];
  for (const [ownerId, winRec] of winnersByOwner) {
    const playoffGames = winRec.wins + winRec.losses + winRec.ties;
    if (playoffGames < minWinnersBracketGames) continue;
    const regRec = regularByOwner.get(ownerId) ?? { wins: 0, losses: 0, ties: 0 };
    const regularWinPct = winPct(regRec);
    const playoffWinPct = winPct(winRec);
    entries.push({
      owner: ownerRef(owners, ownerId),
      regularWinPct,
      playoffWinPct,
      diff: playoffWinPct - regularWinPct,
      playoffGames,
    });
  }
  return entries.sort((a, b) => b.diff - a.diff);
}

// ---------------------------------------------------------------------------
// 4. Bench points left behind
// ---------------------------------------------------------------------------

export interface BenchWeekRow {
  ownerId: string;
  espnTeamId: number;
  week: number;
  benchPoints: number;
}

export interface BenchWeekYear {
  year: number;
  mean: number;
  rows: BenchWeekRow[];
}

/** Points scored while sitting in a bench or IL slot, per owner-week,
 * 2019+ only (same day-accurate-slot gate as the identity view). Includes
 * playoff weeks as-is -- late playoff "weeks" can span multiple scoring
 * periods and inflate their totals, a known caveat surfaced in the UI rather
 * than silently normalized away. */
export function getBenchPointsLeftBehind(
  boxScoresByYear: Map<number, BoxScoreEntry[]>,
  teams: Team[]
): BenchWeekYear[] {
  const years: BenchWeekYear[] = [];
  for (const [year, entries] of boxScoresByYear) {
    const byTeamWeek = new Map<string, number>();
    for (const entry of entries) {
      const key = `${entry.espn_team_id}:${entry.week}`;
      byTeamWeek.set(key, (byTeamWeek.get(key) ?? 0) + getBenchPoints(entry));
    }
    const rows: BenchWeekRow[] = [];
    for (const [key, benchPoints] of byTeamWeek) {
      const [teamIdStr, weekStr] = key.split(":");
      const espnTeamId = Number(teamIdStr);
      const week = Number(weekStr);
      const team = findTeam(teams, year, espnTeamId);
      if (!team) continue;
      rows.push({ ownerId: team.primary_owner_id, espnTeamId, week, benchPoints });
    }
    if (rows.length === 0) continue;
    years.push({ year, mean: rows.reduce((sum, r) => sum + r.benchPoints, 0) / rows.length, rows });
  }
  return years.sort((a, b) => b.year - a.year);
}

// ---------------------------------------------------------------------------
// 5. Scoring-rules drift
// ---------------------------------------------------------------------------

export interface DriftRow {
  statId: number;
  label: string;
  category: "batting" | "pitching";
  valuesByYear: Map<number, number | null>;
  changedYears: Set<number>;
}

/** Points per unit of every stat this league has ever scored, by season --
 * pure presentation of seasons.json's own scoring settings, no new
 * extraction. A year with no entry for a stat_id gets null ("not scored
 * that year"); changedYears marks a year whose value differs from the prior
 * year that stat WAS scored (a gap doesn't itself count as a change). */
export function getScoringRulesDrift(seasons: Season[]): DriftRow[] {
  const sortedSeasons = [...seasons].sort((a, b) => a.year - b.year);
  return ALL_STAT_IDS.map(({ statId, label, category }) => {
    const valuesByYear = new Map<number, number | null>();
    const changedYears = new Set<number>();
    let prevValue: number | null = null;
    for (const season of sortedSeasons) {
      const item = season.scoring.find(s => s.stat_id === statId);
      const value = item ? item.points : null;
      valuesByYear.set(season.year, value);
      if (value !== null) {
        if (prevValue !== null && value !== prevValue) changedYears.add(season.year);
        prevValue = value;
      }
    }
    return { statId, label, category, valuesByYear, changedYears };
  });
}
