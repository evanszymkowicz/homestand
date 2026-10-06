import type { PlayerComparisonResult } from "./playerComparison";
import type { BoxScoreEntry } from "../types";

/**
 * Chart-data builders for the Trade Machine's per-stat visuals.
 *
 * Every function here is a pure derivation over the same already-loaded JSON
 * the rest of the evaluator reads, so the components stay presentational and
 * the shapes stay unit-testable.
 */

export interface WeeklyHeadToHeadRow {
  week: number;
  /** Combined box-score points that week for the side-A players. */
  sideA: number;
  /** Combined box-score points that week for the side-B players. */
  sideB: number;
}

/**
 * The week-by-week scoring total for each side of a deal, from the year's box
 * scores. Weeks with no box-score line from any selected player are omitted --
 * a week where both sides were entirely shut out reads the same as one that
 * simply was not played.
 */
export function computeWeeklyHeadToHead(
  sideAPlayerIds: number[],
  sideBPlayerIds: number[],
  year: number,
  boxScoresByYear: Map<number, BoxScoreEntry[]>
): WeeklyHeadToHeadRow[] {
  const aIds = new Set(sideAPlayerIds);
  const bIds = new Set(sideBPlayerIds);
  if (aIds.size === 0 && bIds.size === 0) return [];

  const byWeek = new Map<number, { sideA: number; sideB: number }>();
  for (const entry of boxScoresByYear.get(year) ?? []) {
    if (entry.year !== year) continue;
    const side = aIds.has(entry.player_id) ? "sideA" : bIds.has(entry.player_id) ? "sideB" : null;
    if (!side) continue;
    const row = byWeek.get(entry.week) ?? { sideA: 0, sideB: 0 };
    row[side] += entry.total_points;
    byWeek.set(entry.week, row);
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, row]) => ({ week, sideA: row.sideA, sideB: row.sideB }));
}

export interface TradeRadarMetric {
  /** Stable key for React lists. NOTE: no data table consumes this yet --
   * RadarComparison renders the chart only, so the two radar axes it plots have
   * no tabular equivalent anywhere in the app. Render one, or drop this claim. */
  key: string;
  /** Axis label shown on the chart. */
  label: string;
  /** Normalized 0-100, the stronger side reading 100 on its own axis. */
  sideA: number;
  sideB: number;
}

/**
 * The multi-dimensional radar for a deal.
 *
 * Each axis is a different unit (points sum vs. z-score sum vs. a share), so
 * there is no honest shared raw scale -- the chart normalizes each dimension
 * to the stronger of the two sides, which is exactly the comparison the radar
 * exists to draw. Dimensions with no underlying data on either side render as
 * 50/50 so the polygon stays comparable across every axis.
 */
export function buildRadarComparison(
  sideA: PlayerComparisonResult[],
  sideB: PlayerComparisonResult[]
): TradeRadarMetric[] {
  const scale = (a: number, b: number): [number, number] => {
    const top = Math.max(a, b);
    if (top <= 0) return [50, 50];
    return [Math.max(0, Math.min(100, (a / top) * 100)), Math.max(0, Math.min(100, (b / top) * 100))];
  };

  const metrics: Omit<TradeRadarMetric, "sideA" | "sideB">[] = [
    { key: "points", label: "Points" },
    { key: "zscore", label: "Z-Score" },
    { key: "percentile", label: "Percentile" },
    { key: "consistency", label: "Consistency" },
    { key: "playoff", label: "Playoff" },
    { key: "draft", label: "Draft Value" },
  ];

  const result: TradeRadarMetric[] = [];
  for (const metric of metrics) {
    const [a, b] = scale(rawValue(metric.key, sideA), rawValue(metric.key, sideB));
    result.push({ ...metric, sideA: a, sideB: b });
  }
  return result;
}

function rawValue(key: string, side: PlayerComparisonResult[]): number {
  switch (key) {
    case "points":
      return side.reduce((t, r) => t + (r.points ?? 0), 0);
    case "zscore":
      return side.reduce((t, r) => t + (r.zscore ?? 0), 0);
    case "percentile":
      return mean(side.map(r => r.percentile)) ?? 0;
    case "consistency":
      // Coefficient of variation: lower is steadier, so express as 1/(1+cv) to
      // keep "bigger = better" across every radar axis.
      return mean(side.map(r => (r.weeklyConsistency ? 1 / (1 + r.weeklyConsistency.cv) : null))) ?? 0;
    case "playoff":
      // Share of a player's production that came in the playoff weeks.
      return (
        mean(
          side.map(r => {
            const split = r.playoffSplit;
            if (!split) return null;
            const total = split.regularSeasonPoints + split.playoffPoints;
            return total === 0 ? 0 : split.playoffPoints / total;
          })
        ) ?? 0
      );
    case "draft":
      return mean(side.map(r => r.draftValueOverReplacement)) ?? 0;
    default:
      return 0;
  }
}

function mean(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}
