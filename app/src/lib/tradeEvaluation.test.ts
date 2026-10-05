import { describe, expect, it } from "vitest";
import {
  buildTradeEvaluationIndex,
  computeRestOfSeasonPoints,
  computeRestOfSeasonValueSeries,
  computeRestOfSeasonValueWithKeepers,
  computeSurplusHistogram,
  computeTradeSymmetry,
  getTradeContext,
  gradeAllTrades,
} from "./tradeEvaluation";
import type { TradeEntry } from "./trades";
import type { Keeper, PlayerTeamSeasonPoints } from "../types";
import type { TradeGrade } from "./tradeEvaluation";

function teamPoints(year: number, playerId: number, ownerId: string, points: number): PlayerTeamSeasonPoints {
  return {
    year,
    player_id: playerId,
    player_name: `Player ${playerId}`,
    owner_id: ownerId,
    espn_team_id: 1,
    points,
    counted_points: points,
    bench_points: 0,
  };
}

function keeper(year: number, playerId: number, ownerId: string): Keeper {
  return {
    year,
    espn_team_id: 1,
    owner_id: ownerId,
    player_id: playerId,
    player_name: `Player ${playerId}`,
    round_id: 1,
    overall_pick_number: 1,
    validated_on_prior_roster: true,
    pro_team_id: 1,
  };
}

function entry(over: Partial<TradeEntry> & Pick<TradeEntry, "tradeKey" | "fromOwnerId" | "toOwnerId">): TradeEntry {
  return {
    key: `${over.tradeKey}-${over.playerId ?? "x"}`,
    kind: "player",
    year: 2021,
    week: 5,
    participantOwnerIds: [over.fromOwnerId, over.toOwnerId],
    playerId: null,
    playerName: "",
    roundId: null,
    overallPickNumber: null,
    points: null,
    ...over,
  };
}

describe("getTradeContext", () => {
  it("labels a pick trade as offseason", () => {
    expect(getTradeContext({ kind: "pick", week: null })).toBe("offseason");
  });

  it("labels a player trade as in-season even when the week is null", () => {
    // week === null on a ledger row means "dated outside a matchup week", not
    // "offseason" — the distinction the old week-based design got wrong.
    expect(getTradeContext({ kind: "player", week: null })).toBe("in-season");
    expect(getTradeContext({ kind: "player", week: 5 })).toBe("in-season");
  });
});

describe("computeRestOfSeasonPoints", () => {
  const index = buildTradeEvaluationIndex(
    [teamPoints(2021, 100, "alice", 3.9), teamPoints(2021, 100, "bob", 251.5)],
    []
  );

  it("returns only what the player produced for that owner", () => {
    // The archive's own split: the acquiring owner's share IS rest-of-season.
    expect(computeRestOfSeasonPoints(100, 2021, "bob", index)).toBe(251.5);
    expect(computeRestOfSeasonPoints(100, 2021, "alice", index)).toBe(3.9);
  });

  it("returns null when no row exists, distinct from a real zero", () => {
    expect(computeRestOfSeasonPoints(100, 2021, "carol", index)).toBeNull();
    expect(computeRestOfSeasonPoints(999, 2021, "bob", index)).toBeNull();
  });

  it("returns a real recorded zero as 0, not null", () => {
    // 111 rows in the archive are a genuine 0.0: rostered, scored nothing.
    const withZero = buildTradeEvaluationIndex([teamPoints(2021, 100, "bob", 0)], []);
    expect(computeRestOfSeasonPoints(100, 2021, "bob", withZero)).toBe(0);
  });

  it("keeps seasons separate", () => {
    const multi = buildTradeEvaluationIndex(
      [teamPoints(2021, 100, "bob", 251.5), teamPoints(2022, 100, "bob", 180)],
      []
    );
    expect(computeRestOfSeasonPoints(100, 2021, "bob", multi)).toBe(251.5);
    expect(computeRestOfSeasonPoints(100, 2022, "bob", multi)).toBe(180);
  });
});

