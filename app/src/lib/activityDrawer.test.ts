import { describe, expect, it } from "vitest";
import {
  ALL_EVENT_KINDS,
  buildActivityFeed,
  currentSeason,
  filterFeedByOwner,
  parseStoredFilters,
  parseStoredOwnerFilter,
  parseStoredScope,
  trophyNameForSlot,
  type BuildActivityFeedArgs,
} from "./activityDrawer";
import type { BoxScoreEntry, Matchup, Owner, Player, Season, Team, Trade, Transaction, TrophyRecord } from "../types";

function makeSeason(overrides: Partial<Season> = {}): Season {
  return {
    year: 2026,
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
      achievements: "full",
    },
    status: "in_progress",
    current_week: 21,
    notes: [],
    settings: { league_id: 6121, league_name: "Homestand League", league_size: 10, is_public: false },
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
      acquisition_type: "WAIVERS",
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
      order_type: "MANUAL",
      keeper_count: 5,
      keeper_order_type: "REGULAR_SEASON_RECORD",
      keeper_deadline_date: null,
      auction_budget: null,
      time_per_pick: 90,
    },
    trade_rules: { deadline_date: null, max_trades: null, revision_hours: 48, veto_votes_required: 4 },
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Team> & Pick<Team, "year" | "espn_team_id" | "team_name">): Team {
  const record = { wins: 10, losses: 5, ties: 0, points_for: 100, points_against: 90 };
  return {
    owner_ids: [`owner-${overrides.espn_team_id}`],
    primary_owner_id: `owner-${overrides.espn_team_id}`,
    division_id: 0,
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
    },
    eliminated: false,
    elimination_matchup_period: null,
    points_adjusted: 0,
    current_projected_rank: null,
    is_transaction_locked: false,
    ...overrides,
  };
}

function makePlayer(id: number, name: string): Player {
  return {
    player_id: id,
    full_name: name,
    default_position_id: 1,
    eligible_slots: [],
    games_played_by_position: {},
    active: true,
    pro_team_id: 1,
    jersey: null,
    droppable: true,
    seasons_seen: [2026],
    roster_days: 0,
  };
}

const TEAMS: Team[] = [
  makeTeam({ year: 2026, espn_team_id: 1, team_name: "Dynasties" }),
  makeTeam({ year: 2026, espn_team_id: 2, team_name: "Stonk Market" }),
];

const OWNERS: Owner[] = [
  { owner_id: "owner-1", canonical_name: "Owner One", espn_member_keys: [], team_names_by_year: {}, co_owners: [], last_active_year: 2026, absent_from_latest_season: false },
  { owner_id: "owner-2", canonical_name: "Owner Two", espn_member_keys: [], team_names_by_year: {}, co_owners: [], last_active_year: 2026, absent_from_latest_season: false },
];

const PLAYERS: Player[] = [
  makePlayer(101, "Corbin Carroll"),
  makePlayer(102, "Bobby Witt Jr."),
  makePlayer(201, "Tarik Skubal"),
  makePlayer(202, "Jesus Luzardo"),
];

const SEASON = makeSeason();

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    year: 2026,
    trade_id: "prop-1",
    proposed_date: null,
    executed_date: 1756400000000,
    team_a_espn_team_id: 1,
    team_a_owner_id: "owner-1",
    team_b_espn_team_id: 2,
    team_b_owner_id: "owner-2",
    acting_member_key: null,
    items: [],
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    year: 2026,
    transaction_id: "tx-1",
    transaction_type: "FREEAGENT",
    scoring_period_id: 148,
    week: 21,
    proposed_date: 1756400000000,
    espn_team_id: 1,
    owner_id: "owner-1",
    acting_member_key: null,
    status: "EXECUTED",
    is_league_manager: false,
    related_transaction_id: null,
    bid_amount: 0,
    items: [],
    ...overrides,
  };
}

function makeMatchup(overrides: Partial<Matchup> = {}): Matchup {
  return {
    year: 2026,
    week: 21,
    matchup_id: 1,
    playoff_tier: null,
    winner: "HOME",
    home: { owner_id: "owner-1", espn_team_id: 1, score: 172.4 },
    away: { owner_id: "owner-2", espn_team_id: 2, score: 134.8 },
    ...overrides,
  };
}

const NO_BOX_SCORES: BoxScoreEntry[] = [];

function feed(overrides: Partial<BuildActivityFeedArgs> = {}) {
  return buildActivityFeed({
    season: SEASON,
    scope: "matchup",
    matchups: [],
    teams: TEAMS,
    owners: OWNERS,
    players: PLAYERS,
    transactions: [],
    trades: [],
    boxScores: NO_BOX_SCORES,
    achievements: null,
    ...overrides,
  });
}

