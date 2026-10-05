import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { Headshot } from "../../components/Headshot";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import { formatInnings, formatPoints } from "../../lib/format";
import { PTS_SEMANTICS_TOOLTIP_COUNTED } from "../../lib/ptsSemantics";
import type { SeasonPlayerLine } from "../../lib/boxScore";
import type { SeasonRosterMarkers } from "../../lib/transactions";

export type SeasonRosterTableKind = "batting" | "pitching" | "points";

interface SeasonRosterTableProps {
  title: string;
  kind: SeasonRosterTableKind;
  rows: SeasonPlayerLine[];
  /** Undefined for years the transaction ledger doesn't cover -- no marker renders. */
  markers?: SeasonRosterMarkers;
}

interface ColumnDef {
  key: string;
  label: string;
  value: (row: SeasonPlayerLine) => string;
  sortValue: (row: SeasonPlayerLine) => number;
}

/** A player with no line on this side reads as a dash, not a zero -- "0 AB" and
 * "never batted" are different facts, and sorting sinks the dashes. Mirrors
 * Matchup/BoxScoreTable.tsx's per-week columns. */
function battingCol(
  key: string,
  label: string,
  pick: (b: NonNullable<SeasonPlayerLine["batting"]>) => number,
  format: (n: number) => string = String
): ColumnDef {
  return {
    key,
    label,
    value: r => (r.batting ? format(pick(r.batting)) : "—"),
    sortValue: r => (r.batting ? pick(r.batting) : -1),
  };
}

function pitchingCol(
  key: string,
  label: string,
  pick: (p: NonNullable<SeasonPlayerLine["pitching"]>) => number,
  format: (n: number) => string = String
): ColumnDef {
  return {
    key,
    label,
    value: r => (r.pitching ? format(pick(r.pitching)) : "—"),
    sortValue: r => (r.pitching ? pick(r.pitching) : -1),
  };
}

const BATTING_COLUMNS: ColumnDef[] = [
  battingCol("ab", "AB", b => b.ab),
  battingCol("r", "R", b => b.r),
  battingCol("1b", "1B", b => b.singles),
  battingCol("2b", "2B", b => b.doubles),
  battingCol("3b", "3B", b => b.triples),
  battingCol("hr", "HR", b => b.hr),
  battingCol("rbi", "RBI", b => b.rbi),
  battingCol("k", "K", b => b.k),
  battingCol("sb", "SB", b => b.sb),
  battingCol("cs", "CS", b => b.cs),
];

const PITCHING_COLUMNS: ColumnDef[] = [
  pitchingCol("ip", "IP", p => p.outs, formatInnings),
  pitchingCol("h", "H", p => p.h),
  pitchingCol("er", "ER", p => p.er),
  pitchingCol("bb", "BB", p => p.bb),
  pitchingCol("k", "K", p => p.k),
  pitchingCol("w", "W", p => p.wins),
  pitchingCol("l", "L", p => p.losses),
  pitchingCol("sv", "SV", p => p.sv),
  pitchingCol("bs", "BS", p => p.bs),
];

function getPrimaryStatColumn(kind: SeasonRosterTableKind): ColumnDef | undefined {
  if (kind === "batting") return BATTING_COLUMNS[0];
  if (kind === "pitching") return PITCHING_COLUMNS[0];
  return undefined;
}

function getSecondaryStatColumns(kind: SeasonRosterTableKind): ColumnDef[] {
  if (kind === "batting") return BATTING_COLUMNS.slice(1);
  if (kind === "pitching") return PITCHING_COLUMNS.slice(1);
  return [];
}

const COLUMNS_BY_KIND: Record<SeasonRosterTableKind, ColumnDef[]> = {
  batting: BATTING_COLUMNS,
  pitching: PITCHING_COLUMNS,
  points: [],
};

/** Which counted-points field a table shows in its "Pts" column -- the
 * combined total for batting and pitching alike would be identical for a
 * two-way player (Ohtani) in both tables, since it's the same underlying
 * row appearing in each. */
function pointsForKind(row: SeasonPlayerLine, kind: SeasonRosterTableKind): number {
  if (kind === "batting") return row.battingCountedPoints;
  if (kind === "pitching") return row.pitchingCountedPoints;
  return row.countedPoints;
}

