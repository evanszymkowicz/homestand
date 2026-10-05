import type { SeasonPlayerLine } from "./boxScore";
import { BATTING_STAT_IDS, PITCHING_STAT_IDS } from "./statIds";
import type { Season, ScoringItem } from "../types";

/**
 * Splitting a stat line's fantasy points into the batting half and the
 * pitching half to solve the two-way-player question (Ohtani, plus the handful of others).
 *
 * ESPN scoring is linear per
 * statId and the mapped statId set is the full scored union, so
 * sum(stat * that season's points-per-unit) reproduces the line's total
 * exactly -- see statIds.ts and scripts/lib/stat_ids.py's verification notes.
 * Recomputed against the archive, batting + pitching lands on
 * player_season_points.json's total to the cent in every Ohtani season
 * (2018-2025), including the two years his pitching half came out negative.
 *
 * The split covers *all* days, started and benched alike, matching how
 * total_points and player_season_points.json are summed -- it is not the
 * started-only figure getCountedPoints returns. A line with no batting (or no
 * pitching) half returns null for that side rather than a zero, so a
 * bat-only player is excluded from a pitching-points ranking instead of
 * sitting at the bottom of it.
 */

export interface CategoryPoints {
  batting: number | null;
  pitching: number | null;
}

export type ScoringByYear = Map<number, Map<number, number>>;

/** statId -> points-per-unit for each season, built once per page. */
export function buildScoringByYear(seasons: Season[]): ScoringByYear {
  return new Map(seasons.map(s => [s.year, new Map(s.scoring.map((i: ScoringItem) => [i.stat_id, i.points]))]));
}

export function splitLinePoints(line: SeasonPlayerLine, rules: Map<number, number> | undefined): CategoryPoints {
  if (!rules) return { batting: null, pitching: null };

  let batting: number | null = null;
  if (line.batting) {
    const b = line.batting;
    batting = BATTING_STAT_IDS.reduce((sum, s) => sum + b[s.field] * (rules.get(s.statId) ?? 0), 0);
  }

  let pitching: number | null = null;
  if (line.pitching) {
    const p = line.pitching;
    pitching = PITCHING_STAT_IDS.reduce((sum, s) => sum + p[s.field] * (rules.get(s.statId) ?? 0), 0);
  }

  return { batting, pitching };
}