describe("parseStoredScope", () => {
  it("defaults to matchup and only accepts season as the alternative", () => {
    expect(parseStoredScope(null)).toBe("matchup");
    expect(parseStoredScope("season")).toBe("season");
    expect(parseStoredScope("garbage")).toBe("matchup");
  });
});

describe("parseStoredFilters", () => {
  it("defaults to all kinds when nothing is stored", () => {
    expect(parseStoredFilters(null)).toEqual(ALL_EVENT_KINDS);
  });

  it("keeps only valid kinds from stored JSON", () => {
    expect(parseStoredFilters(JSON.stringify(["trade", "matchup", "bogus"]))).toEqual(["trade", "matchup"]);
  });

  it("respects an intentionally empty selection", () => {
    expect(parseStoredFilters(JSON.stringify([]))).toEqual([]);
  });

  it("falls back to all kinds on malformed JSON", () => {
    expect(parseStoredFilters("{not json")).toEqual(ALL_EVENT_KINDS);
  });
});

describe("currentSeason", () => {
  it("prefers the in-progress season over newer finals", () => {
    const seasons = [makeSeason({ year: 2025, status: "final" }), makeSeason({ year: 2026, status: "in_progress" })];
    expect(currentSeason(seasons)?.year).toBe(2026);
  });

  it("falls back to the newest final season in the offseason", () => {
    const seasons = [makeSeason({ year: 2024, status: "final" }), makeSeason({ year: 2025, status: "final" })];
    expect(currentSeason(seasons)?.year).toBe(2025);
  });
});

describe("buildActivityFeed — trades", () => {
  const trade = makeTrade({
    items: [
      {
        player_id: 101,
        item_type: "TRADE",
        from_espn_team_id: 1,
        to_espn_team_id: 2,
        from_lineup_slot_id: null,
        to_lineup_slot_id: null,
        source: "ledger",
      },
      {
        player_id: 102,
        item_type: "TRADE",
        from_espn_team_id: 2,
        to_espn_team_id: 1,
        from_lineup_slot_id: null,
        to_lineup_slot_id: null,
        source: "ledger",
      },
    ],
  });
  // The trade's week comes from the ledger, not trades.json.
  const ledger = makeTransaction({
    transaction_type: "TRADE_UPHOLD",
    transaction_id: "uphold-1",
    related_transaction_id: "prop-1",
    week: 21,
  });

  it("groups the exchange by side and resolves player names", () => {
    const result = feed({ trades: [trade], transactions: [ledger] });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].outPlayers).toEqual([{ playerId: 101, name: "Corbin Carroll" }]);
    expect(result.trades[0].inPlayers).toEqual([{ playerId: 102, name: "Bobby Witt Jr." }]);
    expect(result.trades[0].week).toBe(21);
  });

  it("tolerates a player id that resolves to nothing", () => {
    const orphan = makeTrade({
      items: [
        {
          player_id: 9999,
          item_type: "TRADE",
          from_espn_team_id: 1,
          to_espn_team_id: 2,
          from_lineup_slot_id: null,
          to_lineup_slot_id: null,
          source: "ledger",
        },
      ],
    });
    const result = feed({ trades: [orphan], transactions: [ledger] });
    expect(result.trades[0].outPlayers[0].name).toBe("Unknown player");
  });

  it("hides other weeks from matchup scope but shows them for the season", () => {
    const early = makeTrade({
      trade_id: "prop-2",
      items: [
        {
          player_id: 101,
          item_type: "TRADE",
          from_espn_team_id: 1,
          to_espn_team_id: 2,
          from_lineup_slot_id: null,
          to_lineup_slot_id: null,
          source: "ledger",
        },
      ],
    });
    const earlyLedger = makeTransaction({ transaction_id: "uphold-2", related_transaction_id: "prop-2", week: 5 });
    const result = feed({ trades: [trade, early], transactions: [ledger, earlyLedger] });
    expect(result.trades).toHaveLength(1);
    const seasonResult = feed({ scope: "season", trades: [trade, early], transactions: [ledger, earlyLedger] });
    expect(seasonResult.trades).toHaveLength(2);
  });

  it("keeps the unrecorded trade in season scope but not matchup scope", () => {
    const unrecorded = makeTrade({ trade_id: "prop-3", items: [] });
    expect(feed({ trades: [unrecorded] }).trades).toHaveLength(0);
    expect(feed({ scope: "season", trades: [unrecorded] }).trades).toHaveLength(1);
  });
});

