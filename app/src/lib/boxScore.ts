import {
  BENCH_AND_IR_SLOT_IDS,
  IR_SLOT_ID,
  LINEUP_SLOT_LABELS,
  lineupSlotLabel,
  PITCHING_SLOT_IDS,
} from "./lineupSlots";
import type { BattingLine, BoxScoreEntry, PitchingLine } from "../types";

/**
 * Matchup box-score derivations: which of a player's weekly points actually
 * counted toward the team score (started slots) vs sat on the bench/IR, and
 * per-scoring-period point aggregation for the points-per-day chart.
 *
 * Point semantics: `total_points` is FULL production -- counted plus bench/IR
 * -- in every season (the pipeline's snapshot anchoring adds bench back on
 * top of ESPN's counted-only cumulative totals). The counted/bench split is
 * always derived from slots directly (`getCountedPoints` / `getBenchPoints`),
 * never from `total_points` subtraction, so both figures stay correct in any
 * season regardless of how `total_points` was stitched.
 */

export function getMatchupSideEntries(
  boxScores: BoxScoreEntry[],
  matchupId: number,
  espnTeamId: number
): BoxScoreEntry[] {
  return boxScores.filter(e => e.matchup_id === matchupId && e.espn_team_id === espnTeamId);
}

/** Sum of a player's slot points that counted toward the team score (excludes bench/IR). */
export function getCountedPoints(entry: BoxScoreEntry): number {
  return entry.slots.filter(s => !BENCH_AND_IR_SLOT_IDS.has(s.lineup_slot_id)).reduce((sum, s) => sum + s.points, 0);
}

/** Points earned in bench/IR slots -- didn't count toward the team score.
 * Sums bench slots directly rather than subtracting counted from
 * `total_points`, so it stays exact even where `total_points` lags the
 * slot detail (mid-week live captures land bench days at the weekly rebuild). */
export function getBenchPoints(entry: BoxScoreEntry): number {
  return entry.slots.filter(s => BENCH_AND_IR_SLOT_IDS.has(s.lineup_slot_id)).reduce((sum, s) => sum + s.points, 0);
}

/** Below this, bench points are float-summing noise, not real points -- they
 * would otherwise render as "0.0"/"-0.0", implying a real zero. Shared by
 * every bench-points display (Matchup/BoxScoreTable, PlayerPage's week view). */
export const BENCH_DISPLAY_EPSILON = 0.05;

/** Counted (started-slot) points, split by which side of a two-way player's
 * game the slot was actually started for -- SP/RP slots are a pitching
 * start, every other started slot is a batting start. Exact per day, since
 * each slot already records which lineup position that day's start used;
 * this is not an estimate the way splitting bench points by category would
 * be, since a benched day carries no such per-day slot signal. */
export function getCountedPointsByCategory(entry: BoxScoreEntry): { batting: number; pitching: number } {
  let batting = 0;
  let pitching = 0;
  for (const s of entry.slots) {
    if (BENCH_AND_IR_SLOT_IDS.has(s.lineup_slot_id)) continue;
    if (PITCHING_SLOT_IDS.has(s.lineup_slot_id)) pitching += s.points;
    else batting += s.points;
  }
  return { batting, pitching };
}

/** [1,2,3,8,14,15] -> "1–3, 8, 14–15" -- an IL stint reads as a stretch, not a
 * list of numbers. Input must be ascending. */
export function formatWeekRuns(weeks: number[]): string {
  if (weeks.length === 0) return "—";
  const runs: string[] = [];
  let start = weeks[0];
  let prev = weeks[0];
  for (const week of weeks.slice(1)) {
    if (week === prev + 1) {
      prev = week;
      continue;
    }
    runs.push(start === prev ? String(start) : `${start}–${prev}`);
    start = week;
    prev = week;
  }
  runs.push(start === prev ? String(start) : `${start}–${prev}`);
  return runs.join(", ");
}

/** True when the entry records real production. Normalization keeps IL days as
 * zero-point slot-only rows so IL stints can be reconstructed (normalize.py's
 * IR_SLOT_ID exception); those carry no stats and belong in the IL board, not
 * the box score. Pre-2019 rows have no stat line either but do carry points, so
 * the all-IR condition keeps this from stripping them. */
