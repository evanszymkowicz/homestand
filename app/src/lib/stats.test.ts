import { describe, expect, it } from "vitest";
import { OF_POSITION_ID } from "./positions";
import {
  buildSeasonPercentiles,
  getCurrentOwnerIds,
  getCurrentPrimaryOwnerIds,
  getOwnerSeasons,
  getSeasonPointsPercentileForPosition,
  percentileWithin,
} from "./stats";
import type { PlayerSeasonPoints, Team, TeamRecord } from "../types";

const EMPTY_RECORD: TeamRecord = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };

function makeTeam(year: number, espnTeamId: number, ownerIds: string[]): Team {
  return {
    year,
    espn_team_id: espnTeamId,
    owner_ids: ownerIds,
    primary_owner_id: ownerIds[0],
    team_name: `Team ${espnTeamId}`,
    division_id: 1,
    final_rank: 1,
    playoff_seed: 1,
    overall: EMPTY_RECORD,
    home: EMPTY_RECORD,
    away: EMPTY_RECORD,
    division_record: EMPTY_RECORD,
    streak_type: "WIN",
    streak_length: 0,
    draft_day_projected_rank: null,
    waiver_rank: null,
    logo_url: null,
    value_by_stat: {},
    transactions: {
      acquisitions: 0,
      drops: 0,
      trades: 0,
      moves_to_active: 0,
      moves_to_ir: 0,
      acquisitions_budget_spent: 0,
      team_charges: 0,
      acquisitions_by_week: {},
    },
    eliminated: false,
    elimination_matchup_period: null,
    points_adjusted: 0,
    current_projected_rank: null,
    is_transaction_locked: false,
  };
}

describe("getOwnerSeasons", () => {
  it("returns only the team-seasons this owner is credited on", () => {
    const teams = [makeTeam(2023, 1, ["alice"]), makeTeam(2023, 2, ["bob"]), makeTeam(2024, 1, ["alice"])];

    const seasons = getOwnerSeasons(teams, "alice");

    expect(seasons.map(t => `${t.year}:${t.espn_team_id}`)).toEqual(["2023:1", "2024:1"]);
  });

  it("includes a co-owned team-season for both credited owners", () => {
    const teams = [makeTeam(2020, 6, ["anthony-paradiso", "sam-silbert"])];

    expect(getOwnerSeasons(teams, "anthony-paradiso")).toHaveLength(1);
    expect(getOwnerSeasons(teams, "sam-silbert")).toHaveLength(1);
    expect(getOwnerSeasons(teams, "someone-else")).toHaveLength(0);
  });

  it("sorts ascending by year", () => {
    const teams = [makeTeam(2022, 1, ["alice"]), makeTeam(2009, 1, ["alice"]), makeTeam(2015, 1, ["alice"])];

    const seasons = getOwnerSeasons(teams, "alice");

    expect(seasons.map(t => t.year)).toEqual([2009, 2015, 2022]);
  });

  it("returns an empty array for an owner with no team-seasons", () => {
    const teams = [makeTeam(2024, 1, ["alice"])];

    expect(getOwnerSeasons(teams, "nobody")).toEqual([]);
  });
});

describe("getCurrentPrimaryOwnerIds", () => {
  it("leaves out a latest-season co-owner who holds no team of their own", () => {
    const teams = [
      makeTeam(2026, 6, ["sam-silbert", "anthony-paradiso"]),
      makeTeam(2026, 8, ["evan-szymkowicz"]),
      makeTeam(2019, 8, ["anthony-paradiso"]),
    ];

    expect(getCurrentPrimaryOwnerIds(teams)).toEqual(new Set(["sam-silbert", "evan-szymkowicz"]));
    // The co-owner-inclusive helper the other views use is unchanged.
    expect(getCurrentOwnerIds(teams)).toEqual(new Set(["sam-silbert", "anthony-paradiso", "evan-szymkowicz"]));
  });

  it("ignores owners whose latest team predates the newest season", () => {
    const teams = [makeTeam(2026, 1, ["alice"]), makeTeam(2024, 2, ["bob"])];

    expect(getCurrentPrimaryOwnerIds(teams)).toEqual(new Set(["alice"]));
  });
});

describe("percentileWithin", () => {
  it("puts the low and high ends of the field at 0 and 100", () => {
    const field = [1, 2, 3, 4, 5];

    expect(percentileWithin(1, field)).toBe(0);
    expect(percentileWithin(5, field)).toBe(100);
    expect(percentileWithin(3, field)).toBe(50);
  });

  it("gives tied values the average rank's percentile", () => {
    const field = [1, 2, 2, 4];

    expect(percentileWithin(2, field)).toBeCloseTo((1.5 / 3) * 100);
  });

  it("returns null for a field too thin to rank within", () => {
    expect(percentileWithin(7, [7])).toBeNull();
    expect(percentileWithin(7, [])).toBeNull();
  });

  it("agrees with buildSeasonPercentiles on the same field", () => {
    const points = [3, 9, 9, 12, 20];
    const rows: PlayerSeasonPoints[] = points.map((p, i) => ({
      year: 2024,
      player_id: i + 1,
      player_name: `P${i + 1}`,
      points: p,
    }));

    const batch = buildSeasonPercentiles(rows);

    for (const [i, p] of points.entries()) {
      expect(percentileWithin(p, points)).toBeCloseTo(batch.get(`2024:${i + 1}`)!);
    }
  });
});

describe("getSeasonPointsPercentileForPosition", () => {
  function point(playerId: number, points: number): PlayerSeasonPoints {
    return { year: 2024, player_id: playerId, player_name: `P${playerId}`, points };
  }

  it("includes a dual-eligible player's points in either position's comparison field", () => {
    // Player 1 is eligible at both C (2) and 1B (3); player 2 only C, player 3 only 1B.
    const seasonPoints = [point(1, 50), point(2, 80), point(3, 60)];
    const positionByPlayerSeason = new Map<string, number[]>([
      ["2024:1", [2, 3]],
      ["2024:2", [2]],
      ["2024:3", [3]],
    ]);

    const atCatcher = getSeasonPointsPercentileForPosition(1, seasonPoints, positionByPlayerSeason, 2);
    const at1B = getSeasonPointsPercentileForPosition(1, seasonPoints, positionByPlayerSeason, 3);

    // Field for C is {50, 80} -> player 1's 50 is the low end.
    expect(atCatcher.get(2024)).toBe(0);
    // Field for 1B is {50, 60} -> player 1's 50 is again the low end.
    expect(at1B.get(2024)).toBe(0);
  });

  it("ranks the OF scope against everyone eligible at any of LF/CF/RF", () => {
    const seasonPoints = [point(1, 40), point(2, 100)]; // player 1 = LF, player 2 = CF
    const positionByPlayerSeason = new Map<string, number[]>([
      ["2024:1", [7]],
      ["2024:2", [8]],
    ]);

    const ofField = getSeasonPointsPercentileForPosition(1, seasonPoints, positionByPlayerSeason, OF_POSITION_ID);

    expect(ofField.get(2024)).toBe(0); // player 1's 40 is the low end of {40, 100}
  });
});
