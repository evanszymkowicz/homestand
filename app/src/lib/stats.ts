import { formatOwnerNames } from "./format";
import { matchesPositionScope } from "./positions";
import type { Matchup, Owner, PlayerSeasonPoints, Season, Team, TeamRecord } from "../types";

export interface OwnerRef {
  ownerId: string;
  name: string;
}

export interface ChampionshipYear {
  year: number;
  champion: OwnerRef[];
  runnerUp: OwnerRef[];
  third: OwnerRef[];
}

export interface TitlesLeaderboardRow {
  owner: OwnerRef;
  titles: number;
  runnerUps: number;
}

export interface CareerStandingRow {
  owner: OwnerRef;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  seasons: number;
}

export interface SeasonRecordExtreme {
  owners: OwnerRef[];
  teamName: string;
  year: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
}

export interface CareerPointsRow {
  owner: OwnerRef;
  pointsFor: number;
  pointsAgainst: number;
  differential: number;
  games: number;
  pointsForPerGame: number;
}

export interface SeasonPointsExtreme {
  owners: OwnerRef[];
  teamName: string;
  year: number;
  points: number;
  games: number;
  pointsPerGame: number;
}

export interface SeasonDifferentialExtreme {
  owners: OwnerRef[];
  teamName: string;
  year: number;
  differential: number;
}

export function ownerRef(owners: Owner[], ownerId: string): OwnerRef {
  const owner = owners.find(o => o.owner_id === ownerId);
  return { ownerId, name: owner?.canonical_name ?? ownerId };
}

/** A team-season's owner(s), formatted (e.g. "Owner A & Owner B").
 * Shared by any view that renders a team alongside its owner name(s). */
export function teamOwnerNames(team: Team, owners: Owner[]): string {
  return formatOwnerNames(team.owner_ids.map(id => ownerRef(owners, id)));
}

/** The "Current Owners" side of the Records screen's ownership-scope toggle. Derived from teams.json rather than hand-maintained, so a new season's data extends it automatically. */
export function getCurrentOwnerIds(teams: Team[]): Set<string> {
  const latestYear = teams.reduce((max, t) => Math.max(max, t.year), -Infinity);
  const ids = new Set<string>();
  for (const team of teams) {
    if (team.year === latestYear) {
      for (const ownerId of team.owner_ids) ids.add(ownerId);
    }
  }
  return ids;
}

/** Same latest-season derivation as getCurrentOwnerIds, but only owners who
 * hold a team of their own. For views keyed on primary_owner_id, a co-owner
 * with no team of their own has no row to fill -- they'd render as an
 * all-blank line rather than as history. */
export function getCurrentPrimaryOwnerIds(teams: Team[]): Set<string> {
  const latestYear = teams.reduce((max, t) => Math.max(max, t.year), -Infinity);
  const ids = new Set<string>();
  for (const team of teams) {
    if (team.year === latestYear) ids.add(team.primary_owner_id);
  }
  return ids;
}

export function buildSeasonPercentiles(seasonPoints: PlayerSeasonPoints[]): Map<string, number> {
  return percentilesByGroup(seasonPoints, row => `${row.year}`);
}

export function getSeasonPointsPercentileForPosition(
  playerId: number,
  seasonPoints: PlayerSeasonPoints[],
  positionByPlayerSeason: Map<string, number[]>,
  scopePositionId: number
): Map<number, number> {
  const byYear = new Map<number, PlayerSeasonPoints[]>();
  for (const row of seasonPoints) {
    const list = byYear.get(row.year) ?? [];
    list.push(row);
    byYear.set(row.year, list);
  }

  const result = new Map<number, number>();
  for (const [year, rows] of byYear) {
    const field: number[] = [];
    let value: number | null = null;
    for (const row of rows) {
      const inScope =
        row.player_id === playerId ||
        matchesPositionScope(positionByPlayerSeason.get(`${year}:${row.player_id}`) ?? [], scopePositionId);
      if (!inScope) continue;
      field.push(row.points);
      if (row.player_id === playerId) value = row.points;
    }
    if (value === null) continue;
    const percentile = percentileWithin(value, field);
    if (percentile !== null) result.set(year, percentile);
  }
  return result;
}

