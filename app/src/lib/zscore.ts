import { DISPLAY_EXCLUDED_POSITION_IDS } from "./positions";
import type { PlayerSeason, PlayerSeasonPoints } from "../types";

/**
 * Season and position z-scores for fantasy point totals — how far above or
 * below its field a player-season scored, in standard deviations.
 *
 * A percentile (stats.ts) answers "how many did he beat"; a z-score answers
 * "by how much", which is what comparing two sides of a trade needs: three
 * ordinary starters and one superstar can share a percentile sum and be wildly
 * different players.
 *
 * Facts in, facts out — every function here is pure over already-loaded JSON.
 */

/** SP and RP, in `games_played_by_position`'s id space (see positions.ts). */
const PITCHER_POSITION_IDS: ReadonlySet<number> = new Set([1, 11]);

/** Position-player appearances needed to enter a z-score field. A regular
 * starter plays ~150; this admits part-time regulars without letting a
 * September call-up skew a distribution. */
export const MIN_BATTING_GAMES = 50;

/**
 * Pitcher appearances needed to enter a z-score field.
 *
 * Much lower than the batting floor because these are APPEARANCES, not innings:
 * a starter makes ~30 starts and a reliever ~60 outings against a position
 * player's ~150 games. The archive's 2024 maximum on the pitching side is 79.
 */
export const MIN_PITCHER_GAMES = 20;

/**
 * Appearances behind the eligibility threshold, split by side of the ball.
 *
 * "Games" here means APPEARANCES AT A POSITION — not games played, and
 * emphatically not innings pitched. `games_played_by_position` is the only
 * per-season playing-time signal the archive carries: `PlayerSeason` has no
 * `games_played`, `ab`, `ip`, or `outs` field, so any threshold phrased in
 * at-bats or innings is unsatisfiable and a pitcher-appearance count read as
 * innings would treat a 32-outing reliever as ~200 IP.
 *
 * Each side is the MAX across its position buckets, never the sum: a player who
 * appeared at 2B and SS in the same game is counted in both buckets, so summing
 * double-counts. It is not a rounding error — 2023 Zach McKinstry sums to 186
 * games across seven positions in a 162-game season, against a real max of 52.
 *
 * PH (id 12) is excluded via DISPLAY_EXCLUDED_POSITION_IDS: a plate appearance
 * is not a fielding position, and counting it would let bench bats qualify off
 * pinch-hit cameos.
 */
export function getQualifyingGames(season: PlayerSeason): { batting: number; pitching: number } {
  let batting = 0;
  let pitching = 0;
  for (const [positionId, games] of Object.entries(season.games_played_by_position)) {
    const id = Number(positionId);
    if (DISPLAY_EXCLUDED_POSITION_IDS.has(id)) continue;
    if (PITCHER_POSITION_IDS.has(id)) pitching = Math.max(pitching, games);
    else batting = Math.max(batting, games);
  }
  return { batting, pitching };
}

/**
 * Whether a player-season saw enough playing time to belong in a z-score field.
 *
 * Either side passing is enough, so a two-way player qualifies on his stronger
 * half — the same rule getVersatilePlayers applies. The pitching floor is much
 * lower than the batting one because these are appearances: a starter makes ~30
 * starts and a reliever ~60 outings against a position player's ~150 games.
 */
export function qualifiesForZscore(
  season: PlayerSeason,
  minBattingGames = MIN_BATTING_GAMES,
  minPitcherGames = MIN_PITCHER_GAMES
): boolean {
  const { batting, pitching } = getQualifyingGames(season);
  return batting >= minBattingGames || pitching >= minPitcherGames;
}

export interface ZscoreStats {
  mean: number;
  stdev: number;
  count: number;
}

export interface SeasonZscoreStats extends ZscoreStats {
  year: number;
}

export interface PositionZscoreStats extends ZscoreStats {
  year: number;
  positionId: number;
}

