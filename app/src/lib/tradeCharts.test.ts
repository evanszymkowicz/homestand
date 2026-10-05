import { describe, expect, it } from "vitest";
import { buildRadarComparison, computeWeeklyHeadToHead } from "./tradeCharts";
import type { PlayerComparisonResult } from "./playerComparison";
import type { BoxScoreEntry } from "../types";

function boxEntry(playerId: number, week: number, total: number): BoxScoreEntry {
  return {
    year: 2024,
    week,
    matchup_id: 1,
    owner_id: "owner-1",
    espn_team_id: 1,
    player_id: playerId,
    player_name: `Player ${playerId}`,
    total_points: total,
    batting: null,
    pitching: null,
    slots: [],
  };
}

function result(
  over: Partial<PlayerComparisonResult> & Pick<PlayerComparisonResult, "playerId">
): PlayerComparisonResult {
  return {
    playerName: `Player ${over.playerId}`,
    year: 2024,
    points: null,
    zscore: null,
    percentile: null,
    weeklyConsistency: null,
    playoffSplit: null,
    draftPosition: null,
    draftValueOverReplacement: null,
    ...over,
  };
}

describe("computeWeeklyHeadToHead", () => {
  const byYear = new Map<number, BoxScoreEntry[]>([
    [2024, [boxEntry(11, 1, 10), boxEntry(12, 1, 5), boxEntry(21, 1, 20), boxEntry(22, 2, 30)]],
  ]);

  it("totals each side's points per week, ascending", () => {
    expect(computeWeeklyHeadToHead([11, 12], [21, 22], 2024, byYear)).toEqual([
      { week: 1, sideA: 15, sideB: 20 },
      { week: 2, sideA: 0, sideB: 30 },
    ]);
  });

  it("omits weeks where no selected player has a line", () => {
    const sparse = new Map<number, BoxScoreEntry[]>([[2024, [boxEntry(11, 1, 10), boxEntry(21, 5, 20)]]]);
    expect(computeWeeklyHeadToHead([11], [21], 2024, sparse)).toEqual([
      { week: 1, sideA: 10, sideB: 0 },
      { week: 5, sideA: 0, sideB: 20 },
    ]);
  });

  it("returns an empty list when neither side selects a player", () => {
    expect(computeWeeklyHeadToHead([], [], 2024, byYear)).toEqual([]);
  });

  it("returns an empty list for a year outside box-score coverage", () => {
    expect(computeWeeklyHeadToHead([11], [21], 2018, new Map())).toEqual([]);
  });
});

describe("buildRadarComparison", () => {
  it("normalizes each axis to the stronger side", () => {
    const a = [result({ playerId: 1, points: 200, zscore: 1 })];
    const b = [result({ playerId: 2, points: 100, zscore: -1 })];
    const metrics = buildRadarComparison(a, b);
    const points = metrics.find(m => m.key === "points")!;
    const zscore = metrics.find(m => m.key === "zscore")!;
    expect(points.sideA).toBe(100);
    expect(points.sideB).toBe(50);
    expect(zscore.sideA).toBe(100);
    expect(zscore.sideB).toBe(0);
  });

  it("reads both sides at 100 when they tie on a dimension (the winner always reads 100)", () => {
    const metrics = buildRadarComparison(
      [result({ playerId: 1, points: 100 })],
      [result({ playerId: 2, points: 100 })]
    );
    const points = metrics.find(m => m.key === "points")!;
    expect(points.sideA).toBe(100);
    expect(points.sideB).toBe(100);
  });

  it("inverts consistency so steadier reads higher", () => {
    // cv 0 → 1/(1+0) = 1 (max); cv 1 → 0.5.
    const a = [result({ playerId: 1, weeklyConsistency: { mean: 10, stdev: 0, cv: 0, weeks: 2 } })];
    const b = [result({ playerId: 2, weeklyConsistency: { mean: 10, stdev: 5, cv: 1, weeks: 2 } })];
    const metrics = buildRadarComparison(a, b);
    const consistency = metrics.find(m => m.key === "consistency")!;
    expect(consistency.sideA).toBe(100);
    expect(consistency.sideB).toBe(50);
  });

  it("scores playoff share from the playoff split", () => {
    const a = [
      result({
        playerId: 1,
        playoffSplit: { regularSeasonPoints: 100, playoffPoints: 100, regularSeasonWeeks: 18, playoffWeeks: 4 },
      }),
    ];
    const b = [
      result({
        playerId: 2,
        playoffSplit: { regularSeasonPoints: 300, playoffPoints: 0, regularSeasonWeeks: 18, playoffWeeks: 4 },
      }),
    ];
    const metrics = buildRadarComparison(a, b);
    const playoff = metrics.find(m => m.key === "playoff")!;
    // Side A: 0.5 share; Side B: 0 → normalized A=100, B=0.
    expect(playoff.sideA).toBe(100);
    expect(playoff.sideB).toBe(0);
  });

  it("keeps every dimension present, defaulting missing data", () => {
    const metrics = buildRadarComparison([result({ playerId: 1 })], [result({ playerId: 2 })]);
    expect(metrics.map(m => m.key)).toEqual(["points", "zscore", "percentile", "consistency", "playoff", "draft"]);
    // A no-data comparison ties every dimension rather than crashing.
    for (const m of metrics) {
      expect(m.sideA).toBe(50);
      expect(m.sideB).toBe(50);
    }
  });
});
