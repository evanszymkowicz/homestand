import { describe, expect, it } from "vitest";
import { generateSeasonRecap } from "./seasonRecap";
import type { DraftPick, Matchup, PlayerSeasonPoints, Team, TeamRecord, Trade } from "../types";

const EMPTY_RECORD: TeamRecord = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };

function makeTeam(
  year: number,
  espnTeamId: number,
  primaryOwnerId: string,
  overrides: Partial<Team> = {}
): Team {
  const ownerIds = overrides.owner_ids ?? [primaryOwnerId];
  return {
    year,
    espn_team_id: espnTeamId,
    owner_ids: ownerIds,
    primary_owner_id: primaryOwnerId,
    team_name: `Team ${espnTeamId}`,
    division_id: 1,
    final_rank: 1,
    playoff_seed: 1,
    overall: { ...EMPTY_RECORD },
    home: { ...EMPTY_RECORD },
    away: { ...EMPTY_RECORD },
    division_record: { ...EMPTY_RECORD },
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
    ...overrides,
  };
}

function makeMatchup(year: number, week: number, homeScore: number, awayScore: number): Matchup {
  return {
    year,
    week,
    matchup_id: 1,
    playoff_tier: null,
    winner: homeScore > awayScore ? "HOME" : awayScore > homeScore ? "AWAY" : "TIE",
    home: { owner_id: "owner-a", espn_team_id: 1, score: homeScore },
    away: { owner_id: "owner-b", espn_team_id: 2, score: awayScore },
  };
}


