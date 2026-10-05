import { useMemo } from "react";
import { CoverageBadge } from "../../components/CoverageBadge";
import { Board } from "../../components/Board";
import { CARD, EYEBROW } from "../../components/cardStyles";
import { SectionHeading } from "../../components/SectionHeading";
import {
  busiestOwnerSeason,
  computeOwnerTransactionActivity,
  computeOwnerTransactionActivityForOwner,
  type OwnerSeasonActivity,
} from "../../lib/transactionActivity";
import type { Owner, Season, Team, Transaction } from "../../types";

interface TransactionActivityProps {
  ownerId: string;
  owners: Owner[];
  teams: Team[];
  transactions: Transaction[];
  seasons: Season[];
}

interface SeasonRow extends OwnerSeasonActivity {
  year: number;
}

function SummaryStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={CARD}>
      <div className={EYEBROW}>{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${accent ? "text-accent" : "text-ink"}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

/**
 * Per-owner transaction activity off the 2019+ ledger: totals plus a
 * season-by-season breakdown, with a "Wire Wizard" badge for the owner holding
 * the single busiest owner-season in the league.
 *
 * The coverage badge is load-bearing — ESPN serves no transaction data for
 * 2009-2018, so this covers 7 of the archive's 17 seasons and has to say so.
 * The all-time equivalent (all 17 seasons, totals only, no player detail) is the
 * Tinkerer board on the Players route, built from ESPN's own per-season counters.
 *
 * An owner with no season in the covered window gets an explicit "records begin
 * in 2019" note rather than a grid of zeros, which would read as "made no
 * moves". Renders nothing at all only when the ledger itself is empty.
 */
export function TransactionActivity({ ownerId, owners, teams, transactions, seasons }: TransactionActivityProps) {
  const activity = useMemo(
    () => computeOwnerTransactionActivityForOwner(ownerId, transactions),
    [ownerId, transactions]
  );
  // The league-wide busiest owner-season doesn't depend on which owner is being
  // viewed, so it's keyed on the ledger + owner list alone and survives owner
  // switches (this used to walk the ledger once per owner).
  const busiest = useMemo(
    () =>
      transactions.length === 0 ? null : busiestOwnerSeason(computeOwnerTransactionActivity(transactions, owners)),
    [transactions, owners]
  );
  const isWizard = busiest != null && busiest.ownerId === ownerId;

  if (transactions.length === 0) return null;

  const coveredYears = new Set(seasons.filter(s => s.coverage.transactions === "full").map(s => s.year));
  const hasCoveredSeason = teams.some(t => t.owner_ids.includes(ownerId) && coveredYears.has(t.year));

  const rows: SeasonRow[] = [...activity.bySeason.entries()]
    .map(([year, counts]) => ({ year, ...counts }))
    .sort((a, b) => b.year - a.year);

  return (
    <div className="mt-7">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <SectionHeading as="h3">Transaction Activity</SectionHeading>
        <CoverageBadge seasons={seasons} domain="transactions" />
      </div>
      {busiest && isWizard && (
        <p className="mb-1 text-xs font-semibold text-gold">
          Wire Wizard — {busiest.total} moves in {busiest.year}, the busiest owner-season since 2019.
        </p>
      )}

      {!hasCoveredSeason ? (
        <p className="text-sm text-ink-dim">
          Transaction records begin in 2019. This owner has no team-season in the covered window.
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <SummaryStat label="Additions" value={activity.totalAdds} />
            <SummaryStat label="Drops" value={activity.totalDrops} />
            <SummaryStat label="Trades" value={activity.totalTrades} />
            <SummaryStat label="Total Moves" value={activity.totalTransactions} accent />
          </div>

          {rows.length > 0 ? (
            <Board maxHeight="25.5rem">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-eyebrow text-ink-faint">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 text-left font-bold tracking-wide uppercase">
                      Season
                    </th>
                    <th scope="col" className="px-3 py-2 text-center font-bold tracking-wide uppercase">
                      Additions
                    </th>
                    <th scope="col" className="px-3 py-2 text-center font-bold tracking-wide uppercase">
                      Drops
                    </th>
                    <th scope="col" className="px-3 py-2 text-center font-bold tracking-wide uppercase">
                      Trades
                    </th>
                    <th scope="col" className="px-3 py-2 text-center font-bold tracking-wide uppercase">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map(row => (
                    <tr key={row.year} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-left font-semibold">{row.year}</td>
                      <td className="px-3 py-2 text-center">{row.adds}</td>
                      <td className="px-3 py-2 text-center">{row.drops}</td>
                      <td className="px-3 py-2 text-center">{row.trades}</td>
                      <td className="px-3 py-2 text-center font-bold">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Board>
          ) : (
            <p className="text-sm text-ink-dim">No moves recorded since 2019.</p>
          )}
        </>
      )}
    </div>
  );
}
