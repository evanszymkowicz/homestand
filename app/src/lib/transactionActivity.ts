import { isBindingTransaction } from "./transactions";
import type { Owner, Trade, Transaction } from "../types";

export interface OwnerSeasonActivity {
  adds: number;
  drops: number;
  trades: number;
  total: number;
}

export interface OwnerTransactionActivity {
  ownerId: string;
  /** Year -> counts. Only years with at least one counted movement appear. */
  bySeason: Map<number, OwnerSeasonActivity>;
  totalAdds: number;
  totalDrops: number;
  totalTrades: number;
  totalTransactions: number;
  /** Years that actually have ledger data (i.e. transactions covered). */
  seasonsCovered: number;
}

function emptyOwnerActivity(ownerId: string): OwnerTransactionActivity {
  return {
    ownerId,
    bySeason: new Map(),
    totalAdds: 0,
    totalDrops: 0,
    totalTrades: 0,
    totalTransactions: 0,
    seasonsCovered: 0,
  };
}

/**
 * The single ledger walk both exported functions share. Walks `transactions`
 * once and returns a per-owner accumulator.
 *
 * `owner_id` is null on some rows; those are unattributable and dropped rather
 * than bucketed under a synthetic owner.
 *
 * `trades` is the reconstructed deal list from trades.json, and it — NOT the
 * ledger — is the source of truth for the trade count. ESPN prunes the
 * TRADE_PROPOSAL rows and keeps only a small minority of executed deals'
 * item_type === "TRADE" rows in transactions.json; data/README.md records that
 * only 2 of 11 executed 2019-2025 trades survive there. Counting the ledger
 * alone credited the owner page with 0 trades where the Trades tab showed 5 for
 * the same owner. Adds and drops stay on the ledger, which is complete for
 * them.
 *
 * Pass `[]` for trades only if the caller genuinely has no deal data; the trade
 * count then falls back to the lossy ledger clustering below.
 */
function accumulate(transactions: Transaction[], trades: Trade[]): Map<string, OwnerTransactionActivity> {
  const byOwner = new Map<string, OwnerTransactionActivity>();

  const ownerAcc = (ownerId: string): OwnerTransactionActivity => {
    let owner = byOwner.get(ownerId);
    if (!owner) {
      owner = emptyOwnerActivity(ownerId);
      byOwner.set(ownerId, owner);
    }
    return owner;
  };
  const seasonAcc = (owner: OwnerTransactionActivity, year: number): OwnerSeasonActivity => {
    let season = owner.bySeason.get(year);
    if (!season) {
      season = { adds: 0, drops: 0, trades: 0, total: 0 };
      owner.bySeason.set(year, season);
    }
    return season;
  };

  // Pass 1: adds and drops, one per item. Trades are deferred to the per-deal
  // pass below so a multi-player deal counts once.
  for (const tx of transactions) {
    if (tx.owner_id === null) continue;
    if (!isBindingTransaction(tx)) continue;
    for (const item of tx.items) {
      if (item.item_type !== "ADD" && item.item_type !== "DROP") continue;
      const owner = ownerAcc(tx.owner_id);
      const season = seasonAcc(owner, tx.year);
      if (item.item_type === "ADD") {
        season.adds += 1;
        owner.totalAdds += 1;
      } else {
        season.drops += 1;
        owner.totalDrops += 1;
      }
      season.total += 1;
      owner.totalTransactions += 1;
    }
  }

  // Pass 2: one trade per executed deal.
  //
  // Preferred path: trades.json's reconstructed deals, which carry both
  // participants explicitly and survive ESPN's pruning. Each owner in a deal is
  // credited once for that deal's season.
  if (trades.length > 0) {
    for (const trade of trades) {
      // A proposed-but-unexecuted deal is not a completed trade.
      if (trade.executed_date === null) continue;
      const participants = new Set([trade.team_a_owner_id, trade.team_b_owner_id]);
      for (const ownerId of participants) {
        if (ownerId === null) continue;
        const owner = ownerAcc(ownerId);
        const season = seasonAcc(owner, trade.year);
        season.trades += 1;
        owner.totalTrades += 1;
        season.total += 1;
        owner.totalTransactions += 1;
      }
    }
  } else {
    // Fallback for callers with no deal data: cluster the ledger rows by the
    // proposal they answer, the same key trades.ts uses. Lossy by construction
    // (see the doc comment) but better than reporting nothing.
    const deals = new Map<string, { year: number; ownerIds: Set<string> }>();
    for (const tx of transactions) {
      if (tx.owner_id === null) continue;
      if (!isBindingTransaction(tx)) continue;
      if (!tx.items.some(item => item.item_type === "TRADE")) continue;
      const key = `${tx.year}:${tx.related_transaction_id ?? tx.transaction_id}`;
      const deal = deals.get(key) ?? { year: tx.year, ownerIds: new Set<string>() };
      deal.ownerIds.add(tx.owner_id);
      deals.set(key, deal);
    }
    for (const deal of deals.values()) {
      for (const ownerId of deal.ownerIds) {
        const owner = ownerAcc(ownerId);
        const season = seasonAcc(owner, deal.year);
        season.trades += 1;
        owner.totalTrades += 1;
        season.total += 1;
        owner.totalTransactions += 1;
      }
    }
  }

  for (const owner of byOwner.values()) {
    owner.seasonsCovered = owner.bySeason.size;
  }
  return byOwner;
}

/**
 * Activity for every owner in the ledger, sorted by total transactions desc.
 *
 * The `owners` list is used only to ensure every known owner appears (with zero
 * counts), so a caller rendering a table for all owners doesn't have to handle
 * missing rows.
 */
export function computeOwnerTransactionActivity(
  transactions: Transaction[],
  owners: Owner[],
  trades: Trade[] = []
): OwnerTransactionActivity[] {
  const byOwner = accumulate(transactions, trades);
  for (const owner of owners) {
    if (!byOwner.has(owner.owner_id)) byOwner.set(owner.owner_id, emptyOwnerActivity(owner.owner_id));
  }
  return Array.from(byOwner.values()).sort(
    (a, b) => b.totalTransactions - a.totalTransactions || a.ownerId.localeCompare(b.ownerId)
  );
}

/** Activity for a single owner. Returns zeros rather than null when they have
 * no ledger rows, so callers can render the section unconditionally. */
export function computeOwnerTransactionActivityForOwner(
  ownerId: string,
  transactions: Transaction[],
  trades: Trade[] = []
): OwnerTransactionActivity {
  return accumulate(transactions, trades).get(ownerId) ?? emptyOwnerActivity(ownerId);
}

/**
 * The single busiest owner-season in the ledger, for the "Wire wizard" badge.
 * Ties break toward the higher count, then the earlier year, then the lower
 * owner id so the result is deterministic.
 */
export function busiestOwnerSeason(
  activities: OwnerTransactionActivity[]
): { ownerId: string; year: number; total: number } | null {
  let best: { ownerId: string; year: number; total: number } | null = null;
  for (const activity of activities) {
    for (const [year, season] of activity.bySeason) {
      if (season.total === 0) continue;
      if (
        best === null ||
        season.total > best.total ||
        (season.total === best.total && (year < best.year || (year === best.year && activity.ownerId < best.ownerId)))
      ) {
        best = { ownerId: activity.ownerId, year, total: season.total };
      }
    }
  }
  return best;
}
