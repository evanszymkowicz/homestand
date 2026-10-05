import { describe, expect, it } from "vitest";
import { computeWeeklyPowerRankings } from "./powerRankings";
import type { Matchup, Team, TeamRecord } from "../types";

const EMPTY_RECORD: TeamRecord = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };

function makeTeam(year: number, espnTeamId: number, primaryOwnerId: string, overrides: Partial<Team> = {}): Team {
  return {
    year,
    espn_team_id: espnTeamId,
    owner_ids: overrides.owner_ids ?? [primaryOwnerId],
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

function makeMatchup(
  year: number,
  week: number,
  home: { espnTeamId: number; ownerId: string; score: number },
  away: { espnTeamId: number; ownerId: string; score: number },
  overrides: Partial<Matchup> = {}
): Matchup {
  return {
    year,
    week,
    matchup_id: 1,
    playoff_tier: null,
    winner: home.score > away.score ? "HOME" : away.score > home.score ? "AWAY" : "TIE",
    home: { owner_id: home.ownerId, espn_team_id: home.espnTeamId, score: home.score },
    away: { owner_id: away.ownerId, espn_team_id: away.espnTeamId, score: away.score },
    ...overrides,
  };
}

describe("computeWeeklyPowerRankings", () => {
  it("ranks teams by cumulative points each week", () => {
    const teams = [makeTeam(2024, 1, "owner-a"), makeTeam(2024, 2, "owner-b"), makeTeam(2024, 3, "owner-c")];
    const matchups = [
      makeMatchup(
        2024,
        1,
        { espnTeamId: 1, ownerId: "owner-a", score: 100 },
        { espnTeamId: 2, ownerId: "owner-b", score: 90 }
      ),
      makeMatchup(
        2024,
        1,
        { espnTeamId: 3, ownerId: "owner-c", score: 80 },
        { espnTeamId: 1, ownerId: "owner-a", score: 0 }
      ),
    ];
    const result = computeWeeklyPowerRankings(2024, matchups, teams);
    expect(result.weeks).toHaveLength(1);
    const week1 = result.weeks[0];
    expect(week1.rankings[0].espnTeamId).toBe(1);
    expect(week1.rankings[0].cumulativePoints).toBe(100);
    expect(week1.rankings[1].espnTeamId).toBe(2);
    expect(week1.rankings[1].cumulativePoints).toBe(90);
    expect(week1.rankings[2].espnTeamId).toBe(3);
    expect(week1.rankings[2].cumulativePoints).toBe(80);
  });

  it("excludes playoff games entirely, so the last week is the regular-season total", () => {
    const teams = [makeTeam(2024, 1, "owner-a"), makeTeam(2024, 2, "owner-b")];
    const matchups = [
      makeMatchup(
        2024,
        1,
        { espnTeamId: 1, ownerId: "owner-a", score: 50 },
        { espnTeamId: 2, ownerId: "owner-b", score: 100 }
      ),
      makeMatchup(
        2024,
        2,
        { espnTeamId: 1, ownerId: "owner-a", score: 100 },
        { espnTeamId: 2, ownerId: "owner-b", score: 10 },
        { playoff_tier: "WINNERS_BRACKET" }
      ),
    ];
    const result = computeWeeklyPowerRankings(2024, matchups, teams);
    // The playoff week is dropped, not merely flagged: it is absent from the
    // week list, so it cannot contribute points or reorder the table.
    expect(result.weeks.map(w => w.week)).toEqual([1]);
    expect(result.weeks[0].rankings[0].espnTeamId).toBe(2);
    expect(result.weeks[0].rankings[0].cumulativePoints).toBe(100);
  });

  it("reconciles its final-week total with teams.json overall.points_for", () => {
    // The house rule: every season-points figure in the app is regular-season
    // only. This is the assertion that keeps the running total honest.
    const teams = [
      makeTeam(2024, 1, "owner-a", { overall: { ...EMPTY_RECORD, points_for: 150 } }),
      makeTeam(2024, 2, "owner-b", { overall: { ...EMPTY_RECORD, points_for: 100 } }),
    ];
    const matchups = [
      makeMatchup(
        2024,
        1,
        { espnTeamId: 1, ownerId: "owner-a", score: 50 },
        { espnTeamId: 2, ownerId: "owner-b", score: 100 }
      ),
      makeMatchup(
        2024,
        2,
        { espnTeamId: 1, ownerId: "owner-a", score: 100 },
        { espnTeamId: 2, ownerId: "owner-b", score: 0 }
      ),
      makeMatchup(
        2024,
        3,
        { espnTeamId: 1, ownerId: "owner-a", score: 999 },
        { espnTeamId: 2, ownerId: "owner-b", score: 0 },
        { playoff_tier: "WINNERS_BRACKET" }
      ),
    ];
    const result = computeWeeklyPowerRankings(2024, matchups, teams);
    const lastWeek = result.weeks.at(-1)!;
    for (const ranking of lastWeek.rankings) {
      const team = teams.find(t => t.espn_team_id === ranking.espnTeamId)!;
      expect(ranking.cumulativePoints).toBe(team.overall.points_for);
    }
  });

  it("returns an empty week list for a season with no matchups", () => {
    const teams = [makeTeam(2024, 1, "owner-a")];
    const result = computeWeeklyPowerRankings(2024, [], teams);
    expect(result.weeks).toHaveLength(0);
  });
});
