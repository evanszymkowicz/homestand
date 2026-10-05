import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getTradeRegistry,
  groupTrades,
  orientRowToOwner,
  summarizeTradeRegistry,
  sumTradeDeltas,
  UNKNOWN_OWNER_ID,
} from "./trades";
import type { TradeEntry, TradeRow } from "./trades";
import type { DraftPick, PlayerSeasonPoints, Team, Trade, Transaction } from "../types";

function readProcessed<T>(name: string): T {
  const appDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  return JSON.parse(readFileSync(path.join(appDir, "public/data", name), "utf-8")) as T;
}

describe("getTradeRegistry", () => {
  it("combines picks and players into one registry, against the real archive", () => {
    const entries = getTradeRegistry(
      readProcessed<DraftPick[]>("draft_picks.json"),
      readProcessed<Transaction[]>("transactions.json"),
      readProcessed<Trade[]>("trades.json"),
      readProcessed<Team[]>("teams.json"),
      readProcessed<PlayerSeasonPoints[]>("player_season_points.json")
    );
    const summary = summarizeTradeRegistry(entries);

    // 31 traded picks across the full archive. The league's 14 executed
    // player trades: 12 carry a real player exchange (2 ledger-sourced,
    // 9 recovered by trades.json's box-score-diff backfill, and one 2026
    // trade recovered from its surviving proposal --
    // phase-8-trade-backfill-reconstruction-spec.md). One remains unrecorded:
    // a 2021 deal ESPN killed with a TRADE_VETO (not an execution).
    expect(summary.picks).toBe(31);
    expect(summary.unrecorded).toBe(1);

    // Picks reach back well before the 2019 transaction ledger.
    const pickYears = entries.filter(e => e.kind === "pick").map(e => e.year);
    expect(Math.min(...pickYears)).toBe(2009);

    // The recoverable exchanges are real, named players -- not raw ids.
    const traded = entries.filter(e => e.kind === "player").map(e => e.playerName);
    expect(traded).toContain("Randy Arozarena");
    expect(traded).toContain("Giancarlo Stanton");
    expect(traded).toContain("Carlos Correa");
    // The 2026 accept-finalized trade resolves from its surviving proposal.
    expect(traded).toContain("Garrett Crochet");
    expect(traded).toContain("Robbie Ray");
    expect(traded).toContain("Wilyer Abreu");
  });

  it("keeps unrecorded trades in the registry rather than dropping them", () => {
    const entries = getTradeRegistry(
      [],
      readProcessed<Transaction[]>("transactions.json"),
      [],
      readProcessed<Team[]>("teams.json"),
      []
    );
    const unrecorded = entries.filter(e => e.kind === "unrecorded");
    // With no trades.json backfill supplied, every trade whose ledger items
    // didn't survive falls back to "not on file" -- the pre-backfill count.
    // This number drifts with the processed archive as ESPN's transaction
    // ledger is refreshed; current count verified 2026-08-25 (was 11 until a
    // 2026 trade's player exchange was recovered by the daily capture).
    expect(unrecorded.length).toBe(10);
    // They carry no player but still name the side(s) ESPN did serve.
    for (const entry of unrecorded) {
      expect(entry.playerId).toBeNull();
      expect(entry.fromOwnerId).not.toBe(UNKNOWN_OWNER_ID);
    }
    // One trade has only a single TRADE_ACCEPT row on file, so the
    // counterparty is genuinely unknown -- surfaced, not silently dropped.
    // The 2021 case was the original one. A second, 2026's accept-only trade
    // (proposal pruned before the daily capture ran), was recovered once a
    // later daily capture served its proposal -- verified 2026-08-25.
    const acceptOnly = unrecorded.filter(u => u.toOwnerId === UNKNOWN_OWNER_ID);
    expect(acceptOnly.length).toBe(1);
    expect(acceptOnly.map(u => u.year)).toContain(2021);
  });

  it("excludes proposals that were never accepted", () => {
    const proposals = readProcessed<Transaction[]>("transactions.json").filter(
      t => t.transaction_type === "TRADE_PROPOSAL"
    );
    // The proposals DO carry player exchanges -- 144 TRADE items -- which is
    // exactly why they have to be filtered out rather than trusted.
    expect(proposals.flatMap(t => t.items).filter(i => i.item_type === "TRADE").length).toBeGreaterThan(100);

    const entries = getTradeRegistry([], proposals, [], readProcessed<Team[]>("teams.json"), []);
    expect(entries).toEqual([]);
  });
});

