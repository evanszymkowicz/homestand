import { describe, expect, it } from "vitest";
import { getLongestKeptSameOwner, getLongestKeptSameTeamSlot } from "./keepers";
import {
  getKeeperSource,
  getOwnerKeeperHistory,
  getOwnerKeeperHistoryByPlayer,
  getOwnerKeeperStreakAndPoints,
  getOwnerKeeperTenureRows,
  getOwnerStreaks,
  getYearRuns,
  getYearSpan,
} from "./ownerHistory";
import type { DraftPick, Keeper, Owner, PlayerSeasonPoints, Season, Team, TeamRecord } from "../types";
import type { OwnerKeeperPlayerSummary } from "./ownerHistory";

const EMPTY_RECORD: TeamRecord = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };

function makeOwner(ownerId: string, name: string): Owner {
  return {
    owner_id: ownerId,
    canonical_name: name,
    team_names_by_year: {},
    espn_member_keys: [],
    co_owners: [],
    last_active_year: 0,
    absent_from_latest_season: false,
  };
}

function makeTeam(year: number, espnTeamId: number, ownerId: string): Team {
  return {
    year,
    espn_team_id: espnTeamId,
    owner_ids: [ownerId],
    primary_owner_id: ownerId,
    team_name: `Team ${espnTeamId}`,
    division_id: 1,
    final_rank: espnTeamId,
    playoff_seed: espnTeamId,
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

function makeKeeper(overrides: Partial<Keeper> & Pick<Keeper, "year" | "owner_id" | "player_id">): Keeper {
  return {
    espn_team_id: 1,
    player_name: `Player ${overrides.player_id}`,
    round_id: 1,
    overall_pick_number: 1,
    validated_on_prior_roster: true,
    pro_team_id: 1,
    ...overrides,
  };
}

function makePick(
  overrides: Partial<DraftPick> & Pick<DraftPick, "year" | "owner_id" | "player_id" | "overall_pick_number">
): DraftPick {
  return {
    round_id: 6,
    round_pick_number: overrides.overall_pick_number,
    espn_team_id: 1,
    keeper: false,
    traded_pick: false,
    traded_from_espn_team_id: null,
    pro_team_id: 1,
    player_name: `Player ${overrides.player_id}`,
    ...overrides,
  };
}

describe("getKeeperSource", () => {
  it("is 'draft' when the owner live-drafted the player at or before the keeper year", () => {
    const draftPicks = [makePick({ year: 2020, owner_id: "owner-1", player_id: 100, overall_pick_number: 60 })];
    const keeper = makeKeeper({ year: 2021, owner_id: "owner-1", player_id: 100 });
    expect(getKeeperSource("owner-1", keeper, [], draftPicks, [])).toBe("draft");
  });

  it("is 'waiver/trade' when no matching own live draft pick exists and no team handoff applies", () => {
    const draftPicks = [makePick({ year: 2020, owner_id: "owner-2", player_id: 100, overall_pick_number: 60 })];
    const keeper = makeKeeper({ year: 2021, owner_id: "owner-1", player_id: 100 });
    expect(getKeeperSource("owner-1", keeper, [], draftPicks, [])).toBe("waiver/trade");
  });

  it("ignores keeper-round picks (round_id<=5, keeper=true) as a source of 'draft'", () => {
    const draftPicks = [
      makePick({ year: 2020, owner_id: "owner-1", player_id: 100, overall_pick_number: 3, round_id: 1, keeper: true }),
    ];
    const keeper = makeKeeper({ year: 2021, owner_id: "owner-1", player_id: 100 });
    expect(getKeeperSource("owner-1", keeper, [], draftPicks, [])).toBe("waiver/trade");
  });

  it("ignores a live draft pick in a later year than the keeper season", () => {
    const draftPicks = [makePick({ year: 2022, owner_id: "owner-1", player_id: 100, overall_pick_number: 60 })];
    const keeper = makeKeeper({ year: 2021, owner_id: "owner-1", player_id: 100 });
    expect(getKeeperSource("owner-1", keeper, [], draftPicks, [])).toBe("waiver/trade");
  });

  it("is 'inherited with team' when the owner took over the team slot and the player was already on its prior-year roster", () => {
    const teams = [makeTeam(2019, 10, "owner-old"), makeTeam(2020, 10, "owner-1")];
    const keeper = makeKeeper({
      year: 2020,
      owner_id: "owner-1",
      player_id: 100,
      espn_team_id: 10,
      validated_on_prior_roster: true,
    });
    expect(getKeeperSource("owner-1", keeper, [], [], teams)).toBe("inherited with team");
  });

  it("is 'waiver/trade' when the owner took over the team slot but the player wasn't on its prior-year roster", () => {
    const teams = [makeTeam(2019, 10, "owner-old"), makeTeam(2020, 10, "owner-1")];
    const keeper = makeKeeper({
      year: 2020,
      owner_id: "owner-1",
      player_id: 100,
      espn_team_id: 10,
      validated_on_prior_roster: false,
    });
    expect(getKeeperSource("owner-1", keeper, [], [], teams)).toBe("waiver/trade");
  });

  it("is 'waiver/trade', not 'inherited with team', for a charter owner who has always held the team slot", () => {
    const teams = [makeTeam(2019, 10, "owner-1"), makeTeam(2020, 10, "owner-1")];
    const keeper = makeKeeper({
      year: 2020,
      owner_id: "owner-1",
      player_id: 100,
      espn_team_id: 10,
      validated_on_prior_roster: true,
    });
    expect(getKeeperSource("owner-1", keeper, [], [], teams)).toBe("waiver/trade");
  });

  it("carries 'inherited with team' forward through every later year of an unbroken keeper streak, not just the handoff year", () => {
    const teams = [makeTeam(2019, 10, "owner-old"), makeTeam(2020, 10, "owner-1"), makeTeam(2021, 10, "owner-1")];
    const keepers = [
      makeKeeper({
        year: 2020,
        owner_id: "owner-1",
        player_id: 100,
        espn_team_id: 10,
        validated_on_prior_roster: true,
      }),
      makeKeeper({
        year: 2021,
        owner_id: "owner-1",
        player_id: 100,
        espn_team_id: 10,
        validated_on_prior_roster: true,
      }),
    ];
    // owner-1 already owned the slot in 2020 too, so a naive year-over-year
    // check on the 2021 record alone would wrongly see no handoff.
    expect(getKeeperSource("owner-1", keepers[1], keepers, [], teams)).toBe("inherited with team");
  });

  it("treats a gap year as breaking the streak, so re-acquiring the player afterward is evaluated fresh", () => {
    const teams = [
      makeTeam(2019, 10, "owner-old"),
      makeTeam(2020, 10, "owner-1"),
      makeTeam(2021, 10, "owner-1"),
      makeTeam(2022, 10, "owner-1"),
    ];
    const keepers = [
      makeKeeper({
        year: 2020,
        owner_id: "owner-1",
        player_id: 100,
        espn_team_id: 10,
        validated_on_prior_roster: true,
      }),
      // no 2021 keeper record -- not kept that year, so 2022 is a fresh acquisition, not a continuation.
      makeKeeper({
        year: 2022,
        owner_id: "owner-1",
        player_id: 100,
        espn_team_id: 10,
        validated_on_prior_roster: true,
      }),
    ];
    expect(getKeeperSource("owner-1", keepers[1], keepers, [], teams)).toBe("waiver/trade");
  });
});

describe("getOwnerKeeperHistory", () => {
  it("returns only this owner's keepers, most recent year first, tagged with source", () => {
    const draftPicks = [makePick({ year: 2019, owner_id: "owner-1", player_id: 100, overall_pick_number: 60 })];
    const keepers = [
      makeKeeper({ year: 2020, owner_id: "owner-1", player_id: 100, player_name: "Kept Own" }),
      makeKeeper({ year: 2021, owner_id: "owner-1", player_id: 200, player_name: "Kept Traded" }),
      makeKeeper({ year: 2021, owner_id: "owner-2", player_id: 300, player_name: "Not This Owner" }),
    ];

    const history = getOwnerKeeperHistory("owner-1", keepers, draftPicks, []);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ year: 2021, playerId: 200, source: "waiver/trade" });
    expect(history[1]).toMatchObject({ year: 2020, playerId: 100, source: "draft" });
  });

  it("tags a keeper 'inherited with team' when this owner took over the team slot", () => {
    const teams = [makeTeam(2020, 10, "owner-old"), makeTeam(2021, 10, "owner-1")];
    const keepers = [
      makeKeeper({
        year: 2021,
        owner_id: "owner-1",
        player_id: 100,
        player_name: "Inherited",
        espn_team_id: 10,
        validated_on_prior_roster: true,
      }),
    ];

    const history = getOwnerKeeperHistory("owner-1", keepers, [], teams);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ playerId: 100, source: "inherited with team" });
  });

  it("tags every year of a multi-year inherited streak, not just the handoff year", () => {
    const teams = [makeTeam(2019, 10, "owner-old"), makeTeam(2020, 10, "owner-1"), makeTeam(2021, 10, "owner-1")];
    const keepers = [
      makeKeeper({
        year: 2020,
        owner_id: "owner-1",
        player_id: 100,
        player_name: "Inherited",
        espn_team_id: 10,
        validated_on_prior_roster: true,
      }),
      makeKeeper({
        year: 2021,
        owner_id: "owner-1",
        player_id: 100,
        player_name: "Inherited",
        espn_team_id: 10,
        validated_on_prior_roster: true,
      }),
    ];

    const history = getOwnerKeeperHistory("owner-1", keepers, [], teams);
    expect(history).toHaveLength(2);
    expect(history.every(h => h.source === "inherited with team")).toBe(true);
  });
});

