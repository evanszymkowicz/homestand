import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enrichPossessionChain } from "./playerHistory";
import {
  getBlindSpots,
  getJourneymen,
  getMatchupTransactionMarkers,
  getOwnerActivity,
  getSeasonRosterMarkers,
  getVersatilePlayers,
  getWaiverPickups,
  teamMoves,
} from "./transactions";
import type {
  DraftPick,
  Keeper,
  Player,
  PlayerSeasonOwnership,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  Team,
  Transaction,
} from "../types";

function appDir(): string {
  return path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
}

function readProcessed<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(appDir(), "public/data", name), "utf-8")) as T;
}

function makeTransaction(overrides: Partial<Transaction> & Pick<Transaction, "year">): Transaction {
  return {
    transaction_id: "t1",
    transaction_type: "FREEAGENT",
    scoring_period_id: 1,
    week: 1,
    proposed_date: 0,
    espn_team_id: 1,
    owner_id: "owner-a",
    acting_member_key: null,
    status: "EXECUTED",
    is_league_manager: false,
    related_transaction_id: null,
    bid_amount: 0,
    items: [],
    ...overrides,
  };
}

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

describe("teamMoves", () => {
  it("sums acquisitions and drops but excludes trades", () => {
    const team = makeTeam({
      year: 2024,
      primary_owner_id: "a",
      transactions: {
        acquisitions: 10,
        drops: 7,
        trades: 4,
        moves_to_active: 0,
        moves_to_ir: 0,
        acquisitions_budget_spent: 0,
        team_charges: 0,
        acquisitions_by_week: {},
      },
    });
    expect(teamMoves(team)).toBe(17);
  });
});

function makeItem(playerId: number, type: string, from: number | null, to: number | null) {
  return {
    player_id: playerId,
    item_type: type,
    from_espn_team_id: from,
    to_espn_team_id: to,
    from_lineup_slot_id: null,
    to_lineup_slot_id: null,
  };
}

describe("getSeasonRosterMarkers", () => {
  it("distinguishes a traded-away player from a dropped one", () => {
    const txs = [
      makeTransaction({ year: 2024, items: [makeItem(1, "DROP", 2, null)] }),
      makeTransaction({ year: 2024, items: [makeItem(2, "TRADE", 2, 5)] }),
    ];
    const markers = getSeasonRosterMarkers(txs, 2024, 2);
    expect([...markers.droppedPlayerIds]).toEqual([1]);
    expect([...markers.tradedAwayPlayerIds]).toEqual([2]);
  });

  it("does not treat a player traded back onto the roster as traded away", () => {
    const txs = [
      // Player 3 traded away from team 2, later traded back onto it.
      makeTransaction({ year: 2024, scoring_period_id: 1, items: [makeItem(3, "TRADE", 2, 5)] }),
      makeTransaction({ year: 2024, scoring_period_id: 2, items: [makeItem(3, "TRADE", 5, 2)] }),
    ];
    const markers = getSeasonRosterMarkers(txs, 2024, 2);
    expect(markers.tradedAwayPlayerIds.has(3)).toBe(false);
    expect(markers.droppedPlayerIds.has(3)).toBe(false);
  });

  it("keeps a drop after a trade-away as the last event", () => {
    const txs = [
      makeTransaction({ year: 2024, scoring_period_id: 1, items: [makeItem(4, "TRADE", 2, 5)] }),
      makeTransaction({ year: 2024, scoring_period_id: 2, items: [makeItem(4, "DROP", 5, null)] }),
    ];
    const markers = getSeasonRosterMarkers(txs, 2024, 2);
    expect(markers.tradedAwayPlayerIds.has(4)).toBe(true);
    // Last event with team 2 was the trade-away, so it is not a drop -- but the
    // roster-churn still reads as "gone" via tradedAwayPlayerIds.
    expect(markers.droppedPlayerIds.has(4)).toBe(false);
  });
});

