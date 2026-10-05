import { Link } from "react-router-dom";
import { cellBackground, cellLabel, pairKey, type PairRecord } from "../../lib/h2h";
import type { Owner } from "../../types";

interface GridProps {
  owners: Owner[];
  records: Map<string, PairRecord>;
}

/** Sticky first column so a wide owner list still scrolls sideways on a phone inside Board's overflow-x-auto wrapper. */
export function Grid({ owners, records }: GridProps) {
  const sortedOwners = [...owners].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left"></th>
          {sortedOwners.map(col => (
            <th
              key={col.owner_id}
              scope="col"
              className="px-2 py-2 text-center text-[0.62rem] font-semibold tracking-wide text-ink-faint uppercase whitespace-nowrap">
              {col.canonical_name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedOwners.map(row => (
          <tr key={row.owner_id} className="border-t border-border">
            <th
              scope="row"
              className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">
              {row.canonical_name}
            </th>
            {sortedOwners.map(col => {
              if (col.owner_id === row.owner_id) {
                return (
                  <td key={col.owner_id} className="px-2 py-2 text-center text-ink-faint">
                    —
                  </td>
                );
              }
              const record = records.get(pairKey(row.owner_id, col.owner_id));
              const games = record ? record.wins + record.losses + record.ties : 0;
              return (
                <td key={col.owner_id} style={cellBackground(record, games)} className="p-0 text-center">
                  <Link
                    to={`/head-to-head/${row.owner_id}/${col.owner_id}`}
                    className={`block px-2 py-2 tabular-nums hover:underline ${
                      games === 0 ? "text-ink-faint" : "font-semibold text-ink"
                    }`}>
                    {cellLabel(record)}
                  </Link>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