describe("getOwnerKeeperHistoryByPlayer", () => {
  it("collapses to one row per player with all years, distinct sources, and summed points", () => {
    const draftPicks = [makePick({ year: 2019, owner_id: "owner-1", player_id: 100, overall_pick_number: 60 })];
    const keepers = [
      makeKeeper({ year: 2020, owner_id: "owner-1", player_id: 100, player_name: "Long Keeper" }),
      makeKeeper({ year: 2021, owner_id: "owner-1", player_id: 100, player_name: "Long Keeper" }),
      makeKeeper({ year: 2023, owner_id: "owner-1", player_id: 100, player_name: "Long Keeper" }),
      makeKeeper({ year: 2021, owner_id: "owner-1", player_id: 200, player_name: "One-Timer" }),
      makeKeeper({ year: 2021, owner_id: "owner-2", player_id: 300, player_name: "Not This Owner" }),
    ];
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2020, player_id: 100, player_name: "Long Keeper", points: 100 },
      { year: 2021, player_id: 100, player_name: "Long Keeper", points: 50.5 },
      { year: 2022, player_id: 100, player_name: "Long Keeper", points: 999 }, // not a keeper year, must not count
      { year: 2023, player_id: 100, player_name: "Long Keeper", points: 10 },
    ];

    const summaries = getOwnerKeeperHistoryByPlayer("owner-1", keepers, draftPicks, seasonPoints, []);
    expect(summaries).toHaveLength(2);
    // Most recent keeper year first.
    expect(summaries[0]).toMatchObject({
      playerId: 100,
      years: [2020, 2021, 2023],
      sources: ["draft"],
      points: 160.5,
    });
    expect(summaries[1]).toMatchObject({ playerId: 200, years: [2021], sources: ["waiver/trade"], points: 0 });
  });
});

