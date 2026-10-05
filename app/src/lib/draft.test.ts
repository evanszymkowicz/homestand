import { describe, expect, it } from "vitest";
import {
  getDraftSteals,
  getLiveDraftPicks,
  getLiveDraftYears,
  getMrIrrelevant,
  getPlayerDraftHistory,
  getPlayerSeasonPoints,
  getRenumberedBoardsByYear,
  renumberLiveRounds,
  searchPlayers,
} from "./draft";
import type { DraftStealEntry, MrIrrelevantEntry, RenumberedPick } from "./draft";
import type { DraftPick, Keeper, Player, PlayerSeasonPoints, Team, TeamRecord } from "../types";

const EMPTY_RECORD: TeamRecord = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };

function makeTeam(year: number, espnTeamId: number): Team {
  return {
    year,
    espn_team_id: espnTeamId,
    owner_ids: [`owner-${espnTeamId}`],
    primary_owner_id: `owner-${espnTeamId}`,
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

function makeTeams(year: number, count: number): Team[] {
  return Array.from({ length: count }, (_, i) => makeTeam(year, i + 1));
}

function makePick(overrides: Partial<DraftPick> & Pick<DraftPick, "year" | "overall_pick_number">): DraftPick {
  const teamCount = 10;
  const roundId = Math.floor((overrides.overall_pick_number - 1) / teamCount) + 1;
  return {
    round_id: roundId,
    round_pick_number: ((overrides.overall_pick_number - 1) % teamCount) + 1,
    espn_team_id: ((overrides.overall_pick_number - 1) % teamCount) + 1,
    owner_id: `owner-${((overrides.overall_pick_number - 1) % teamCount) + 1}`,
    player_id: overrides.overall_pick_number,
    player_name: `Player ${overrides.overall_pick_number}`,
    keeper: roundId <= 5,
    traded_pick: false,
    traded_from_espn_team_id: null,
    pro_team_id: 1,
    ...overrides,
  };
}

/** A normal 30-round, 10-team draft: rounds 1-5 kept, 6-30 live (250 picks). */
function makeNormalYearPicks(year: number): DraftPick[] {
  return Array.from({ length: 300 }, (_, i) => makePick({ year, overall_pick_number: i + 1 }));
}

describe("getLiveDraftPicks / renumberLiveRounds", () => {
  it("filters on the keeper field, not round_id, and renumbers starting at Round 1", () => {
    const picks = makeNormalYearPicks(2023);
    const live = getLiveDraftPicks(picks, 2023);
    expect(live).toHaveLength(250);
    expect(live.every(p => !p.keeper)).toBe(true);

    const renumbered = renumberLiveRounds(live, 10);
    expect(renumbered[0].live_round).toBe(1);
    expect(renumbered[0].live_overall_pick).toBe(1);
    expect(renumbered[renumbered.length - 1].live_round).toBe(25);
    expect(renumbered[renumbered.length - 1].live_overall_pick).toBe(250);
  });

  it("2009: every round-1-5 pick has keeper=false (the league's first draft), so all 300 picks are live across 30 rounds", () => {
    const picks = Array.from({ length: 300 }, (_, i) =>
      makePick({ year: 2009, overall_pick_number: i + 1, keeper: false })
    );
    const live = getLiveDraftPicks(picks, 2009);
    expect(live).toHaveLength(300);

    const renumbered = renumberLiveRounds(live, 10);
    expect(renumbered[renumbered.length - 1].live_round).toBe(30);
  });

  it("2019: the Acuna exception (round_id=5, keeper=false) is included in the live board", () => {
    const picks = makeNormalYearPicks(2019).map(p =>
      p.overall_pick_number === 45 ? { ...p, keeper: false, player_name: "Ronald Acuna Jr." } : p
    );
    const live = getLiveDraftPicks(picks, 2019);
    expect(live).toHaveLength(251);
    expect(live.some(p => p.player_name === "Ronald Acuna Jr.")).toBe(true);
  });

  it("2014: a short round (249 live picks) doesn't divide evenly by team count but still renumbers", () => {
    const picks = makeNormalYearPicks(2014).slice(0, 299);
    const live = getLiveDraftPicks(picks, 2014);
    expect(live).toHaveLength(249);

    const renumbered = renumberLiveRounds(live, 10);
    expect(renumbered[renumbered.length - 1].live_round).toBe(25);
    expect(renumbered[renumbered.length - 1].live_overall_pick).toBe(249);
  });
});

describe("getRenumberedBoardsByYear", () => {
  it("derives each year's team count from teams.json rather than assuming 10", () => {
    const picks = [...makeNormalYearPicks(2023)];
    const teams = makeTeams(2023, 10);
    const boards = getRenumberedBoardsByYear(picks, teams);
    expect(boards.get(2023)).toHaveLength(250);
  });
});

describe("getPlayerSeasonPoints", () => {
  const seasonPoints: PlayerSeasonPoints[] = [
    { year: 2023, player_id: 1, player_name: "Player 1", points: 42.5 },
    { year: 2024, player_id: 1, player_name: "Player 1", points: 10 },
  ];

  it("returns the points for the matching year/player", () => {
    expect(getPlayerSeasonPoints(seasonPoints, 2023, 1)).toBe(42.5);
  });

  it("returns null for a player with no season-points row on file, distinct from a real recorded 0.0", () => {
    expect(getPlayerSeasonPoints(seasonPoints, 2023, 999)).toBeNull();
  });
});

describe("getMrIrrelevant", () => {
  it("picks the last live pick of each year and flags a next-year keeper", () => {
    const picks2023 = renumberLiveRounds(getLiveDraftPicks(makeNormalYearPicks(2023), 2023), 10);
    const picks2024 = renumberLiveRounds(getLiveDraftPicks(makeNormalYearPicks(2024), 2024), 10);
    const boards = new Map([
      [2023, picks2023],
      [2024, picks2024],
    ]);
    const lastPick2023 = picks2023[picks2023.length - 1];
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2023, player_id: lastPick2023.player_id, player_name: lastPick2023.player_name, points: 3.5 },
    ];
    const keepers: Keeper[] = [
      {
        year: 2024,
        espn_team_id: 1,
        owner_id: "owner-1",
        player_id: lastPick2023.player_id,
        player_name: lastPick2023.player_name,
        round_id: 1,
        overall_pick_number: 1,
        validated_on_prior_roster: true,
        pro_team_id: 1,
      },
    ];

    const entries = getMrIrrelevant(boards, seasonPoints, keepers);
    expect(entries.map(e => e.year)).toEqual([2024, 2023]);
    const entry2023 = entries.find(e => e.year === 2023);
    expect(entry2023?.points).toBe(3.5);
    expect(entry2023?.keptNextYear).toBe(true);
    expect(entries.find(e => e.year === 2024)?.keptNextYear).toBe(false);
  });
});