describe("computeRestOfSeasonValueWithKeepers", () => {
  it("adds consecutive keeper seasons under the same owner", () => {
    const index = buildTradeEvaluationIndex(
      [teamPoints(2021, 100, "bob", 100), teamPoints(2022, 100, "bob", 200), teamPoints(2023, 100, "bob", 300)],
      [keeper(2022, 100, "bob"), keeper(2023, 100, "bob")]
    );
    expect(computeRestOfSeasonValueWithKeepers(100, 2021, "bob", index)).toBe(600);
  });

  it("stops at the first break in the keeper chain", () => {
    const index = buildTradeEvaluationIndex(
      [teamPoints(2021, 100, "bob", 100), teamPoints(2022, 100, "bob", 200), teamPoints(2025, 100, "bob", 999)],
      // Kept 2022, lost, re-acquired 2025 — the 2025 season is not this trade's doing.
      [keeper(2022, 100, "bob"), keeper(2025, 100, "bob")]
    );
    expect(computeRestOfSeasonValueWithKeepers(100, 2021, "bob", index)).toBe(300);
  });

  it("ignores keeper years belonging to a different owner", () => {
    const index = buildTradeEvaluationIndex(
      [teamPoints(2021, 100, "bob", 100), teamPoints(2022, 100, "alice", 999)],
      [keeper(2022, 100, "alice")]
    );
    expect(computeRestOfSeasonValueWithKeepers(100, 2021, "bob", index)).toBe(100);
  });

  it("matches the plain rest-of-season value when nothing was kept", () => {
    const index = buildTradeEvaluationIndex([teamPoints(2021, 100, "bob", 100)], []);
    expect(computeRestOfSeasonValueWithKeepers(100, 2021, "bob", index)).toBe(100);
  });

  it("returns null when no season in the chain has a points row", () => {
    const index = buildTradeEvaluationIndex([], [keeper(2022, 100, "bob")]);
    expect(computeRestOfSeasonValueWithKeepers(100, 2021, "bob", index)).toBeNull();
  });

  it("sorts keeper years regardless of input order", () => {
    const index = buildTradeEvaluationIndex(
      [teamPoints(2021, 100, "bob", 10), teamPoints(2022, 100, "bob", 20), teamPoints(2023, 100, "bob", 30)],
      // Deliberately out of order — the index must sort before walking the chain.
      [keeper(2023, 100, "bob"), keeper(2022, 100, "bob")]
    );
    expect(computeRestOfSeasonValueWithKeepers(100, 2021, "bob", index)).toBe(60);
  });

  it("stops the keeper chain at the first year outside the provided coverage set", () => {
    const index = buildTradeEvaluationIndex(
      [teamPoints(2021, 100, "bob", 100), teamPoints(2022, 100, "bob", 200), teamPoints(2023, 100, "bob", 300)],
      [keeper(2022, 100, "bob"), keeper(2023, 100, "bob")]
    );
    const coverage = new Set([2021, 2022]);
    expect(computeRestOfSeasonValueWithKeepers(100, 2021, "bob", index, coverage)).toBe(300);
    expect(computeRestOfSeasonValueSeries(100, 2021, "bob", index, coverage)).toEqual([
      { year: 2021, points: 100 },
      { year: 2022, points: 200 },
    ]);
  });
});