describe("buildActivityFeed — free agent moves", () => {
  const move = makeTransaction({
    items: [
      {
        player_id: 101,
        item_type: "ADD",
        from_espn_team_id: null,
        to_espn_team_id: 1,
        from_lineup_slot_id: null,
        to_lineup_slot_id: null,
      },
      {
        player_id: 102,
        item_type: "DROP",
        from_espn_team_id: 1,
        to_espn_team_id: null,
        from_lineup_slot_id: null,
        to_lineup_slot_id: null,
      },
      {
        player_id: 101,
        item_type: "LINEUP",
        from_espn_team_id: 1,
        to_espn_team_id: 1,
        from_lineup_slot_id: 2,
        to_lineup_slot_id: 5,
      },
    ],
  });

  it("emits add/drop rows and skips lineup bookkeeping", () => {
    const result = feed({ transactions: [move] });
    expect(result.fas.map(e => e.action)).toEqual(["added", "dropped"]);
    expect(result.fas[0].playerName).toBe("Corbin Carroll");
  });

  it("excludes canceled and pending rows", () => {
    const canceled = makeTransaction({
      transaction_id: "tx-2",
      status: "CANCELED",
      items: [
        {
          player_id: 101,
          item_type: "ADD",
          from_espn_team_id: null,
          to_espn_team_id: 1,
          from_lineup_slot_id: null,
          to_lineup_slot_id: null,
        },
      ],
    });
    const result = feed({ transactions: [move, canceled] });
    expect(result.fas).toHaveLength(2);
  });

  it("shows preseason rows (week null) in season scope only", () => {
    const preseason = makeTransaction({
      transaction_id: "tx-3",
      week: null,
      items: [
        {
          player_id: 101,
          item_type: "ADD",
          from_espn_team_id: null,
          to_espn_team_id: 1,
          from_lineup_slot_id: null,
          to_lineup_slot_id: null,
        },
      ],
    });
    expect(feed({ transactions: [preseason] }).fas).toHaveLength(0);
    expect(feed({ scope: "season", transactions: [preseason] }).fas).toHaveLength(1);
  });
});

describe("buildActivityFeed — matchups", () => {
  it("names sides via teams.json and links to the matchup", () => {
    const result = feed({ matchups: [makeMatchup()] });
    expect(result.matchups).toHaveLength(1);
    expect(result.matchups[0].winnerName).toBe("Dynasties");
    expect(result.matchups[0].loserName).toBe("Stonk Market");
    expect(result.matchups[0].winnerScore).toBeCloseTo(172.4);
  });

  it("skips undecided and tied matchups", () => {
    const result = feed({
      matchups: [
        makeMatchup({ matchup_id: 2, winner: "UNDECIDED" }),
        makeMatchup({ matchup_id: 3, winner: "TIE" }),
        makeMatchup({ matchup_id: 4 }),
      ],
    });
    expect(result.matchups.map(m => m.matchupId)).toEqual([4]);
  });
});

describe("buildActivityFeed — IL moves", () => {
  const placed = makeTransaction({
    transaction_id: "tx-il-1",
    items: [
      {
        player_id: 101,
        item_type: "LINEUP",
        from_espn_team_id: 1,
        to_espn_team_id: 1,
        from_lineup_slot_id: 14,
        to_lineup_slot_id: 17,
      },
    ],
  });
  const activated = makeTransaction({
    transaction_id: "tx-il-2",
    items: [
      {
        player_id: 102,
        item_type: "LINEUP",
        from_espn_team_id: 1,
        to_espn_team_id: 1,
        from_lineup_slot_id: 17,
        to_lineup_slot_id: 16,
      },
    ],
  });

  it("emits placed/activated rows from LINEUP items touching the IR slot", () => {
    const result = feed({ transactions: [placed, activated] });
    expect(result.ils.map(e => e.action)).toEqual(["placed", "activated"]);
    expect(result.ils[0].playerName).toBe("Corbin Carroll");
    expect(result.ils[1].playerName).toBe("Bobby Witt Jr.");
  });

  it("keeps drops of an IL-stashed player in the FA category, not IL", () => {
    const droppedFromIl = makeTransaction({
      transaction_id: "tx-il-3",
      items: [
        {
          player_id: 101,
          item_type: "DROP",
          from_espn_team_id: 1,
          to_espn_team_id: null,
          from_lineup_slot_id: 17,
          to_lineup_slot_id: null,
        },
      ],
    });
    const result = feed({ transactions: [droppedFromIl] });
    expect(result.ils).toHaveLength(0);
    expect(result.fas).toHaveLength(1);
    expect(result.fas[0].action).toBe("dropped");
  });

  it("ignores ordinary LINEUP start/sit shuffling", () => {
    const benchSwap = makeTransaction({
      transaction_id: "tx-il-4",
      items: [
        {
          player_id: 101,
          item_type: "LINEUP",
          from_espn_team_id: 1,
          to_espn_team_id: 1,
          from_lineup_slot_id: 16,
          to_lineup_slot_id: 14,
        },
      ],
    });
    expect(feed({ transactions: [benchSwap] }).ils).toHaveLength(0);
  });

  it("hides other weeks from matchup scope", () => {
    const early = makeTransaction({
      transaction_id: "tx-il-5",
      week: 5,
      items: [
        {
          player_id: 101,
          item_type: "LINEUP",
          from_espn_team_id: 1,
          to_espn_team_id: 1,
          from_lineup_slot_id: 14,
          to_lineup_slot_id: 17,
        },
      ],
    });
    expect(feed({ transactions: [early] }).ils).toHaveLength(0);
    expect(feed({ scope: "season", transactions: [early] }).ils).toHaveLength(1);
  });
});