describe("multi-party trades", () => {
  function makeAccept(teamId: number, relatedId: string): Transaction {
    return {
      year: 2021,
      transaction_id: `accept-${teamId}`,
      transaction_type: "TRADE_ACCEPT",
      scoring_period_id: 30,
      week: 5,
      proposed_date: 0,
      espn_team_id: teamId,
      owner_id: null,
      acting_member_key: null,
      status: "EXECUTED",
      is_league_manager: false,
      related_transaction_id: relatedId,
      bid_amount: 0,
      items: [],
    };
  }

  it("keeps every side of a three-way trade instead of just the first two", () => {
    const teams = readProcessed<Team[]>("teams.json").filter(t => t.year === 2021);
    const [a, b, c] = teams.map(t => t.espn_team_id);
    const entries = getTradeRegistry(
      [],
      [makeAccept(a, "prop"), makeAccept(b, "prop"), makeAccept(c, "prop")],
      [],
      teams,
      []
    );

    expect(entries).toHaveLength(1);
    // fromOwnerId/toOwnerId only carry two sides -- participantOwnerIds is the
    // authoritative list, which is what the table renders.
    expect(entries[0].participantOwnerIds).toHaveLength(3);
    expect(new Set(entries[0].participantOwnerIds).size).toBe(3);
  });

  it("populates participantOwnerIds on pick and player rows too", () => {
    const entries = getTradeRegistry(
      readProcessed<DraftPick[]>("draft_picks.json"),
      readProcessed<Transaction[]>("transactions.json"),
      readProcessed<Trade[]>("trades.json"),
      readProcessed<Team[]>("teams.json"),
      readProcessed<PlayerSeasonPoints[]>("player_season_points.json")
    );
    for (const entry of entries.filter(e => e.kind !== "unrecorded")) {
      expect(entry.participantOwnerIds).toEqual([entry.fromOwnerId, entry.toOwnerId]);
    }
  });
});

function playerEntry(fromOwnerId: string, toOwnerId: string, playerId: number, points: number): TradeEntry {
  return {
    key: `${fromOwnerId}-${toOwnerId}-${playerId}`,
    tradeKey: "t1",
    kind: "player",
    year: 2020,
    week: 3,
    fromOwnerId,
    toOwnerId,
    participantOwnerIds: [fromOwnerId, toOwnerId],
    playerId,
    playerName: `Player ${playerId}`,
    roundId: null,
    overallPickNumber: null,
    points,
  };
}

describe("point delta sign (Points Δ favors the first/left owner)", () => {
  const entry = playerEntry;

  it("is positive when the first owner received more than they gave up", () => {
    // A gave 100, B gave 300 -> A received 300, gave 100 -> net +200.
    const rows = groupTrades([entry("A", "B", 1, 100), entry("B", "A", 2, 300)]);
    expect(rows[0].sides[0].ownerId).toBe("A");
    expect(rows[0].points).toBeCloseTo(200, 0);
  });

  it("is negative when the first owner gave up more than they received", () => {
    // A gave 500, B gave 200 -> A received 200, gave 500 -> net -300.
    const rows = groupTrades([entry("A", "B", 1, 500), entry("B", "A", 2, 200)]);
    expect(rows[0].points).toBeCloseTo(-300, 0);
  });

  it("reads the real 2019 trade signed against the fuller (left) side", () => {
    const rows = groupTrades(
      getTradeRegistry(
        readProcessed<DraftPick[]>("draft_picks.json"),
        readProcessed<Transaction[]>("transactions.json"),
        readProcessed<Trade[]>("trades.json"),
        readProcessed<Team[]>("teams.json"),
        readProcessed<PlayerSeasonPoints[]>("player_season_points.json")
      )
    );
    const row = rows.find(
      r => r.kind === "player" && r.year === 2019 && r.sides.some(s => s.ownerId === "john-packer")
    );
    expect(row).toBeDefined();
    // john-packer gave up 3 players (767.5); received one (263.2) -> -504.3.
    expect(row!.points).toBeCloseTo(-504.3, 1);
  });
});

