import { percentileWithin } from "./stats";
import { computeZscoreWithFallback, type PositionZscoreStats, type SeasonZscoreStats } from "./zscore";
import type { BoxScoreEntry, DraftPick, PlayerSeason, PlayerSeasonPoints, Season } from "../types";

export interface PlayerComparisonInput {
  playerId: number;
  year: number;
}

export interface WeeklyConsistency {
  mean: number;
  stdev: number;
  /** Coefficient of variation — stdev relative to mean, so a 300-point player
   * and a 30-point player can be compared on steadiness. Lower is steadier. */
  cv: number;
  weeks: number;
}

export interface PlayoffSplit {
  regularSeasonPoints: number;
  playoffPoints: number;
  regularSeasonWeeks: number;
  playoffWeeks: number;
}

export interface PlayerComparisonResult {
  playerId: number;
  playerName: string;
  year: number;
  /** Null when no season-points row exists at all — distinct from a real 0.0,
   * the same distinction getPlayerSeasonPoints draws. */
  points: number | null;
  /** Null when that year has no distribution to rank within. */
  zscore: number | null;
  percentile: number | null;
  /** 2019+ only (box-score coverage); null earlier. */
  weeklyConsistency: WeeklyConsistency | null;
  playoffSplit: PlayoffSplit | null;
  /** Overall pick number if the player was drafted that year. */
  draftPosition: number | null;
  /** Points percentile minus the percentile the draft slot implied. Positive
   * means the player outproduced his draft cost. Null when undrafted or
   * unrankable. */
  draftValueOverReplacement: number | null;
}

export type LetterGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export interface SideComparison {
  sideA: PlayerComparisonResult[];
  sideB: PlayerComparisonResult[];
  aggregate: {
    sideAZscoreSum: number;
    sideBZscoreSum: number;
    sideAPoints: number;
    sideBPoints: number;
    /**
     * Side A's z-score total minus Side B's — a NORMALIZED margin, positive
     * favors Side A. Deliberately a different measure from `letterGrade` and
     * `isFair`, which compare raw points: z-scores say "how far above his
     * field", points say "how much production changed hands". A UI showing both
     * should label them separately rather than implying one derives from the
     * other.
     */
    surplusZscore: number;
    surplusPoints: number;
    letterGrade: LetterGrade;
    isFair: boolean;
  };
}

/** Precomputed lookups shared across every player in a comparison, so an NvN
 * package doesn't rescan the 7,195-row points file once per player. */
export interface ComparisonIndex {
  pointsByKey: Map<string, PlayerSeasonPoints>;
  positionByKey: Map<string, number>;
  pointsByYear: Map<number, number[]>;
  draftByKey: Map<string, DraftPick>;
  totalPicksByYear: Map<number, number>;
  regularSeasonWeeksByYear: Map<number, number>;
}

/**
 * Build the shared index once per route/render, not once per player.
 *
 * Keyed "year:player_id" throughout, the same key shape stats.ts and
 * zscore.ts already use.
 *
 * `seasons` is narrowed to the two fields actually read, so callers can pass
 * full `Season[]` and tests don't have to fabricate a 15-field league config
 * to check a week split.
 */
export function buildComparisonIndex(
  seasonPoints: PlayerSeasonPoints[],
  playerSeasons: PlayerSeason[],
  draftPicks: DraftPick[],
  seasons: Pick<Season, "year" | "regular_season_weeks">[]
): ComparisonIndex {
  const pointsByKey = new Map<string, PlayerSeasonPoints>();
  const pointsByYear = new Map<number, number[]>();
  for (const row of seasonPoints) {
    pointsByKey.set(`${row.year}:${row.player_id}`, row);
    const list = pointsByYear.get(row.year) ?? [];
    list.push(row.points);
    pointsByYear.set(row.year, list);
  }

  const positionByKey = new Map<string, number>();
  for (const season of playerSeasons) {
    positionByKey.set(`${season.year}:${season.player_id}`, season.default_position_id);
  }

  const draftByKey = new Map<string, DraftPick>();
  const totalPicksByYear = new Map<number, number>();
  for (const pick of draftPicks) {
    draftByKey.set(`${pick.year}:${pick.player_id}`, pick);
    totalPicksByYear.set(pick.year, Math.max(totalPicksByYear.get(pick.year) ?? 0, pick.overall_pick_number));
  }

  const regularSeasonWeeksByYear = new Map(seasons.map(s => [s.year, s.regular_season_weeks]));

  return { pointsByKey, positionByKey, pointsByYear, draftByKey, totalPicksByYear, regularSeasonWeeksByYear };
}

