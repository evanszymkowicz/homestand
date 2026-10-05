import { describe, expect, it } from "vitest";
import type { Matchup, Team, TeamRecord } from "../types";
import { buildTeamOwnersIndex, getPairRecords, getPairSummary, pairKey } from "./h2h";

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

interface MakeMatchupOptions {
  year?: number;
  week: number;
  matchupId: number;
  playoffTier?: string | null;
  winner: Matchup["winner"];
  homeTeamId: number;
  awayTeamId: number | null;
  homeScore?: number;
  awayScore?: number;
}

function makeMatchup(opts: MakeMatchupOptions): Matchup {
  return {
    year: opts.year ?? 2024,
    week: opts.week,
    matchup_id: opts.matchupId,
    playoff_tier: opts.playoffTier ?? null,
    winner: opts.winner,
    home: { owner_id: null, espn_team_id: opts.homeTeamId, score: opts.homeScore ?? 100 },
    away:
      opts.awayTeamId === null ? null : { owner_id: null, espn_team_id: opts.awayTeamId, score: opts.awayScore ?? 90 },
  };
}

describe("getPairRecords", () => {
  it("credits a win to the winner and a loss to the loser, in both directions", () => {
    const teams = [makeTeam(2024, 1, ["alice"]), makeTeam(2024, 2, ["bob"])];
    const index = buildTeamOwnersIndex(teams);
    const matchups = [makeMatchup({ week: 1, matchupId: 1, winner: "HOME", homeTeamId: 1, awayTeamId: 2 })];

    const records = getPairRecords(matchups, index, "combined");

    expect(records.get(pairKey("alice", "bob"))).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(records.get(pairKey("bob", "alice"))).toEqual({ wins: 0, losses: 1, ties: 0 });
  });

  it("counts a tie for both owners", () => {
    const teams = [makeTeam(2024, 1, ["alice"]), makeTeam(2024, 2, ["bob"])];
    const index = buildTeamOwnersIndex(teams);
    const matchups = [makeMatchup({ week: 1, matchupId: 1, winner: "TIE", homeTeamId: 1, awayTeamId: 2 })];

    const records = getPairRecords(matchups, index, "combined");

    expect(records.get(pairKey("alice", "bob"))).toEqual({ wins: 0, losses: 0, ties: 1 });
    expect(records.get(pairKey("bob", "alice"))).toEqual({ wins: 0, losses: 0, ties: 1 });
  });

  it("credits every owner on a co-owned team, but never credits a co-owner against themselves", () => {
    // Home is co-owned by alice+bob; away is co-owned by alice+carol (alice is on
    // both sides — a same-owner scenario the real data can produce via trades).
    const teams = [makeTeam(2024, 1, ["alice", "bob"]), makeTeam(2024, 2, ["alice", "carol"])];
    const index = buildTeamOwnersIndex(teams);
    const matchups = [makeMatchup({ week: 1, matchupId: 1, winner: "HOME", homeTeamId: 1, awayTeamId: 2 })];

    const records = getPairRecords(matchups, index, "combined");

    expect(records.get(pairKey("alice", "alice"))).toBeUndefined();
    expect(records.get(pairKey("alice", "carol"))).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(records.get(pairKey("bob", "alice"))).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(records.get(pairKey("bob", "carol"))).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(records.get(pairKey("carol", "alice"))).toEqual({ wins: 0, losses: 1, ties: 0 });
  });

  it("skips byes and undecided matchups", () => {
    const teams = [makeTeam(2024, 1, ["alice"]), makeTeam(2024, 2, ["bob"])];
    const index = buildTeamOwnersIndex(teams);
    const matchups = [
      makeMatchup({ week: 1, matchupId: 1, winner: "UNDECIDED", homeTeamId: 1, awayTeamId: null }),
      makeMatchup({ week: 2, matchupId: 2, winner: "UNDECIDED", homeTeamId: 1, awayTeamId: 2 }),
    ];

    const records = getPairRecords(matchups, index, "combined");

    expect(records.size).toBe(0);
  });

  it("filters by regular/playoffs/combined scope", () => {
    const teams = [makeTeam(2024, 1, ["alice"]), makeTeam(2024, 2, ["bob"])];
    const index = buildTeamOwnersIndex(teams);
    const matchups = [
      makeMatchup({ week: 1, matchupId: 1, winner: "HOME", homeTeamId: 1, awayTeamId: 2, playoffTier: null }),
      makeMatchup({
        week: 20,
        matchupId: 2,
        winner: "AWAY",
        homeTeamId: 1,
        awayTeamId: 2,
        playoffTier: "WINNERS_BRACKET",
      }),
    ];

    const regular = getPairRecords(matchups, index, "regular");
    const playoffs = getPairRecords(matchups, index, "playoffs");
    const combined = getPairRecords(matchups, index, "combined");

    expect(regular.get(pairKey("alice", "bob"))).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(playoffs.get(pairKey("alice", "bob"))).toEqual({ wins: 0, losses: 1, ties: 0 });
    expect(combined.get(pairKey("alice", "bob"))).toEqual({ wins: 1, losses: 1, ties: 0 });
  });
});