export function hasAccumulatedStats(entry: BoxScoreEntry): boolean {
  if (entry.batting !== null || entry.pitching !== null || entry.total_points !== 0) return true;
  return !(entry.slots.length > 0 && entry.slots.every(s => s.lineup_slot_id === IR_SLOT_ID));
}

export interface ILStint {
  playerId: number;
  playerName: string;
  espnTeamId: number;
  /** The current unbroken stint: consecutive weeks ending at the matchup week. */
  weeks: number[];
}

/** Players on either side of a matchup who are on the IL *during that week*,
 * with the length of the stint they're currently in. Needs the whole season's
 * entries, not just the matchup's, to walk the stint backwards -- the caller
 * already loads the year. Slot data is only real 2019+ (see lineupSlots.ts), so
 * gate on coverage.stat_lines rather than trusting an empty result. */
export function getMatchupILStints(seasonEntries: BoxScoreEntry[], week: number, espnTeamIds: number[]): ILStint[] {
  const teams = new Set(espnTeamIds);
  // (team:player) -> every week that player held the IL slot, for the walk-back below.
  const ilWeeks = new Map<string, Set<number>>();
  const names = new Map<string, { playerId: number; playerName: string; espnTeamId: number }>();
  for (const entry of seasonEntries) {
    if (entry.week > week || !teams.has(entry.espn_team_id)) continue;
    if (!entry.slots.some(s => s.lineup_slot_id === IR_SLOT_ID)) continue;
    const key = `${entry.espn_team_id}:${entry.player_id}`;
    if (!ilWeeks.has(key)) {
      ilWeeks.set(key, new Set());
      names.set(key, { playerId: entry.player_id, playerName: entry.player_name, espnTeamId: entry.espn_team_id });
    }
    ilWeeks.get(key)!.add(entry.week);
  }

  const stints: ILStint[] = [];
  for (const [key, weeks] of ilWeeks) {
    if (!weeks.has(week)) continue; // activated before this matchup -- not currently on the IL
    const run: number[] = [];
    for (let w = week; weeks.has(w); w--) run.unshift(w);
    stints.push({ ...names.get(key)!, weeks: run });
  }
  return stints.sort((a, b) => b.weeks.length - a.weeks.length || a.playerName.localeCompare(b.playerName));
}

/** One team-season's IL usage, one row per player who ever held the IL slot.
 * Same 2019+ caveat as getMatchupILStints. */
export function getTeamSeasonILWeeks(
  entries: BoxScoreEntry[]
): { playerId: number; playerName: string; weeks: number[] }[] {
  const byPlayer = new Map<number, { playerId: number; playerName: string; weeks: number[] }>();
  for (const entry of entries) {
    if (!entry.slots.some(s => s.lineup_slot_id === IR_SLOT_ID)) continue;
    const existing = byPlayer.get(entry.player_id);
    if (existing) {
      if (!existing.weeks.includes(entry.week)) existing.weeks.push(entry.week);
    } else {
      byPlayer.set(entry.player_id, { playerId: entry.player_id, playerName: entry.player_name, weeks: [entry.week] });
    }
  }
  const rows = [...byPlayer.values()];
  for (const row of rows) row.weeks.sort((a, b) => a - b);
  return rows.sort((a, b) => b.weeks.length - a.weeks.length || a.playerName.localeCompare(b.playerName));
}

export interface SlotDay {
  scoringPeriod: number;
  label: string;
}

export interface PlayerWeekSlots {
  primaryLabel: string;
  /** Every distinct slot the player occupied this week, not just the primary. */
  changedMidWeek: boolean;
  days: SlotDay[];
  /** True when the player sat in the IL slot at least one day this week. */
  onIL: boolean;
}

/** `primaryLabel` is whichever slot covers the most days that week, except the
 * IL slot: a player stashed mid-week keeps the position they actually held,
 * with `onIL` carrying the stash separately. IL only wins the label when there
 * was no position slot at all (an all-IL week, normally leafed out to the IL
 * board by hasAccumulatedStats). */