/**
 * The percentile of draft capital a slot represents, against that year's
 * actual board. 1st overall ≈ 100, the last pick ≈ 0. Null when the year's board
 * isn't known.
 *
 * The denominator is the HIGHEST `overall_pick_number` observed for the season,
 * which equals the full board (keepers + live picks). `overall_pick_number` is
 * numbered across the whole board — keeper slots take 1-50 and live picks run
 * 51-300 — so pairing a full-board numerator with a live-only denominator would
 * put the last pick at ~-20%.
 *
 * A consequence worth knowing when reading these figures: a keeper occupying
 * slot 3 reads as ~99th-percentile draft capital. That is the right reading for
 * ROI (keeping a player at slot 3 spends slot-3 capital), but it is not the
 * same as "drafted 3rd overall in the live draft".
 */
function draftPositionPercentile(overall: number, totalPicks: number): number | null {
  if (totalPicks <= 0) return null;
  return ((totalPicks - overall) / totalPicks) * 100;
}

/**
 * Weekly mean/stdev/CV for one player-season from its box-score lines.
 *
 * 2019+ only, because that's where the weekly archive starts (2018 is partial).
 * Returns null for a season with fewer than two scored weeks — one week is a
 * point, not a distribution.
 */
export function computeWeeklyConsistency(entries: BoxScoreEntry[]): WeeklyConsistency | null {
  const byWeek = new Map<number, number>();
  for (const entry of entries) {
    byWeek.set(entry.week, (byWeek.get(entry.week) ?? 0) + entry.total_points);
  }
  const values = [...byWeek.values()];
  if (values.length < 2) return null;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  return { mean, stdev, cv: mean === 0 ? 0 : stdev / mean, weeks: values.length };
}

/**
 * Regular-season vs. playoff production for one player-season.
 *
 * Split on the season's own `regular_season_weeks` rather than a hardcoded
 * week number — the league's schedule length changed across the archive (2020
 * was 8 weeks against the usual 21-22)
 */
export function computePlayoffSplit(entries: BoxScoreEntry[], regularSeasonWeeks: number): PlayoffSplit | null {
  if (entries.length === 0) return null;

  let regularSeasonPoints = 0;
  let playoffPoints = 0;
  const regularWeeks = new Set<number>();
  const playoffWeeks = new Set<number>();

  for (const entry of entries) {
    if (entry.week > regularSeasonWeeks) {
      playoffPoints += entry.total_points;
      playoffWeeks.add(entry.week);
    } else {
      regularSeasonPoints += entry.total_points;
      regularWeeks.add(entry.week);
    }
  }

  return {
    regularSeasonPoints,
    playoffPoints,
    regularSeasonWeeks: regularWeeks.size,
    playoffWeeks: playoffWeeks.size,
  };
}

/**
 * Evaluate one player-season.
 *
 * `boxScoresForYear` is the already-loaded weekly archive for THAT year, or
 * undefined for a year outside box-score coverage — in which case the weekly
 * and playoff dimensions come back null rather than zero, so the UI can hide
 * them instead of showing a fabricated flat line. Entries are re-filtered by
 * year defensively: a caller passing a multi-year list would otherwise get
 * phantom weeks from other seasons.
 */
export function comparePlayerSeason(
  input: PlayerComparisonInput,
  index: ComparisonIndex,
  seasonZscoreStats: Map<number, SeasonZscoreStats>,
  positionZscoreStats: Map<string, PositionZscoreStats>,
  boxScoresForYear?: BoxScoreEntry[]
): PlayerComparisonResult {
  const key = `${input.year}:${input.playerId}`;
  const row = index.pointsByKey.get(key) ?? null;
  const points = row?.points ?? null;
  const positionId = index.positionByKey.get(key) ?? null;

  const zscore =
    points === null
      ? null
      : computeZscoreWithFallback(points, input.year, positionId, seasonZscoreStats, positionZscoreStats);

  const field = index.pointsByYear.get(input.year) ?? [];
  const percentile = points === null ? null : percentileWithin(points, field);

  const playerEntries = boxScoresForYear?.filter(e => e.year === input.year && e.player_id === input.playerId) ?? [];
  const weeklyConsistency = playerEntries.length > 0 ? computeWeeklyConsistency(playerEntries) : null;
  const regularSeasonWeeks = index.regularSeasonWeeksByYear.get(input.year);
  const playoffSplit =
    playerEntries.length > 0 && regularSeasonWeeks !== undefined
      ? computePlayoffSplit(playerEntries, regularSeasonWeeks)
      : null;

  const pick = index.draftByKey.get(key) ?? null;
  const totalPicks = index.totalPicksByYear.get(input.year) ?? 0;
  const slotPercentile = pick ? draftPositionPercentile(pick.overall_pick_number, totalPicks) : null;

  return {
    playerId: input.playerId,
    // `||` not `??`: an unresolvable draft pick carries an empty player_name,
    // which is "nothing usable" rather than a real name.
    playerName: row?.player_name || pick?.player_name || `Player ${input.playerId}`,
    year: input.year,
    points,
    zscore,
    percentile,
    weeklyConsistency,
    playoffSplit,
    draftPosition: pick?.overall_pick_number ?? null,
    draftValueOverReplacement: percentile !== null && slotPercentile !== null ? percentile - slotPercentile : null,
  };
}