/** Returns null for a field too thin to describe a distribution. The same `n < 2` rule buildSeasonPercentiles uses so a one-player year yields no stats rather than a stdev of 0. */
function describe(values: number[]): ZscoreStats | null {
  const count = values.length;
  if (count < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / count;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / count;
  return { mean, stdev: Math.sqrt(variance), count };
}

/** Qualifying player-seasons keyed "year:player_id", so the points rows can be
 * filtered without rescanning `playerSeasons` per row. */
function qualifyingKeys(playerSeasons: PlayerSeason[], minBattingGames: number, minPitcherGames: number): Set<string> {
  const keys = new Set<string>();
  for (const season of playerSeasons) {
    if (qualifiesForZscore(season, minBattingGames, minPitcherGames)) keys.add(`${season.year}:${season.player_id}`);
  }
  return keys;
}

/** League-wide points distribution per season, over qualifying players only.
 * Keyed by year. */
export function computeSeasonZscoreStats(
  seasonPoints: PlayerSeasonPoints[],
  playerSeasons: PlayerSeason[],
  minBattingGames = MIN_BATTING_GAMES,
  minPitcherGames = MIN_PITCHER_GAMES
): Map<number, SeasonZscoreStats> {
  const qualifying = qualifyingKeys(playerSeasons, minBattingGames, minPitcherGames);

  const byYear = new Map<number, number[]>();
  for (const row of seasonPoints) {
    if (!qualifying.has(`${row.year}:${row.player_id}`)) continue;
    const list = byYear.get(row.year) ?? [];
    list.push(row.points);
    byYear.set(row.year, list);
  }

  const stats = new Map<number, SeasonZscoreStats>();
  for (const [year, values] of byYear) {
    const described = describe(values);
    if (described) stats.set(year, { year, ...described });
  }
  return stats;
}

/**
 * Points distribution per season per position, over qualifying players only.
 * Keyed "year:positionId".
 *
 * Scoped by `default_position_id` — that season's declared primary, not the
 * career one and not the full eligibility set, so each player-season lands in
 * exactly one field and the distribution stays a partition of the league.
 */
export function computePositionZscoreStats(
  seasonPoints: PlayerSeasonPoints[],
  playerSeasons: PlayerSeason[],
  minBattingGames = MIN_BATTING_GAMES,
  minPitcherGames = MIN_PITCHER_GAMES
): Map<string, PositionZscoreStats> {
  const qualifying = new Map<string, number>();
  for (const season of playerSeasons) {
    if (!qualifiesForZscore(season, minBattingGames, minPitcherGames)) continue;
    qualifying.set(`${season.year}:${season.player_id}`, season.default_position_id);
  }

  const byGroup = new Map<string, { year: number; positionId: number; values: number[] }>();
  for (const row of seasonPoints) {
    const positionId = qualifying.get(`${row.year}:${row.player_id}`);
    if (positionId === undefined) continue;
    const key = `${row.year}:${positionId}`;
    const group = byGroup.get(key) ?? { year: row.year, positionId, values: [] };
    group.values.push(row.points);
    byGroup.set(key, group);
  }

  const stats = new Map<string, PositionZscoreStats>();
  for (const [key, group] of byGroup) {
    const described = describe(group.values);
    if (described) stats.set(key, { year: group.year, positionId: group.positionId, ...described });
  }
  return stats;
}

/** Standard deviations from the mean. Zero when the field is flat (every
 * player scored the same), which is a real answer rather than a divide-by-zero:
 * nobody stood out. */
export function computeZscore(points: number, stats: ZscoreStats): number {
  if (stats.stdev === 0) return 0;
  return (points - stats.mean) / stats.stdev;
}

/**
 * Z-score against a player's own position, falling back to the league-wide
 * season field.
 *
 * The position field is the better comparison — a catcher's 400 points means
 * something different from an outfielder's — but a thin position-year has no
 * distribution to rank within, so it falls back rather than returning nothing.
 * Null only when neither field exists.
 */
export function computeZscoreWithFallback(
  points: number,
  year: number,
  positionId: number | null,
  seasonStats: Map<number, SeasonZscoreStats>,
  positionStats: Map<string, PositionZscoreStats>
): number | null {
  if (positionId !== null) {
    const scoped = positionStats.get(`${year}:${positionId}`);
    if (scoped) return computeZscore(points, scoped);
  }
  const league = seasonStats.get(year);
  return league ? computeZscore(points, league) : null;
}