describe("sumTradeDeltas", () => {
  function trade(key: string, points: number | null, owners: string[]): TradeRow {
    return {
      key,
      kind: "unrecorded" as const,
      year: 2020,
      week: 1,
      sides: owners.map(o => ({ ownerId: o, assets: [], points: null })),
      points,
      participantOwnerIds: owners,
    };
  }

  it("sums the Points Delta across an owner's trades", () => {
    const rows = [
      trade("a", 150, ["owner-a", "owner-b"]),
      trade("b", -80, ["owner-a", "owner-c"]),
      trade("c", 40, ["owner-b", "owner-d"]),
    ];
    expect(sumTradeDeltas(rows, "owner-a")).toBeCloseTo(70, 0);
    // owner-a holds sides[0] of both its trades. owner-d holds sides[1] of the
    // third, so its figure inverts to -40.
    expect(sumTradeDeltas(rows, "owner-d")).toBeCloseTo(-40, 0);
  });

  it("returns null when an owner's trades carry no scored delta", () => {
    const rows = [trade("a", null, ["owner-a", "owner-b"])];
    expect(sumTradeDeltas(rows, "owner-a")).toBeNull();
  });

  it("returns null for an owner with no trades at all", () => {
    expect(sumTradeDeltas([trade("a", 10, ["owner-b", "owner-c"])], "owner-x")).toBeNull();
  });

  it("signs each trade from the summed owner's own side of it", () => {
    // row.points is always sides[0]'s net. owner-b is on sides[1] of both, so
    // every contribution must invert -- the raw sum would be -60, their real
    // total is +60.
    const rows = [trade("a", 200, ["owner-a", "owner-b"]), trade("b", -140, ["owner-a", "owner-b"])];
    expect(sumTradeDeltas(rows, "owner-a")).toBeCloseTo(60, 0);
    expect(sumTradeDeltas(rows, "owner-b")).toBeCloseTo(-60, 0);
  });

  it("inverts only the trades the owner is on the short side of", () => {
    const rows = [trade("a", 100, ["owner-a", "owner-b"]), trade("b", 40, ["owner-b", "owner-c"])];
    // owner-b holds sides[1] of "a" (so -100) but sides[0] of "b" (+40).
    // Summing the column blind would give +140.
    expect(sumTradeDeltas(rows, "owner-b")).toBeCloseTo(-60, 0);
  });

  it("agrees with the Points Δ column it sums, for both sides of a trade", () => {
    const rows = groupTrades([playerEntry("A", "B", 1, 500), playerEntry("B", "A", 2, 200)]);
    expect(rows[0].points).toBeCloseTo(-300, 0);
    // A gave 500 and received 200; B is the mirror image.
    expect(sumTradeDeltas(rows, "A")).toBeCloseTo(-300, 0);
    expect(sumTradeDeltas(rows, "B")).toBeCloseTo(300, 0);
  });

  it("excludes a third side, whose net the two-sided delta doesn't describe", () => {
    // pointsDelta compares only the first two sides, so sides[2] has no
    // attributable figure -- better absent from the total than silently wrong.
    const rows = [trade("a", 100, ["owner-a", "owner-b", "owner-c"])];
    expect(sumTradeDeltas(rows, "owner-a")).toBeCloseTo(100, 0);
    expect(sumTradeDeltas(rows, "owner-b")).toBeCloseTo(-100, 0);
    expect(sumTradeDeltas(rows, "owner-c")).toBeNull();
  });

  it("excludes an owner named only in participantOwnerIds with no side", () => {
    const rows = [trade("a", 100, ["owner-a", "owner-b", "not-on-file"])];
    expect(sumTradeDeltas(rows, "not-on-file")).toBeNull();
  });

  it("sums every owner's real net to zero across a set of trades", () => {
    const rows = [
      trade("a", 200, ["owner-a", "owner-b"]),
      trade("b", -140, ["owner-a", "owner-b"]),
      trade("c", 40, ["owner-b", "owner-c"]),
    ];
    const total = ["owner-a", "owner-b", "owner-c"].reduce((sum, id) => sum + (sumTradeDeltas(rows, id) ?? 0), 0);
    expect(total).toBeCloseTo(0, 0);
  });

  describe("orientRowToOwner", () => {
    it("moves a side-1 owner to the front and flips the delta with them", () => {
      const [row] = groupTrades([playerEntry("A", "B", 1, 500), playerEntry("B", "A", 2, 200)]);
      const oriented = orientRowToOwner(row, "B");
      expect(oriented.sides.map(s => s.ownerId)).toEqual(["B", "A"]);
      expect(oriented.points).toBeCloseTo(300, 0);
      // The owner's total now equals the sum of the column it renders.
      expect(sumTradeDeltas([oriented], "B")).toBeCloseTo(300, 0);
    });

    it("leaves an already-first owner untouched", () => {
      const [row] = groupTrades([playerEntry("A", "B", 1, 500), playerEntry("B", "A", 2, 200)]);
      const oriented = orientRowToOwner(row, "A");
      expect(oriented.sides.map(s => s.ownerId)).toEqual(["A", "B"]);
      expect(oriented.points).toBeCloseTo(-300, 0);
    });

    it("does not mutate the input row", () => {
      const [row] = groupTrades([playerEntry("A", "B", 1, 500), playerEntry("B", "A", 2, 200)]);
      const before = row.sides.map(s => s.ownerId);
      orientRowToOwner(row, "B");
      expect(row.sides.map(s => s.ownerId)).toEqual(before);
      expect(row.points).toBeCloseTo(-300, 0);
    });

    it("leaves an unscored row's null delta null", () => {
      const [scored] = groupTrades([playerEntry("A", "B", 1, 500), playerEntry("B", "A", 2, 200)]);
      expect(orientRowToOwner({ ...scored, points: null }, "B").points).toBeNull();
    });

    it("leaves a row the owner isn't a side of alone", () => {
      const [row] = groupTrades([playerEntry("A", "B", 1, 500), playerEntry("B", "A", 2, 200)]);
      expect(orientRowToOwner(row, "owner-x")).toBe(row);
    });

    it("makes the rendered column sum equal the filtered total", () => {
      const rows = groupTrades([
        playerEntry("A", "B", 1, 500),
        playerEntry("B", "A", 2, 200),
        playerEntry("A", "B", 3, 100),
        playerEntry("B", "A", 4, 900),
      ]);
      const oriented = rows.map(r => orientRowToOwner(r, "A"));
      const columnSum = oriented.reduce((sum, r) => sum + (r.points ?? 0), 0);
      expect(columnSum).toBeCloseTo(sumTradeDeltas(rows, "A") ?? 0, 5);
    });
  });
});