describe("parseStoredOwnerFilter", () => {
  it("treats null and empty string as all owners", () => {
    expect(parseStoredOwnerFilter(null)).toBeNull();
    expect(parseStoredOwnerFilter("")).toBeNull();
  });

  it("passes stored owner ids through", () => {
    expect(parseStoredOwnerFilter("owner-1")).toBe("owner-1");
  });
});

describe("filterFeedByOwner", () => {
  const trade = makeTrade({
    items: [
      {
        player_id: 101,
        item_type: "TRADE",
        from_espn_team_id: 1,
        to_espn_team_id: 2,
        from_lineup_slot_id: null,
        to_lineup_slot_id: null,
        source: "ledger",
      },
    ],
  });
  const ledger = makeTransaction({
    transaction_type: "TRADE_UPHOLD",
    transaction_id: "uphold-1",
    related_transaction_id: "prop-1",
    week: 21,
  });
  const full = feed({ trades: [trade], transactions: [ledger], matchups: [makeMatchup()] });

  it("keeps trades the owner is on either side of", () => {
    expect(filterFeedByOwner(full, "owner-1").trades).toHaveLength(1);
    expect(filterFeedByOwner(full, "owner-2").trades).toHaveLength(1);
    expect(filterFeedByOwner(full, "owner-3").trades).toHaveLength(0);
  });

  it("keeps matchups the owner played", () => {
    expect(filterFeedByOwner(full, "owner-1").matchups).toHaveLength(1);
    expect(filterFeedByOwner(full, "owner-3").matchups).toHaveLength(0);
  });

  it("passes the feed through unchanged for the all-owners case", () => {
    expect(filterFeedByOwner(full, null)).toBe(full);
  });
});

describe("buildActivityFeed — achievements", () => {
  const shutoutWeek: BoxScoreEntry[] = [
    {
      year: 2026,
      week: 21,
      matchup_id: 1,
      owner_id: "owner-1",
      espn_team_id: 1,
      player_id: 201,
      player_name: "Tarik Skubal",
      total_points: 62.3,
      batting: null,
      pitching: {
        outs: 27,
        h: 3,
        r: 0,
        er: 0,
        bb: 1,
        hb: 0,
        k: 11,
        wins: 1,
        losses: 0,
        sv: 0,
        bs: 0,
        hd: 0,
        sho: 1,
        nh: 0,
        pg: 0,
      },
      slots: [{ scoring_period: 148, lineup_slot_id: 14, points: 62.3, raw_stats: { "34": 27, "48": 11 } }],
    },
  ];

  it("derives shutouts and weekly leaders when stat lines are covered", () => {
    const result = feed({ boxScores: shutoutWeek });
    expect(result.achievements.some(a => a.label === "throws a shutout")).toBe(true);
    // Single-appearance weeks don't say the count; no IP anywhere.
    expect(result.achievements.some(a => a.detail === "11 K")).toBe(true);
    expect(result.achievements.some(a => a.label === "leads the league with 62.3 points")).toBe(true);
    expect(result.achievements.some(a => a.label === "leads in strikeouts with 11" && a.detail === null)).toBe(true);
  });

  it("says the starts count only for multi-start weeks", () => {
    const twoStartWeek: BoxScoreEntry[] = [
      {
        year: 2026,
        week: 21,
        matchup_id: 1,
        owner_id: "owner-2",
        espn_team_id: 2,
        player_id: 202,
        player_name: "Jesus Luzardo",
        total_points: 40.6,
        batting: null,
        pitching: {
          outs: 42,
          h: 4,
          r: 0,
          er: 0,
          bb: 6,
          hb: 0,
          k: 18,
          wins: 2,
          losses: 0,
          sv: 0,
          bs: 0,
          hd: 0,
          sho: 0,
          nh: 0,
          pg: 0,
        },
        slots: [
          { scoring_period: 154, lineup_slot_id: 16, points: 20.3, raw_stats: { "34": 21, "48": 9 } },
          { scoring_period: 155, lineup_slot_id: 14, points: 20.3, raw_stats: { "34": 21, "48": 9 } },
        ],
      },
    ];
    const result = feed({ boxScores: twoStartWeek });
    expect(result.achievements.some(a => a.label === "leads in strikeouts with 18" && a.detail === "2 starts")).toBe(true);
    expect(result.achievements.every(a => !a.label.includes("IP") && !(a.detail ?? "").includes("IP"))).toBe(true);
  });

  it("stays empty when the season lacks stat-line coverage", () => {
    const result = feed({
      boxScores: shutoutWeek,
      season: makeSeason({ coverage: { ...SEASON.coverage, stat_lines: "missing" } }),
    });
    expect(result.achievements).toEqual([]);
  });

  it("scopes to the current week in matchup scope", () => {
    const otherWeek: BoxScoreEntry[] = [{ ...shutoutWeek[0], week: 20, player_id: 202 }];
    const result = feed({ boxScores: [...shutoutWeek, ...otherWeek] });
    expect(result.achievements.every(a => a.week === 21)).toBe(true);
    const seasonResult = feed({ scope: "season", boxScores: [...shutoutWeek, ...otherWeek] });
    expect(seasonResult.achievements.some(a => a.week === 20)).toBe(true);
  });
});