describe("getDraftSteals", () => {
  it("ranks a late pick who outproduced the field as the top steal and an early bust at the bottom", () => {
    const live = renumberLiveRounds(getLiveDraftPicks(makeNormalYearPicks(2023), 2023), 10);
    const lastPick = live[live.length - 1];
    const firstPick = live[0];
    // Control group decreases gently with pick number (no ties); firstPick is
    // forced far below the whole field (a bust) and lastPick far above it
    // (a steal), so both extremes are unambiguous regardless of tie-breaking.
    const seasonPoints: PlayerSeasonPoints[] = live.map(p => {
      if (p.player_id === lastPick.player_id)
        return { year: 2023, player_id: p.player_id, player_name: p.player_name, points: 500 };
      if (p.player_id === firstPick.player_id)
        return { year: 2023, player_id: p.player_id, player_name: p.player_name, points: -50 };
      return {
        year: 2023,
        player_id: p.player_id,
        player_name: p.player_name,
        points: 100 - p.live_overall_pick * 0.01,
      };
    });
    const boards = new Map([[2023, live]]);

    const steals = getDraftSteals(boards, seasonPoints, []);
    expect(steals[0].pick.player_id).toBe(lastPick.player_id);
    expect(steals[0].rankGap).toBeGreaterThan(0);
    expect(steals[steals.length - 1].pick.player_id).toBe(firstPick.player_id);
    expect(steals[steals.length - 1].rankGap).toBeLessThan(0);
  });

  it("flags redraft status: kept beats redrafted, an earlier round improves, a later round declines, undrafted is gone", () => {
    const live2023 = renumberLiveRounds(getLiveDraftPicks(makeNormalYearPicks(2023), 2023), 10);
    const live2024 = renumberLiveRounds(getLiveDraftPicks(makeNormalYearPicks(2024), 2024), 10);
    const boards = new Map([
      [2023, live2023],
      [2024, live2024],
    ]);
    const keptPick = live2023[0];
    const improvedPick = live2023[25]; // round 3
    const declinedPick = live2023[35]; // round 4
    const undraftedPick = live2023[live2023.length - 1];

    const improvedTarget = live2024.find(p => p.live_round < improvedPick.live_round)!;
    const declinedTarget = live2024.find(p => p.live_round >= declinedPick.live_round)!;
    const seasonPoints: PlayerSeasonPoints[] = [];
    const keepers: Keeper[] = [
      {
        year: 2024,
        espn_team_id: 1,
        owner_id: "owner-1",
        player_id: keptPick.player_id,
        player_name: keptPick.player_name,
        round_id: 1,
        overall_pick_number: 1,
        validated_on_prior_roster: true,
        pro_team_id: 1,
      },
    ];
    const live2024WithSwaps = live2024
      // Drop the undrafted player from 2024 entirely -- the generated boards
      // reuse player ids across years, and "gone" requires a true absence.
      .filter(p => p.player_id !== undraftedPick.player_id)
      .map(p => {
        if (p.player_id === improvedTarget.player_id) return { ...p, player_id: improvedPick.player_id };
        if (p.player_id === declinedTarget.player_id) return { ...p, player_id: declinedPick.player_id };
        return p;
      });
    boards.set(2024, live2024WithSwaps);

    const steals = getDraftSteals(boards, seasonPoints, keepers);
    const byId = new Map(steals.filter(e => e.pick.year === 2023).map(e => [e.pick.player_id, e]));
    expect(byId.get(keptPick.player_id)?.redraftStatus).toBe("kept");
    expect(byId.get(improvedPick.player_id)?.redraftStatus).toBe("improved");
    expect(byId.get(declinedPick.player_id)?.redraftStatus).toBe("declined");
    expect(byId.get(undraftedPick.player_id)?.redraftStatus).toBe("gone");
  });
});

