import { describe, expect, it } from "vitest";
import type { FormStripYear } from "./divergingViews";
import {
  computeOwnerMilestones,
  computeOwnerStreaksByOwner,
  countOwnerRosteredPlayers,
  type MilestoneInput,
  type OwnerMilestone,
} from "./ownerMilestones";
import type { Matchup, PlayerTeamSeasonPoints, Season, Team, Transaction } from "../types";

function makeTeam(overrides: Partial<Team> & Pick<Team, "year" | "primary_owner_id">): Team {
  const record = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
  return {
    espn_team_id: 1,
    owner_ids: [overrides.primary_owner_id],
    team_name: "Team",
    division_id: 1,
    final_rank: 1,
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
      ...overrides.transactions,
    },
    eliminated: false,
    elimination_matchup_period: null,
    points_adjusted: 0,
    current_projected_rank: null,
    is_transaction_locked: false,
    ...overrides,
  };
}

function makeSeason(year: number, overrides: Partial<Season> = {}): Season {
  return {
    year,
    regular_season_weeks: 21,
    playoff_weeks: 3,
    playoff_team_count: 6,
    playoff_brackets: ["WINNERS_BRACKET"],
    divisions: [],
    scoring: [],
    coverage: {
      teams: "full",
      matchups: "full",
      draft: "full",
      rosters: "full",
      players: "full",
      box_scores: "full",
      stat_lines: "full",
      transactions: "full",
      achievements: "missing",
    },
    status: "final",
    current_week: 21,
    notes: [],
    settings: { league_id: 1, league_name: "flb", league_size: 10, is_public: false },
    roster_rules: {
      lineup_slot_counts: {},
      position_limits: {},
      bench_unlimited: true,
      move_limit: null,
      lineup_lock_time: "",
      roster_lock_time: "",
      using_undroppable_list: false,
    },
    acquisition_rules: {
      acquisition_type: "FREEAGENT",
      waiver_hours: 48,
      waiver_order_reset: true,
      waiver_process_days: [],
      waiver_process_hour: 0,
      minimum_bid: 0,
      using_acquisition_budget: false,
      acquisition_budget: null,
      acquisition_limit: null,
      matchup_acquisition_limit: null,
      transaction_locking_enabled: false,
    },
    draft_settings: {
      draft_type: "SNAKE",
      order_type: "RANDOM",
      keeper_count: 0,
      keeper_order_type: "UNORDERED",
      keeper_deadline_date: null,
      auction_budget: null,
      time_per_pick: 180,
    },
    trade_rules: { deadline_date: null, max_trades: null, revision_hours: 4, veto_votes_required: 0 },
    ...overrides,
  };
}

function makeMatchup(overrides: Partial<Matchup> & Pick<Matchup, "week">): Matchup {
  return {
    year: 2024,
    matchup_id: overrides.week,
    playoff_tier: null,
    winner: "HOME",
    home: { owner_id: "owner-a", espn_team_id: 1, score: 100 },
    away: { owner_id: "owner-b", espn_team_id: 2, score: 90 },
    ...overrides,
  };
}

function makeTeamSeasonPoint(
  overrides: Partial<PlayerTeamSeasonPoints> & Pick<PlayerTeamSeasonPoints, "year" | "player_id">
): PlayerTeamSeasonPoints {
  return {
    player_name: `Player ${overrides.player_id}`,
    owner_id: "owner-a",
    espn_team_id: 1,
    points: 0,
    counted_points: 0,
    bench_points: 0,
    ...overrides,
  };
}

function makeAddTransaction(year: number, ownerId: string, playerId: number): Transaction {
  return {
    transaction_id: `t-${year}-${playerId}`,
    year,
    transaction_type: "FREEAGENT",
    scoring_period_id: 1,
    week: 1,
    proposed_date: 0,
    espn_team_id: 1,
    owner_id: ownerId,
    acting_member_key: null,
    status: "EXECUTED",
    is_league_manager: false,
    related_transaction_id: null,
    bid_amount: 0,
    items: [
      {
        player_id: playerId,
        item_type: "ADD",
        from_espn_team_id: null,
        to_espn_team_id: 1,
        from_lineup_slot_id: null,
        to_lineup_slot_id: null,
      },
    ],
  };
}