describe("buildActivityFeed — trophies", () => {
  const memberKey = "0123456789abcdef";

  function makeTrophyRecord(overrides: Partial<TrophyRecord> = {}): TrophyRecord {
    return {
      year: 2026,
      member_key: memberKey,
      owner_id: "owner-1",
      espn_team_id: 1,
      trophies: Array.from({ length: 20 }, (_, slot) => ({ slot, earned: false })),
      ...overrides,
    };
  }

  it("emits no trophy rows while the slot→name mapping is pending", () => {
    const earned = makeTrophyRecord({
      trophies: Array.from({ length: 20 }, (_, slot) => ({ slot, earned: slot === 7 })),
    });
    const result = feed({ scope: "season", achievements: [earned] });
    expect(result.trophies).toEqual([]);
  });

  it("emits a named row for an earned slot once the mapping knows it", () => {
    const earned = makeTrophyRecord({
      trophies: Array.from({ length: 20 }, (_, slot) => ({ slot, earned: slot === 7 })),
    });
    const result = feed({ scope: "season", achievements: [earned], trophyNames: { 7: "No Mercy" } });
    expect(result.trophies).toEqual([
      {
        id: `trophy-2026-${memberKey}-7`,
        kind: "trophy",
        year: 2026,
        ownerId: "owner-1",
        espnTeamId: 1,
        trophySlot: 7,
        trophyName: "No Mercy",
      },
    ]);
    expect(trophyNameForSlot(7, { 7: "No Mercy" })).toBe("No Mercy");
    expect(trophyNameForSlot(7, {})).toBeNull();
  });

  it("skips records whose owner or team didn't resolve", () => {
    const unresolved = makeTrophyRecord({
      owner_id: null,
      trophies: Array.from({ length: 20 }, (_, slot) => ({ slot, earned: slot === 0 })),
    });
    const result = feed({ scope: "season", achievements: [unresolved] });
    expect(result.trophies).toEqual([]);
  });

  it("ignores records from other seasons and uncovered seasons", () => {
    const earnedElsewhere = makeTrophyRecord({ year: 2025 });
    const uncoveredSeason = makeSeason({ coverage: { ...SEASON.coverage, achievements: "missing" } });
    const result = feed({ scope: "season", achievements: [earnedElsewhere] });
    expect(result.trophies).toEqual([]);
    const resultUncovered = feed({
      scope: "season",
      season: uncoveredSeason,
      achievements: [makeTrophyRecord()],
    });
    expect(resultUncovered.trophies).toEqual([]);
  });

  it("excludes trophies from the matchup-scope window entirely", () => {
    const earned = makeTrophyRecord({
      trophies: Array.from({ length: 20 }, (_, slot) => ({ slot, earned: slot === 7 })),
    });
    const result = feed({ scope: "matchup", achievements: [earned] });
    expect(result.trophies).toEqual([]);
  });
});