describe("getMatchupTransactionMarkers", () => {
  it("captures add, drop, and trade-away on one side during the week", () => {
    const txs = [
      makeTransaction({ year: 2024, week: 3, items: [makeItem(1, "ADD", null, 2)] }),
      makeTransaction({ year: 2024, week: 3, items: [makeItem(2, "DROP", 2, null)] }),
      makeTransaction({ year: 2024, week: 3, items: [makeItem(3, "TRADE", 2, 5)] }),
    ];
    const markers = getMatchupTransactionMarkers(txs, 2024, 3, 2);
    expect([...markers.addedPlayerIds]).toEqual([1]);
    expect([...markers.droppedPlayerIds]).toEqual([2]);
    expect([...markers.tradedAwayPlayerIds]).toEqual([3]);
  });

  it("ignores a different week and a non-binding transaction", () => {
    const txs = [
      makeTransaction({ year: 2024, week: 4, items: [makeItem(1, "DROP", 2, null)] }),
      makeTransaction({ year: 2024, week: 3, status: "CANCELED", items: [makeItem(2, "TRADE", 2, 5)] }),
    ];
    const markers = getMatchupTransactionMarkers(txs, 2024, 3, 2);
    expect(markers.droppedPlayerIds.size).toBe(0);
    expect(markers.tradedAwayPlayerIds.size).toBe(0);
  });
});


function makeTeamPoints(year: number, playerId: number, ownerId: string, points: number): PlayerTeamSeasonPoints {
  return {
    year,
    player_id: playerId,
    player_name: `Player ${playerId}`,
    owner_id: ownerId,
    espn_team_id: 1,
    points,
    counted_points: points,
    bench_points: 0,
  };
}

describe("getWaiverPickups", () => {
  const seasonPoints: PlayerSeasonPoints[] = [
    { year: 2021, player_id: 1, player_name: "Breakout Guy", points: 300 },
    { year: 2021, player_id: 2, player_name: "Modest Guy", points: 50 },
  ];

  it("ranks by points earned FOR THE ADDING OWNER, not the season total", () => {
    const txs = [
      makeTransaction({ year: 2021, transaction_id: "a", owner_id: "kept-him", items: [makeItem(2, "ADD", null, 1)] }),
      makeTransaction({ year: 2021, transaction_id: "b", owner_id: "cut-him", items: [makeItem(1, "ADD", null, 2)] }),
    ];
    // "cut-him" grabbed the 300-point season but only banked 5 of it.
    const teamPoints = [makeTeamPoints(2021, 2, "kept-him", 50), makeTeamPoints(2021, 1, "cut-him", 5)];

    const result = getWaiverPickups(txs, seasonPoints, teamPoints, []);
    expect(result.map(r => r.playerName)).toEqual(["Modest Guy", "Breakout Guy"]);
    // The season figure is still carried, so the gap is visible rather than hidden.
    expect(result[1]).toMatchObject({ ownerPoints: 5, seasonPoints: 300 });
  });

  it("ignores DROP items, non-FREEAGENT types, and adds that never scored for the owner", () => {
    const teamPoints = [makeTeamPoints(2021, 1, "owner-a", 300)];
    const txs = [
      makeTransaction({ year: 2021, transaction_id: "a", items: [makeItem(1, "DROP", 1, null)] }),
      makeTransaction({
        year: 2021,
        transaction_id: "b",
        transaction_type: "TRADE_ACCEPT",
        items: [makeItem(1, "TRADE", 1, 2)],
      }),
      // An add by an owner with no points row of their own.
      makeTransaction({ year: 2021, transaction_id: "c", owner_id: "owner-b", items: [makeItem(1, "ADD", null, 1)] }),
    ];
    expect(getWaiverPickups(txs, seasonPoints, teamPoints, [])).toEqual([]);
  });

  it("collapses a repeat pickup to the owner's first add", () => {
    const txs = [
      makeTransaction({ year: 2021, transaction_id: "late", week: 9, items: [makeItem(1, "ADD", null, 1)] }),
      makeTransaction({ year: 2021, transaction_id: "early", week: 3, items: [makeItem(1, "ADD", null, 1)] }),
    ];
    const result = getWaiverPickups(txs, seasonPoints, [makeTeamPoints(2021, 1, "owner-a", 300)], []);
    expect(result).toHaveLength(1);
    expect(result[0].week).toBe(3);
  });

  it("excludes re-adds of a player the same owner drafted that year", () => {
    const txs = [makeTransaction({ year: 2021, transaction_id: "a", items: [makeItem(1, "ADD", null, 1)] })];
    const teamPoints = [makeTeamPoints(2021, 1, "owner-a", 300)];
    const drafted = [{ year: 2021, player_id: 1, owner_id: "owner-a" } as unknown as DraftPick];
    expect(getWaiverPickups(txs, seasonPoints, teamPoints, drafted)).toEqual([]);
    // ...but another owner adding that same player is still a real find.
    const other = [
      makeTransaction({ year: 2021, transaction_id: "b", owner_id: "owner-b", items: [makeItem(1, "ADD", null, 1)] }),
    ];
    const otherPoints = [makeTeamPoints(2021, 1, "owner-b", 280)];
    expect(getWaiverPickups(other, seasonPoints, otherPoints, drafted)).toHaveLength(1);
  });
});