describe("generateSeasonRecap", () => {
  it("identifies champion and runner-up", () => {
    const teams = [
      makeTeam(2024, 1, "owner-a", { final_rank: 1, overall: { ...EMPTY_RECORD, points_for: 1000 } }),
      makeTeam(2024, 2, "owner-b", { final_rank: 2, overall: { ...EMPTY_RECORD, points_for: 900 } }),
    ];
    const matchups = [makeMatchup(2024, 1, 100, 90)];
    const recap = generateSeasonRecap(2024, teams, matchups, [], [], []);
    expect(recap).not.toBeNull();
    expect(recap!.champion.ownerIds).toEqual(["owner-a"]);
    expect(recap!.runnerUp.ownerIds).toEqual(["owner-b"]);
  });

  it("finds the biggest mover from the prior year", () => {
    const teams = [
      makeTeam(2023, 1, "owner-a", { final_rank: 8 }),
      makeTeam(2024, 1, "owner-a", { final_rank: 1 }),
      makeTeam(2023, 2, "owner-b", { final_rank: 2 }),
      makeTeam(2024, 2, "owner-b", { final_rank: 2 }),
    ];
    const matchups = [makeMatchup(2024, 1, 100, 90)];
    const recap = generateSeasonRecap(2024, teams, matchups, [], [], []);
    expect(recap!.biggestMover).toMatchObject({
      ownerIds: ["owner-a"],
      improvement: 7,
      fromRank: 8,
      toRank: 1,
    });
  });

  it("returns null biggest mover for the first archive year", () => {
    const teams = [
      makeTeam(2009, 1, "owner-a", { final_rank: 1 }),
      makeTeam(2009, 2, "owner-b", { final_rank: 2 }),
    ];
    const matchups = [makeMatchup(2009, 1, 100, 90)];
    const recap = generateSeasonRecap(2009, teams, matchups, [], [], []);
    expect(recap!.biggestMover).toBeNull();
  });

  it("finds the highest-scoring single-week performance", () => {
    const teams = [
      makeTeam(2024, 1, "owner-a", { final_rank: 1 }),
      makeTeam(2024, 2, "owner-b", { final_rank: 2 }),
    ];
    const matchups = [
      makeMatchup(2024, 1, 150, 120),
      makeMatchup(2024, 2, 180, 140),
    ];
    const recap = generateSeasonRecap(2024, teams, matchups, [], [], []);
    expect(recap!.highestScoringWeek).toMatchObject({
      ownerIds: ["owner-a"],
      week: 2,
      points: 180,
    });
  });

  it("summarizes trades with player names", () => {
    const teams = [
      makeTeam(2024, 1, "owner-a", { final_rank: 1 }),
      makeTeam(2024, 2, "owner-b", { final_rank: 2 }),
    ];
    const trades: Trade[] = [
      {
        year: 2024,
        trade_id: "t1",
        proposed_date: null,
        executed_date: null,
        team_a_espn_team_id: 1,
        team_a_owner_id: "owner-a",
        team_b_espn_team_id: 2,
        team_b_owner_id: "owner-b",
        acting_member_key: null,
        items: [
          { player_id: 1, item_type: "TRADE", from_espn_team_id: 1, to_espn_team_id: 2, from_lineup_slot_id: null, to_lineup_slot_id: null, source: "ledger" },
          { player_id: 2, item_type: "TRADE", from_espn_team_id: 2, to_espn_team_id: 1, from_lineup_slot_id: null, to_lineup_slot_id: null, source: "ledger" },
        ],
      },
    ];
    const playerSeasonPoints: PlayerSeasonPoints[] = [
      { year: 2024, player_id: 1, player_name: "Player One", points: 100 },
      { year: 2024, player_id: 2, player_name: "Player Two", points: 200 },
    ];
    const matchups = [makeMatchup(2024, 1, 100, 90)];
    const recap = generateSeasonRecap(2024, teams, matchups, trades, playerSeasonPoints, []);
    expect(recap!.notableTrades).toHaveLength(1);
    expect(recap!.notableTrades[0].gave).toEqual([{ playerId: 1, name: "Player One" }]);
    expect(recap!.notableTrades[0].received).toEqual([{ playerId: 2, name: "Player Two" }]);
    expect(recap!.notableTrades[0].ownerAIds).toEqual(["owner-a"]);
    expect(recap!.notableTrades[0].ownerBIds).toEqual(["owner-b"]);
  });

  it("falls back to unlinked picks when a trade side moves no player", () => {
    const teams = [
      makeTeam(2024, 1, "owner-a", { final_rank: 1 }),
      makeTeam(2024, 2, "owner-b", { final_rank: 2 }),
    ];
    const trades: Trade[] = [
      {
        year: 2024,
        trade_id: "t1",
        proposed_date: null,
        executed_date: null,
        team_a_espn_team_id: 1,
        team_a_owner_id: "owner-a",
        team_b_espn_team_id: 2,
        team_b_owner_id: "owner-b",
        acting_member_key: null,
        items: [
          { player_id: 1, item_type: "TRADE", from_espn_team_id: 1, to_espn_team_id: 2, from_lineup_slot_id: null, to_lineup_slot_id: null, source: "ledger" },
        ],
      },
    ];
    const playerSeasonPoints: PlayerSeasonPoints[] = [{ year: 2024, player_id: 1, player_name: "Player One", points: 100 }];
    const matchups = [makeMatchup(2024, 1, 100, 90)];
    const recap = generateSeasonRecap(2024, teams, matchups, trades, playerSeasonPoints, []);
    expect(recap!.notableTrades[0].gave).toEqual([{ playerId: 1, name: "Player One" }]);
    expect(recap!.notableTrades[0].received).toEqual([{ playerId: null, name: "picks" }]);
  });

  it("carries every owner's id on a co-owned champion", () => {
    const teams = [
      makeTeam(2024, 1, "owner-a", { final_rank: 1, owner_ids: ["owner-a", "owner-c"] }),
      makeTeam(2024, 2, "owner-b", { final_rank: 2 }),
    ];
    const matchups = [makeMatchup(2024, 1, 100, 90)];
    const recap = generateSeasonRecap(2024, teams, matchups, [], [], []);
    expect(recap!.champion.ownerIds).toEqual(["owner-a", "owner-c"]);
    expect(recap!.champion.teamId).toBe(1);
  });

  it("identifies breakout players by value shift", () => {
    const teams = [
      makeTeam(2024, 1, "owner-a", { final_rank: 1 }),
      makeTeam(2024, 2, "owner-b", { final_rank: 2 }),
    ];
    const draftPicks: DraftPick[] = [
      { year: 2024, overall_pick_number: 10, round_id: 1, round_pick_number: 10, espn_team_id: 1, owner_id: "owner-a", player_id: 1, player_name: "Late Pick", keeper: false, traded_pick: false, traded_from_espn_team_id: null, pro_team_id: null },
      { year: 2024, overall_pick_number: 1, round_id: 1, round_pick_number: 1, espn_team_id: 1, owner_id: "owner-a", player_id: 2, player_name: "Early Pick", keeper: false, traded_pick: false, traded_from_espn_team_id: null, pro_team_id: null },
    ];
    const playerSeasonPoints: PlayerSeasonPoints[] = [
      { year: 2024, player_id: 1, player_name: "Late Pick", points: 500 },
      { year: 2024, player_id: 2, player_name: "Early Pick", points: 100 },
    ];
    const matchups = [makeMatchup(2024, 1, 100, 90)];
    const recap = generateSeasonRecap(2024, teams, matchups, [], playerSeasonPoints, draftPicks);
    expect(recap!.breakoutPlayers.length).toBeGreaterThan(0);
    expect(recap!.breakoutPlayers[0].playerId).toBe(1);
    expect(recap!.breakoutPlayers[0].playerName).toBe("Late Pick");
    expect(recap!.breakoutPlayers[0].valueShift).toBeGreaterThan(0);
  });

});
