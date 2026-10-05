import { useState } from "react";
import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { OwnerScopeToggle, type OwnerScope } from "../../components/OwnerScopeToggle";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import { cellBackground, cellLabel, pairKey, type PairRecord } from "../../lib/h2h";
import { getCurrentOwnerIds, winPct } from "../../lib/stats";
import type { Owner, Team } from "../../types";

interface VsEveryoneProps {
  ownerId: string;
  owners: Owner[];
  teams: Team[];
  records: Map<string, PairRecord>;
}

type VsEveryoneSortKey = "opponent" | "record";

interface VsEveryoneRow {
  opponent: Owner;
  record: PairRecord | undefined;
  games: number;
}

function vsEveryoneSortValue(row: VsEveryoneRow, key: VsEveryoneSortKey): number | string {
  switch (key) {
    case "opponent":
      return row.opponent.canonical_name;
    case "record":
      return row.record ? winPct(row.record) : -1;
  }
}

/** All-time record against every other owner, combined regular+playoffs.
 * Active/All-Time scope reuses the same OwnerScopeToggle + getCurrentOwnerIds
 * pair as OwnerDirectory/Records — it only changes which opponents are
 * listed, not the records themselves. Reuses Grid.tsx's exact diverging
 * win%-tint helpers rather than re-implementing them. */
export function VsEveryone({ ownerId, owners, teams, records }: VsEveryoneProps) {
  const [scope, setScope] = useState<OwnerScope>("current");
  const currentOwnerIds = getCurrentOwnerIds(teams);
  const opponents = owners
    .filter(o => o.owner_id !== ownerId)
    .filter(o => scope === "all" || currentOwnerIds.has(o.owner_id))
    .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));

  const rows: VsEveryoneRow[] = opponents.map(opponent => {
    const record = records.get(pairKey(ownerId, opponent.owner_id));
    const games = record ? record.wins + record.losses + record.ties : 0;
    return { opponent, record, games };
  });

  const { sorted, sortKey, direction, toggleSort } = useSortableRows<VsEveryoneRow, VsEveryoneSortKey>(
    rows,
    vsEveryoneSortValue,
    "opponent",
    "asc"
  );

  return (
    <div className="mt-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionHeading as="h3">Head-to-Head vs. Everyone</SectionHeading>
        <OwnerScopeToggle value={scope} onChange={setScope} />
      </div>
      {opponents.length === 0 ? (
        <p className="text-ink-dim">No other owners to compare against.</p>
      ) : (
        <Board maxHeight={TEN_ROWS}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <SortHeader
                  label="Opponent"
                  sortKey="opponent"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={toggleSort}
                  align="left"
                />
                <SortHeader
                  label="Record"
                  sortKey="record"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={toggleSort}
                  align="center"
                />
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ opponent, record, games }) => {
                return (
                  <tr key={opponent.owner_id} className="border-t border-border hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <Link to={`/head-to-head/${ownerId}/${opponent.owner_id}`} className="hover:underline">
                        {opponent.canonical_name}
                      </Link>
                    </td>
                    <td style={cellBackground(record, games)} className="p-0 text-center">
                      <Link
                        to={`/head-to-head/${ownerId}/${opponent.owner_id}`}
                        className={`block px-3 py-2 tabular-nums hover:underline ${
                          games === 0 ? "text-ink-faint" : "font-semibold text-ink"
                        }`}>
                        {cellLabel(record)}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Board>
      )}
    </div>
  );
}
