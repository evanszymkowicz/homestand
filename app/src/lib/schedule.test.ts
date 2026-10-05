import { describe, expect, it } from "vitest";
import { getBracketChampionTeamId, getPlayoffWeeksFromMatchups, type BracketRound } from "./schedule";
import type { Matchup, MatchupWinner, Team, TeamRecord } from "../types";

const emptyRecord: TeamRecord = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };

function makeTeam(espnTeamId: number, finalRank: number): Team {
  return {
    year: 2023,
    espn_team_id: espnTeamId,
    owner_ids: [`owner-${espnTeamId}`],
    primary_owner_id: `owner-${espnTeamId}`,
    team_name: `Team ${espnTeamId}`,
    division_id: 0,
    final_rank: finalRank,
    playoff_seed: finalRank,
    overall: emptyRecord,
    home: emptyRecord,
    away: emptyRecord,
    division_record: emptyRecord,
    streak_type: "WIN",
    streak_length: 1,
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

function makeMatchup(
  matchupId: number,
  week: number,
  homeTeam: number,
  awayTeam: number,
  winner: MatchupWinner,
  playoffTier: string | null = "WINNERS_BRACKET",
  year = 2023
): Matchup {
  return {
    year,
    week,
    matchup_id: matchupId,
    playoff_tier: playoffTier,
    winner,
    home: { owner_id: `owner-${homeTeam}`, espn_team_id: homeTeam, score: winner === "HOME" ? 10 : 5 },
    away: { owner_id: `owner-${awayTeam}`, espn_team_id: awayTeam, score: winner === "AWAY" ? 10 : 5 },
  };
}

describe("getBracketChampionTeamId", () => {
  const teams = [makeTeam(1, 1), makeTeam(2, 2), makeTeam(3, 3), makeTeam(4, 4)];

  it("returns the final-round winner of a winners bracket", () => {
    const rounds: BracketRound[] = [
      { week: 21, matchups: [makeMatchup(1, 21, 1, 4, "HOME"), makeMatchup(2, 21, 2, 3, "HOME")] },
      { week: 22, matchups: [makeMatchup(3, 22, 1, 2, "HOME")] },
    ];
    expect(getBracketChampionTeamId(rounds, teams, 2023)).toBe(1);
  });

  it("picks the best-final-rank winner when the final week has several games (consolation ladder)", () => {
    // Ladder final week: the 5th-place game and the 7th-place game both happen
    // in the last round; the ladder winner is the 5th-place game's winner.
    const ladderTeams = [makeTeam(5, 5), makeTeam(6, 6), makeTeam(7, 7), makeTeam(8, 8)];
    const rounds: BracketRound[] = [
      { week: 22, matchups: [makeMatchup(10, 22, 5, 6, "HOME"), makeMatchup(11, 22, 7, 8, "AWAY")] },
    ];
    expect(getBracketChampionTeamId(rounds, ladderTeams, 2023)).toBe(5);
  });

  it("returns null for an empty bracket or an undecided final", () => {
    expect(getBracketChampionTeamId([], teams, 2023)).toBeNull();
    const undecided: BracketRound[] = [{ week: 22, matchups: [makeMatchup(1, 22, 1, 2, "UNDECIDED")] }];
    expect(getBracketChampionTeamId(undecided, teams, 2023)).toBeNull();
  });
});

describe("getPlayoffWeeksFromMatchups", () => {
  it("returns no weeks when there are no playoff matchups", () => {
    const matchups = [
      makeMatchup(1, 1, 1, 2, "HOME", null),
      makeMatchup(2, 2, 3, 4, "AWAY", null),
    ];
    expect(getPlayoffWeeksFromMatchups(matchups, 2023)).toEqual([]);
  });

  it("returns the distinct ascending weeks that have playoff matchups", () => {
    const matchups = [
      makeMatchup(1, 22, 1, 2, "HOME"),
      makeMatchup(2, 24, 1, 2, "HOME"),
      makeMatchup(3, 23, 3, 4, "AWAY"),
      makeMatchup(4, 23, 5, 6, "HOME"),
    ];
    expect(getPlayoffWeeksFromMatchups(matchups, 2023)).toEqual([22, 23, 24]);
  });

  it("excludes regular-season matchups and other years", () => {
    const matchups = [
      makeMatchup(1, 21, 1, 2, "HOME", null),
      makeMatchup(2, 22, 1, 2, "HOME"),
      makeMatchup(3, 18, 1, 2, "AWAY", "WINNERS_BRACKET", 2022),
    ];
    expect(getPlayoffWeeksFromMatchups(matchups, 2023)).toEqual([22]);
  });
});