describe("getYearRuns", () => {
  it("compresses consecutive years into runs and leaves gaps as separate segments", () => {
    expect(getYearRuns([2019, 2020, 2021, 2023, 2025])).toEqual([
      { start: 2019, end: 2021 },
      { start: 2023, end: 2023 },
      { start: 2025, end: 2025 },
    ]);
    expect(getYearRuns([])).toEqual([]);
  });
});

describe("getYearSpan", () => {
  it("returns the first and last year regardless of gaps", () => {
    expect(getYearSpan([2019, 2020, 2021, 2023, 2025])).toEqual({ start: 2019, end: 2025 });
    expect(getYearSpan([2020])).toEqual({ start: 2020, end: 2020 });
  });

  it("returns undefined for an empty list", () => {
    expect(getYearSpan([])).toBeUndefined();
  });
});

describe("getOwnerKeeperTenureRows", () => {
  const summary = (playerId: number, playerName: string, years: number[]): OwnerKeeperPlayerSummary => ({
    playerId,
    playerName,
    years,
    sources: ["draft"],
    points: 0,
  });

  it("splits a keeper's years into consecutive runs and records the longest run", () => {
    const rows = getOwnerKeeperTenureRows([summary(100, "Gappy", [2019, 2020, 2022])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      playerId: 100,
      longestRun: 2,
      runs: [
        { start: 2019, end: 2020 },
        { start: 2022, end: 2022 },
      ],
    });
  });

  it("sorts longest run first, then total years, then name", () => {
    const rows = getOwnerKeeperTenureRows([
      summary(1, "One Year", [2024]),
      summary(2, "Spread Out", [2019, 2021, 2023]), // three years, longest run 1
      summary(3, "Long Run", [2020, 2021, 2022, 2023]), // longest run 4
      summary(4, "Two And One", [2022, 2024, 2025]), // longest run 2, three years
    ]);
    expect(rows.map(r => r.playerName)).toEqual(["Long Run", "Two And One", "Spread Out", "One Year"]);
  });

  it("returns an empty list for no keepers", () => {
    expect(getOwnerKeeperTenureRows([])).toEqual([]);
  });
});