const formStrips = (rows: FormStripYear["rows"]): FormStripYear[] => [{ year: 2024, rows }];

function baseInput(overrides: Partial<MilestoneInput> = {}): MilestoneInput {
  return {
    ownerId: "owner-a",
    teams: [],
    seasons: [makeSeason(2024)],
    transactions: [],
    teamSeasonPoints: [],
    ...overrides,
  };
}

function milestonesFor(input: MilestoneInput, matchups: Matchup[] = []) {
  return computeOwnerMilestones({
    ...input,
    formStrips: formStrips([{ ownerId: input.ownerId, espnTeamId: 1, mean: 0, stdev: 0, weeks: [] }]),
    streaksByOwner: computeOwnerStreaksByOwner(input.teams, matchups),
  }).milestones;
}

function byLabel(milestones: OwnerMilestone[], label: string) {
  return milestones.find(m => m.label === label);
}

describe("computeOwnerStreaksByOwner", () => {
  it("finds the longest run across every team-season an owner had", () => {
    const teams = [
      makeTeam({ year: 2023, primary_owner_id: "owner-a", espn_team_id: 1 }),
      makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 1 }),
    ];
    // 2023: W W L. 2024: W W W.
    const matchups = [
      makeMatchup({ year: 2023, week: 1 }),
      makeMatchup({ year: 2023, week: 2 }),
      makeMatchup({ year: 2023, week: 3, winner: "AWAY" }),
      makeMatchup({ year: 2024, week: 1 }),
      makeMatchup({ year: 2024, week: 2 }),
      makeMatchup({ year: 2024, week: 3 }),
    ];
    const streaks = computeOwnerStreaksByOwner(teams, matchups).get("owner-a")!;
    expect(streaks.wins).toBe(3);
    expect(streaks.winsYear).toBe(2024);
  });

  it("does not read Team.streak_length, which is the streak as of season end", () => {
    // The archived row says LOSS / 1 (the run it happened to be on when the
    // season stopped) but the real longest win run in these matchups is 4.
    const teams = [
      makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 1, streak_type: "LOSS", streak_length: 1 }),
    ];
    const matchups = [
      makeMatchup({ week: 1 }),
      makeMatchup({ week: 2 }),
      makeMatchup({ week: 3 }),
      makeMatchup({ week: 4 }),
      makeMatchup({ week: 5, winner: "AWAY" }),
    ];
    expect(computeOwnerStreaksByOwner(teams, matchups).get("owner-a")!.wins).toBe(4);
  });

  it("excludes playoff weeks and undecided rows", () => {
    const teams = [makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 1 })];
    const matchups = [
      makeMatchup({ week: 1 }),
      // Playoff week -- not regular season, so it can't extend a regular-season run.
      makeMatchup({ week: 22, playoff_tier: "WINNERS_BRACKET" }),
      makeMatchup({ week: 23, playoff_tier: "WINNERS_BRACKET" }),
    ];
    expect(computeOwnerStreaksByOwner(teams, matchups).get("owner-a")!.wins).toBe(1);
  });

  it("breaks a streak on a tie, matching stats.ts's own rule", () => {
    const teams = [makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 1 })];
    const matchups = [makeMatchup({ week: 1 }), makeMatchup({ week: 2, winner: "TIE" }), makeMatchup({ week: 3 })];
    expect(computeOwnerStreaksByOwner(teams, matchups).get("owner-a")!.wins).toBe(1);
  });

  it("credits a co-owned team's streaks to both owners", () => {
    const teams = [
      makeTeam({ year: 2024, primary_owner_id: "owner-a", owner_ids: ["owner-a", "owner-b"], espn_team_id: 1 }),
    ];
    const byOwner = computeOwnerStreaksByOwner(teams, [makeMatchup({ week: 1 }), makeMatchup({ week: 2 })]);
    expect(byOwner.get("owner-a")!.wins).toBe(2);
    expect(byOwner.get("owner-b")!.wins).toBe(2);
  });
});