describe("getPairSummary", () => {
  const teams = [makeTeam(2024, 1, ["alice"]), makeTeam(2024, 2, ["bob"])];
  const index = buildTeamOwnersIndex(teams);

  it("returns an empty summary with no meetings for an identity pair", () => {
    const matchups = [makeMatchup({ week: 1, matchupId: 1, winner: "HOME", homeTeamId: 1, awayTeamId: 2 })];

    const summary = getPairSummary(matchups, index, "alice", "alice");

    expect(summary.meetings).toEqual([]);
    expect(summary.overall).toEqual({ wins: 0, losses: 0, ties: 0 });
  });

  it("builds chronological meetings, splits, PF, average margin, and the current streak", () => {
    const matchups = [
      makeMatchup({
        week: 1,
        matchupId: 1,
        winner: "HOME",
        homeTeamId: 1,
        awayTeamId: 2,
        homeScore: 120,
        awayScore: 100,
      }),
      makeMatchup({
        week: 2,
        matchupId: 2,
        winner: "AWAY",
        homeTeamId: 2,
        awayTeamId: 1,
        homeScore: 90,
        awayScore: 110,
        playoffTier: "WINNERS_BRACKET",
      }),
      makeMatchup({
        week: 3,
        matchupId: 3,
        winner: "AWAY",
        homeTeamId: 2,
        awayTeamId: 1,
        homeScore: 95,
        awayScore: 130,
        playoffTier: "WINNERS_BRACKET",
      }),
    ];

    const summary = getPairSummary(matchups, index, "alice", "bob");

    expect(summary.meetings.map(m => m.matchupId)).toEqual([1, 2, 3]);
    expect(summary.overall).toEqual({ wins: 3, losses: 0, ties: 0 });
    expect(summary.regular).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(summary.playoffs).toEqual({ wins: 2, losses: 0, ties: 0 });
    expect(summary.pointsForA).toBe(120 + 110 + 130);
    expect(summary.pointsForB).toBe(100 + 90 + 95);
    expect(summary.averageMargin).toBeCloseTo((120 - 100 + (110 - 90) + (130 - 95)) / 3);
    expect(summary.streak).toEqual({ result: "W", length: 3 });
  });

  it("has no streak when the most recent meeting was a tie", () => {
    const matchups = [
      makeMatchup({ week: 1, matchupId: 1, winner: "HOME", homeTeamId: 1, awayTeamId: 2 }),
      makeMatchup({ week: 2, matchupId: 2, winner: "TIE", homeTeamId: 1, awayTeamId: 2 }),
    ];

    const summary = getPairSummary(matchups, index, "alice", "bob");

    expect(summary.streak).toBeNull();
  });

  it("stops the streak count at an earlier tie without nullifying it", () => {
    const matchups = [
      makeMatchup({ week: 1, matchupId: 1, winner: "TIE", homeTeamId: 1, awayTeamId: 2 }),
      makeMatchup({ week: 2, matchupId: 2, winner: "HOME", homeTeamId: 1, awayTeamId: 2 }),
      makeMatchup({ week: 3, matchupId: 3, winner: "HOME", homeTeamId: 1, awayTeamId: 2 }),
    ];

    const summary = getPairSummary(matchups, index, "alice", "bob");

    expect(summary.streak).toEqual({ result: "W", length: 2 });
  });
});