describe("gradeAllTrades", () => {
  const index = buildTradeEvaluationIndex(
    [
      teamPoints(2021, 100, "bob", 300), // bob got player 100
      teamPoints(2021, 200, "alice", 100), // alice got player 200
    ],
    []
  );

  const twoSided: TradeEntry[] = [
    entry({ tradeKey: "t1", playerId: 100, playerName: "P100", fromOwnerId: "alice", toOwnerId: "bob" }),
    entry({ tradeKey: "t1", playerId: 200, playerName: "P200", fromOwnerId: "bob", toOwnerId: "alice" }),
  ];

  it("values each side by what it received", () => {
    const { graded } = gradeAllTrades(twoSided, index);
    expect(graded).toHaveLength(1);
    const trade = graded[0];
    // alice is ownerA (sorted); she received player 200 → 100 points.
    expect(trade.ownerA).toBe("alice");
    expect(trade.sideATotalPoints).toBe(100);
    expect(trade.ownerB).toBe("bob");
    expect(trade.sideBTotalPoints).toBe(300);
    expect(trade.surplus).toBe(-200);
    expect(trade.letterGrade).toBe("F");
    expect(trade.isFair).toBe(false);
  });

  it("skips unrecorded trades but reports them as ungraded", () => {
    const withUnrecorded: TradeEntry[] = [
      ...twoSided,
      entry({
        tradeKey: "t2",
        kind: "unrecorded",
        fromOwnerId: "alice",
        toOwnerId: "bob",
        participantOwnerIds: ["alice", "bob"],
        year: 2020,
      }),
    ];
    const { graded, ungraded } = gradeAllTrades(withUnrecorded, index);
    expect(graded).toHaveLength(1);
    expect(ungraded).toHaveLength(1);
    expect(ungraded[0].reason).toBe("exchange-unknown");
    expect(ungraded[0].participantOwnerIds).toEqual(["alice", "bob"]);
  });

  it("never produces NaN totals for an unrecorded trade", () => {
    const { graded } = gradeAllTrades(
      [entry({ tradeKey: "t3", kind: "unrecorded", fromOwnerId: "alice", toOwnerId: "bob" })],
      index
    );
    expect(graded).toHaveLength(0);
  });

  it("reports a one-sided trade as ungraded rather than grading it against nothing", () => {
    const oneSided: TradeEntry[] = [entry({ tradeKey: "t4", playerId: 100, fromOwnerId: "alice", toOwnerId: "bob" })];
    const { graded, ungraded } = gradeAllTrades(oneSided, index);
    expect(graded).toHaveLength(0);
    expect(ungraded[0].reason).toBe("single-sided");
  });

  it("reports a three-way trade as ungraded rather than silently dropping a side", () => {
    // A/B grading cannot express three sides: carol's surrendered asset would
    // belong to neither graded side. None exist in the archive today, but the
    // registry preserves every participant, so this must not silently truncate.
    const threeWay: TradeEntry[] = [
      entry({ tradeKey: "t3w", playerId: 100, fromOwnerId: "alice", toOwnerId: "bob" }),
      entry({ tradeKey: "t3w", playerId: 200, fromOwnerId: "bob", toOwnerId: "carol" }),
      entry({
        tradeKey: "t3w",
        playerId: 300,
        fromOwnerId: "carol",
        toOwnerId: "alice",
        participantOwnerIds: ["alice", "bob", "carol"],
      }),
    ];
    const { graded, ungraded } = gradeAllTrades(threeWay, index);
    expect(graded).toHaveLength(0);
    expect(ungraded).toHaveLength(1);
    expect(ungraded[0].reason).toBe("multi-party");
  });

  it("grades a pick trade through the same path, labelled offseason", () => {
    const pickTrade: TradeEntry[] = [
      entry({
        tradeKey: "p1",
        kind: "pick",
        week: null,
        playerId: 100,
        fromOwnerId: "alice",
        toOwnerId: "bob",
        overallPickNumber: 5,
      }),
      entry({
        tradeKey: "p1",
        kind: "pick",
        week: null,
        playerId: 200,
        fromOwnerId: "bob",
        toOwnerId: "alice",
        overallPickNumber: 9,
      }),
    ];
    const { graded } = gradeAllTrades(pickTrade, index);
    expect(graded[0].context).toBe("offseason");
    expect(graded[0].week).toBeNull();
  });

  it("groups every asset of one trade into a single graded row", () => {
    const packageDeal: TradeEntry[] = [
      entry({ tradeKey: "t5", playerId: 100, fromOwnerId: "alice", toOwnerId: "bob" }),
      entry({ tradeKey: "t5", playerId: 300, fromOwnerId: "alice", toOwnerId: "bob" }),
      entry({ tradeKey: "t5", playerId: 200, fromOwnerId: "bob", toOwnerId: "alice" }),
    ];
    const { graded } = gradeAllTrades(packageDeal, index);
    expect(graded).toHaveLength(1);
    expect(graded[0].sideBPlayers).toHaveLength(2); // bob received two players
    expect(graded[0].sideAPlayers).toHaveLength(1);
  });

  it("sorts most recent first", () => {
    const spanning: TradeEntry[] = [
      entry({ tradeKey: "old", year: 2019, playerId: 100, fromOwnerId: "alice", toOwnerId: "bob" }),
      entry({ tradeKey: "old", year: 2019, playerId: 200, fromOwnerId: "bob", toOwnerId: "alice" }),
      entry({ tradeKey: "new", year: 2023, playerId: 100, fromOwnerId: "alice", toOwnerId: "bob" }),
      entry({ tradeKey: "new", year: 2023, playerId: 200, fromOwnerId: "bob", toOwnerId: "alice" }),
    ];
    const { graded } = gradeAllTrades(spanning, index);
    expect(graded.map(g => g.year)).toEqual([2023, 2019]);
  });

  it("skips trades whose year is not in the provided coverage set", () => {
    const partial: TradeEntry[] = [
      entry({ tradeKey: "t1", year: 2021, playerId: 100, fromOwnerId: "alice", toOwnerId: "bob" }),
      entry({ tradeKey: "t1", year: 2021, playerId: 200, fromOwnerId: "bob", toOwnerId: "alice" }),
    ];
    const coverage = new Set([2020]);
    const { graded } = gradeAllTrades(partial, index, coverage);
    expect(graded).toHaveLength(0);
  });
});