describe("countOwnerRosteredPlayers", () => {
  it("counts distinct players per team the owner held, not per owner id", () => {
    const teams = [
      makeTeam({ year: 2024, primary_owner_id: "owner-a", owner_ids: ["owner-a", "owner-b"], espn_team_id: 1 }),
      makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 9 }),
    ];
    const rows = [
      makeTeamSeasonPoint({ year: 2024, player_id: 1, espn_team_id: 1 }),
      makeTeamSeasonPoint({ year: 2024, player_id: 1, espn_team_id: 1 }),
      makeTeamSeasonPoint({ year: 2024, player_id: 2, espn_team_id: 9 }),
      // Team 77 is nobody's in `teams`, so this row must not be counted.
      makeTeamSeasonPoint({ year: 2024, player_id: 3, espn_team_id: 77 }),
    ];
    expect(countOwnerRosteredPlayers("owner-a", rows, teams)).toEqual({ count: 2, years: [2024] });
    // owner-b is credited only on the co-owned team, not owner-a's team 9, so
    // they see 1 player rather than inheriting owner-a's second roster.
    expect(countOwnerRosteredPlayers("owner-b", rows, teams)).toEqual({ count: 1, years: [2024] });
  });

  it("returns an empty count when no production rows loaded", () => {
    const teams = [makeTeam({ year: 2024, primary_owner_id: "owner-a" })];
    expect(countOwnerRosteredPlayers("owner-a", [], teams)).toEqual({ count: 0, years: [] });
  });
});