export function getPlayerWeekSlots(entry: BoxScoreEntry): PlayerWeekSlots | null {
  if (entry.slots.length === 0) return null;
  const counts = new Map<number, number>();
  for (const s of entry.slots) counts.set(s.lineup_slot_id, (counts.get(s.lineup_slot_id) ?? 0) + 1);
  let primarySlotId = entry.slots[0].lineup_slot_id;
  let max = 0;
  for (const [slotId, count] of counts) {
    if (slotId === IR_SLOT_ID) continue;
    if (count > max) {
      max = count;
      primarySlotId = slotId;
    }
  }
  const days = [...entry.slots]
    .sort((a, b) => a.scoring_period - b.scoring_period)
    .map(s => ({ scoringPeriod: s.scoring_period, label: lineupSlotLabel(s.lineup_slot_id) }));
  return {
    primaryLabel: lineupSlotLabel(primarySlotId),
    changedMidWeek: counts.size > 1,
    onIL: counts.has(IR_SLOT_ID),
    days,
  };
}

export interface EntriesByStatAvailability {
  batting: BoxScoreEntry[];
  pitching: BoxScoreEntry[];
  pointsOnly: BoxScoreEntry[];
}

/** Splits entries by which raw stat line is available, data-driven rather than
 * gated on season.coverage.stat_lines -- a two-way player appears in both
 * batting and pitching; an entry with neither (an entire pre-2019 season, or a
 * gap inside 2018's partial coverage) falls back to pointsOnly so no player
 * silently vanishes from the box score. */
export function splitEntriesByStatAvailability(entries: BoxScoreEntry[]): EntriesByStatAvailability {
  return {
    batting: entries.filter(e => e.batting !== null),
    pitching: entries.filter(e => e.pitching !== null),
    pointsOnly: entries.filter(e => e.batting === null && e.pitching === null),
  };
}

/** Every scoring period either side's slots touch, ascending -- the
 * points-per-day chart's gate (>1 period) and x-axis domain. */
export function getDistinctScoringPeriods(entries: BoxScoreEntry[]): number[] {
  const periods = new Set<number>();
  for (const entry of entries) {
    for (const slot of entry.slots) {
      periods.add(slot.scoring_period);
    }
  }
  return Array.from(periods).sort((a, b) => a - b);
}

/** One side's counted (started-slot) points for each of the given periods --
 * summed across periods this reconciles to the matchup side's score. */
export function getSidePointsByPeriod(entries: BoxScoreEntry[], periods: number[]): number[] {
  const byPeriod = new Map<number, number>(periods.map(p => [p, 0]));
  for (const entry of entries) {
    for (const slot of entry.slots) {
      if (BENCH_AND_IR_SLOT_IDS.has(slot.lineup_slot_id)) continue;
      byPeriod.set(slot.scoring_period, (byPeriod.get(slot.scoring_period) ?? 0) + slot.points);
    }
  }
  return periods.map(p => byPeriod.get(p) ?? 0);
}

/** Every box-score entry for one team-season, across every matchup week --
 * the join Owner/SeasonHistory's roster drill-down needs, since box scores
 * are stored per matchup, not pre-aggregated per team-season. */
export function getSeasonTeamEntries(boxScores: BoxScoreEntry[], espnTeamId: number): BoxScoreEntry[] {
  return boxScores.filter(e => e.espn_team_id === espnTeamId);
}

export function sumLines<T extends object>(lines: T[]): T {
  const result: Record<string, number> = {};
  for (const line of lines) {
    for (const [key, value] of Object.entries(line)) {
      result[key] = (result[key] ?? 0) + (value as number);
    }
  }
  return result as T;
}

export interface TeamSeasonStatLine {
  batting: BattingLine | null;
  pitching: PitchingLine | null;
}

/** One team-season's stat line, summed across every player who had a
 * box-score entry for that team that year. Null when no raw line exists. */
export function aggregateTeamSeasonStatLine(entries: BoxScoreEntry[]): TeamSeasonStatLine {
  const battingLines = entries.map(e => e.batting).filter((b): b is BattingLine => b !== null);
  const pitchingLines = entries.map(e => e.pitching).filter((p): p is PitchingLine => p !== null);
  return {
    batting: battingLines.length > 0 ? sumLines(battingLines) : null,
    pitching: pitchingLines.length > 0 ? sumLines(pitchingLines) : null,
  };
}