function percentilesByGroup(
  seasonPoints: PlayerSeasonPoints[],
  groupKey: (row: PlayerSeasonPoints) => string
): Map<string, number> {
  const byGroup = new Map<string, PlayerSeasonPoints[]>();
  for (const row of seasonPoints) {
    const key = groupKey(row);
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }

  const percentiles = new Map<string, number>();
  for (const rows of byGroup.values()) {
    const n = rows.length;
    if (n < 2) continue;
    const sorted = [...rows].sort((a, b) => a.points - b.points);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && sorted[j + 1].points === sorted[i].points) j++;
      const averageRank = (i + j) / 2;
      const percentile = (averageRank / (n - 1)) * 100;
      for (let k = i; k <= j; k++) percentiles.set(`${sorted[k].year}:${sorted[k].player_id}`, percentile);
      i = j + 1;
    }
  }
  return percentiles;
}

export function percentileWithin(value: number, field: number[]): number | null {
  const n = field.length;
  if (n < 2) return null;
  let below = 0;
  let equal = 0;
  for (const v of field) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  const averageRank = below + (equal - 1) / 2;
  return (averageRank / (n - 1)) * 100;
}

export function getSeasonPercentile(percentiles: Map<string, number>, year: number, playerId: number): number | null {
  return percentiles.get(`${year}:${playerId}`) ?? null;
}

/** Where a draft slot sat in percentile terms: the first pick of an N-pick board
 * is the 100th percentile, the last is the 0th. Returns null when the board has
 * fewer than two picks, where the curve has no range.
 *
 * Shared by season-recap value shift and keeper draft ROI, which must agree
 * exactly -- a drifted copy would silently change what "value over draft slot"
 * means between the two views. */
export function draftSlotPercentile(totalPicks: number, overallPick: number): number | null {
  if (totalPicks <= 1) return null;
  return ((totalPicks - overallPick) / (totalPicks - 1)) * 100;
}

export function isShortenedSeason(seasons: Season[], year: number): boolean {
  const season = seasons.find(s => s.year === year);
  if (!season || seasons.length === 0) return false;
  const typicalWeeks = Math.max(...seasons.map(s => s.regular_season_weeks));
  return season.regular_season_weeks < typicalWeeks / 2;
}

type WinLossTie = Pick<TeamRecord, "wins" | "losses" | "ties">;

function games(record: WinLossTie): number {
  return record.wins + record.losses + record.ties;
}

export function winPct(record: WinLossTie): number {
  const total = games(record);
  return total === 0 ? 0 : (record.wins + 0.5 * record.ties) / total;
}

/** Every owner credited on a team-season, per the co-owner rule above. */
function creditedOwners(team: Team): string[] {
  return team.owner_ids;
}

export function getChampionshipsByYear(teams: Team[], owners: Owner[]): ChampionshipYear[] {
  const byYear = new Map<number, Team[]>();
  for (const team of teams) {
    const list = byYear.get(team.year) ?? [];
    list.push(team);
    byYear.set(team.year, list);
  }

  const results: ChampionshipYear[] = [];
  for (const [year, yearTeams] of byYear) {
    const podium = (rank: number) =>
      yearTeams
        .filter(t => t.final_rank === rank)
        .flatMap(t => creditedOwners(t))
        .map(id => ownerRef(owners, id));
    results.push({
      year,
      champion: podium(1),
      runnerUp: podium(2),
      third: podium(3),
    });
  }
  return results.sort((a, b) => b.year - a.year);
}

