import { describe, expect, it } from "vitest";
import {
  busiestOwnerSeason,
  computeOwnerTransactionActivity,
  computeOwnerTransactionActivityForOwner,
} from "./transactionActivity";
import type { Owner, Transaction } from "../types";

function makeTransaction(overrides: Partial<Transaction> & Pick<Transaction, "year">): Transaction {
  return {
    transaction_id: "t1",
    transaction_type: "FREEAGENT",
    scoring_period_id: 1,
    week: 1,
    proposed_date: 0,
    espn_team_id: 1,
    owner_id: "owner-a",
    acting_member_key: null,
    status: "EXECUTED",
    is_league_manager: false,
    related_transaction_id: null,
    bid_amount: 0,
    items: [],
    ...overrides,
  };
}

function makeItem(playerId: number, type: string) {
  return {
    player_id: playerId,
    item_type: type,
    from_espn_team_id: 1,
    to_espn_team_id: type === "DROP" ? null : 1,
    from_lineup_slot_id: null,
    to_lineup_slot_id: null,
  };
}

function makeOwner(ownerId: string, canonicalName: string): Owner {
  return {
    owner_id: ownerId,
    canonical_name: canonicalName,
    team_names_by_year: {},
    espn_member_keys: [],
    co_owners: [],
    last_active_year: 2024,
    absent_from_latest_season: false,
  };
}

const OWNERS: Owner[] = [makeOwner("owner-a", "Alice"), makeOwner("owner-b", "Bob")];

describe("computeOwnerTransactionActivityForOwner", () => {
  it("counts adds, drops and trades separately", () => {
    const txs = [
      makeTransaction({ year: 2024, items: [makeItem(1, "ADD"), makeItem(2, "ADD")] }),
      makeTransaction({ year: 2024, items: [makeItem(3, "DROP")] }),
      makeTransaction({ year: 2024, items: [makeItem(4, "TRADE")] }),
    ];
    const activity = computeOwnerTransactionActivityForOwner("owner-a", txs);
    expect(activity.totalAdds).toBe(2);
    expect(activity.totalDrops).toBe(1);
    expect(activity.totalTrades).toBe(1);
    expect(activity.totalTransactions).toBe(4);
  });

  it("counts a multi-player trade as one deal, not one per player", () => {
    const txs = [
      makeTransaction({
        year: 2026,
        transaction_id: "deal-1",
        items: [makeItem(1, "TRADE"), makeItem(2, "TRADE"), makeItem(3, "TRADE")],
      }),
    ];
    const activity = computeOwnerTransactionActivityForOwner("owner-a", txs);
    expect(activity.totalTrades).toBe(1);
    expect(activity.totalTransactions).toBe(1);
    expect(activity.bySeason.get(2026)).toEqual({ adds: 0, drops: 0, trades: 1, total: 1 });
  });

  it("clusters the rows of one deal by its related proposal id", () => {
    const txs = [
      makeTransaction({
        year: 2026,
        transaction_id: "accept",
        related_transaction_id: "proposal",
        items: [makeItem(1, "TRADE")],
      }),
      makeTransaction({
        year: 2026,
        transaction_id: "uphold",
        related_transaction_id: "proposal",
        items: [makeItem(2, "TRADE")],
      }),
    ];
    expect(computeOwnerTransactionActivityForOwner("owner-a", txs).totalTrades).toBe(1);
  });

  it("counts a deal once for each participating owner", () => {
    const txs = [
      makeTransaction({
        year: 2026,
        owner_id: "owner-a",
        transaction_id: "row-a",
        related_transaction_id: "deal",
        items: [makeItem(1, "TRADE")],
      }),
      makeTransaction({
        year: 2026,
        owner_id: "owner-b",
        transaction_id: "row-b",
        related_transaction_id: "deal",
        items: [makeItem(2, "TRADE")],
      }),
    ];
    const activities = computeOwnerTransactionActivity(txs, OWNERS);
    expect(activities.find(a => a.ownerId === "owner-a")!.totalTrades).toBe(1);
    expect(activities.find(a => a.ownerId === "owner-b")!.totalTrades).toBe(1);
  });

  it("excludes LINEUP items, which are start/sit shuffling rather than roster moves", () => {
    const txs = [
      makeTransaction({ year: 2024, items: [makeItem(1, "ADD")] }),
      makeTransaction({ year: 2024, items: [makeItem(2, "LINEUP"), makeItem(3, "LINEUP")] }),
    ];
    expect(computeOwnerTransactionActivityForOwner("owner-a", txs).totalTransactions).toBe(1);
  });

  it("excludes non-binding trade proposals", () => {
    const txs = [
      makeTransaction({ year: 2024, status: "PENDING", items: [makeItem(1, "TRADE")] }),
      makeTransaction({ year: 2024, status: "CANCELED", items: [makeItem(2, "TRADE")] }),
      makeTransaction({ year: 2024, status: null, items: [makeItem(3, "TRADE")] }),
    ];
    const activity = computeOwnerTransactionActivityForOwner("owner-a", txs);
    expect(activity.totalTrades).toBe(1);
  });

  it("breaks activity down by season", () => {
    const txs = [
      makeTransaction({ year: 2024, items: [makeItem(1, "ADD")] }),
      makeTransaction({ year: 2023, items: [makeItem(2, "ADD"), makeItem(3, "DROP")] }),
    ];
    const activity = computeOwnerTransactionActivityForOwner("owner-a", txs);
    expect(activity.bySeason.get(2023)).toEqual({ adds: 1, drops: 1, trades: 0, total: 2 });
    expect(activity.bySeason.get(2024)).toEqual({ adds: 1, drops: 0, trades: 0, total: 1 });
    expect(activity.seasonsCovered).toBe(2);
  });

  it("drops rows with no owner attribution instead of bucketing them", () => {
    const txs = [makeTransaction({ year: 2024, owner_id: null, items: [makeItem(1, "ADD")] })];
    expect(computeOwnerTransactionActivityForOwner("owner-a", txs).totalTransactions).toBe(0);
  });

  it("returns zeros for an owner with no ledger rows", () => {
    const activity = computeOwnerTransactionActivityForOwner("nobody", []);
    expect(activity.totalTransactions).toBe(0);
    expect(activity.bySeason.size).toBe(0);
  });

  it("ignores transactions with zero counted items", () => {
    const txs = [makeTransaction({ year: 2024, items: [makeItem(1, "LINEUP")] })];
    const activity = computeOwnerTransactionActivityForOwner("owner-a", txs);
    expect(activity.totalTransactions).toBe(0);
    // The year must not appear at all -- an empty season is not a season.
    expect(activity.bySeason.size).toBe(0);
  });
});

