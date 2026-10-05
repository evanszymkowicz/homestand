import { describe, expect, it } from "vitest";
import {
  computePositionZscoreStats,
  computeSeasonZscoreStats,
  computeZscore,
  computeZscoreWithFallback,
  getQualifyingGames,
  qualifiesForZscore,
} from "./zscore";
import type { PlayerSeason, PlayerSeasonPoints } from "../types";

function playerSeason(
  playerId: number,
  year: number,
  gamesByPosition: Record<string, number>,
  defaultPositionId = 3
): PlayerSeason {
  return {
    year,
    player_id: playerId,
    player_name: `Player ${playerId}`,
    eligible_slots: [],
    games_played_by_position: gamesByPosition,
    default_position_id: defaultPositionId,
    jersey: null,
    injury_status: null,
    injured: null,
    pro_team_id: null,
  };
}

function points(playerId: number, year: number, value: number): PlayerSeasonPoints {
  return { year, player_id: playerId, player_name: `Player ${playerId}`, points: value };
}

//  ex: 2023 Zach McKinstry's real line sums to 186 games in a 162-game season because one game at two positions counts for a higher total.
describe("getQualifyingGames", () => {
  it("takes the max across position buckets, not the sum", () => {
    const season = playerSeason(1, 2023, { "4": 47, "5": 52, "6": 23, "7": 22, "8": 2, "9": 38, "10": 2 });
    expect(getQualifyingGames(season).batting).toBe(52);
  });

  it("splits pitching from batting", () => {
    const season = playerSeason(1, 2021, { "1": 23, "7": 1, "9": 6, "10": 126 });
    expect(getQualifyingGames(season)).toEqual({ batting: 126, pitching: 23 });
  });

  it("treats SP and RP as one pitching side", () => {
    const season = playerSeason(1, 2024, { "1": 12, "11": 31 });
    expect(getQualifyingGames(season)).toEqual({ batting: 0, pitching: 31 });
  });

  it("excludes PH, which is a plate appearance rather than a position", () => {
    const season = playerSeason(1, 2021, { "10": 40, "12": 59 });
    expect(getQualifyingGames(season).batting).toBe(40);
  });

  it("reports zero for a side the player never appeared on", () => {
    expect(getQualifyingGames(playerSeason(1, 2024, { "11": 60 }))).toEqual({ batting: 0, pitching: 60 });
    expect(getQualifyingGames(playerSeason(1, 2024, {}))).toEqual({ batting: 0, pitching: 0 });
  });
});

describe("qualifiesForZscore", () => {
  it("qualifies a player who clears only the batting floor", () => {
    expect(qualifiesForZscore(playerSeason(1, 2024, { "3": 120 }))).toBe(true);
  });

  it("qualifies a player who clears only the pitching floor", () => {
    expect(qualifiesForZscore(playerSeason(1, 2024, { "1": 28 }))).toBe(true);
  });

  it("qualifies a two-way player on his stronger side alone", () => {
    // 2022 Ohtani: 28 pitching appearances clears the pitching floor even
    // though neither side would pass the other's threshold.
    const ohtani = playerSeason(1, 2022, { "1": 28, "10": 152 });
    expect(qualifiesForZscore(ohtani, 200, 20)).toBe(true);
    expect(qualifiesForZscore(ohtani, 50, 500)).toBe(true);
  });

  it("rejects a part-time player who clears neither floor", () => {
    expect(qualifiesForZscore(playerSeason(1, 2024, { "3": 22, "1": 4 }))).toBe(false);
  });

  it("does not let a sum of small buckets sneak past the floor", () => {
    // Six positions totalling 90 appearances, none above 20.
    const utility = playerSeason(1, 2024, { "3": 15, "4": 15, "5": 15, "6": 15, "7": 15, "8": 15 });
    expect(qualifiesForZscore(utility)).toBe(false);
  });
});