export function getTitlesLeaderboard(teams: Team[], owners: Owner[]): TitlesLeaderboardRow[] {
  const counts = new Map<string, { titles: number; runnerUps: number }>();
  const bump = (ownerId: string, key: "titles" | "runnerUps") => {
    const entry = counts.get(ownerId) ?? { titles: 0, runnerUps: 0 };
    entry[key] += 1;
    counts.set(ownerId, entry);
  };

  for (const team of teams) {
    if (team.final_rank === 1) {
      for (const id of creditedOwners(team)) bump(id, "titles");
    } else if (team.final_rank === 2) {
      for (const id of creditedOwners(team)) bump(id, "runnerUps");
    }
  }

  // Every owner appears, even with zero titles, so the leaderboard is complete.
  for (const owner of owners) {
    if (!counts.has(owner.owner_id)) {
      counts.set(owner.owner_id, { titles: 0, runnerUps: 0 });
    }
  }

  return Array.from(counts.entries())
    .map(([ownerId, { titles, runnerUps }]) => ({
      owner: ownerRef(owners, ownerId),
      titles,
      runnerUps,
    }))
    .sort((a, b) => b.titles - a.titles || b.runnerUps - a.runnerUps);
}

function careerRecordsByOwner(teams: Team[]): Map<string, Team[]> {
  const byOwner = new Map<string, Team[]>();
  for (const team of teams) {
    for (const ownerId of creditedOwners(team)) {
      const list = byOwner.get(ownerId) ?? [];
      list.push(team);
      byOwner.set(ownerId, list);
    }
  }
  return byOwner;
}

/** Every team-season this owner is credited on (co-owned team-seasons included, per the
 * co-owner rule above), chronological ascending — matches h2h.ts's PairSummary.meetings
 * convention for per-entity history tables. */
export function getOwnerSeasons(teams: Team[], ownerId: string): Team[] {
  return teams.filter(t => t.owner_ids.includes(ownerId)).sort((a, b) => a.year - b.year);
}

export function getCareerStandings(teams: Team[], owners: Owner[]): CareerStandingRow[] {
  const byOwner = careerRecordsByOwner(teams);
  return Array.from(byOwner.entries())
    .map(([ownerId, ownerTeams]) => {
      const wins = ownerTeams.reduce((sum, t) => sum + t.overall.wins, 0);
      const losses = ownerTeams.reduce((sum, t) => sum + t.overall.losses, 0);
      const ties = ownerTeams.reduce((sum, t) => sum + t.overall.ties, 0);
      return {
        owner: ownerRef(owners, ownerId),
        wins,
        losses,
        ties,
        winPct: winPct({ wins, losses, ties }),
        seasons: ownerTeams.length,
      };
    })
    .sort((a, b) => b.wins - a.wins);
}

function rankedSingleSeasons(teams: Team[], owners: Owner[], direction: "best" | "worst"): SeasonRecordExtreme[] {
  return [...teams]
    .sort((a, b) =>
      direction === "best"
        ? winPct(b.overall) - winPct(a.overall) || b.overall.wins - a.overall.wins
        : winPct(a.overall) - winPct(b.overall) || a.overall.wins - b.overall.wins
    )
    .map(t => ({
      owners: creditedOwners(t).map(id => ownerRef(owners, id)),
      teamName: t.team_name,
      year: t.year,
      wins: t.overall.wins,
      losses: t.overall.losses,
      ties: t.overall.ties,
      winPct: winPct(t.overall),
    }));
}

/** Top N worst single-season records league-wide (rank 1 first). */
export function getWorstSingleSeasons(teams: Team[], owners: Owner[], n = 3): SeasonRecordExtreme[] {
  return rankedSingleSeasons(teams, owners, "worst").slice(0, n);
}

/** Top N best single-season records league-wide (rank 1 first). */
export function getBestSingleSeasons(teams: Team[], owners: Owner[], n = 3): SeasonRecordExtreme[] {
  return rankedSingleSeasons(teams, owners, "best").slice(0, n);
}

/** Minimum seasons played to qualify for the career-worst-win% record (avoids a
 * one-season sample size dominating the "worst ever" label). Carried over from the
 * prototypes/league-records.html design reference. */
export const MIN_SEASONS_FOR_CAREER_WIN_PCT = 5;

