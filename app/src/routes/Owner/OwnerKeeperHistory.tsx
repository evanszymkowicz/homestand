import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CARD, EYEBROW } from "../../components/cardStyles";
import { FilterBar } from "../../components/FilterBar";
import { FilterSelect } from "../../components/FilterSelect";
import { CoverageBadge } from "../../components/CoverageBadge";
import { SectionHeading } from "../../components/SectionHeading";
import { formatPoints } from "../../lib/format";
import type { OwnerKeeperPoints } from "../../lib/keepers";
import {
  getOwnerKeeperTenureRows,
  type KeeperSource,
  type OwnerKeeperPlayerSummary,
  type OwnerKeeperTenureRow,
} from "../../lib/ownerHistory";
import { POSITION_LABEL_ORDER } from "../../lib/positions";
import type { Season } from "../../types";

interface OwnerKeeperHistoryProps {
  seasons: Season[];
  playerSummaries: OwnerKeeperPlayerSummary[];
  points: OwnerKeeperPoints | undefined;
  /** False when the only keeper(s) on record for this owner are in an
   * in-progress season -- points.points would be 0 not because they scored
   * nothing, but because there's no final total yet. See
   * getOwnerKeeperStreakAndPoints's comment. */
  hasFinalKeeperSeason: boolean;
  /** `Map<player_id, position label>` from players.json's default position.
   * Powers the Pos column and its filter. */
  positions: Map<number, string>;
}

const SOURCE_LABELS: Record<KeeperSource, string> = {
  draft: "Draft",
  "inherited with team": "Inherited",
  "waiver/trade": "Waivers/trades",
};

const TENURE_AXIS_LABEL = "text-[0.62rem] font-bold tracking-wide text-ink-faint uppercase";

type KeeperRow = OwnerKeeperTenureRow & {
  position: string;
  points: number;
  sources: KeeperSource[];
};

/** Keeper history for one owner: the career keeper-points figure -- summed from
 * the keeper rows currently shown, so the source/position filters narrow both
 * the number and the graph together, matching the Players stats tables' "the
 * total describes what's on screen" behavior -- above a tenure graph of those
 * same keepers. */