function sortValue(
  row: SeasonPlayerLine,
  key: string,
  columns: ColumnDef[],
  kind: SeasonRosterTableKind
): number | string {
  switch (key) {
    case "player":
      return row.playerName;
    case "pts":
      return pointsForKind(row, kind);
    case "bench":
      return row.benchPoints;
    case "weeks":
      return row.weeksRostered;
    default:
      return columns.find(c => c.key === key)?.sortValue(row) ?? 0;
  }
}

/** One team-season's full roster, aggregated across every box-score week --
 * the season-scoped counterpart to Matchup/BoxScoreTable.tsx's single-week
 * version. "Weeks" replaces that table's per-entry Bench column, since bench
 * points read as a season total here rather than a single week's number.
 * Every column is sortable and the table caps at ten visible rows with a
 * scrollbar, matching the rest of the app's row-capped tables. */
export function SeasonRosterTable({ title, kind, rows, markers }: SeasonRosterTableProps) {
  const columns = COLUMNS_BY_KIND[kind];
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<SeasonPlayerLine, string>(
    rows,
    (row, key) => sortValue(row, key, columns, kind),
    "pts",
    "desc"
  );

  if (rows.length === 0) {
    return (
      <Board title={title} maxHeight={TEN_ROWS}>
        <p className="px-3.5 py-3 text-sm text-ink-dim">No roster data available for this view.</p>
      </Board>
    );
  }

  const primaryStatCol = getPrimaryStatColumn(kind);
  const secondaryStatCols = getSecondaryStatColumns(kind);

  return (
    <Board title={title} maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <SortHeader
              label="Player"
              sortKey="player"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Pts"
              sortKey="pts"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              tooltip={PTS_SEMANTICS_TOOLTIP_COUNTED}
            />
            {primaryStatCol && (
              <SortHeader
                label={primaryStatCol.label}
                sortKey={primaryStatCol.key}
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
            )}
            {secondaryStatCols.map(col => (
              <SortHeader
                key={col.key}
                label={col.label}
                sortKey={col.key}
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
            ))}
            <SortHeader
              label="Bench"
              sortKey="bench"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Wks"
              sortKey="weeks"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const dropped = markers?.droppedPlayerIds.has(row.playerId) ?? false;
            const added = markers?.freeAgentAddedPlayerIds.has(row.playerId) ?? false;
            const traded = markers?.tradeAcquiredPlayerIds.has(row.playerId) ?? false;
            const tradedAway = markers?.tradedAwayPlayerIds.has(row.playerId) ?? false;
            return (
              <tr
                key={row.playerId}
                className={`border-t border-border hover:bg-surface-2 ${dropped || tradedAway ? "text-ink-faint" : ""}`}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link
                    to={`/player/${row.playerId}`}
                    className="inline-flex items-center gap-2 align-middle hover:underline"
                    title={tradedAway ? "Traded away" : dropped ? "Dropped to waivers/free agency" : undefined}>
                    <Headshot playerId={row.playerId} playerName={row.playerName} size={24} />
                    <span>{row.playerName}</span>
                  </Link>
                  {added && (
                    <span className="ml-1 font-bold text-diverge-pos" title="Added from free agency/waivers">
                      +
                    </span>
                  )}
                  {traded && (
                    <span className="ml-1 font-bold text-diverge-pos" title="Acquired by trade">
                      *
                    </span>
                  )}
                  {tradedAway && (
                    <span className="ml-1 font-bold text-ink-faint" title="Traded away this year">
                      -
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center font-semibold tabular-nums">
                  {formatPoints(pointsForKind(row, kind))}
                </td>
                {primaryStatCol && (
                  <td key={primaryStatCol.key} className="px-3 py-2 text-center tabular-nums">
                    {primaryStatCol.value(row)}
                  </td>
                )}
                {secondaryStatCols.map(col => (
                  <td key={col.key} className="px-3 py-2 text-center tabular-nums">
                    {col.value(row)}
                  </td>
                ))}
                <td className="px-3 py-2 text-center tabular-nums text-ink-faint">
                  {row.benchPoints !== 0 ? formatPoints(row.benchPoints) : "—"}
                </td>
                <td className="px-3 py-2 text-center tabular-nums text-ink-faint">{row.weeksRostered}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Board>
  );
}