describe("computeOwnerTransactionActivity", () => {
  it("returns every known owner, including those with no activity", () => {
    const txs = [makeTransaction({ year: 2024, owner_id: "owner-a", items: [makeItem(1, "ADD")] })];
    const activities = computeOwnerTransactionActivity(txs, OWNERS);
    expect(activities.map(a => a.ownerId).sort()).toEqual(["owner-a", "owner-b"]);
    expect(activities.find(a => a.ownerId === "owner-b")!.totalTransactions).toBe(0);
  });

  it("sorts by total transactions descending", () => {
    const txs = [
      makeTransaction({ year: 2024, owner_id: "owner-a", items: [makeItem(1, "ADD")] }),
      makeTransaction({
        year: 2024,
        owner_id: "owner-b",
        items: [makeItem(2, "ADD"), makeItem(3, "DROP")],
      }),
    ];
    const activities = computeOwnerTransactionActivity(txs, OWNERS);
    expect(activities[0].ownerId).toBe("owner-b");
  });
});

describe("busiestOwnerSeason", () => {
  it("finds the single busiest owner-season league-wide", () => {
    const txs = [
      makeTransaction({ year: 2024, owner_id: "owner-a", items: [makeItem(1, "ADD")] }),
      makeTransaction({
        year: 2024,
        owner_id: "owner-b",
        items: [makeItem(2, "ADD"), makeItem(3, "ADD"), makeItem(4, "DROP")],
      }),
    ];
    const busiest = busiestOwnerSeason(computeOwnerTransactionActivity(txs, OWNERS));
    expect(busiest).toEqual({ ownerId: "owner-b", year: 2024, total: 3 });
  });

  it("breaks a tie toward the earlier year so the result is deterministic", () => {
    const txs = [
      makeTransaction({ year: 2025, owner_id: "owner-a", items: [makeItem(1, "ADD")] }),
      makeTransaction({ year: 2024, owner_id: "owner-b", items: [makeItem(2, "ADD")] }),
    ];
    const busiest = busiestOwnerSeason(computeOwnerTransactionActivity(txs, OWNERS));
    expect(busiest).toEqual({ ownerId: "owner-b", year: 2024, total: 1 });
  });

  it("returns null when nobody moved", () => {
    expect(busiestOwnerSeason(computeOwnerTransactionActivity([], OWNERS))).toBeNull();
  });
});
