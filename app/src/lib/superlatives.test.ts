import { describe, expect, it } from "vitest";
import { getBiggestSundayCollapses } from "./superlatives";
import type { BoxScoreEntry, BoxScoreSlot, Matchup, Owner, Team, TeamRecord } from "../types";

const EMPTY_RECORD: TeamRecord = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };

function makeTeam(espnTeamId: number, ownerIds: string[]): Team {
  return {
    year: 2024,
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

interface MakeMatchupOptions {
  week: number;
  matchupId: number;
  winner: Matchup["winner"];
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
}

function makeMatchup(opts: MakeMatchupOptions): Matchup {
  return {
    year: 2024,
    week: opts.week,
    matchup_id: opts.matchupId,
    playoff_tier: null,
    winner: opts.winner,
    home: { owner_id: null, espn_team_id: opts.homeTeamId, score: opts.homeScore },
    away: { owner_id: null, espn_team_id: opts.awayTeamId, score: opts.awayScore },
  };
}

function makeEntry(matchupId: number, espnTeamId: number, slots: BoxScoreSlot[]): BoxScoreEntry {
  return {
    year: 2024,
    week: 1,
    matchup_id: matchupId,
    owner_id: "owner",
    espn_team_id: espnTeamId,
    player_id: espnTeamId * 100,
    player_name: `Player ${espnTeamId}`,
    total_points: slots.reduce((sum, s) => sum + s.points, 0),
    batting: null,
    pitching: null,
    slots,
  };
}

const teams: Team[] = [makeTeam(1, ["alice"]), makeTeam(2, ["bob"])];
const owners: Owner[] = [];

describe("getBiggestSundayCollapses", () => {
  it("finds a team that led entering the final day but lost", () => {
    const matchups = [
      makeMatchup({
        week: 1,
        matchupId: 1,
        winner: "AWAY",
        homeTeamId: 1,
        awayTeamId: 2,
        homeScore: 40,
        awayScore: 50,
      }),
    ];
    const boxScores = [
      makeEntry(1, 1, [
        { scoring_period: 1, lineup_slot_id: 0, points: 20 },
        { scoring_period: 2, lineup_slot_id: 0, points: 15 },
        { scoring_period: 3, lineup_slot_id: 0, points: 5 },
      ]),
      makeEntry(1, 2, [
        { scoring_period: 1, lineup_slot_id: 0, points: 10 },
        { scoring_period: 2, lineup_slot_id: 0, points: 10 },
        { scoring_period: 3, lineup_slot_id: 0, points: 30 },
      ]),
    ];

    const results = getBiggestSundayCollapses(new Map([[2024, boxScores]]), matchups, teams, owners);

    expect(results).toHaveLength(1);
    expect(results[0].collapsed.espnTeamId).toBe(1);
    expect(results[0].winner.espnTeamId).toBe(2);
    expect(results[0].leadBeforeFinalDay).toBe(15);
    expect(results[0].finalMargin).toBe(10);
  });

  it("does not report a collapse when the leader holds on", () => {
    const matchups = [
      makeMatchup({
        week: 2,
        matchupId: 2,
        winner: "HOME",
        homeTeamId: 1,
        awayTeamId: 2,
        homeScore: 65,
        awayScore: 25,
      }),
    ];
    const boxScores = [
      makeEntry(2, 1, [
        { scoring_period: 1, lineup_slot_id: 0, points: 20 },
        { scoring_period: 2, lineup_slot_id: 0, points: 15 },
        { scoring_period: 3, lineup_slot_id: 0, points: 30 },
      ]),
      makeEntry(2, 2, [
        { scoring_period: 1, lineup_slot_id: 0, points: 10 },
        { scoring_period: 2, lineup_slot_id: 0, points: 10 },
        { scoring_period: 3, lineup_slot_id: 0, points: 5 },
      ]),
    ];

    const results = getBiggestSundayCollapses(new Map([[2024, boxScores]]), matchups, teams, owners);

    expect(results).toHaveLength(0);
  });

  it("ignores matchups with only one scoring period (pre-2019-shaped data)", () => {
    const matchups = [
      makeMatchup({
        week: 3,
        matchupId: 3,
        winner: "AWAY",
        homeTeamId: 1,
        awayTeamId: 2,
        homeScore: 20,
        awayScore: 30,
      }),
    ];
    const boxScores = [
      makeEntry(3, 1, [{ scoring_period: 1, lineup_slot_id: 0, points: 20 }]),
      makeEntry(3, 2, [{ scoring_period: 1, lineup_slot_id: 0, points: 30 }]),
    ];

    const results = getBiggestSundayCollapses(new Map([[2024, boxScores]]), matchups, teams, owners);

    expect(results).toHaveLength(0);
  });

  it("ignores a matchup tied entering the final day", () => {
    const matchups = [
      makeMatchup({
        week: 4,
        matchupId: 4,
        winner: "AWAY",
        homeTeamId: 1,
        awayTeamId: 2,
        homeScore: 35,
        awayScore: 80,
      }),
    ];
    const boxScores = [
      makeEntry(4, 1, [
        { scoring_period: 1, lineup_slot_id: 0, points: 10 },
        { scoring_period: 2, lineup_slot_id: 0, points: 20 },
        { scoring_period: 3, lineup_slot_id: 0, points: 5 },
      ]),
      makeEntry(4, 2, [
        { scoring_period: 1, lineup_slot_id: 0, points: 10 },
        { scoring_period: 2, lineup_slot_id: 0, points: 20 },
        { scoring_period: 3, lineup_slot_id: 0, points: 50 },
      ]),
    ];

    const results = getBiggestSundayCollapses(new Map([[2024, boxScores]]), matchups, teams, owners);

    expect(results).toHaveLength(0);
  });

  it("ranks by the size of the blown lead and respects n", () => {
    const matchups = [
      // Small collapse: 5-point lead blown.
      makeMatchup({
        week: 5,
        matchupId: 5,
        winner: "AWAY",
        homeTeamId: 1,
        awayTeamId: 2,
        homeScore: 40,
        awayScore: 41,
      }),
      // Big collapse: 20-point lead blown.
      makeMatchup({
        week: 6,
        matchupId: 6,
        winner: "AWAY",
        homeTeamId: 1,
        awayTeamId: 2,
        homeScore: 40,
        awayScore: 51,
      }),
    ];
    const boxScores = [
      makeEntry(5, 1, [
        { scoring_period: 1, lineup_slot_id: 0, points: 20 },
        { scoring_period: 2, lineup_slot_id: 0, points: 15 },
        { scoring_period: 3, lineup_slot_id: 0, points: 5 },
      ]),
      makeEntry(5, 2, [
        { scoring_period: 1, lineup_slot_id: 0, points: 15 },
        { scoring_period: 2, lineup_slot_id: 0, points: 15 },
        { scoring_period: 3, lineup_slot_id: 0, points: 11 },
      ]),
      makeEntry(6, 1, [
        { scoring_period: 1, lineup_slot_id: 0, points: 25 },
        { scoring_period: 2, lineup_slot_id: 0, points: 15 },
        { scoring_period: 3, lineup_slot_id: 0, points: 0 },
      ]),
      makeEntry(6, 2, [
        { scoring_period: 1, lineup_slot_id: 0, points: 10 },
        { scoring_period: 2, lineup_slot_id: 0, points: 10 },
        { scoring_period: 3, lineup_slot_id: 0, points: 31 },
      ]),
    ];

    const results = getBiggestSundayCollapses(new Map([[2024, boxScores]]), matchups, teams, owners);
    expect(results.map(r => r.matchupId)).toEqual([6, 5]);
    expect(results.map(r => r.leadBeforeFinalDay)).toEqual([20, 5]);

    const topOnly = getBiggestSundayCollapses(new Map([[2024, boxScores]]), matchups, teams, owners, 1);
    expect(topOnly.map(r => r.matchupId)).toEqual([6]);
  });
});