/** Top N worst career win% (min. `minSeasons` seasons played), rank 1 first. */
export function getWorstCareerWinPcts(
  standings: CareerStandingRow[],
  minSeasons = MIN_SEASONS_FOR_CAREER_WIN_PCT,
  n = 3
): CareerStandingRow[] {
  return standings
    .filter(row => row.seasons >= minSeasons)
    .sort((a, b) => a.winPct - b.winPct)
    .slice(0, n);
}

/** Top N best career win% (min. `minSeasons` seasons played), rank 1 first. */
export function getBestCareerWinPcts(
  standings: CareerStandingRow[],
  minSeasons = MIN_SEASONS_FOR_CAREER_WIN_PCT,
  n = 3
): CareerStandingRow[] {
  return standings
    .filter(row => row.seasons >= minSeasons)
    .sort((a, b) => b.winPct - a.winPct)
    .slice(0, n);
}

export function getCareerPoints(teams: Team[], owners: Owner[]): CareerPointsRow[] {
  const byOwner = careerRecordsByOwner(teams);
  return Array.from(byOwner.entries()).map(([ownerId, ownerTeams]) => {
    const pointsFor = ownerTeams.reduce((sum, t) => sum + t.overall.points_for, 0);
    const pointsAgainst = ownerTeams.reduce((sum, t) => sum + t.overall.points_against, 0);
    const totalGames = ownerTeams.reduce((sum, t) => sum + games(t.overall), 0);
    return {
      owner: ownerRef(owners, ownerId),
      pointsFor,
      pointsAgainst,
      differential: pointsFor - pointsAgainst,
      games: totalGames,
      pointsForPerGame: totalGames === 0 ? 0 : pointsFor / totalGames,
    };
  });
}

function toSeasonPointsExtreme(team: Team, owners: Owner[]): SeasonPointsExtreme {
  const g = games(team.overall);
  return {
    owners: creditedOwners(team).map(id => ownerRef(owners, id)),
    teamName: team.team_name,
    year: team.year,
    points: team.overall.points_for,
    games: g,
    pointsPerGame: g === 0 ? 0 : team.overall.points_for / g,
  };
}

/** Top N most points scored in a season league-wide (rank 1 first). */
export function getBestSeasonPoints(teams: Team[], owners: Owner[], n = 3): SeasonPointsExtreme[] {
  return [...teams]
    .sort((a, b) => b.overall.points_for - a.overall.points_for)
    .slice(0, n)
    .map(t => toSeasonPointsExtreme(t, owners));
}

/** Top N fewest points scored in a season league-wide (rank 1 first). */
export function getWorstSeasonPoints(teams: Team[], owners: Owner[], n = 3): SeasonPointsExtreme[] {
  return [...teams]
    .sort((a, b) => a.overall.points_for - b.overall.points_for)
    .slice(0, n)
    .map(t => toSeasonPointsExtreme(t, owners));
}

function rankedSeasonDifferentials(
  teams: Team[],
  owners: Owner[],
  direction: "best" | "worst"
): SeasonDifferentialExtreme[] {
  return [...teams]
    .sort((a, b) => {
      const diffA = a.overall.points_for - a.overall.points_against;
      const diffB = b.overall.points_for - b.overall.points_against;
      return direction === "best" ? diffB - diffA : diffA - diffB;
    })
    .map(t => ({
      owners: creditedOwners(t).map(id => ownerRef(owners, id)),
      teamName: t.team_name,
      year: t.year,
      differential: t.overall.points_for - t.overall.points_against,
    }));
}

/** Top N best single-season point differentials (rank 1 first). */
export function getBestSeasonDifferentials(teams: Team[], owners: Owner[], n = 3): SeasonDifferentialExtreme[] {
  return rankedSeasonDifferentials(teams, owners, "best").slice(0, n);
}

/** Ranks team-seasons by points-for per game, not raw total — distinct from
 * getBestSeasonPoints because a shortened season (2020) can out-pace a full one
 * on a per-game basis without winning on total points. */
