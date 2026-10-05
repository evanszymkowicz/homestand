import { describe, expect, it } from "vitest";
import { getIdentityVsWinPct, getPitchingBattingIdentity, getScoringRulesDrift } from "./divergingViews";
import type {
  BattingLine,
  BoxScoreEntry,
  BoxScoreSlot,
  Matchup,
  PitchingLine,
  Season,
  Team,
  TeamRecord,
} from "../types";

const BATTING_LINE: BattingLine = {
  ab: 4,
  r: 1,
  singles: 1,
  doubles: 0,
  triples: 0,
  hr: 1,
  rbi: 2,
  bb: 0,
  hbp: 0,
  k: 1,
  sb: 0,
  cs: 0,
  gidp: 0,
  cyc: 0,
  gshr: 0,
  e: 0,
};

const PITCHING_LINE: PitchingLine = {
  outs: 18,
  h: 4,
  r: 1,
  er: 1,
  bb: 1,
  hb: 0,
  k: 8,
  wins: 1,
  losses: 0,
  sv: 0,
  bs: 0,
  hd: 0,
  sho: 0,
  nh: 0,
  pg: 0,
};

const YEAR = 2024;
const REGULAR_MATCHUP = 1;
const PLAYOFF_MATCHUP = 2;
const BATTING_SLOT = 0;
const SP_SLOT = 14;

function makeRecord(wins: number, losses: number, pointsFor: number): TeamRecord {
  return { wins, losses, ties: 0, points_for: pointsFor, points_against: 0 };
}

