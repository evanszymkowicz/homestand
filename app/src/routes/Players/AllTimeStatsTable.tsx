import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FilterBar } from "../../components/FilterBar";
import { FilterSelect } from "../../components/FilterSelect";
import { Headshot } from "../../components/Headshot";
import { OwnerLink } from "../../components/OwnerLink";
import { PortalTooltip } from "../../components/PortalTooltip";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows, type SortDirection } from "../../hooks/useSortableRows";
import { formatPoints } from "../../lib/format";
import { STAT_COLUMNS } from "../../lib/statColumns";
import { allTimePointsTooltip, type AllTimeStatRow } from "../../lib/seasonStats";
import { OF_POSITION_IDS, positionLabel } from "../../lib/positions";
import { ownerRef } from "../../lib/stats";
import type { MlbTeam, Owner } from "../../types";

interface AllTimeStatsTableProps {
  rows: AllTimeStatRow[];
  owners: Owner[];
  mlbTeams: MlbTeam[];
}

// Same 37px row math as SeasonStatsTable so the virtualizer stays exact.
const ROW_HEIGHT = 37;

// Fixed leading columns (Player, Points, Seasons, Pos, Owner, MLB) plus the
// stat columns. The all-time table has no Draft column -- a player's career
// spans many drafts, so there's no single pick number to show.
const COLUMN_COUNT = 6 + STAT_COLUMNS.length;

type SortKey =
  "player" | "position" | "proTeam" | "owner" | "points" | "seasons" | (typeof STAT_COLUMNS)[number]["key"];

function proTeamAbbrev(mlbTeamById: Map<number, MlbTeam>, proTeamId: number | null): string {
  if (proTeamId === null) return "—";
  return mlbTeamById.get(proTeamId)?.abbrev ?? "—";
}

const PITCHER_POSITION_IDS = new Set([1, 11]);

function isPitcher(positionIds: number[]): boolean {
  return positionIds.some(id => PITCHER_POSITION_IDS.has(id));
}

function positionLabelOrDash(positionIds: number[]): string {
  if (positionIds.length === 0) return "—";
  return positionIds.map(positionLabel).join("/");
}