export function getBestSeasonPointsPerGame(teams: Team[], owners: Owner[], n = 3): SeasonPointsExtreme[] {
  const withGames = teams.filter(t => games(t.overall) > 0);
  return [...withGames]
    .sort((a, b) => b.overall.points_for / games(b.overall) - a.overall.points_for / games(a.overall))
    .slice(0, n)
    .map(t => toSeasonPointsExtreme(t, owners));
}

/** Top N worst single-season point differentials (rank 1 first). */
export function getWorstSeasonDifferentials(teams: Team[], owners: Owner[], n = 3): SeasonDifferentialExtreme[] {
  return rankedSeasonDifferentials(teams, owners, "worst").slice(0, n);
}

export interface SeasonStreakExtreme {
  owners: OwnerRef[];
  teamName: string;
  year: number;
  length: number;
}

type StreakResult = "W" | "L" | "T";

/** Regular-season-only results (playoff_tier === null, matching the `overall`
 * record single-season stats above already draw from), chronological by week,
 * keyed "year:espn_team_id". */
/** Exported (rather than left private to this module) so ownerMilestones.ts can
 * answer "this owner's longest streak" — the league-wide getBestWinStreaks /
 * getWorstLossStreaks wrappers below only surface the top N, which can't answer
 * a per-owner question. */
export function regularSeasonResultsByTeam(matchups: Matchup[]): Map<string, StreakResult[]> {
  const byTeam = new Map<string, { week: number; result: StreakResult }[]>();
  const push = (key: string, week: number, result: StreakResult) => {
    const list = byTeam.get(key) ?? [];
    list.push({ week, result });
    byTeam.set(key, list);
  };

  for (const m of matchups) {
    if (m.playoff_tier !== null || m.winner === "UNDECIDED" || !m.away) continue;
    const homeResult: StreakResult = m.winner === "TIE" ? "T" : m.winner === "HOME" ? "W" : "L";
    const awayResult: StreakResult = m.winner === "TIE" ? "T" : m.winner === "AWAY" ? "W" : "L";
    push(`${m.year}:${m.home.espn_team_id}`, m.week, homeResult);
    push(`${m.year}:${m.away.espn_team_id}`, m.week, awayResult);
  }

  const sorted = new Map<string, StreakResult[]>();
  for (const [key, list] of byTeam) {
    sorted.set(
      key,
      list.sort((a, b) => a.week - b.week).map(x => x.result)
    );
  }
  return sorted;
}

/** Longest run of consecutive `target` results — a tie breaks a streak, same rule
 * as the head-to-head streak in h2h.ts. Exported for the same reason as
 * regularSeasonResultsByTeam above. */
export function longestRun(results: StreakResult[], target: "W" | "L"): number {
  let best = 0;
  let current = 0;
  for (const result of results) {
    current = result === target ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

function rankedSeasonStreaks(
  teams: Team[],
  owners: Owner[],
  matchups: Matchup[],
  target: "W" | "L"
): SeasonStreakExtreme[] {
  const resultsByTeam = regularSeasonResultsByTeam(matchups);
  return teams
    .map(t => ({
      owners: creditedOwners(t).map(id => ownerRef(owners, id)),
      teamName: t.team_name,
      year: t.year,
      length: longestRun(resultsByTeam.get(`${t.year}:${t.espn_team_id}`) ?? [], target),
    }))
    .filter(s => s.length > 0)
    .sort((a, b) => b.length - a.length);
}

/** Top N longest single-season winning streaks league-wide (rank 1 first). */
export function getBestWinStreaks(teams: Team[], owners: Owner[], matchups: Matchup[], n = 3): SeasonStreakExtreme[] {
  return rankedSeasonStreaks(teams, owners, matchups, "W").slice(0, n);
}

/** Top N longest single-season losing streaks league-wide (rank 1 first). */
export function getWorstLossStreaks(teams: Team[], owners: Owner[], matchups: Matchup[], n = 3): SeasonStreakExtreme[] {
  return rankedSeasonStreaks(teams, owners, matchups, "L").slice(0, n);
}
