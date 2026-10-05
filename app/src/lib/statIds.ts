/** ESPN MLB statId -> display label and stat-line field, ported from
 * scripts/lib/stat_ids.py's BATTING_STAT_IDS/PITCHING_STAT_IDS (the verified
 * statId -> box-score field mapping, 31 ids across every season 2009-2025).
 * Labels are short display abbreviations, not the field names -- e.g.
 * "doubles" -> "2B".
 *
 * `field` is what makes a stat line's points recomputable: the mapped set is
 * the scored union and ESPN scoring is linear per id, so
 * sum(line[field] * that season's points-per-unit) == the line's total points
 * exactly (stat_ids.py's docstring documents the verification; validate.py's
 * reconciliation check depends on it). See pointsSplit.ts. */

import type { BattingLine, PitchingLine } from "../types";

export interface StatIdEntry {
  statId: number;
  label: string;
  category: "batting" | "pitching";
}

interface BattingStatIdEntry extends StatIdEntry {
  category: "batting";
  field: keyof BattingLine;
}

interface PitchingStatIdEntry extends StatIdEntry {
  category: "pitching";
  field: keyof PitchingLine;
}

export const BATTING_STAT_IDS: BattingStatIdEntry[] = [
  { statId: 0, label: "AB", category: "batting", field: "ab" },
  { statId: 3, label: "2B", category: "batting", field: "doubles" },
  { statId: 4, label: "3B", category: "batting", field: "triples" },
  { statId: 5, label: "HR", category: "batting", field: "hr" },
  { statId: 7, label: "1B", category: "batting", field: "singles" },
  { statId: 10, label: "BB", category: "batting", field: "bb" },
  { statId: 12, label: "HBP", category: "batting", field: "hbp" },
  { statId: 20, label: "R", category: "batting", field: "r" },
  { statId: 21, label: "RBI", category: "batting", field: "rbi" },
  { statId: 23, label: "SB", category: "batting", field: "sb" },
  { statId: 24, label: "CS", category: "batting", field: "cs" },
  { statId: 26, label: "GIDP", category: "batting", field: "gidp" },
  { statId: 27, label: "K", category: "batting", field: "k" },
  { statId: 30, label: "CYC", category: "batting", field: "cyc" },
  { statId: 31, label: "GSHR", category: "batting", field: "gshr" },
  { statId: 72, label: "E", category: "batting", field: "e" },
];

export const PITCHING_STAT_IDS: PitchingStatIdEntry[] = [
  { statId: 34, label: "OUT", category: "pitching", field: "outs" },
  { statId: 37, label: "H", category: "pitching", field: "h" },
  { statId: 39, label: "BB", category: "pitching", field: "bb" },
  { statId: 42, label: "HB", category: "pitching", field: "hb" },
  { statId: 44, label: "R", category: "pitching", field: "r" },
  { statId: 45, label: "ER", category: "pitching", field: "er" },
  { statId: 48, label: "K", category: "pitching", field: "k" },
  { statId: 53, label: "W", category: "pitching", field: "wins" },
  { statId: 54, label: "L", category: "pitching", field: "losses" },
  { statId: 57, label: "SV", category: "pitching", field: "sv" },
  { statId: 58, label: "BS", category: "pitching", field: "bs" },
  { statId: 60, label: "HD", category: "pitching", field: "hd" },
  { statId: 64, label: "SHO", category: "pitching", field: "sho" },
  { statId: 65, label: "NH", category: "pitching", field: "nh" },
  { statId: 66, label: "PG", category: "pitching", field: "pg" },
];

export const ALL_STAT_IDS: StatIdEntry[] = [...BATTING_STAT_IDS, ...PITCHING_STAT_IDS];

export function statIdLabel(statId: number): string {
  return ALL_STAT_IDS.find(s => s.statId === statId)?.label ?? `#${statId}`;
}