export function AllTimeStatsTable({ rows, owners, mlbTeams }: AllTimeStatsTableProps) {
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [proTeamFilter, setProTeamFilter] = useState("all");

  const parentRef = useRef<HTMLDivElement>(null);

  const mlbTeamById = useMemo(() => new Map(mlbTeams.map(t => [t.pro_team_id, t])), [mlbTeams]);

  const ownerOptions = useMemo(() => {
    const ids = Array.from(new Set(rows.map(r => r.ownerId).filter((id): id is string => id !== null)));
    return ids.map(id => ownerRef(owners, id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, owners]);

  const positionOptions = useMemo(() => {
    const labels = new Set(rows.flatMap(r => r.positionIds.map(positionLabel)));
    if (rows.some(r => r.positionIds.length === 0)) labels.add("—");
    return Array.from(labels).sort();
  }, [rows]);

  const proTeamOptions = useMemo(
    () => Array.from(new Set(rows.map(r => proTeamAbbrev(mlbTeamById, r.proTeamId)))).sort(),
    [rows, mlbTeamById]
  );

  const filtered = rows.filter(
    r =>
      (ownerFilter === "all" || r.ownerId === ownerFilter) &&
      (positionFilter === "all" ||
        (positionFilter === "pitchers" && isPitcher(r.positionIds)) ||
        (positionFilter === "hitters" && r.positionIds.some(id => !PITCHER_POSITION_IDS.has(id))) ||
        (positionFilter === "of" && r.positionIds.some(id => OF_POSITION_IDS.has(id))) ||
        r.positionIds.some(id => positionLabel(id) === positionFilter) ||
        (r.positionIds.length === 0 && positionFilter === "—")) &&
      (proTeamFilter === "all" || proTeamAbbrev(mlbTeamById, r.proTeamId) === proTeamFilter)
  );

  function getValue(row: AllTimeStatRow, key: SortKey, _direction: SortDirection): number | string {
    switch (key) {
      case "player":
        return row.playerName;
      case "position":
        return positionLabelOrDash(row.positionIds);
      case "proTeam":
        return proTeamAbbrev(mlbTeamById, row.proTeamId);
      case "owner":
        return row.ownerId === null ? "—" : ownerRef(owners, row.ownerId).name;
      case "points":
        return row.cardPoints;
      case "seasons":
        return row.seasons;
      default:
        return STAT_COLUMNS.find(c => c.key === key)?.sortValue(row) ?? 0;
    }
  }

  const { sorted, sortKey, direction, toggleSort } = useSortableRows<AllTimeStatRow, SortKey>(
    filtered,
    getValue,
    "points",
    "desc"
  );

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const startOffset = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const lastVirtualRow = virtualItems[virtualItems.length - 1];
  const endOffset = lastVirtualRow ? virtualizer.getTotalSize() - (lastVirtualRow.start + lastVirtualRow.size) : 0;

  return (
    <div>
      <FilterBar shown={filtered.length} total={rows.length}>
        <FilterSelect value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} aria-label="Filter by owner">
          <option value="all">All owners</option>
          {ownerOptions.map(o => (
            <option key={o.ownerId} value={o.ownerId}>
              {o.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          value={positionFilter}
          onChange={e => setPositionFilter(e.target.value)}
          aria-label="Filter by position">
          <option value="all">All positions</option>
          <option value="pitchers">All Pitchers</option>
          <option value="hitters">All Hitters</option>
          <option value="of">All OF</option>
          {positionOptions.map(p => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          value={proTeamFilter}
          onChange={e => setProTeamFilter(e.target.value)}
          aria-label="Filter by pro team">
          <option value="all">All MLB teams</option>
          {proTeamOptions.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-dim">No players match these filters.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div ref={parentRef} className="scrollbar-accent overflow-auto" style={{ maxHeight: "25.5rem" }}>
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
                    stickyLeft
                    className="border-r border-border"
                  />
                  <SortHeader
                    label="Points"
                    sortKey="points"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    align="left"
                    tooltip="Career ESPN full-season total. Hover a cell for the rostered share."
                  />
                  <SortHeader
                    label="Seasons"
                    sortKey="seasons"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    align="center"
                  />
                  <SortHeader
                    label="Position"
                    sortKey="position"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    align="left"
                  />
                  <SortHeader
                    label="Owner"
                    sortKey="owner"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    align="left"
                  />
                  <SortHeader
                    label="MLB"
                    sortKey="proTeam"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    align="left"
                  />
                  {STAT_COLUMNS.map(col => (
                    <SortHeader
                      key={col.key}
                      label={col.label}
                      ariaLabel={col.ariaLabel}
                      sortKey={col.key}
                      activeKey={sortKey}
                      direction={direction}
                      onSort={toggleSort}
                      align="center"
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {startOffset > 0 && (
                  <tr aria-hidden="true" style={{ height: startOffset }}>
                    <td colSpan={COLUMN_COUNT} style={{ height: startOffset }} />
                  </tr>
                )}
                {virtualItems.map(virtualRow => {
                  const row = sorted[virtualRow.index];
                  return (
                    <tr key={row.playerId} className="group border-t border-border hover:bg-surface-2">
                      <td className="sticky left-0 z-10 border-r border-border bg-surface px-3 py-1.5 whitespace-nowrap group-hover:bg-surface-2">
                        <Link to={`/player/${row.playerId}`} className="flex items-center gap-2 hover:underline">
                          <Headshot playerId={row.playerId} playerName={row.playerName} size={24} />
                          <span className="font-semibold">{row.playerName}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums">
                        {/* PortalTooltip rather than a native `title`: a title
                            attribute is hover-only, so it never fires on touch,
                            never enters the accessibility tree, and the <td>
                            is not focusable. The rostered-of-total caveat is
                            the most important qualifier in this column, so it
                            has to be reachable by keyboard. */}
                        <PortalTooltip content={allTimePointsTooltip(row) ?? "Career total."}>
                          {formatPoints(row.cardPoints)}
                        </PortalTooltip>
                      </td>
                      <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{row.seasons}</td>
                      <td className="px-3 py-2 text-left text-ink-dim">
                        <span
                          className="inline-block max-w-20 truncate align-bottom"
                          title={positionLabelOrDash(row.positionIds)}>
                          {positionLabelOrDash(row.positionIds)}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-ink-dim">
                        <OwnerLink owners={owners} ownerId={row.ownerId} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-left text-ink-dim">
                        {proTeamAbbrev(mlbTeamById, row.proTeamId)}
                      </td>
                      {STAT_COLUMNS.map(col => (
                        <td key={col.key} className="px-3 py-2 text-center tabular-nums">
                          {col.value(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {endOffset > 0 && (
                  <tr aria-hidden="true" style={{ height: endOffset }}>
                    <td colSpan={COLUMN_COUNT} style={{ height: endOffset }} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