describe("getOwnerStreaks", () => {
  it("filters a league-wide same-owner streak list down to the ones this owner is part of", () => {
    const owners = [makeOwner("owner-1", "Owner One"), makeOwner("owner-2", "Owner Two")];
    const keepers = [
      makeKeeper({ year: 2020, owner_id: "owner-1", player_id: 100 }),
      makeKeeper({ year: 2021, owner_id: "owner-1", player_id: 100 }),
      makeKeeper({ year: 2020, owner_id: "owner-2", player_id: 200 }),
    ];
    const streaks = getLongestKeptSameOwner(keepers, owners);

    const owner1Streaks = getOwnerStreaks("owner-1", streaks);
    expect(owner1Streaks).toHaveLength(1);
    expect(owner1Streaks[0].playerId).toBe(100);
  });

  it("includes a same-team-slot streak the owner only partly held, with the transfer flag intact", () => {
    const owners = [makeOwner("owner-1", "Owner One"), makeOwner("owner-2", "Owner Two")];
    const keepers = [
      makeKeeper({ year: 2018, owner_id: "owner-1", player_id: 100, espn_team_id: 10 }),
      makeKeeper({ year: 2019, owner_id: "owner-2", player_id: 100, espn_team_id: 10 }),
    ];
    const streaks = getLongestKeptSameTeamSlot(keepers, owners);

    const owner1Streaks = getOwnerStreaks("owner-1", streaks);
    expect(owner1Streaks).toHaveLength(1);
    expect(owner1Streaks[0].ownershipTransferred).toBe(true);

    const owner2Streaks = getOwnerStreaks("owner-2", streaks);
    expect(owner2Streaks).toHaveLength(1);
    expect(owner2Streaks[0].playerId).toBe(100);
  });
});

describe("getOwnerKeeperStreakAndPoints", () => {
  it("extends the same-owner streak into an in-progress season, but excludes its points from the career total", () => {
    const owners = [makeOwner("owner-1", "Owner One")];
    const seasons: Pick<Season, "year" | "status">[] = [
      { year: 2024, status: "final" },
      { year: 2025, status: "final" },
      { year: 2026, status: "in_progress" },
    ];
    const keepers = [
      makeKeeper({ year: 2024, owner_id: "owner-1", player_id: 100 }),
      makeKeeper({ year: 2025, owner_id: "owner-1", player_id: 100 }),
      makeKeeper({ year: 2026, owner_id: "owner-1", player_id: 100 }),
    ];
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2024, player_id: 100, player_name: "Player 100", points: 100 },
      { year: 2025, player_id: 100, player_name: "Player 100", points: 100 },
      { year: 2026, player_id: 100, player_name: "Player 100", points: 999 }, // in-progress, must not count
    ];

    const { sameOwnerStreaks, keeperPoints, hasFinalKeeperSeason } = getOwnerKeeperStreakAndPoints(
      "owner-1",
      keepers,
      seasons,
      seasonPoints,
      owners
    );

    // The streak includes 2026 -- a keeper pick is a draft-time fact,
    // already true the moment the draft happens, not a partial total.
    expect(sameOwnerStreaks).toHaveLength(1);
    expect(sameOwnerStreaks[0].length).toBe(3);
    expect(sameOwnerStreaks[0].endYear).toBe(2026);

    // Career keeper points is a leaderboard total, still accumulating for
    // an in-progress season, so 2026's 999 points is excluded.
    expect(keeperPoints?.points).toBe(200);
    expect(keeperPoints?.keeperSeasons).toBe(3);
    expect(hasFinalKeeperSeason).toBe(true);
  });

  it("reports no final keeper season when every keeper on record is in an in-progress season", () => {
    const owners = [makeOwner("owner-1", "Owner One")];
    const seasons: Pick<Season, "year" | "status">[] = [{ year: 2026, status: "in_progress" }];
    const keepers = [makeKeeper({ year: 2026, owner_id: "owner-1", player_id: 100 })];
    const seasonPoints: PlayerSeasonPoints[] = [{ year: 2026, player_id: 100, player_name: "Player 100", points: 999 }];

    const { keeperPoints, hasFinalKeeperSeason } = getOwnerKeeperStreakAndPoints(
      "owner-1",
      keepers,
      seasons,
      seasonPoints,
      owners
    );

    // points is 0 because there's no *final* season to report a total from
    // yet -- not because the owner actually scored zero. Callers must gate
    // display on hasFinalKeeperSeason, not on keeperPoints.points/keeperSeasons
    // alone, or "0 points from 1 kept player" reads as a settled fact.
    expect(keeperPoints?.points).toBe(0);
    expect(keeperPoints?.keeperSeasons).toBe(1);
    expect(hasFinalKeeperSeason).toBe(false);
  });
});