/**
 * Letter grade for a trade, from the two sides' point totals.
 *
 * Takes both sides rather than a surplus and a baseline so the denominator is
 * unambiguous: the margin is measured against the SMALLER side, which is what
 * makes "one side got twice as much" read the same regardless of argument
 * order. Grades are from Side A's perspective — swapping the arguments mirrors
 * the scale (A+ becomes F).
 *
 * A trade where the smaller side scored nothing has no meaningful ratio; it
 * grades on which side got something at all.
 */
export function computeLetterGrade(sideAPoints: number, sideBPoints: number): LetterGrade {
  const smaller = Math.min(sideAPoints, sideBPoints);
  const surplus = sideAPoints - sideBPoints;

  if (smaller <= 0) {
    if (surplus > 0) return "A+";
    if (surplus < 0) return "F";
    return "C";
  }

  const ratio = surplus / smaller;
  if (ratio > 0.5) return "A+";
  if (ratio > 0.25) return "A";
  if (ratio > 0.1) return "B";
  if (ratio >= -0.1) return "C";
  if (ratio >= -0.25) return "D";
  return "F";
}

/** Within 10% on points — the same band `computeLetterGrade` calls a "C". */
export function isFairTrade(sideAPoints: number, sideBPoints: number): boolean {
  const smaller = Math.min(sideAPoints, sideBPoints);
  if (smaller <= 0) return sideAPoints === sideBPoints;
  return Math.abs(sideAPoints - sideBPoints) / smaller <= 0.1;
}

/**
 * Compare two sides of a trade, 1v1 or NvN.
 *
 * Sides are summed rather than averaged: a package deal's value is everything
 * it contains, so three useful players really can outweigh one star.
 * Unrankable player-seasons contribute 0 to the totals rather than dropping the
 * side, so a package's size is never silently reduced.
 */
export function compareTradeSides(
  sideAInputs: PlayerComparisonInput[],
  sideBInputs: PlayerComparisonInput[],
  index: ComparisonIndex,
  seasonZscoreStats: Map<number, SeasonZscoreStats>,
  positionZscoreStats: Map<string, PositionZscoreStats>,
  boxScoresByYear?: Map<number, BoxScoreEntry[]>
): SideComparison {
  const evaluate = (input: PlayerComparisonInput) =>
    comparePlayerSeason(input, index, seasonZscoreStats, positionZscoreStats, boxScoresByYear?.get(input.year));

  const sideA = sideAInputs.map(evaluate);
  const sideB = sideBInputs.map(evaluate);

  const sumZ = (side: PlayerComparisonResult[]) => side.reduce((total, r) => total + (r.zscore ?? 0), 0);
  const sumPoints = (side: PlayerComparisonResult[]) => side.reduce((total, r) => total + (r.points ?? 0), 0);

  const sideAZscoreSum = sumZ(sideA);
  const sideBZscoreSum = sumZ(sideB);
  const sideAPoints = sumPoints(sideA);
  const sideBPoints = sumPoints(sideB);

  return {
    sideA,
    sideB,
    aggregate: {
      sideAZscoreSum,
      sideBZscoreSum,
      sideAPoints,
      sideBPoints,
      surplusZscore: sideAZscoreSum - sideBZscoreSum,
      surplusPoints: sideAPoints - sideBPoints,
      letterGrade: computeLetterGrade(sideAPoints, sideBPoints),
      isFair: isFairTrade(sideAPoints, sideBPoints),
    },
  };
}
