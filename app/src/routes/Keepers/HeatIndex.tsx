import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FilterSelect } from "../../components/FilterSelect";
import { SectionHeading } from "../../components/SectionHeading";
import { TickerText } from "../../components/TickerText";
import type { RenumberedPick } from "../../lib/draft";
import { formatPercentileChange, formatPoints } from "../../lib/format";
import { getKeeperHeatIndex, heatIndexBackground } from "../../lib/keepers";
import { ownerRef } from "../../lib/stats";
import type { Keeper, Owner, PlayerSeasonPoints } from "../../types";

interface HeatIndexProps {
  keepers: Keeper[];
  seasonPoints: PlayerSeasonPoints[];
  positionByPlayerId: Map<number, string>;
  boardsByYear: Map<number, RenumberedPick[]>;
  percentiles: Map<string, number>;
  years: number[];
  search: string;
  owners: Owner[];
}

const SCOPE_ALL = "all";

export function HeatIndex({
  keepers,
  seasonPoints,
  positionByPlayerId,
  boardsByYear,
  percentiles,
  years,
  search,
  owners,
}: HeatIndexProps) {
  const [scope, setScope] = useState<string>(String(years[0] ?? SCOPE_ALL));
  const [position, setPosition] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");

  const year = scope === SCOPE_ALL ? null : Number(scope);
  // Percentile change is comparable at any point in a season, so
  // "All-Time" rolls in the in-progress season too rather than freezing to finished seasons.
  const entries = useMemo(
    () => getKeeperHeatIndex(keepers, seasonPoints, positionByPlayerId, boardsByYear, percentiles, year),
    [keepers, seasonPoints, positionByPlayerId, boardsByYear, percentiles, year]
  );

  const positions = useMemo(() => Array.from(new Set(entries.map(e => e.positionLabel))).sort(), [entries]);
  const ownerOptions = useMemo(() => {
    const ids = new Set(entries.map(e => e.keeper.owner_id));
    return Array.from(ids)
      .map(id => ownerRef(owners, id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, owners]);

  const q = search.trim().toLowerCase();
  const filtered = entries.filter(
    e =>
      (position === "all" || e.positionLabel === position) &&
      (ownerFilter === "all" || e.keeper.owner_id === ownerFilter) &&
      (!q || e.keeper.player_name.toLowerCase().includes(q))
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionHeading>Keeper Heat Index</SectionHeading>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect value={scope} onChange={e => setScope(e.target.value)} aria-label="Heat index scope">
            <option value={SCOPE_ALL}>All-Time</option>
            {years.map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={position} onChange={e => setPosition(e.target.value)} aria-label="Filter by position">
            <option value="all">All positions</option>
            {positions.map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} aria-label="Filter by owner">
            <option value="all">All owners</option>
            {ownerOptions.map(o => (
              <option key={o.ownerId} value={o.ownerId}>
                {o.name}
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>

      <p className="mb-4 max-w-2xl text-xs text-ink-faint">
        Compare every keeper's percentile rank from that season's field of players to their percentile rank the previous
        season.
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-dim">No keepers match these filters.</p>
      ) : (
        <div
          className="scrollbar-accent grid gap-2 overflow-y-auto pr-1"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", maxHeight: "70vh" }}>
          {filtered.map(entry => (
            <div
              key={`${entry.keeper.year}-${entry.keeper.player_id}`}
              style={heatIndexBackground(entry.percentileChange)}
              className="rounded-lg border border-border p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <Link to={`/player/${entry.keeper.player_id}`} className="min-w-0 hover:underline">
                  <TickerText text={entry.keeper.player_name} className="text-sm font-bold" />
                </Link>
                <span className="flex-none text-sm font-extrabold tabular-nums">
                  {entry.percentileChange === null ? (
                    <span className="text-[0.62rem] font-semibold text-ink-faint">no prior season</span>
                  ) : (
                    formatPercentileChange(entry.percentileChange)
                  )}
                </span>
              </div>
              <div className="mt-0.5 whitespace-nowrap text-[0.68rem] text-ink-faint">
                {entry.positionLabel} · {entry.keeper.year} ·{" "}
                {entry.points === null ? "no data" : `${formatPoints(entry.points)} pts`}
              </div>
              <div
                className={`mt-0.5 text-[0.62rem] font-semibold ${
                  entry.draftRoi === null
                    ? "text-ink-faint"
                    : entry.draftRoi > 0
                      ? "text-diverge-pos"
                      : entry.draftRoi < 0
                        ? "text-diverge-neg"
                        : "text-ink-dim"
                }`}
                title="Draft ROI: actual season percentile minus the expected percentile from original draft position (positive = outperformed the pick).">
                {entry.draftRoi === null
                  ? "Draft ROI: n/a"
                  : `Draft ROI: ${formatPercentileChange(entry.draftRoi)}`}
              </div>
              <div className="mt-0.5 text-[0.62rem] text-ink-faint">
                {entry.originalDraftSlot
                  ? `Drafted Rd ${entry.originalDraftSlot.round} (${entry.originalDraftSlot.year}) by ${
                      ownerRef(owners, entry.originalDraftSlot.ownerId).name
                    }`
                  : "Undrafted"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
