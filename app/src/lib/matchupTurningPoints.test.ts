import { describe, expect, it } from "vitest";
import { computeMatchupTurningPoint, computeMatchupTurningPoints } from "./matchupTurningPoints";
import type { BoxScoreEntry, Matchup, Team, TeamRecord } from "../types";

const EMPTY_RECORD: TeamRecord = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };

function makeTeam(
  year: number,
  espnTeamId: number,
  primaryOwnerId: string,
  finalRank: number,
  overrides: Partial<Team> = {}
): Team {
  return {
    year,
    espn_team_id: espnTeamId,
    owner_ids: [primaryOwnerId],
    primary_owner_id: primaryOwnerId,
    team_name: `Team ${espnTeamId}`,
    division_id: 1,
    final_rank: finalRank,
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

function makeMatchup(
  year: number,
  week: number,
  matchupId: number,
  home: { espnTeamId: number; ownerId: string; score: number },
  away: { espnTeamId: number; ownerId: string; score: number },
  overrides: Partial<Matchup> = {}
): Matchup {
  return {
    year,
    week,
    matchup_id: matchupId,
    playoff_tier: null,
    winner: home.score > away.score ? "HOME" : away.score > home.score ? "AWAY" : "TIE",
    home: { owner_id: home.ownerId, espn_team_id: home.espnTeamId, score: home.score },
    away: { owner_id: away.ownerId, espn_team_id: away.espnTeamId, score: away.score },
    ...overrides,
  };
}

function makeBoxScoreEntry(
  year: number,
  week: number,
  espnTeamId: number,
  playerId: number,
  slots: { scoring_period: number; lineup_slot_id: number; points: number }[]
): BoxScoreEntry {
  return {
    year,
    week,
    matchup_id: 1,
    owner_id: "",
    espn_team_id: espnTeamId,
    player_id: playerId,
    player_name: `Player ${playerId}`,
    total_points: slots.reduce((sum, s) => sum + s.points, 0),
    batting: null,
    pitching: null,
    slots,
  };
}

describe("computeMatchupTurningPoint", () => {
  it("identifies an upset when a lower-ranked team beats a higher-ranked team", () => {
    const teams = [makeTeam(2024, 1, "owner-a", 5), makeTeam(2024, 2, "owner-b", 1)];
    const matchup = makeMatchup(
      2024,
      1,
      1,
      { espnTeamId: 1, ownerId: "owner-a", score: 120 },
      { espnTeamId: 2, ownerId: "owner-b", score: 100 }
    );
    const result = computeMatchupTurningPoint(matchup, [], teams);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("upset");
    expect(result!.value).toBe(4);
  });

  it("returns null for a matchup where the higher-ranked team wins", () => {
    const teams = [makeTeam(2024, 1, "owner-a", 1), makeTeam(2024, 2, "owner-b", 5)];
    const matchup = makeMatchup(
      2024,
      1,
      1,
      { espnTeamId: 1, ownerId: "owner-a", score: 120 },
      { espnTeamId: 2, ownerId: "owner-b", score: 100 }
    );
    const result = computeMatchupTurningPoint(matchup, [], teams);
    expect(result).toBeNull();
  });

  it("identifies a comeback from day-level box scores", () => {
    const teams = [makeTeam(2024, 1, "owner-a", 1), makeTeam(2024, 2, "owner-b", 2)];
    const matchup = makeMatchup(
      2024,
      1,
      1,
      { espnTeamId: 1, ownerId: "owner-a", score: 120 },
      { espnTeamId: 2, ownerId: "owner-b", score: 110 }
    );
    const boxScores: BoxScoreEntry[] = [
      makeBoxScoreEntry(2024, 1, 1, 1, [
        { scoring_period: 1, lineup_slot_id: 1, points: 10 },
        { scoring_period: 2, lineup_slot_id: 1, points: 110 },
      ]),
      makeBoxScoreEntry(2024, 1, 2, 2, [
        { scoring_period: 1, lineup_slot_id: 1, points: 60 },
        { scoring_period: 2, lineup_slot_id: 1, points: 50 },
      ]),
    ];
    const result = computeMatchupTurningPoint(matchup, boxScores, teams);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("comeback");
    expect(result!.value).toBeCloseTo(50);
  });

  it("does not flag a comeback when the winner led wire-to-wire", () => {
    const teams = [makeTeam(2024, 1, "owner-a", 1), makeTeam(2024, 2, "owner-b", 2)];
    const matchup = makeMatchup(
      2024,
      1,
      1,
      { espnTeamId: 1, ownerId: "owner-a", score: 120 },
      { espnTeamId: 2, ownerId: "owner-b", score: 100 }
    );
    const boxScores: BoxScoreEntry[] = [
      makeBoxScoreEntry(2024, 1, 1, 1, [
        { scoring_period: 1, lineup_slot_id: 1, points: 60 },
        { scoring_period: 2, lineup_slot_id: 1, points: 60 },
      ]),
      makeBoxScoreEntry(2024, 1, 2, 2, [
        { scoring_period: 1, lineup_slot_id: 1, points: 40 },
        { scoring_period: 2, lineup_slot_id: 1, points: 60 },
      ]),
    ];
    const result = computeMatchupTurningPoint(matchup, boxScores, teams);
    expect(result).toBeNull();
  });

  it("ignores box scores that do not resolve per day", () => {
    // Pre-2019 shape: one scoring period, every slot lineup_slot_id 0. With a
    // single period the winner's weekly deficit is not an in-week comeback, so
    // this must report nothing rather than dressing up a full-week loss.
    const teams = [makeTeam(2018, 1, "owner-a", 1), makeTeam(2018, 2, "owner-b", 2)];
    const matchup = makeMatchup(
      2018,
      1,
      1,
      { espnTeamId: 1, ownerId: "owner-a", score: 120 },
      { espnTeamId: 2, ownerId: "owner-b", score: 110 }
    );
    const boxScores: BoxScoreEntry[] = [
      makeBoxScoreEntry(2018, 1, 1, 1, [{ scoring_period: 1, lineup_slot_id: 0, points: 10 }]),
      makeBoxScoreEntry(2018, 1, 2, 2, [{ scoring_period: 1, lineup_slot_id: 0, points: 20 }]),
    ];
    const result = computeMatchupTurningPoint(matchup, boxScores, teams);
    expect(result).toBeNull();
  });

  it("measures the deficit across scoring periods, not just the week total", () => {
    // 2019 is the first season whose box scores are flagged full coverage, and
    // is the range the scoreboard actually ships. The winner trails by 20 after
    // day one and finishes ahead, so the comeback is worth 20 -- proof the
    // cumulative walk uses the periods rather than collapsing to the week total.
    const teams = [makeTeam(2019, 1, "owner-a", 1), makeTeam(2019, 2, "owner-b", 2)];
    const matchup = makeMatchup(
      2019,
      1,
      1,
      { espnTeamId: 1, ownerId: "owner-a", score: 120 },
      { espnTeamId: 2, ownerId: "owner-b", score: 110 }
    );
    const boxScores: BoxScoreEntry[] = [
      makeBoxScoreEntry(2019, 1, 1, 1, [
        { scoring_period: 1, lineup_slot_id: 0, points: 5 },
        { scoring_period: 2, lineup_slot_id: 0, points: 120 },
      ]),
      makeBoxScoreEntry(2019, 1, 2, 2, [
        { scoring_period: 1, lineup_slot_id: 0, points: 25 },
        { scoring_period: 2, lineup_slot_id: 0, points: 80 },
      ]),
    ];
    const result = computeMatchupTurningPoint(matchup, boxScores, teams);
    expect(result?.type).toBe("comeback");
    expect(result?.value).toBe(20);
  });
});

describe("computeMatchupTurningPoints", () => {
  it("tags the single biggest differential across all matchups", () => {
    const teams = [makeTeam(2024, 1, "owner-a", 1), makeTeam(2024, 2, "owner-b", 3), makeTeam(2024, 3, "owner-c", 2)];
    const matchups = [
      makeMatchup(
        2024,
        1,
        1,
        { espnTeamId: 1, ownerId: "owner-a", score: 100 },
        { espnTeamId: 2, ownerId: "owner-b", score: 90 }
      ),
      makeMatchup(
        2024,
        1,
        2,
        { espnTeamId: 3, ownerId: "owner-c", score: 150 },
        { espnTeamId: 2, ownerId: "owner-b", score: 90 }
      ),
    ];
    const results = computeMatchupTurningPoints(matchups, new Map(), teams);
    const biggest = results.find(r => r.type === "biggest_differential");
    expect(biggest?.matchupId).toBe(2);
    expect(biggest?.value).toBeCloseTo(60);
  });
  it("keeps the biggest-differential tag inside its own season", () => {
    // ESPN matchup ids are per-year, so both seasons below carry matchup_id 1.
    // The 2023 blowout is the larger margin; a bare id comparison would tag the
    // 2024 matchup with 2023's number.
    const teams = [
      makeTeam(2023, 1, "owner-a", 5),
      makeTeam(2023, 2, "owner-b", 1),
      makeTeam(2024, 3, "owner-a", 5),
      makeTeam(2024, 4, "owner-b", 1),
    ];
    const matchups = [
      makeMatchup(
        2023,
        1,
        1,
        { espnTeamId: 1, ownerId: "owner-a", score: 100 },
        { espnTeamId: 2, ownerId: "owner-b", score: 200 }
      ),
      makeMatchup(
        2024,
        1,
        1,
        { espnTeamId: 3, ownerId: "owner-a", score: 100 },
        { espnTeamId: 4, ownerId: "owner-b", score: 120 }
      ),
    ];
    const results = computeMatchupTurningPoints(matchups, new Map(), teams);
    // Neither is an upset (the better-ranked owner-b wins both), so the only
    // tag available is the blowout -- and 2023's 100-point margin is the bigger.
    const tagged = results.filter(r => r.type === "biggest_differential");
    expect(tagged).toHaveLength(1);
    expect(tagged[0].matchupId).toBe(1);
    expect(tagged[0].value).toBeCloseTo(100);
  });
});
