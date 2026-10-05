import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { Headshot } from "../../components/Headshot";
import { SortHeader } from "../../components/SortHeader";
import { TickerText } from "../../components/TickerText";
import { useSortableRows } from "../../hooks/useSortableRows";
import {
  BENCH_DISPLAY_EPSILON,
  getBenchPoints,
  getCountedPoints,
  getPlayerWeekSlots,
  type PlayerWeekSlots,
} from "../../lib/boxScore";
import { formatInnings, formatPoints } from "../../lib/format";
import { PTS_SEMANTICS_TOOLTIP_COUNTED } from "../../lib/ptsSemantics";
import type { BoxScoreEntry } from "../../types";

// The two pinned columns are fixed-width so the second one's `left` offset is a
// constant; a long name tickers inside its box rather than widening the column.
const PLAYER_COL_WIDTH = "10rem";
const POINTS_COL_WIDTH = "4.5rem";
const PINNED_WIDTH = "14.5rem";

// Small enough that the headshot and the slot badge both fit inside the
// unchanged PLAYER_COL_WIDTH.
const HEADSHOT_SIZE = 26;

// Below the sticky header rows' z-10/z-20 so a pinned column scrolls under them, not over.
const PINNED_CELL = "sticky z-[5] bg-surface p-0 group-hover:bg-surface-2";
const PINNED_EDGE = "border-r border-border";
/** Marks where the pitching group starts, so a row's two halves stay readable side by side. */
const GROUP_EDGE = "border-l border-border";

interface BoxScoreTableProps {
  title: string;
  entries: BoxScoreEntry[];
  /** Undefined for years the transaction ledger doesn't cover -- neither marker renders. */
  droppedPlayerIds?: Set<number>;
  addedPlayerIds?: Set<number>;
  /** Players traded away from this side during the matchup week. */
  tradedAwayPlayerIds?: Set<number>;
  /** Day-accurate slot data only exists 2019+ (2018 is a season-end snapshot, not real). */
  showSlots?: boolean;
  /** False pre-2018, where no raw line exists and the stat columns would all be dashes. */
  showStats?: boolean;
}

/** "Bench" reads as a dash here -- the Bench points column already covers it. */
function slotDisplayLabel(label: string): string {
  return label === "Bench" ? "—" : label;
}

/** Slot badge; day-by-day tooltip only appears for a week that changed slot.
 * Exported for the player page's week-by-week view's Position column. */
export function SlotCell({ slots }: { slots: PlayerWeekSlots | null }) {
  if (!slots) return <span className="text-ink-faint">—</span>;
  if (!slots.changedMidWeek) {
    return (
      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.68rem] font-bold">
        {slotDisplayLabel(slots.primaryLabel)}
      </span>
    );
  }
  return (
    <span className="group/slot relative inline-flex">
      <span tabIndex={0} className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.68rem] font-bold outline-none">
        {slotDisplayLabel(slots.primaryLabel)}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-20 mt-1.5 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1.5 text-left text-xs whitespace-nowrap text-ink opacity-0 shadow-md transition-opacity group-hover/slot:opacity-100 group-focus-within/slot:opacity-100">
        {slots.days.map(d => (
          <div key={d.scoringPeriod} className="text-ink-dim">
            Day {d.scoringPeriod}: {slotDisplayLabel(d.label)}
          </div>
        ))}
      </span>
    </span>
  );
}

interface ColumnDef {
  /** Unique sort key -- distinct from `label` because "K" appears on both sides. */
  key: string;
  label: string;
  /** Spelled-out header tooltip, since batting and pitching abbreviations now share a row. */
  title: string;
  value: (entry: BoxScoreEntry) => string;
  /** Raw numeric stat backing the column, used for sorting -- distinct from
   * `value` because IP's formatted "6.2" notation (thirds, not tenths) still
   * happens to sort correctly as a parsed float, but outs is the honest key. */
  sortValue: (entry: BoxScoreEntry) => number;
}

/** A player with no line on the active side reads as a dash, not a zero -- "0 AB"
 * and "never batted" are different facts, and sorting sinks the dashes. */
function battingCol(
  label: string,
  title: string,
  pick: (b: NonNullable<BoxScoreEntry["batting"]>) => number
): ColumnDef {
  return {
    key: `b:${label}`,
    label,
    title: `Hitting — ${title}`,
    value: e => (e.batting ? String(pick(e.batting)) : "—"),
    sortValue: e => (e.batting ? pick(e.batting) : -1),
  };
}

