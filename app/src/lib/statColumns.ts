import { formatInnings } from "./format";
import type { BattingLine, PitchingLine } from "../types";

/** The minimum a row needs to feed the batting/pitching counting-stat
 * columns — shared by the per-season and all-time player stat tables. */
export interface StatLineSource {
  batting: BattingLine | null;
  pitching: PitchingLine | null;
}

export interface StatColumnDef {
  key: string;
  label: string;
  //  Distinguishes batting vs. pitching "K" for screen readers where it would otherwise both be "K" (strikeouts) in the same table
  ariaLabel?: string;
  value: (row: StatLineSource) => string;
  sortValue: (row: StatLineSource) => number;
}

//  Replace O with "—" where it would be wrong as a stat
function stat(value: number | undefined, hasLine: boolean): string {
  return hasLine ? String(value ?? 0) : "—";
}

export const BATTING_COLUMNS: StatColumnDef[] = [
  { key: "ab", label: "AB", value: r => stat(r.batting?.ab, r.batting !== null), sortValue: r => r.batting?.ab ?? 0 },
  { key: "r", label: "R", value: r => stat(r.batting?.r, r.batting !== null), sortValue: r => r.batting?.r ?? 0 },
  {
    key: "1b",
    label: "1B",
    value: r => stat(r.batting?.singles, r.batting !== null),
    sortValue: r => r.batting?.singles ?? 0,
  },
  {
    key: "2b",
    label: "2B",
    value: r => stat(r.batting?.doubles, r.batting !== null),
    sortValue: r => r.batting?.doubles ?? 0,
  },
  {
    key: "3b",
    label: "3B",
    value: r => stat(r.batting?.triples, r.batting !== null),
    sortValue: r => r.batting?.triples ?? 0,
  },
  { key: "hr", label: "HR", value: r => stat(r.batting?.hr, r.batting !== null), sortValue: r => r.batting?.hr ?? 0 },
  {
    key: "rbi",
    label: "RBI",
    value: r => stat(r.batting?.rbi, r.batting !== null),
    sortValue: r => r.batting?.rbi ?? 0,
  },
  {
    key: "bat_k",
    label: "K",
    ariaLabel: "Batting strikeouts",
    value: r => stat(r.batting?.k, r.batting !== null),
    sortValue: r => r.batting?.k ?? 0,
  },
  { key: "sb", label: "SB", value: r => stat(r.batting?.sb, r.batting !== null), sortValue: r => r.batting?.sb ?? 0 },
  { key: "cs", label: "CS", value: r => stat(r.batting?.cs, r.batting !== null), sortValue: r => r.batting?.cs ?? 0 },
];

export const PITCHING_COLUMNS: StatColumnDef[] = [
  {
    key: "ip",
    label: "IP",
    value: r => (r.pitching !== null ? formatInnings(r.pitching?.outs ?? 0) : "—"),
    sortValue: r => r.pitching?.outs ?? 0,
  },
  { key: "h", label: "H", value: r => stat(r.pitching?.h, r.pitching !== null), sortValue: r => r.pitching?.h ?? 0 },
  {
    key: "er",
    label: "ER",
    value: r => stat(r.pitching?.er, r.pitching !== null),
    sortValue: r => r.pitching?.er ?? 0,
  },
  {
    key: "bb",
    label: "BB",
    value: r => stat(r.pitching?.bb, r.pitching !== null),
    sortValue: r => r.pitching?.bb ?? 0,
  },
  {
    key: "pit_k",
    label: "K",
    ariaLabel: "Pitching strikeouts",
    value: r => stat(r.pitching?.k, r.pitching !== null),
    sortValue: r => r.pitching?.k ?? 0,
  },
  {
    key: "w",
    label: "W",
    value: r => stat(r.pitching?.wins, r.pitching !== null),
    sortValue: r => r.pitching?.wins ?? 0,
  },
  {
    key: "l",
    label: "L",
    value: r => stat(r.pitching?.losses, r.pitching !== null),
    sortValue: r => r.pitching?.losses ?? 0,
  },
  {
    key: "sv",
    label: "SV",
    value: r => stat(r.pitching?.sv, r.pitching !== null),
    sortValue: r => r.pitching?.sv ?? 0,
  },
  {
    key: "bs",
    label: "BS",
    value: r => stat(r.pitching?.bs, r.pitching !== null),
    sortValue: r => r.pitching?.bs ?? 0,
  },
];

export const STAT_COLUMNS = [...BATTING_COLUMNS, ...PITCHING_COLUMNS];