describe("computeSeasonZscoreStats", () => {
  const seasons = [
    playerSeason(1, 2024, { "3": 150 }),
    playerSeason(2, 2024, { "3": 150 }),
    playerSeason(3, 2024, { "3": 150 }),
    playerSeason(4, 2024, { "3": 10 }), // part-time, excluded
  ];

  it("computes mean and stdev over qualifying players only", () => {
    const stats = computeSeasonZscoreStats(
      [points(1, 2024, 100), points(2, 2024, 200), points(3, 2024, 300), points(4, 2024, 9999)],
      seasons
    );
    const y2024 = stats.get(2024)!;
    expect(y2024.count).toBe(3);
    expect(y2024.mean).toBe(200);
    // Population stdev of [100,200,300] = sqrt(20000/3) ≈ 81.6497
    expect(y2024.stdev).toBeCloseTo(81.6497, 4);
  });

  it("skips a year too thin to describe a distribution", () => {
    const stats = computeSeasonZscoreStats([points(1, 2024, 100)], [playerSeason(1, 2024, { "3": 150 })]);
    expect(stats.has(2024)).toBe(false);
  });

  it("keeps seasons independent of one another", () => {
    const stats = computeSeasonZscoreStats(
      [points(1, 2023, 10), points(2, 2023, 20), points(1, 2024, 1000), points(2, 2024, 2000)],
      [
        playerSeason(1, 2023, { "3": 150 }),
        playerSeason(2, 2023, { "3": 150 }),
        playerSeason(1, 2024, { "3": 150 }),
        playerSeason(2, 2024, { "3": 150 }),
      ]
    );
    expect(stats.get(2023)!.mean).toBe(15);
    expect(stats.get(2024)!.mean).toBe(1500);
  });
});

describe("computePositionZscoreStats", () => {
  it("scopes distributions to that season's declared primary position", () => {
    const stats = computePositionZscoreStats(
      [points(1, 2024, 100), points(2, 2024, 200), points(3, 2024, 400), points(4, 2024, 600)],
      [
        playerSeason(1, 2024, { "2": 130 }, 2), // C
        playerSeason(2, 2024, { "2": 130 }, 2), // C
        playerSeason(3, 2024, { "8": 150 }, 8), // CF
        playerSeason(4, 2024, { "8": 150 }, 8), // CF
      ]
    );
    expect(stats.get("2024:2")!.mean).toBe(150);
    expect(stats.get("2024:8")!.mean).toBe(500);
  });

  it("skips a position-year with too few players to rank within", () => {
    const stats = computePositionZscoreStats([points(1, 2024, 100)], [playerSeason(1, 2024, { "2": 130 }, 2)]);
    expect(stats.has("2024:2")).toBe(false);
  });
});

describe("computeZscore", () => {
  it("measures distance from the mean in standard deviations", () => {
    expect(computeZscore(300, { mean: 200, stdev: 50, count: 10 })).toBe(2);
    expect(computeZscore(150, { mean: 200, stdev: 50, count: 10 })).toBe(-1);
    expect(computeZscore(200, { mean: 200, stdev: 50, count: 10 })).toBe(0);
  });

  it("returns zero when every player scored the same", () => {
    expect(computeZscore(200, { mean: 200, stdev: 0, count: 10 })).toBe(0);
  });
});

describe("computeZscoreWithFallback", () => {
  const seasonStats = new Map([[2024, { year: 2024, mean: 300, stdev: 100, count: 50 }]]);
  const positionStats = new Map([["2024:2", { year: 2024, positionId: 2, mean: 200, stdev: 50, count: 10 }]]);

  it("prefers the player's own position field", () => {
    expect(computeZscoreWithFallback(300, 2024, 2, seasonStats, positionStats)).toBe(2);
  });

  it("falls back to the league field when the position-year is missing", () => {
    expect(computeZscoreWithFallback(400, 2024, 8, seasonStats, positionStats)).toBe(1);
  });

  it("falls back to the league field when the position is unknown", () => {
    expect(computeZscoreWithFallback(400, 2024, null, seasonStats, positionStats)).toBe(1);
  });

  it("returns null when neither field exists", () => {
    expect(computeZscoreWithFallback(400, 2009, 2, seasonStats, positionStats)).toBeNull();
  });
});