function makePlayer(playerId: number, fullName: string): Player {
  return {
    player_id: playerId,
    full_name: fullName,
    default_position_id: 1,
    eligible_slots: [],
    games_played_by_position: {},
    active: null,
    pro_team_id: null,
    jersey: null,
    droppable: null,
    seasons_seen: [],
    roster_days: 0,
  };
}

describe("searchPlayers", () => {
  const players: Player[] = [
    makePlayer(1, "Ronald Acuna Jr."),
    makePlayer(2, "Mike Trout"),
    makePlayer(3, "Never Drafted Guy"),
  ];

  it("returns nothing for an empty query", () => {
    expect(searchPlayers(players, "")).toEqual([]);
  });

  it("matches case-insensitively by substring", () => {
    const results = searchPlayers(players, "acu");
    expect(results).toEqual([{ playerId: 1, playerName: "Ronald Acuna Jr." }]);
  });

  it("includes a player with no draft_picks entry -- search covers every player, not just drafted ones", () => {
    const results = searchPlayers(players, "never drafted");
    expect(results).toEqual([{ playerId: 3, playerName: "Never Drafted Guy" }]);
  });

  it("caps results at the given limit", () => {
    const manyPlayers = Array.from({ length: 10 }, (_, i) => makePlayer(100 + i, `Common Name ${i}`));
    expect(searchPlayers(manyPlayers, "common", 3)).toHaveLength(3);
  });
});

describe("getLiveDraftYears", () => {
  it("returns years with a live (non-keeper) pick, ascending, excluding keeper-only years", () => {
    const draftPicks = [
      makePick({ year: 2019, overall_pick_number: 45, player_id: 1, keeper: false }),
      makePick({ year: 2021, overall_pick_number: 3, round_id: 1, player_id: 1, keeper: true }),
      makePick({ year: 2023, overall_pick_number: 10, player_id: 1, keeper: false }),
    ];
    expect(getLiveDraftYears(1, draftPicks)).toEqual([2019, 2023]);
  });

  it("returns an empty array for a player only ever kept, never live-drafted", () => {
    const draftPicks = [makePick({ year: 2021, overall_pick_number: 3, round_id: 1, player_id: 1, keeper: true })];
    expect(getLiveDraftYears(1, draftPicks)).toEqual([]);
  });

  it("returns an empty array for a player with no draft_picks entry at all", () => {
    expect(getLiveDraftYears(999, [])).toEqual([]);
  });
});

function makeRenumberedPick(
  overrides: Partial<RenumberedPick> & Pick<RenumberedPick, "year" | "player_id">
): RenumberedPick {
  return {
    ...makePick({ overall_pick_number: 1, ...overrides }),
    live_round: 1,
    live_overall_pick: 1,
    ...overrides,
  };
}