describe("computeRestOfSeasonValueSeries", () => {
  it("returns the trade year plus consecutive keeper seasons", () => {
    const index = buildTradeEvaluationIndex(
      [teamPoints(2021, 100, "bob", 100), teamPoints(2022, 100, "bob", 200), teamPoints(2023, 100, "bob", 300)],
      [keeper(2022, 100, "bob"), keeper(2023, 100, "bob")]
    );
    expect(computeRestOfSeasonValueSeries(100, 2021, "bob", index)).toEqual([
      { year: 2021, points: 100 },
      { year: 2022, points: 200 },
      { year: 2023, points: 300 },
    ]);
  });

  it("stops at the first break in the keeper chain", () => {
    const index = buildTradeEvaluationIndex(
      [teamPoints(2021, 100, "bob", 100), teamPoints(2022, 100, "bob", 200), teamPoints(2025, 100, "bob", 999)],
      [keeper(2022, 100, "bob"), keeper(2025, 100, "bob")]
    );
    expect(computeRestOfSeasonValueSeries(100, 2021, "bob", index)).toEqual([
      { year: 2021, points: 100 },
      { year: 2022, points: 200 },
    ]);
  });

  it("returns just the trade year when nothing was kept", () => {
    const index = buildTradeEvaluationIndex([teamPoints(2021, 100, "bob", 100)], []);
    expect(computeRestOfSeasonValueSeries(100, 2021, "bob", index)).toEqual([{ year: 2021, points: 100 }]);
  });

  it("returns an empty series when the player never produced for the owner", () => {
    const index = buildTradeEvaluationIndex([], []);
    expect(computeRestOfSeasonValueSeries(100, 2021, "bob", index)).toEqual([]);
  });
});

describe("computeSurplusHistogram", () => {
  const grade = (tradeKey: string, surplus: number): TradeGrade =>
    ({
      tradeKey,
      year: 2021,
      week: 1,
      context: "in-season",
      ownerA: "alice",
      ownerB: "bob",
      sideAPlayers: [],
      sideBPlayers: [],
      sideATotalPoints: 0,
      sideBTotalPoints: 0,
      surplus,
      letterGrade: "C",
      isFair: true,
    }) as TradeGrade;

  it("bins each trade into a zero-centered bucket", () => {
    const buckets = computeSurplusHistogram([grade("t1", -100), grade("t2", 0), grade("t3", 100)], 3);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3);
    expect(buckets.some(b => b.label === "near 0 (fair)")).toBe(true);
  });

  it("labels the fair bucket and keeps totals stable", () => {
    const buckets = computeSurplusHistogram(
      [grade("t1", 1604), grade("t2", 383), grade("t3", -446), grade("t4", 2)],
      7
    );
    // Bucket edges are derived from the max |surplus|; every grade lands in exactly one.
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(4);
    const fair = buckets.find(b => b.label === "near 0 (fair)");
    expect(fair).toBeDefined();
    expect(fair!.count).toBe(1);
  });

  it("returns a single fair bucket when all surpluses are zero", () => {
    const buckets = computeSurplusHistogram([grade("t1", 0), grade("t2", 0)]);
    expect(buckets).toEqual([{ label: "near 0 (fair)", count: 2 }]);
  });

  it("returns no buckets for an empty grade list", () => {
    expect(computeSurplusHistogram([])).toEqual([]);
  });
});

describe("computeTradeSymmetry", () => {
  const index = buildTradeEvaluationIndex([teamPoints(2021, 100, "bob", 100), teamPoints(2021, 200, "alice", 100)], []);

  it("counts a balanced trade as fair for both owners", () => {
    const even: TradeEntry[] = [
      entry({ tradeKey: "t1", playerId: 100, fromOwnerId: "alice", toOwnerId: "bob" }),
      entry({ tradeKey: "t1", playerId: 200, fromOwnerId: "bob", toOwnerId: "alice" }),
    ];
    const { graded } = gradeAllTrades(even, index);
    const stats = computeTradeSymmetry(graded);
    expect(stats.totalTrades).toBe(1);
    expect(stats.fairTrades).toBe(1);
    expect(stats.oneSidedTrades).toBe(0);
    expect(stats.fairTradePercentage).toBe(100);
    expect(stats.byOwner.alice.fairTradePercentage).toBe(100);
    expect(stats.byOwner.bob.totalTrades).toBe(1);
  });

  it("returns a plain object for byOwner, not a Map", () => {
    const stats = computeTradeSymmetry([]);
    expect(stats.byOwner).toEqual({});
    expect(stats.byOwner instanceof Map).toBe(false);
  });

  it("reports zero rather than NaN when there are no trades", () => {
    const stats = computeTradeSymmetry([]);
    expect(stats.fairTradePercentage).toBe(0);
    expect(Number.isNaN(stats.fairTradePercentage)).toBe(false);
  });
});