function pitchingCol(
  label: string,
  title: string,
  pick: (p: NonNullable<BoxScoreEntry["pitching"]>) => number,
  format: (n: number) => string = String
): ColumnDef {
  return {
    key: `p:${label}`,
    label,
    title: `Pitching — ${title}`,
    value: e => (e.pitching ? format(pick(e.pitching)) : "—"),
    sortValue: e => (e.pitching ? pick(e.pitching) : -1),
  };
}

const BATTING_COLUMNS: ColumnDef[] = [
  battingCol("AB", "At bats", b => b.ab),
  battingCol("R", "Runs", b => b.r),
  battingCol("1B", "Singles", b => b.singles),
  battingCol("2B", "Doubles", b => b.doubles),
  battingCol("3B", "Triples", b => b.triples),
  battingCol("HR", "Home runs", b => b.hr),
  battingCol("RBI", "Runs batted in", b => b.rbi),
  battingCol("K", "Strikeouts", b => b.k),
  battingCol("SB", "Stolen bases", b => b.sb),
  battingCol("CS", "Caught stealing", b => b.cs),
  battingCol("GIDP", "Grounded into double play", b => b.gidp),
];

const PITCHING_COLUMNS: ColumnDef[] = [
  pitchingCol("IP", "Innings pitched", p => p.outs, formatInnings),
  pitchingCol("H", "Hits allowed", p => p.h),
  pitchingCol("RA", "Runs allowed", p => p.r),
  pitchingCol("ER", "Earned runs", p => p.er),
  pitchingCol("BB", "Walks", p => p.bb),
  pitchingCol("HB", "Hit batters", p => p.hb),
  pitchingCol("K", "Strikeouts", p => p.k),
  pitchingCol("W", "Wins", p => p.wins),
  pitchingCol("L", "Losses", p => p.losses),
  pitchingCol("SV", "Saves", p => p.sv),
  pitchingCol("BS", "Blown saves", p => p.bs),
  pitchingCol("NH", "No-hitters", p => p.nh),
  pitchingCol("PG", "Perfect games", p => p.pg),
];

/** Fixed height on the group row so the sort row below it can pin at a constant offset. */
const GROUP_ROW_HEIGHT = "1rem";

/** The label sticks just past the pinned columns so it stays readable while its
 * group is only partly scrolled into view -- a group spans wider than a phone. */
function GroupHeader({ label, span, className = "" }: { label: string; span: number; className?: string }) {
  return (
    <th
      scope="colgroup"
      colSpan={span}
      style={{ height: GROUP_ROW_HEIGHT }}
      className={`sticky top-0 z-10 bg-surface px-3 text-center text-[0.6rem] font-bold tracking-widest text-ink-faint uppercase ${className}`}>
      <span style={{ left: PINNED_WIDTH }} className="sticky inline-block">
        {label}
      </span>
    </th>
  );
}

/** One table for a side's whole week -- batters, pitchers and benched players
 * together, batting and pitching lines on the same row, in whatever the active
 * sort produces. Player and Pts stay pinned while the stat columns scroll
 * sideways. Gray means dropped and nothing else -- a player who scored nothing
 * that counted already reads that way from a 0.0 in Pts. Gray and the added
 * "+" only render for years transactions.json covers. */
