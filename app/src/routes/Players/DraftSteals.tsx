import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { OwnerLink } from "../../components/OwnerLink";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import { DRAFT_VALUE_LEADERBOARD_SIZE, redraftMarker, redraftMarkerClass } from "../../lib/draft";
import type { DraftStealEntry } from "../../lib/draft";
import { formatPoints } from "../../lib/format";
import { ownerRef } from "../../lib/stats";
import type { Owner, Season } from "../../types";

interface DraftStealsProps {
  seasons: Season[];
  entries: DraftStealEntry[];
  owners: Owner[];
}

type StealSortKey = "year" | "player" | "owner" | "points" | "draftPosition" | "rankGap";

function StealsTable({
  rows,
  owners,
  initialDirection,
  hideDeclined = false,
}: {
  rows: DraftStealEntry[];
  owners: Owner[];
  initialDirection: "asc" | "desc";
  hideDeclined?: boolean;
}) {
  function getValue(entry: DraftStealEntry, key: StealSortKey): number | string {
    switch (key) {
      case "year":
        return entry.pick.year;
      case "player":
        return entry.pick.player_name;
      case "owner":
        return ownerRef(owners, entry.pick.owner_id).name;
      case "points":
        return entry.points ?? -Infinity;
      case "draftPosition":
        return entry.pick.live_overall_pick;
      case "rankGap":
        return entry.rankGap;
    }
  }

  // Default sort key is "rankGap" which is not a visible column
  // as active -- reproducing the steal/bust ranking the rows arrive in until
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<DraftStealEntry, StealSortKey>(
    rows,
    getValue,
    "rankGap",
    initialDirection
  );

  return (
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
              label="Owner"
              sortKey="owner"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Points"
              sortKey="points"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Draft Position"
              sortKey="draftPosition"
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
              key={`${e.pick.year}-${e.pick.player_id}`}
              className={`border-t border-border ${redraftRowClass(e.redraftStatus)}`}>
              <td className="px-3 py-2 text-center text-ink-faint tabular-nums">{e.pick.year}</td>
              <td className="px-3 py-2 font-semibold">
                <Link to={`/player/${e.pick.player_id}`} className="hover:underline">
                  {e.pick.player_name}
                </Link>{" "}
                {!(hideDeclined && e.redraftStatus === "declined") && (
                  <span className={redraftMarkerClass(e.redraftStatus)}>{redraftMarker(e.redraftStatus)}</span>
                )}
              </td>
              <td className="px-3 py-2 text-ink-dim">
                <OwnerLink owners={owners} ownerId={e.pick.owner_id} />
              </td>
              <td className="px-3 py-2 text-center tabular-nums">
                {e.points === null ? <span className="text-ink-faint">no data</span> : formatPoints(e.points)}
              </td>
              <td className="px-3 py-2 text-center tabular-nums">#{e.pick.live_overall_pick}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

function redraftRowClass(status: DraftStealEntry["redraftStatus"]): string {
  return status === "kept" ? "bg-gold-soft hover:bg-gold-soft" : "hover:bg-surface-2";
}

export function DraftSteals({ seasons, entries, owners }: DraftStealsProps) {
  if (entries.length === 0) {
    return <p className="text-ink-dim">No draft data available yet.</p>;
  }

  const steals = entries.slice(0, DRAFT_VALUE_LEADERBOARD_SIZE);
  const busts = entries.slice(-DRAFT_VALUE_LEADERBOARD_SIZE).reverse();

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>Draft Steals</SectionHeading>
          <CoverageBadge seasons={seasons} domain="box_scores" />
        </div>
        <StealsTable rows={steals} owners={owners} initialDirection="desc" />
      </div>
      <div>
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>Biggest Busts</SectionHeading>
          <CoverageBadge seasons={seasons} domain="box_scores" />
        </div>
        <StealsTable rows={busts} owners={owners} initialDirection="asc" hideDeclined />
      </div>
      <p className="text-xs text-ink-faint">
        <span className="text-gold">*</span> kept the following season · <span className="text-diverge-pos">↑</span>{" "}
        redrafted into an earlier round · <span className="text-diverge-neg">↓</span> redrafted into the same or a later
        round
      </p>
    </div>
  );
}