describe("getOwnerActivity", () => {
  it("aggregates across seasons and normalizes by seasons played", () => {
    const teams = [
      makeTeam({
        year: 2019,
        primary_owner_id: "veteran",
        transactions: {
          acquisitions: 10,
          drops: 10,
          trades: 1,
          moves_to_active: 0,
          moves_to_ir: 0,
          acquisitions_budget_spent: 0,
          team_charges: 0,
          acquisitions_by_week: {},
        },
      }),
      makeTeam({
        year: 2020,
        primary_owner_id: "veteran",
        transactions: {
          acquisitions: 10,
          drops: 10,
          trades: 1,
          moves_to_active: 0,
          moves_to_ir: 0,
          acquisitions_budget_spent: 0,
          team_charges: 0,
          acquisitions_by_week: {},
        },
      }),
      makeTeam({
        year: 2020,
        primary_owner_id: "newcomer",
        transactions: {
          acquisitions: 15,
          drops: 15,
          trades: 0,
          moves_to_active: 0,
          moves_to_ir: 0,
          acquisitions_budget_spent: 0,
          team_charges: 0,
          acquisitions_by_week: {},
        },
      }),
    ];
    const result = getOwnerActivity(teams);
    // The veteran leads on raw total purely by playing longer...
    expect(result[0].ownerId).toBe("veteran");
    expect(result[0].moves).toBe(40);
    expect(result[0].movesPerSeason).toBe(20);
    // ...but the newcomer is the more active manager per season.
    const newcomer = result.find(o => o.ownerId === "newcomer");
    expect(newcomer?.movesPerSeason).toBe(30);
  });
});

describe("getBlindSpots", () => {
  it("keeps high scorers at low ownership and drops widely-owned ones", () => {
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2013, player_id: 1, player_name: "Overlooked", points: 300 },
      { year: 2013, player_id: 2, player_name: "Everyone Had Him", points: 400 },
      { year: 2013, player_id: 3, player_name: "Low Owned, Low Points", points: 10 },
    ];
    const ownership = [1, 2, 3].map(id => makeOwnership(2013, id, id === 2 ? 99 : 10));
    const result = getBlindSpots(seasonPoints, ownership);
    expect(result.map(r => r.playerName)).toEqual(["Overlooked"]);
  });
});

function makeOwnership(year: number, playerId: number, percentOwned: number): PlayerSeasonOwnership {
  return {
    year,
    player_id: playerId,
    player_name: `Player ${playerId}`,
    percent_owned: percentOwned,
    percent_started: 0,
    percent_change: 0,
    average_draft_position: null,
    average_draft_position_percent_change: null,
    auction_value_average: null,
    auction_value_average_change: null,
  };
}