function makeTeam(espnTeamId: number, ownerId: string, pointsFor: number, finalRank = 2): Team {
  const record = makeRecord(6, 4, pointsFor);
  return {
    year: YEAR,
    espn_team_id: espnTeamId,
    owner_ids: [ownerId],
    primary_owner_id: ownerId,
    team_name: `Team ${espnTeamId}`,
    division_id: 1,
    final_rank: finalRank,
    playoff_seed: 1,
    overall: record,
    home: record,
    away: record,
    division_record: record,
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

function makeEntry(
  espnTeamId: number,
  matchupId: number,
  slots: BoxScoreSlot[],
  lines: { batting?: boolean; pitching?: boolean } = {}
): BoxScoreEntry {
  return {
    year: YEAR,
    week: matchupId,
    matchup_id: matchupId,
    owner_id: "owner",
    espn_team_id: espnTeamId,
    player_id: 1,
    player_name: "Player",
    total_points: slots.reduce((sum, s) => sum + s.points, 0),
    // Only the slot drives the split; the lines mark a player as two-way,
    // which is what the superseded entry-level rule keyed on.
    batting: lines.batting ? BATTING_LINE : null,
    pitching: lines.pitching ? PITCHING_LINE : null,
    slots,
  };
}

function slot(lineupSlotId: number, points: number): BoxScoreSlot {
  return { scoring_period: 1, lineup_slot_id: lineupSlotId, points };
}

const MATCHUPS: Matchup[] = [
  {
    year: YEAR,
    week: 1,
    matchup_id: REGULAR_MATCHUP,
    playoff_tier: null,
    winner: "HOME",
    home: { owner_id: "alice", espn_team_id: 1, score: 150 },
    away: { owner_id: "bob", espn_team_id: 2, score: 100 },
  },
  {
    year: YEAR,
    week: 2,
    matchup_id: PLAYOFF_MATCHUP,
    playoff_tier: "WINNERS_BRACKET",
    winner: "HOME",
    home: { owner_id: "alice", espn_team_id: 1, score: 40 },
    away: { owner_id: "bob", espn_team_id: 2, score: 30 },
  },
];

/** Team 1: 100 batting + 50 pitching in the regular season (points_for 150),
 * plus a 40-point playoff pitching week that must not count. Team 2: 80/20. */
function baseEntries(): BoxScoreEntry[] {
  return [
    makeEntry(1, REGULAR_MATCHUP, [slot(BATTING_SLOT, 100)], { batting: true }),
    makeEntry(1, REGULAR_MATCHUP, [slot(SP_SLOT, 50)], { pitching: true }),
    makeEntry(1, PLAYOFF_MATCHUP, [slot(SP_SLOT, 40)], { pitching: true }),
    makeEntry(2, REGULAR_MATCHUP, [slot(BATTING_SLOT, 80)], { batting: true }),
    makeEntry(2, REGULAR_MATCHUP, [slot(SP_SLOT, 20)], { pitching: true }),
  ];
}

const TEAMS = [makeTeam(1, "alice", 150, 1), makeTeam(2, "bob", 100)];

function identityRows(entries: BoxScoreEntry[], teams = TEAMS) {
  const years = getPitchingBattingIdentity(new Map([[YEAR, entries]]), teams, MATCHUPS);
  return years[0].rows;
}

describe("getPitchingBattingIdentity", () => {
  it("counts only regular-season matchups, so pitching + batting equals points_for", () => {
    const [team1] = identityRows(baseEntries());

    expect(team1.pitchingPoints).toBe(50);
    expect(team1.battingPoints).toBe(100);
    expect(team1.pitchingPoints + team1.battingPoints).toBe(team1.points);
    // 90/150 if the playoff week leaked into the numerator.
    expect(team1.share).toBeCloseTo(50 / 150, 10);
  });

  it("splits a two-way player's week by the slot each day was started in", () => {
    const entries = [
      makeEntry(1, REGULAR_MATCHUP, [slot(SP_SLOT, 30), slot(BATTING_SLOT, 20)], {
        batting: true,
        pitching: true,
      }),
      makeEntry(1, REGULAR_MATCHUP, [slot(BATTING_SLOT, 100)], { batting: true }),
      makeEntry(2, REGULAR_MATCHUP, [slot(BATTING_SLOT, 100)], { batting: true }),
    ];

    const [team1] = identityRows(entries, [makeTeam(1, "alice", 150), makeTeam(2, "bob", 100)]);

    expect(team1.pitchingPoints).toBe(30);
    expect(team1.battingPoints).toBe(120);
    expect(team1.share).toBeCloseTo(30 / 150, 10);
  });

  it("moves the share down when a two-way player's pitching days scored negative points", () => {
    const entries = [
      makeEntry(1, REGULAR_MATCHUP, [slot(SP_SLOT, -10), slot(BATTING_SLOT, 40)], {
        batting: true,
        pitching: true,
      }),
      makeEntry(1, REGULAR_MATCHUP, [slot(BATTING_SLOT, 70)], { batting: true }),
      makeEntry(2, REGULAR_MATCHUP, [slot(BATTING_SLOT, 100)], { batting: true }),
    ];

    const [team1] = identityRows(entries, [makeTeam(1, "alice", 100), makeTeam(2, "bob", 100)]);

    expect(team1.pitchingPoints).toBe(-10);
    // Below the 0% the old whole-week-as-batting rule would have shown.
    expect(team1.share).toBeLessThan(0);
    expect(team1.pitchingPoints + team1.battingPoints).toBe(team1.points);
  });

  it("skips teams that scored no points rather than dividing by zero", () => {
    const rows = identityRows(baseEntries(), [makeTeam(1, "alice", 150), makeTeam(2, "bob", 0)]);

    expect(rows.map(r => r.ownerId)).toEqual(["alice"]);
  });
});

describe("getIdentityVsWinPct", () => {
  it("carries points, pitching points and a league-average-relative points index", () => {
    const rows = getIdentityVsWinPct(new Map([[YEAR, baseEntries()]]), TEAMS, MATCHUPS);
    const alice = rows.find(r => r.ownerId === "alice")!;
    const bob = rows.find(r => r.ownerId === "bob")!;

    expect(alice.points).toBe(150);
    expect(alice.pitchingPoints).toBe(50);
    // Season mean points_for is 125.
    expect(alice.pointsIndex).toBeCloseTo(150 / 125, 10);
    expect(bob.pointsIndex).toBeCloseTo(100 / 125, 10);
    expect(alice.isChampion).toBe(true);
    expect(bob.isChampion).toBe(false);
  });
});

/** Only scoring matters here; the rest of Season is irrelevant to the drift
 * computation, so the fixture carries just year + scoring. */
function makeSeason(year: number, scoring: [number, number][]): Season {
  return {
    year,
    scoring: scoring.map(([stat_id, points]) => ({ stat_id, points })),
  } as Season;
}

describe("getScoringRulesDrift", () => {
  it("flags a year whose points differ from the prior scored year", () => {
    const rows = getScoringRulesDrift([
      makeSeason(2024, [[5, 1]]),
      makeSeason(2025, [[5, 2]]),
    ]);
    const hr = rows.find(r => r.statId === 5)!;

    expect(hr.valuesByYear.get(2024)).toBe(1);
    expect(hr.valuesByYear.get(2025)).toBe(2);
    expect(hr.changedYears.has(2025)).toBe(true);
    expect(hr.changedYears.has(2024)).toBe(false);
  });

  it("treats a gap year as unscored, not as a change", () => {
    const rows = getScoringRulesDrift([
      makeSeason(2024, [[5, 1]]),
      makeSeason(2025, []),
      makeSeason(2026, [[5, 1]]),
    ]);
    const hr = rows.find(r => r.statId === 5)!;

    expect(hr.valuesByYear.get(2025)).toBeNull();
    expect(hr.changedYears.size).toBe(0);
  });

  it("yields null for a stat no season scored", () => {
    const rows = getScoringRulesDrift([makeSeason(2024, []), makeSeason(2025, [])]);
    const hr = rows.find(r => r.statId === 5)!;

    expect(hr.valuesByYear.get(2024)).toBeNull();
    expect(hr.valuesByYear.get(2025)).toBeNull();
    expect(hr.changedYears.size).toBe(0);
  });
});