export function BoxScoreTable({
  title,
  entries,
  droppedPlayerIds,
  addedPlayerIds,
  tradedAwayPlayerIds,
  showSlots = false,
  showStats = true,
}: BoxScoreTableProps) {
  const columns = showStats ? [...BATTING_COLUMNS, ...PITCHING_COLUMNS] : [];
  const firstPitchingKey = PITCHING_COLUMNS[0].key;

  function sortValue(entry: BoxScoreEntry, key: string): number | string {
    if (key === "player") return entry.player_name;
    if (key === "pts") return getCountedPoints(entry);
    if (key === "bench") return getBenchPoints(entry);
    return columns.find(c => c.key === key)?.sortValue(entry) ?? 0;
  }

  const { sorted, sortKey, direction, toggleSort } = useSortableRows<BoxScoreEntry, string>(
    entries,
    sortValue,
    "pts",
    "desc"
  );
  if (entries.length === 0) {
    return (
      <Board title={title} maxHeight={TEN_ROWS}>
        <p className="px-3.5 py-3 text-sm text-ink-dim">No box score entries for this matchup.</p>
      </Board>
    );
  }

  // Only the stat columns are grouped; the Slot/Bench columns just need a filler cell.
  const fillerColumnCount = (showSlots ? 1 : 0) + 1;

  return (
    <Board title={title} maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          {showStats && (
            <tr>
              <th
                colSpan={2}
                style={{ height: GROUP_ROW_HEIGHT, left: 0 }}
                className={`sticky top-0 z-20 bg-surface ${PINNED_EDGE}`}>
                <span className="sr-only">Player and points</span>
              </th>
              <th colSpan={fillerColumnCount} className="sticky top-0 z-10 bg-surface" />
              <GroupHeader label="Hitting" span={BATTING_COLUMNS.length} />
              <GroupHeader label="Pitching" span={PITCHING_COLUMNS.length} className={GROUP_EDGE} />
            </tr>
          )}
          <tr>
            <SortHeader
              label="Player"
              sortKey="player"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
              stickyLeft
              stickyTop={showStats ? GROUP_ROW_HEIGHT : undefined}
            />
            <SortHeader
              label="Points"
              sortKey="pts"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              stickyLeftOffset={PLAYER_COL_WIDTH}
              stickyTop={showStats ? GROUP_ROW_HEIGHT : undefined}
              className={PINNED_EDGE}
              tooltip={PTS_SEMANTICS_TOOLTIP_COUNTED}
            />
            {showSlots && (
              <th
                scope="col"
                style={{ top: showStats ? GROUP_ROW_HEIGHT : undefined }}
                className="text-eyebrow sticky top-0 z-10 bg-surface px-3 py-2 text-center font-semibold tracking-wide text-ink-faint">
                Position
              </th>
            )}
            <SortHeader
              label="Bench"
              sortKey="bench"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              stickyTop={showStats ? GROUP_ROW_HEIGHT : undefined}
            />
            {columns.map(col => (
              <SortHeader
                key={col.key}
                label={col.label}
                ariaLabel={col.title}
                sortKey={col.key}
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
                stickyTop={GROUP_ROW_HEIGHT}
                className={col.key === firstPitchingKey ? GROUP_EDGE : ""}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(entry => {
            const counted = getCountedPoints(entry);
            const bench = getBenchPoints(entry);
            const dropped = droppedPlayerIds?.has(entry.player_id) ?? false;
            const added = addedPlayerIds?.has(entry.player_id) ?? false;
            const tradedAway = tradedAwayPlayerIds?.has(entry.player_id) ?? false;
            const weekSlots = getPlayerWeekSlots(entry);
            return (
              <tr
                key={entry.player_id}
                className={`group border-t border-border hover:bg-surface-2 ${dropped || tradedAway ? "text-ink-faint" : ""}`}>
                <td style={{ left: 0 }} className={PINNED_CELL}>
                  <div
                    style={{ width: PLAYER_COL_WIDTH }}
                    className="flex items-center gap-2 overflow-hidden px-2 py-2">
                    <Headshot playerId={entry.player_id} playerName={entry.player_name} size={HEADSHOT_SIZE} />
                    <TickerText text={entry.player_name} className="min-w-0 flex-1">
                      <Link
                        to={`/player/${entry.player_id}`}
                        className="hover:underline"
                        title={
                          tradedAway
                            ? "Traded away during this matchup"
                            : dropped
                              ? "Dropped during this matchup"
                              : undefined
                        }>
                        {entry.player_name}
                      </Link>
                    </TickerText>
                    {added && (
                      <span
                        className="font-bold text-diverge-pos"
                        title="Added via free agency/waivers during this matchup">
                        +
                      </span>
                    )}
                    {tradedAway && (
                      <span className="font-bold text-ink-faint" title="Traded away during this matchup">
                        -
                      </span>
                    )}
                    {weekSlots?.onIL && (
                      <span className="font-bold text-diverge-pos" title="Placed on the IL during this matchup">
                        ●
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ left: PLAYER_COL_WIDTH }} className={`${PINNED_CELL} ${PINNED_EDGE}`}>
                  <div
                    style={{ minWidth: POINTS_COL_WIDTH }}
                    className="w-full px-3 py-2 text-center font-semibold tabular-nums">
                    {formatPoints(counted)}
                  </div>
                </td>
                {showSlots && (
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <SlotCell slots={weekSlots} />
                  </td>
                )}
                <td className="px-3 py-2 text-center tabular-nums text-ink-faint">
                  {Math.abs(bench) > BENCH_DISPLAY_EPSILON ? formatPoints(bench) : "—"}
                </td>
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 text-center tabular-nums ${col.key === firstPitchingKey ? GROUP_EDGE : ""}`}>
                    {col.value(entry)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Board>
  );
}
