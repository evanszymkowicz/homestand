import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { OwnerLink } from "../../components/OwnerLink";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import type { MrIrrelevantEntry } from "../../lib/draft";
import { formatPoints } from "../../lib/format";
import { ownerRef } from "../../lib/stats";
import type { Owner, Season } from "../../types";

interface MrIrrelevantProps {
  seasons: Season[];
  entries: MrIrrelevantEntry[];
  owners: Owner[];
  positionByPlayerId: Map<number, string>;
}

type IrrelevantSortKey = "year" | "player" | "position" | "owner" | "points";

export function MrIrrelevant({ seasons, entries, owners, positionByPlayerId }: MrIrrelevantProps) {
  function getValue(entry: MrIrrelevantEntry, key: IrrelevantSortKey): number | string {
    switch (key) {
      case "year":
        return entry.year;
      case "player":
        return entry.pick.player_name;
      case "position":
        return positionByPlayerId.get(entry.pick.player_id) ?? "—";
      case "owner":
        return ownerRef(owners, entry.pick.owner_id).name;
      case "points":
        return entry.points ?? -Infinity;
    }
  }

  const { sorted, sortKey, direction, toggleSort } = useSortableRows<MrIrrelevantEntry, IrrelevantSortKey>(
    entries,
    getValue,
    "year",
    "desc"
  );

  if (entries.length === 0) {
    return <p className="text-ink-dim">No draft data available yet.</p>;
  }

  const anyKept = entries.some(e => e.keptNextYear);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <SectionHeading>Mr. Irrelevant</SectionHeading>
        <CoverageBadge seasons={seasons} domain="box_scores" />
      </div>
      <Board maxHeight={TEN_ROWS}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <SortHeader
                label="Year"
                sortKey="year"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
              <SortHeader
                label="Player"
                sortKey="player"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
              />
              <SortHeader
                label="Pos"
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
                label="Season Points"
                sortKey="points"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map(e => (
              <tr
                key={e.year}
                className={`border-t border-border ${
                  e.keptNextYear ? "bg-gold-soft hover:bg-gold-soft" : "hover:bg-surface-2"
                }`}>
                <td className="px-3 py-2 text-center font-semibold tabular-nums">{e.year}</td>
                <td className="px-3 py-2 font-semibold">
                  <Link to={`/player/${e.pick.player_id}`} className="hover:underline">
                    {e.pick.player_name}
                  </Link>
                  {e.keptNextYear && <span className="text-gold">*</span>}
                </td>
                <td className="px-3 py-2 text-ink-dim">{positionByPlayerId.get(e.pick.player_id) ?? "—"}</td>
                <td className="px-3 py-2 text-ink-dim">
                  <OwnerLink owners={owners} ownerId={e.pick.owner_id} />
                </td>
                <td className="px-3 py-2 text-center tabular-nums">
                  {e.points === null ? (
                    <span title="No season-points data on file" className="text-ink-faint">
                      no data
                    </span>
                  ) : (
                    formatPoints(e.points)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Board>
      {anyKept && <p className="mt-2 text-xs text-ink-faint">*Kept the following season.</p>}
    </div>
  );
}