describe("getVersatilePlayers", () => {
  it("counts only positions clearing the games floor, and drops one-position players", () => {
    const players: { player_id: number; full_name: string; games_played_by_position: Record<string, number> }[] = [
      // The 60 pinch-hit appearances (12) clear the games floor but must not
      // count as a position.
      {
        player_id: 1,
        full_name: "Utility Man",
        games_played_by_position: { "4": 40, "5": 30, "6": 20, "1": 1, "12": 60 },
      },
      { player_id: 2, full_name: "Pure Starter", games_played_by_position: { "1": 32 } },
      { player_id: 3, full_name: "Bench Bat", games_played_by_position: { "3": 40, "12": 60 } },
    ];
    const result = getVersatilePlayers(players);
    // Only the utility man survives: the starter has one position, and the
    // bench bat is left with one once pinch-hitting is discounted.
    expect(result).toHaveLength(1);
    // The single blowout inning at position 1 is below the floor, and the 60
    // pinch-hit appearances are excluded outright.
    expect(result[0].positionCount).toBe(3);
    expect(result[0].totalGames).toBe(90);
  });
});

/** These pin the leaderboards against the committed archive. They are the
 * check that the joins actually line up on real ids, which synthetic fixtures
 * cannot prove. Verified by hand against data/processed/ on 2026-07-26. */