describe("getPlayerDraftHistory", () => {
  it("returns every draft_picks entry for the player, most recent first, tagged as kept or live", () => {
    const draftPicks = [
      makePick({ year: 2021, overall_pick_number: 3, round_id: 1, player_id: 42, owner_id: "owner-1", keeper: true }),
      makePick({ year: 2019, overall_pick_number: 61, round_id: 7, player_id: 42, owner_id: "owner-2", keeper: false }),
      makePick({ year: 2020, overall_pick_number: 900, player_id: 999, owner_id: "owner-3" }), // different player
    ];
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2019, player_id: 42, player_name: "Player 42", points: 12.5 },
      { year: 2021, player_id: 42, player_name: "Player 42", points: 30 },
    ];

    const history = getPlayerDraftHistory(42, draftPicks, seasonPoints, [], []);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ year: 2021, isKeeper: true, ownerId: "owner-1", points: 30 });
    expect(history[1]).toMatchObject({ year: 2019, isKeeper: false, ownerId: "owner-2", points: 12.5 });
    expect(history[1].isMrIrrelevant).toBe(false);
    expect(history[1].redraftStatus).toBeNull();
    expect(history[1].valueLabel).toBeNull();
  });

  it("returns an empty history for a player never drafted", () => {
    expect(getPlayerDraftHistory(12345, [], [], [], [])).toEqual([]);
  });

  it("flags the live-pick row that was that year's Mr. Irrelevant", () => {
    const draftPicks = [makePick({ year: 2023, overall_pick_number: 300, round_id: 30, player_id: 42, keeper: false })];
    const mrIrrelevantEntries: MrIrrelevantEntry[] = [
      { year: 2023, pick: makeRenumberedPick({ year: 2023, player_id: 42 }), points: 3.5, keptNextYear: false },
    ];

    const history = getPlayerDraftHistory(42, draftPicks, [], mrIrrelevantEntries, []);
    expect(history[0].isMrIrrelevant).toBe(true);
  });

  it("carries redraftStatus and rankGap from the matching draftSteals entry, and labels top/bottom entries steal/bust", () => {
    const draftPicks = [makePick({ year: 2023, overall_pick_number: 200, round_id: 20, player_id: 42, keeper: false })];
    // 20 steals-leaderboard entries; player 42 sits at index 2 (top DRAFT_VALUE_LEADERBOARD_SIZE -> "steal").
    const draftSteals: DraftStealEntry[] = Array.from({ length: 20 }, (_, i) => ({
      pick: makeRenumberedPick({ year: 2023, player_id: i === 2 ? 42 : 1000 + i }),
      points: 100 - i,
      rankGap: 20 - i,
      redraftStatus: i === 2 ? "improved" : "declined",
    }));

    const history = getPlayerDraftHistory(42, draftPicks, [], [], draftSteals);
    expect(history[0].redraftStatus).toBe("improved");
    expect(history[0].rankGap).toBe(18);
    expect(history[0].valueLabel).toBe("steal");
  });

  it("labels a bottom-of-leaderboard entry as a bust", () => {
    const draftPicks = [makePick({ year: 2023, overall_pick_number: 1, round_id: 1, player_id: 42, keeper: false })];
    const draftSteals: DraftStealEntry[] = Array.from({ length: 20 }, (_, i) => ({
      pick: makeRenumberedPick({ year: 2023, player_id: i === 18 ? 42 : 1000 + i }),
      points: 100 - i,
      rankGap: 20 - i,
      redraftStatus: "declined",
    }));

    const history = getPlayerDraftHistory(42, draftPicks, [], [], draftSteals);
    expect(history[0].valueLabel).toBe("bust");
  });

  it("leaves valueLabel null for a middle-of-the-pack entry", () => {
    const draftPicks = [makePick({ year: 2023, overall_pick_number: 1, round_id: 1, player_id: 42, keeper: false })];
    // 40 entries: index 20 is outside both the top-15 and bottom-15 cutoffs.
    const draftSteals: DraftStealEntry[] = Array.from({ length: 40 }, (_, i) => ({
      pick: makeRenumberedPick({ year: 2023, player_id: i === 20 ? 42 : 1000 + i }),
      points: 100 - i,
      rankGap: 40 - i,
      redraftStatus: "declined",
    }));

    const history = getPlayerDraftHistory(42, draftPicks, [], [], draftSteals);
    expect(history[0].valueLabel).toBeNull();
  });
});