describe("computeOwnerMilestones", () => {
  it("returns no milestones for an owner with no team-season", () => {
    expect(milestonesFor(baseInput())).toEqual([]);
  });

  it("computes best finish from final_rank", () => {
    const teams = [
      makeTeam({
        year: 2024,
        primary_owner_id: "owner-a",
        espn_team_id: 1,
        final_rank: 1,
        playoff_seed: 1,
        overall: { wins: 15, losses: 6, ties: 0, points_for: 2500, points_against: 2000 },
      }),
    ];
    const milestones = milestonesFor(baseInput({ teams, seasons: [makeSeason(2024)] }));

    expect(byLabel(milestones, "Best Finish")?.value).toBe("1st");
  });

  it("reports best and worst finish across different seasons", () => {
    const teams = [
      makeTeam({ year: 2023, primary_owner_id: "owner-a", espn_team_id: 1, final_rank: 2, playoff_seed: 2 }),
      makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 1, final_rank: 9, playoff_seed: 9 }),
    ];
    const milestones = milestonesFor(baseInput({ teams, seasons: [makeSeason(2023), makeSeason(2024)] }));
    expect(byLabel(milestones, "Best Finish")).toMatchObject({ value: "2nd", season: 2023 });
    expect(byLabel(milestones, "Worst Finish")).toMatchObject({ value: "9th", season: 2024 });
  });

  it("reads the Best Week from matchup weekly scores, so it has full 2009+ coverage", () => {
    const teams = [
      makeTeam({ year: 2011, primary_owner_id: "owner-a", espn_team_id: 1 }),
      makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 1 }),
    ];
    const strips: FormStripYear[] = [
      {
        year: 2011,
        rows: [{ ownerId: "owner-a", espnTeamId: 1, mean: 90, stdev: 5, weeks: [{ week: 4, score: 187.5, z: 1 }] }],
      },
      {
        year: 2024,
        rows: [{ ownerId: "owner-a", espnTeamId: 1, mean: 90, stdev: 5, weeks: [{ week: 2, score: 150.2, z: 1 }] }],
      },
    ];
    const milestones = computeOwnerMilestones({
      ownerId: "owner-a",
      teams,
      seasons: [makeSeason(2011), makeSeason(2024)],
      transactions: [],
      teamSeasonPoints: [],
      formStrips: strips,
      streaksByOwner: computeOwnerStreaksByOwner(teams, []),
    }).milestones;

    expect(byLabel(milestones, "Best Week")).toMatchObject({ value: "187.5", season: 2011 });
  });

  it("counts distinct players from the production rows and states the season span", () => {
    const teams = [
      makeTeam({ year: 2023, primary_owner_id: "owner-a", espn_team_id: 1 }),
      makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 1 }),
    ];
    const milestones = milestonesFor(
      baseInput({
        teams,
        teamSeasonPoints: [
          makeTeamSeasonPoint({ year: 2023, player_id: 5, espn_team_id: 1 }),
          makeTeamSeasonPoint({ year: 2024, player_id: 5, espn_team_id: 1 }),
        ],
      })
    );
    const milestone = byLabel(milestones, "unique players owned");
    expect(milestone?.value).toBe("1");
    expect(milestone?.description).toBe("2023–2024");
  });

  it("includes 2018 and flags it as partial when it contributes to the count", () => {
    const teams = [makeTeam({ year: 2018, primary_owner_id: "owner-a", espn_team_id: 1 })];
    const partial = makeSeason(2018, {
      coverage: {
        teams: "full",
        matchups: "full",
        draft: "full",
        rosters: "full",
        players: "full",
        box_scores: "partial",
        stat_lines: "partial",
        transactions: "missing",
        achievements: "missing",
      },
    });
    const milestones = milestonesFor(
      baseInput({
        teams,
        seasons: [partial],
        teamSeasonPoints: [makeTeamSeasonPoint({ year: 2018, player_id: 7, espn_team_id: 1 })],
      })
    );
    const milestone = byLabel(milestones, "unique players owned");
    expect(milestone?.value).toBe("1");
    // 2018 is counted, not dropped -- and the card says it is partial.
    expect(milestone?.description).toBe("2018 · 2018 partial");
  });

  it("reports the busiest season from the 2019+ ledger, matching the activity table", () => {
    const teams = [
      makeTeam({ year: 2020, primary_owner_id: "owner-a", espn_team_id: 1 }),
      makeTeam({ year: 2021, primary_owner_id: "owner-a", espn_team_id: 1 }),
    ];
    const transactions = [
      makeAddTransaction(2020, "owner-a", 1),
      makeAddTransaction(2020, "owner-a", 2),
      makeAddTransaction(2020, "owner-a", 3),
      makeAddTransaction(2021, "owner-a", 4),
    ];
    const milestones = milestonesFor(baseInput({ teams, seasons: [makeSeason(2020), makeSeason(2021)], transactions }));
    expect(byLabel(milestones, "Busiest Season")).toMatchObject({
      value: "3",
      season: 2020,
      description: "moves · since 2019",
    });
  });

  it("includes win and losing streaks derived from matchups", () => {
    const teams = [makeTeam({ year: 2024, primary_owner_id: "owner-a", espn_team_id: 1 })];
    const matchups = [
      makeMatchup({ week: 1 }),
      makeMatchup({ week: 2 }),
      makeMatchup({ week: 3 }),
      makeMatchup({ week: 4, winner: "AWAY" }),
      makeMatchup({ week: 5, winner: "AWAY" }),
    ];
    const milestones = milestonesFor(baseInput({ teams }), matchups);
    expect(byLabel(milestones, "Longest Win Streak")?.value).toBe("3 games");
    expect(byLabel(milestones, "Longest Losing Streak")?.value).toBe("2 games");
  });

  it("counts playoff appearances against the season's own playoff field size", () => {
    const teams = [
      makeTeam({ year: 2020, primary_owner_id: "owner-a", espn_team_id: 1, final_rank: 3, playoff_seed: 3 }),
    ];
    const milestones = milestonesFor(
      baseInput({ teams, seasons: [makeSeason(2020, { playoff_team_count: 2, regular_season_weeks: 8 })] })
    );
    expect(byLabel(milestones, "Playoff Appearances")).toBeUndefined();
  });
});