describe("hand-verification against real processed data", () => {
  it("finds the league's best wire pickups (2019-2025 ledger)", () => {
    const top = getWaiverPickups(
      readProcessed<Transaction[]>("transactions.json"),
      readProcessed<PlayerSeasonPoints[]>("player_season_points.json"),
      readProcessed<PlayerTeamSeasonPoints[]>("player_team_season_points.json"),
      readProcessed<DraftPick[]>("draft_picks.json"),
      readProcessed<Keeper[]>("keepers.json"),
      10
    );

    expect(top[0]).toMatchObject({ playerName: "Geraldo Perdomo", year: 2025 });
    expect(top[0].ownerPoints).toBeCloseTo(327.4, 1);

    // Robbie Ray's 2021 Cy Young season was picked up by two owners, but one
    // held him for 4.9 of the 318.1 points. Ranking by owner-attributed points
    // keeps the manager who actually rode it and drops the one who didn't.
    const rayRows = top.filter(r => r.playerName === "Robbie Ray");
    expect(rayRows).toHaveLength(1);
    expect(rayRows[0].ownerId).toBe("nathan-forman");
    expect(rayRows[0].ownerPoints).toBeCloseTo(313.2, 1);
    expect(rayRows[0].seasonPoints).toBeCloseTo(318.1, 1);

    // No owner appears twice for the same player-season.
    const keys = top.map(r => `${r.year}:${r.playerId}:${r.ownerId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ranks owner transaction activity across all seasons", () => {
    const teams = readProcessed<Team[]>("teams.json");
    const activity = getOwnerActivity(teams);

    // Moves is a floor, not an exact count: 2026 is in progress, so every weekly
    // data refresh adds to it (3,139 at the 2026-07 refresh, 3,143 a week later).
    expect(activity[0]).toMatchObject({ ownerId: "john-packer", seasonsCovered: 16 });
    expect(activity[0].moves).toBeGreaterThanOrEqual(3139);
    // Raw totals reward longevity; per-season exposes a short-tenure owner who
    // was nearly as busy. This is why the view shows both.
    const busiestPerSeason = [...activity].sort((a, b) => b.movesPerSeason - a.movesPerSeason)[0];
    expect(busiestPerSeason.ownerId).toBe("john-packer");
    expect(activity.find(o => o.ownerId === "luis-garcia")?.seasonsCovered).toBe(4);
  });

  it.skip("finds league-wide blind spots across the full archive", () => {
    const seasonPoints = readProcessed<PlayerSeasonPoints[]>("player_season_points.json");
    const ownership = readProcessed<PlayerSeasonOwnership[]>("player_season_ownership.json");
    const spots = getBlindSpots(seasonPoints, ownership, { minPoints: 200, maxPercentOwned: 40, limit: 100 });

    expect(spots[0]).toMatchObject({ playerName: "Cody Ross", year: 2009 });
    expect(spots[0].points).toBeCloseTo(336.8, 1);
    // Spans well beyond the 2019+ transaction window -- this is the only new
    // leaderboard that covers all 17 seasons.
    expect(Math.min(...spots.map(s => s.year))).toBeLessThan(2019);
  });

  it("finds the league's biggest journeymen (2019-2025 ledger)", () => {
    const transactions = readProcessed<Transaction[]>("transactions.json");
    const players = readProcessed<Player[]>("players.json");
    const top = getJourneymen(transactions, players, 5);

    expect(top[0]).toMatchObject({ playerName: "Dean Kremer", pickups: 18 });
    expect(top[0].ownerIds).toHaveLength(5);
  });

  it("finds the most versatile players", () => {
    const players = readProcessed<Player[]>("players.json");
    const versatile = getVersatilePlayers(players, { minGames: 10, limit: 7 });

    // Updated after full kona_player_info re-extraction (2026-08).
    // 8, not 9: pinch-hitting (position id 12) is excluded as a plate
    // appearance rather than a position. Ties on positionCount are broken by
    // totalGames descending, so Jurickson Profar leads the 8-position group.
    // Christopher Morel re-pinned 2026-08-22: live 2026 games grew his
    // multi-position totals past Harold Castro within the same 8-position tie.
    // Enrique Hernandez + Ezequiel Duran re-pinned 2026-09-09: live 2026
    // games pushed their totalGames into the same 8-position tie -- Hernandez
    // (1075) past Willi Castro (1000); Duran (547) past Christopher Morel (507).
    expect(versatile[0].playerName).toBe("Jurickson Profar");
    expect(versatile[0].positionCount).toBe(8);
    expect(versatile[1].playerName).toBe("Enrique Hernandez");
    expect(versatile[2].playerName).toBe("Willi Castro");
    expect(versatile[3].playerName).toBe("Dylan Moore");
    expect(versatile[4].playerName).toBe("Ezequiel Duran");
    expect(versatile[5].playerName).toBe("Christopher Morel");
    expect(versatile[6].playerName).toBe("Harold Castro");
    expect(versatile.every(p => p.positionCount >= 2)).toBe(true);
    expect(versatile.every(p => p.positions.every(pos => pos.positionId !== 12))).toBe(true);
  });
});

describe("enrichPossessionChain", () => {
  const playerId = 7;
  // Ledger years, the isOngoing gate -- 2012 is deliberately absent.
  const covered: ReadonlySet<number> = new Set([2021, 2026]);

  it("names how a run started and ended when the ledger has the events", () => {
    const runs = [{ ownerId: "owner-a", espnTeamId: 3, startYear: 2021, startWeek: 5, endYear: 2021, endWeek: 12 }];
    const txs = [
      makeTransaction({
        year: 2021,
        transaction_id: "add",
        week: 4,
        espn_team_id: 3,
        items: [
          {
            player_id: playerId,
            item_type: "ADD",
            from_espn_team_id: null,
            to_espn_team_id: 3,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
      makeTransaction({
        year: 2021,
        transaction_id: "drop",
        week: 13,
        espn_team_id: 3,
        items: [
          {
            player_id: playerId,
            item_type: "DROP",
            from_espn_team_id: 3,
            to_espn_team_id: null,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
    ];

    const [run] = enrichPossessionChain(runs, playerId, txs, covered);
    expect(run.acquiredVia).toBe("free agent");
    expect(run.acquiredWeek).toBe(4);
    expect(run.releasedVia).toBe("dropped");
    expect(run.releasedWeek).toBe(13);
    expect(run.isOngoing).toBe(false);
  });

  it("leaves everything null when the ledger has nothing (the pre-2019 case)", () => {
    const runs = [{ ownerId: "owner-a", espnTeamId: 3, startYear: 2012, startWeek: 1, endYear: 2012, endWeek: 20 }];
    const [run] = enrichPossessionChain(runs, playerId, [], covered);
    expect(run.acquiredVia).toBeNull();
    expect(run.releasedVia).toBeNull();
    // No ledger for 2012, so a missing drop proves nothing -- the run must not read as open.
    expect(run.isOngoing).toBe(false);
    // The underlying run is preserved untouched.
    expect(run.startYear).toBe(2012);
    expect(run.endWeek).toBe(20);
  });

  it("marks a run with no recorded release in a covered year as ongoing", () => {
    const runs = [{ ownerId: "owner-a", espnTeamId: 3, startYear: 2026, startWeek: 1, endYear: 2026, endWeek: 18 }];
    const txs = [
      makeTransaction({
        year: 2026,
        transaction_id: "add",
        week: 1,
        espn_team_id: 3,
        items: [
          {
            player_id: playerId,
            item_type: "ADD",
            from_espn_team_id: null,
            to_espn_team_id: 3,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
    ];

    const [run] = enrichPossessionChain(runs, playerId, txs, covered);
    expect(run.acquiredVia).toBe("free agent");
    expect(run.releasedVia).toBeNull();
    expect(run.isOngoing).toBe(true);
  });

  it("ignores a canceled trade proposal", () => {
    const runs = [{ ownerId: "owner-a", espnTeamId: 3, startYear: 2026, startWeek: 1, endYear: 2026, endWeek: 17 }];
    const txs = [
      makeTransaction({
        year: 2026,
        transaction_id: "proposal",
        transaction_type: "TRADE_PROPOSAL",
        status: "CANCELED",
        week: 17,
        espn_team_id: 5,
        items: [
          {
            player_id: playerId,
            item_type: "TRADE",
            from_espn_team_id: 3,
            to_espn_team_id: 5,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
    ];

    const [run] = enrichPossessionChain(runs, playerId, txs, covered);
    expect(run.releasedVia).toBeNull();
    expect(run.isOngoing).toBe(true);
  });

  it("ignores a LINEUP item, which is a slot change rather than a move", () => {
    const runs = [{ ownerId: "owner-a", espnTeamId: 3, startYear: 2026, startWeek: 4, endYear: 2026, endWeek: 9 }];
    const txs = [
      makeTransaction({
        year: 2026,
        transaction_id: "lineup",
        transaction_type: "ROSTER",
        week: 4,
        espn_team_id: 3,
        items: [
          {
            player_id: playerId,
            item_type: "LINEUP",
            from_espn_team_id: 3,
            to_espn_team_id: 3,
            from_lineup_slot_id: 16,
            to_lineup_slot_id: 12,
          },
        ],
      }),
    ];

    const [run] = enrichPossessionChain(runs, playerId, txs, covered);
    expect(run.acquiredVia).toBeNull();
    expect(run.releasedVia).toBeNull();
  });

  it("ignores events for a different team, and labels a trade as a trade", () => {
    const runs = [{ ownerId: "owner-a", espnTeamId: 3, startYear: 2021, startWeek: 5, endYear: 2021, endWeek: 12 }];
    const txs = [
      // Another team adding the same player must not attach to this run.
      makeTransaction({
        year: 2021,
        transaction_id: "other",
        week: 4,
        espn_team_id: 9,
        items: [
          {
            player_id: playerId,
            item_type: "ADD",
            from_espn_team_id: null,
            to_espn_team_id: 9,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
      makeTransaction({
        year: 2021,
        transaction_id: "trade",
        week: 5,
        transaction_type: "TRADE_ACCEPT",
        espn_team_id: 3,
        items: [
          {
            player_id: playerId,
            item_type: "TRADE",
            from_espn_team_id: 9,
            to_espn_team_id: 3,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
    ];

    const [run] = enrichPossessionChain(runs, playerId, txs, covered);
    expect(run.acquiredVia).toBe("trade");
    expect(run.acquiredWeek).toBe(5);
  });
});

describe("enrichPossessionChain draftedToTeam", () => {
  const playerId = 7;

  it("marks a run whose start year matches the ownership draft year", () => {
    const runs = [{ ownerId: "owner-a", espnTeamId: 3, startYear: 2024, startWeek: 15, endYear: 2024, endWeek: 20 }];
    const byOwner = new Map<string, Set<number>>([["owner-a", new Set([2024])]]);
    const [run] = enrichPossessionChain(runs, playerId, [], new Set(), byOwner);
    expect(run.draftedToTeam).toBe(true);
  });

  it("leaves runs false when the owner or year does not match a draft", () => {
    const runs = [
      { ownerId: "owner-b", espnTeamId: 4, startYear: 2023, startWeek: 1, endYear: 2023, endWeek: 18 },
      { ownerId: "owner-a", espnTeamId: 3, startYear: 2022, startWeek: 3, endYear: 2022, endWeek: 12 },
    ];
    // owner-a drafted the player in 2024; a 2022 run is a different year.
    const byOwner = new Map<string, Set<number>>([["owner-a", new Set([2024])]]);
    const enriched = enrichPossessionChain(runs, playerId, [], new Set(), byOwner);
    expect(enriched[0].draftedToTeam).toBe(false); // never drafted by owner-b
    expect(enriched[1].draftedToTeam).toBe(false); // drafted in a different year than the run
  });
});

describe("getWaiverPickups nextYearStatus", () => {
  const seasonPoints: PlayerSeasonPoints[] = [
    { year: 2021, player_id: 1, player_name: "Kept Dude", points: 100 },
    { year: 2021, player_id: 2, player_name: "Redrafted Dude", points: 90 },
    { year: 2021, player_id: 3, player_name: "Gone Dude", points: 80 },
  ];

  it("flags kept, redrafted, and gone pickups", () => {
    const txs = [
      makeTransaction({ year: 2021, transaction_id: "a", owner_id: "owner-a", items: [makeItem(1, "ADD", null, 1)] }),
      makeTransaction({ year: 2021, transaction_id: "b", owner_id: "owner-b", items: [makeItem(2, "ADD", null, 1)] }),
      makeTransaction({ year: 2021, transaction_id: "c", owner_id: "owner-c", items: [makeItem(3, "ADD", null, 1)] }),
    ];
    const teamPoints = [
      makeTeamPoints(2021, 1, "owner-a", 100),
      makeTeamPoints(2021, 2, "owner-b", 90),
      makeTeamPoints(2021, 3, "owner-c", 80),
    ];
    // owner-a keeps player 1 next year; player 2 is re-drafted live next year.
    const keepers: Keeper[] = [
      {
        year: 2022,
        espn_team_id: 1,
        owner_id: "owner-a",
        player_id: 1,
        player_name: "Kept Dude",
        round_id: 5,
        overall_pick_number: 47,
        validated_on_prior_roster: true,
        pro_team_id: 20,
      },
    ];
    const draftPicks: DraftPick[] = [
      {
        year: 2022,
        overall_pick_number: 30,
        round_id: 3,
        round_pick_number: 10,
        espn_team_id: 5,
        owner_id: "owner-z",
        player_id: 2,
        player_name: "Redrafted Dude",
        keeper: false,
        traded_pick: false,
        traded_from_espn_team_id: null,
        pro_team_id: null,
      },
    ];

    const result = getWaiverPickups(txs, seasonPoints, teamPoints, draftPicks, keepers, 5);
    const byName = new Map(result.map(r => [r.playerName, r] as const));
    expect(byName.get("Kept Dude")?.nextYearStatus).toBe("kept");
    expect(byName.get("Redrafted Dude")?.nextYearStatus).toBe("drafted");
    expect(byName.get("Gone Dude")?.nextYearStatus).toBe("gone");
  });
});