function KeeperPointsCard({
  points,
  hasFinalKeeperSeason,
  summaries,
  positions,
}: {
  points: OwnerKeeperPoints | undefined;
  hasFinalKeeperSeason: boolean;
  summaries: OwnerKeeperPlayerSummary[];
  positions: Map<number, string>;
}) {
  const [source, setSource] = useState<"all" | KeeperSource>("all");
  const [position, setPosition] = useState("all");

  const positionOptions = useMemo(() => {
    const presentPositions = new Set(summaries.map(s => positions.get(s.playerId) ?? "—"));
    return POSITION_LABEL_ORDER.filter(label => presentPositions.has(label)).concat(
      [...presentPositions].filter(label => !POSITION_LABEL_ORDER.includes(label)).sort()
    );
  }, [summaries, positions]);

  const years = useMemo(() => {
    const yearSet = new Set<number>();
    for (const summary of summaries) for (const year of summary.years) yearSet.add(year);
    const sortedYears = [...yearSet].sort((a, b) => a - b);
    return sortedYears.length === 0
      ? []
      : Array.from({ length: sortedYears[sortedYears.length - 1] - sortedYears[0] + 1 }, (_, i) => sortedYears[0] + i);
  }, [summaries]);

  const allRows = useMemo<KeeperRow[]>(() => {
    const byId = new Map(summaries.map(summary => [summary.playerId, summary]));
    return getOwnerKeeperTenureRows(summaries).map(row => {
      const summary = byId.get(row.playerId)!;
      return {
        ...row,
        position: positions.get(row.playerId) ?? "—",
        points: summary.points,
        sources: summary.sources,
      };
    });
  }, [summaries, positions]);

  const rows = allRows.filter(row => {
    if (source !== "all" && !row.sources.includes(source)) return false;
    if (position !== "all" && row.position !== position) return false;
    return true;
  });

  const filteredPoints = rows.reduce((sum, row) => sum + row.points, 0);
  const showNumber = points != null && hasFinalKeeperSeason;

  return (
    <>
      <FilterBar shown={rows.length} total={allRows.length}>
        <FilterSelect
          aria-label="Filter by acquisition source"
          value={source}
          onChange={e => setSource(e.target.value as "all" | KeeperSource)}>
          <option value="all">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect aria-label="Filter by position" value={position} onChange={e => setPosition(e.target.value)}>
          <option value="all">All positions</option>
          {positionOptions.map(label => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>

      <div className={CARD}>
        {showNumber && <div className="text-3xl font-extrabold text-accent">{formatPoints(filteredPoints)}</div>}

        <div className={showNumber ? `${EYEBROW} mt-1` : EYEBROW}>
          <span className="font-normal">Keeper Points</span>
          {!showNumber && (
            <span className="font-normal normal-case tracking-normal"> — no final keeper season yet</span>
          )}
        </div>

        <KeeperTenureGraph years={years} rows={rows} hasAny={allRows.length > 0} />
      </div>
    </>
  );
}

/** Every keeper this owner has had, one row each: position, a shared year axis
 * with a bar per consecutive-year run (a gap year breaks the bar; the longest
 * run among the rows shown is gold with its row tinted), keeper points, and how
 * they were acquired. Rows sit in longest-run order because that order is the
 * "kept longest" answer; each track's aria-label carries the year span for
 * screen readers. */
function KeeperTenureGraph({ years, rows, hasAny }: { years: number[]; rows: KeeperRow[]; hasAny: boolean }) {
  if (!hasAny) return <p className="mt-3 text-sm text-ink-dim">None on record.</p>;
  if (rows.length === 0) return <p className="mt-3 text-sm text-ink-dim">No keepers match these filters.</p>;

  const firstYear = years[0];
  const longest = rows.reduce((max, row) => Math.max(max, row.longestRun), 0);
  const gridStyle = {
    gridTemplateColumns: `minmax(6rem, 10rem) 2.25rem repeat(${years.length}, minmax(0, 1fr)) 4.5rem minmax(5rem, 7rem)`,
  };

  return (
    <div className="mt-3 overflow-x-auto">
      <div className="min-w-[34rem]">
        <div className="grid items-end gap-x-0.5" style={gridStyle} aria-hidden="true">
          <span className={TENURE_AXIS_LABEL}>Player</span>
          <span className={TENURE_AXIS_LABEL}>Pos</span>
          {years.map(year => (
            <span key={year} className={`${TENURE_AXIS_LABEL} text-center`}>
              {String(year).slice(2)}
            </span>
          ))}
          <span className={`${TENURE_AXIS_LABEL} text-center`}>Pts</span>
          <span className={TENURE_AXIS_LABEL}>Acquired</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {rows.map(row => {
            const isLongest = row.longestRun === longest;
            const label = `${row.playerName}: kept ${row.years.length} year${
              row.years.length === 1 ? "" : "s"
            }, ${row.years[0]} to ${row.years[row.years.length - 1]}`;
            return (
              <div
                key={row.playerId}
                className={`grid items-center rounded-md ${isLongest ? "bg-gold-soft" : "hover:bg-surface-2"}`}
                style={gridStyle}>
                <Link
                  to={`/player/${row.playerId}`}
                  className="min-w-0 truncate pr-2 text-sm font-semibold hover:underline">
                  {row.playerName}
                </Link>
                <span className="text-xs text-ink-faint">{row.position}</span>
                <div
                  className="relative h-5 rounded-md bg-surface-2"
                  style={{ gridColumn: `3 / ${3 + years.length}` }}
                  role="img"
                  aria-label={label}>
                  {row.runs.map(run => {
                    const left = ((run.start - firstYear) / years.length) * 100;
                    const width = ((run.end - run.start + 1) / years.length) * 100;
                    return (
                      <span
                        key={run.start}
                        className={`absolute inset-y-0.5 rounded-[4px] ${isLongest ? "bg-gold" : "bg-accent"}`}
                        style={{ left: `${left}%`, width: `calc(${width}% - 3px)` }}
                      />
                    );
                  })}
                </div>
                <span className="text-center text-xs tabular-nums">{formatPoints(row.points)}</span>
                <span className="truncate pl-2 text-xs text-ink-faint" title={row.sources.join(" / ")}>
                  {row.sources.map(s => SOURCE_LABELS[s]).join(" / ")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Keeper history section for the owner page: career keeper points from the
 * distinct players this owner has kept, then a single tenure graph folding in
 * the old per-player breakdown (position, keeper points, acquisition source)
 * so the roster is listed once. Reuses keepers.ts's league-wide computations
 * sliced to this owner via ownerHistory.ts rather than recomputing anything --
 * stays in agreement with the Keepers route by construction. */
export function OwnerKeeperHistory({
  seasons,
  playerSummaries,
  points,
  hasFinalKeeperSeason,
  positions,
}: OwnerKeeperHistoryProps) {
  const distinctPlayers = playerSummaries.length;
  const hasHighlights = distinctPlayers > 0 || (points != null && hasFinalKeeperSeason);

  return (
    <div className="mt-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionHeading as="h3">Keeper History</SectionHeading>
        <CoverageBadge seasons={seasons} domain="draft" />
      </div>

      {!hasHighlights ? (
        <p className="text-ink-dim">No keepers on record yet.</p>
      ) : (
        <KeeperPointsCard
          points={points}
          hasFinalKeeperSeason={hasFinalKeeperSeason}
          summaries={playerSummaries}
          positions={positions}
        />
      )}
    </div>
  );
}