export interface SeasonPlayerLine {
  playerId: number;
  playerName: string;
  weeksRostered: number;
  countedPoints: number;
  battingCountedPoints: number;
  pitchingCountedPoints: number;
  benchPoints: number;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
  /** Every slot-day this season was the IL -- the player was stashed, never
   * active. Always false pre-2019, where slot data is a placeholder. */
  ilOnly: boolean;
  /** Which side a player with no stat line was rostered as, read off the
   * non-IL slots they occupied. Null when there's no real slot data. */
  slotSide: "batting" | "pitching" | null;
}

/** Which table a statless-but-active player belongs in, from the slots they
 * actually sat in -- a lineup slot is the only side signal a player who never
 * recorded a stat leaves behind. */
function slotSideOf(entries: BoxScoreEntry[]): "batting" | "pitching" | null {
  let batting = 0;
  let pitching = 0;
  for (const entry of entries) {
    for (const slot of entry.slots) {
      if (BENCH_AND_IR_SLOT_IDS.has(slot.lineup_slot_id)) continue;
      if (!(slot.lineup_slot_id in LINEUP_SLOT_LABELS)) continue;
      if (PITCHING_SLOT_IDS.has(slot.lineup_slot_id)) pitching++;
      else batting++;
    }
  }
  if (batting === 0 && pitching === 0) return null;
  return pitching > batting ? "pitching" : "batting";
}

/** One team-season's full roster, one row per player who ever had a box-score
 * entry that year -- not just the season-end roster, so a player traded or
 * dropped mid-season still shows up. Counted/bench points and batting/pitching
 * lines are summed across every week the player appears; a player who never
 * had a raw stat line that season (pre-2019, or a gap inside 2018's partial
 * coverage) keeps batting/pitching null rather than a fabricated zero line. */
export function aggregateSeasonRoster(entries: BoxScoreEntry[]): SeasonPlayerLine[] {
  const byPlayer = new Map<number, BoxScoreEntry[]>();
  for (const e of entries) {
    if (!byPlayer.has(e.player_id)) byPlayer.set(e.player_id, []);
    byPlayer.get(e.player_id)!.push(e);
  }

  const rows: SeasonPlayerLine[] = [];
  for (const playerEntries of byPlayer.values()) {
    let countedPoints = 0;
    let benchPoints = 0;
    let battingCounted = 0;
    let pitchingCounted = 0;
    const weeks = new Set<number>();
    const battingLines: BattingLine[] = [];
    const pitchingLines: PitchingLine[] = [];
    let everHadNonIrSlots = false;
    let allSlotsAreIr = true;
    for (const e of playerEntries) {
      weeks.add(e.week);
      countedPoints += getCountedPoints(e);
      benchPoints += getBenchPoints(e);
      const byCategory = getCountedPointsByCategory(e);
      battingCounted += byCategory.batting;
      pitchingCounted += byCategory.pitching;
      if (e.batting !== null) battingLines.push(e.batting);
      if (e.pitching !== null) pitchingLines.push(e.pitching);
      if (e.slots.length > 0) {
        everHadNonIrSlots = true;
        for (const s of e.slots) {
          if (s.lineup_slot_id !== IR_SLOT_ID) allSlotsAreIr = false;
        }
      }
    }
    rows.push({
      playerId: playerEntries[0].player_id,
      playerName: playerEntries[0].player_name,
      weeksRostered: weeks.size,
      countedPoints,
      battingCountedPoints: battingCounted,
      pitchingCountedPoints: pitchingCounted,
      benchPoints,
      batting: battingLines.length > 0 ? sumLines(battingLines) : null,
      pitching: pitchingLines.length > 0 ? sumLines(pitchingLines) : null,
      ilOnly: everHadNonIrSlots && allSlotsAreIr,
      slotSide: slotSideOf(playerEntries),
    });
  }
  return rows.sort((a, b) => b.countedPoints - a.countedPoints);
}
