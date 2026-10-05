import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAllTimeStatRows,
  buildSeasonStatRows,
  LINEUP_SPLIT_FIRST_YEAR,
  pointsTooltip,
  allTimePointsTooltip,
  type AllTimeStatRow,
  type SeasonStatRow,
} from "./seasonStats";
import type {
  BattingLine,
  BoxScoreEntry,
  DraftPick,
  Player,
  PlayerSeason,
  PlayerSeasonBackfill,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  PitchingLine,
  Team,
} from "../types";
import type { SeasonPlayerLine } from "./boxScore";

function appDir(): string {
  return path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
}

function readProcessed<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(appDir(), "public/data", name), "utf-8")) as T;
}

function makePlayerSeason(
  year: number,
  playerId: number,
  eligibleSlots: number[],
  defaultPositionId: number
): PlayerSeason {
  return {
    year,
    player_id: playerId,
    player_name: "Test Player",
    eligible_slots: eligibleSlots,
    games_played_by_position: {},
    default_position_id: defaultPositionId,
    jersey: null,
    injury_status: null,
    injured: null,
    pro_team_id: null,
  };
}

function makePoints(year: number, playerId: number, espnTeamId = 1): PlayerTeamSeasonPoints {
  return {
    year,
    player_id: playerId,
    player_name: "Test Player",
    owner_id: "owner-1",
    espn_team_id: espnTeamId,
    points: 100,
    counted_points: 100,
    bench_points: 0,
  };
}

function makeBackfill(
  overrides: Partial<PlayerSeasonBackfill> & Pick<PlayerSeasonBackfill, "year" | "player_id" | "player_name">
): PlayerSeasonBackfill {
  return {
    points: 0,
    batting: null,
    pitching: null,
    eligible_slots: [],
    default_position_id: null,
    source: "kona",
    ...overrides,
  };
}

const NO_BACKFILL: PlayerSeasonBackfill[] = [];
const NO_TEAMS: Team[] = [];
const NO_CARD_POINTS = new Map<string, number>();

function makeTeam(year: number, espnTeamId: number, ownerId: string): Team {
  return {
    year,
    espn_team_id: espnTeamId,
    owner_ids: [ownerId],
    primary_owner_id: ownerId,
    team_name: `Team ${espnTeamId}`,
    division_id: 1,
    final_rank: 1,
    playoff_seed: 1,
    overall: { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 },
    home: { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 },
    away: { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 },
    division_record: { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 },
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

function makeEntry(
  overrides: Partial<BoxScoreEntry> & Pick<BoxScoreEntry, "week" | "player_id" | "espn_team_id">
): BoxScoreEntry {
  return {
    year: 2025,
    matchup_id: 1,
    owner_id: "owner-1",
    player_name: "Test Player",
    total_points: 10,
    batting: null,
    pitching: null,
    slots: [{ scoring_period: 1, lineup_slot_id: 1, points: 10 }],
    ...overrides,
  };
}

const BATTING: BattingLine = {
  ab: 10,
  r: 2,
  singles: 2,
  doubles: 1,
  triples: 0,
  hr: 1,
  rbi: 3,
  bb: 1,
  hbp: 0,
  k: 2,
  sb: 0,
  cs: 0,
  gidp: 0,
  cyc: 0,
  gshr: 0,
  e: 0,
};

const PITCHING: PitchingLine = {
  outs: 18,
  h: 5,
  r: 2,
  er: 2,
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

describe("buildSeasonStatRows -- positionIds", () => {
  it("slots a player under every eligible position, primary first", () => {
    // Ben Rice 2025-shaped: catcher (slot 0) + 1B (slot 1), default/primary 1B.
    const playerSeasons = [makePlayerSeason(2025, 1, [0, 1, 12, 16, 17], 3)];
    const points = [makePoints(2025, 1)];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], playerSeasons, [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].positionIds).toEqual([3, 2]); // 1B (primary) first, then C
  });

  it("falls back to the default position when eligible_slots is empty", () => {
    const playerSeasons = [makePlayerSeason(2025, 1, [], 5)];
    const points = [makePoints(2025, 1)];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], playerSeasons, [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows[0].positionIds).toEqual([5]);
  });

  it("yields an empty positionIds array when no playerSeasons row exists for the player-year", () => {
    const points = [makePoints(2025, 1)];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], [], [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows[0].positionIds).toEqual([]);
  });
});

describe("buildSeasonStatRows -- draft/roster fields", () => {
  it("still resolves draft position and pro team from draftPicks", () => {
    const playerSeasons = [makePlayerSeason(2025, 1, [1], 3)];
    const points = [makePoints(2025, 1)];
    const draftPicks: DraftPick[] = [
      {
        year: 2025,
        overall_pick_number: 12,
        round_id: 2,
        round_pick_number: 2,
        espn_team_id: 1,
        owner_id: "owner-1",
        player_id: 1,
        player_name: "Test Player",
        keeper: false,
        traded_pick: false,
        traded_from_espn_team_id: null,
        pro_team_id: 15,
      },
    ];

    const rows = buildSeasonStatRows(
      2025,
      2025,
      points,
      NO_BACKFILL,
      draftPicks,
      playerSeasons,
      [],
      NO_TEAMS,
      NO_CARD_POINTS
    );

    expect(rows[0].draftPosition).toBe(12);
    expect(rows[0].proTeamId).toBe(15);
  });
});

describe("buildSeasonStatRows -- multi-stint aggregation", () => {
  it("collapses a mid-season move into one row with summed points and current-team attribution", () => {
    const points = [makePoints(2025, 1, 1), { ...makePoints(2025, 1, 2), owner_id: "owner-2", points: 50 }];
    const boxScores = [
      makeEntry({ week: 1, player_id: 1, espn_team_id: 1 }),
      makeEntry({ week: 2, player_id: 1, espn_team_id: 2, owner_id: "owner-2" }),
      makeEntry({ week: 3, player_id: 1, espn_team_id: 2, owner_id: "owner-2" }),
    ];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], [], boxScores, NO_TEAMS, NO_CARD_POINTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].rosteredPoints).toBe(150);
    expect(rows[0].espnTeamId).toBe(2);
    expect(rows[0].ownerId).toBe("owner-2");
  });

  it("sums batting lines across stints", () => {
    const points = [makePoints(2025, 1, 1), { ...makePoints(2025, 1, 2), owner_id: "owner-2", points: 50 }];
    const boxScores = [
      makeEntry({ week: 1, player_id: 1, espn_team_id: 1, batting: BATTING }),
      makeEntry({ week: 2, player_id: 1, espn_team_id: 2, owner_id: "owner-2", batting: BATTING }),
    ];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], [], boxScores, NO_TEAMS, NO_CARD_POINTS);

    expect(rows[0].batting?.ab).toBe(20);
    expect(rows[0].batting?.hr).toBe(2);
    expect(rows[0].pitching).toBeNull();
  });

  it("keeps the line from a stint that has one when the other doesn't", () => {
    const points = [makePoints(2025, 1, 1), { ...makePoints(2025, 1, 2), owner_id: "owner-2", points: 50 }];
    const boxScores = [
      makeEntry({ week: 1, player_id: 1, espn_team_id: 1 }),
      makeEntry({ week: 2, player_id: 1, espn_team_id: 2, owner_id: "owner-2", batting: BATTING }),
    ];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], [], boxScores, NO_TEAMS, NO_CARD_POINTS);

    expect(rows[0].batting).toEqual(BATTING);
  });

  it("keeps batting null when no stint has a raw line (pre-2019 shape)", () => {
    const points = [makePoints(2025, 1, 1), { ...makePoints(2025, 1, 2), owner_id: "owner-2", points: 50 }];
    const boxScores = [
      makeEntry({ week: 1, player_id: 1, espn_team_id: 1 }),
      makeEntry({ week: 2, player_id: 1, espn_team_id: 2, owner_id: "owner-2" }),
    ];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], [], boxScores, NO_TEAMS, NO_CARD_POINTS);

    expect(rows[0].batting).toBeNull();
    expect(rows[0].pitching).toBeNull();
  });

  it("attributes a player with no box-score entries to his last stint row", () => {
    const points = [makePoints(2025, 1, 1), { ...makePoints(2025, 1, 2), owner_id: "owner-2", points: 50 }];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], [], [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].espnTeamId).toBe(2);
    expect(rows[0].ownerId).toBe("owner-2");
  });
});

describe("buildSeasonStatRows -- latest-season player pool", () => {
  it("includes a backfilled unowned player and assigns the current fantasy team", () => {
    const playerSeasons = [makePlayerSeason(2026, 1, [1], 3)];
    const backfill: PlayerSeasonBackfill[] = [
      makeBackfill({
        year: 2026,
        player_id: 1,
        player_name: "Active Free Agent",
        points: 123.4,
        batting: BATTING,
      }),
    ];
    const teams = [makeTeam(2026, 2, "owner-2")];
    // fantasy_team_id 2 means the player is currently rostered despite having
    // no box-score appearances.
    playerSeasons[0].fantasy_team_id = 2;

    const rows = buildSeasonStatRows(2026, 2026, [], backfill, [], playerSeasons, [], teams, NO_CARD_POINTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe(1);
    expect(rows[0].ownerId).toBe("owner-2");
    expect(rows[0].rosteredPoints).toBe(123.4);
  });

  it("shows a dash (null owner) for an unrostered player with zero stats", () => {
    const playerSeasons = [makePlayerSeason(2026, 1, [1], 3)];
    const teams = [makeTeam(2026, 2, "owner-2")];
    // fantasy_team_id is omitted (undefined) for free agents; 0 is normalized
    // away in normalize.py.

    const rows = buildSeasonStatRows(2026, 2026, [], [], [], playerSeasons, [], teams, NO_CARD_POINTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBeNull();
    expect(rows[0].espnTeamId).toBeNull();
    expect(rows[0].rosteredPoints).toBe(0);
  });

  it("does not add zero-stat rows for historical seasons", () => {
    const playerSeasons = [makePlayerSeason(2025, 1, [1], 3)];

    const rows = buildSeasonStatRows(2025, 2026, [], [], [], playerSeasons, [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows).toHaveLength(0);
  });
});

describe("buildSeasonStatRows -- real 2026 data", () => {
  it("yields one row per player and reconciles with player_season_points.json", () => {
    const teamSeasonPoints = readProcessed<PlayerTeamSeasonPoints[]>("player_team_season_points.json");
    const seasonPoints = readProcessed<PlayerSeasonPoints[]>("player_season_points.json");
    const draftPicks = readProcessed<DraftPick[]>("draft_picks.json");
    const playerSeasons = readProcessed<PlayerSeason[]>("player_seasons.json");
    const boxScores = readProcessed<BoxScoreEntry[]>("box_scores/2026.json");
    const teams = readProcessed<Team[]>("teams.json");

    const rows = buildSeasonStatRows(
      2026,
      2026,
      teamSeasonPoints,
      [],
      draftPicks,
      playerSeasons,
      boxScores,
      teams,
      NO_CARD_POINTS
    );

    const ids = rows.map(r => r.playerId);
    expect(new Set(ids).size).toBe(ids.length);

    const totalByPlayer = new Map(seasonPoints.filter(p => p.year === 2026).map(p => [p.player_id, p.points]));
    for (const row of rows) {
      const total = totalByPlayer.get(row.playerId);
      if (total !== undefined) {
        expect(row.rosteredPoints).toBeCloseTo(total, 1);
      } else {
        // Either a backfilled unowned active player or a zero-stat player from
        // the current player pool.
        expect(row.rosteredPoints).toBeGreaterThanOrEqual(0);
      }
    }

    // The reported bug: a player moved between two co-owned teams
    // mid-season and rendered as one line per stint. Verify he collapses to
    // one row and that the row's points match the fixture (rather than a
    // hardcoded value, so the test survives future data refreshes).
    const jung = rows.filter(r => r.playerId === 42437);
    expect(jung).toHaveLength(1);
    expect(jung[0].ownerId).toBe("sam-silbert");
    expect(totalByPlayer.has(42437)).toBe(true);
    expect(jung[0].rosteredPoints).toBeCloseTo(totalByPlayer.get(42437)!, 1);
  });
});

describe("buildSeasonStatRows -- cardPoints", () => {
  it("joins the card total and keeps the rostered figure alongside", () => {
    const playerSeasons = [makePlayerSeason(2025, 1, [3], 3)];
    const points = [makePoints(2025, 1)];
    const card = new Map([["2025:1", 150.5]]);

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], playerSeasons, [], NO_TEAMS, card);

    expect(rows).toHaveLength(1);
    expect(rows[0].rosteredPoints).toBe(100);
    expect(rows[0].cardPoints).toBe(150.5);
  });

  it("falls back to rostered points when the card row is missing", () => {
    const playerSeasons = [makePlayerSeason(2025, 1, [3], 3)];
    const points = [makePoints(2025, 1)];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], playerSeasons, [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].cardPoints).toBe(100);
  });

  it("keeps card and rostered on opposite signs apart for sorting (Scherzer shape)", () => {
    // Rostered -14.1 (all relief no-decisions while rostered) against a card
    // total of 19.0: the two sort keys must order this row differently, so
    // both figures have to survive onto the row independently.
    const playerSeasons = [makePlayerSeason(2026, 1, [14], 1)];
    const stint = { ...makePoints(2026, 1), points: -14.1 };
    const card = new Map([["2026:1", 19.0]]);

    const rows = buildSeasonStatRows(2026, 2026, [stint], NO_BACKFILL, [], playerSeasons, [], NO_TEAMS, card);

    expect(rows).toHaveLength(1);
    expect(rows[0].rosteredPoints).toBe(-14.1);
    expect(rows[0].cardPoints).toBe(19.0);
  });
});

describe("buildSeasonStatRows -- lineupSplit", () => {
  it("sums the counted/bench split across stints", () => {
    const points = [
      { ...makePoints(2025, 1, 1), points: 100, counted_points: 80, bench_points: 20 },
      { ...makePoints(2025, 1, 2), owner_id: "owner-2", points: 50, counted_points: 30, bench_points: 20 },
    ];

    const rows = buildSeasonStatRows(2025, 2025, points, NO_BACKFILL, [], [], [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].rosteredPoints).toBe(150);
    expect(rows[0].lineupSplit).toEqual({ counted: 110, bench: 40 });
  });

  it("leaves the split null before bench tracking began", () => {
    expect(LINEUP_SPLIT_FIRST_YEAR).toBe(2018);
    const points = [{ ...makePoints(2015, 1), counted_points: 100, bench_points: 0 }];

    const rows = buildSeasonStatRows(2015, 2026, points, NO_BACKFILL, [], [], [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].rosteredPoints).toBe(100);
    expect(rows[0].lineupSplit).toBeNull();
  });

  it("leaves the split null for backfill and free-agent rows with no stints", () => {
    const backfill = [makeBackfill({ year: 2026, player_id: 1, player_name: "Active Free Agent", points: 50 })];
    const playerSeasons = [makePlayerSeason(2026, 2, [1], 3)];

    const rows = buildSeasonStatRows(2026, 2026, [], backfill, [], playerSeasons, [], NO_TEAMS, NO_CARD_POINTS);

    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.lineupSplit).toBeNull();
  });

  it("reconciles the split against player_season_points.json on real 2026 data", () => {
    const teamSeasonPoints = readProcessed<PlayerTeamSeasonPoints[]>("player_team_season_points.json");
    const seasonPoints =
      readProcessed<(PlayerSeasonPoints & { counted_points: number; bench_points: number })[]>(
        "player_season_points.json"
      );
    const boxScores = readProcessed<BoxScoreEntry[]>("box_scores/2026.json");
    const teams = readProcessed<Team[]>("teams.json");
    const playerSeasons = readProcessed<PlayerSeason[]>("player_seasons.json");
    const draftPicks = readProcessed<DraftPick[]>("draft_picks.json");

    const rows = buildSeasonStatRows(
      2026,
      2026,
      teamSeasonPoints,
      [],
      draftPicks,
      playerSeasons,
      boxScores,
      teams,
      NO_CARD_POINTS
    );

    const totals = new Map(seasonPoints.filter(p => p.year === 2026).map(p => [p.player_id, p]));
    let checked = 0;
    for (const row of rows) {
      const total = totals.get(row.playerId);
      if (total === undefined || row.lineupSplit === null) continue;
      expect(row.lineupSplit.counted).toBeCloseTo(total.counted_points, 1);
      expect(row.lineupSplit.bench).toBeCloseTo(total.bench_points, 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(400);
  });
});

describe("pointsTooltip", () => {
  function makeRow(overrides: Partial<SeasonStatRow>): SeasonStatRow {
    return {
      playerId: 1,
      playerName: "Test Player",
      ownerId: "owner-1",
      espnTeamId: 1,
      positionIds: [],
      proTeamId: null,
      draftPosition: null,
      rosteredPoints: 100,
      cardPoints: 150,
      lineupSplit: { counted: 68, bench: 32 },
      batting: null,
      pitching: null,
      ...overrides,
    };
  }

  it("leads with the rostered share of the total, then the lineup share", () => {
    expect(pointsTooltip(makeRow({}), 2025)).toBe(
      "100.0 rostered of 150.0 total\n68% of rostered in a starting lineup\n68.0 counted · 32.0 bench"
    );
  });

  it("omits the rostered line when the total all came while rostered", () => {
    expect(
      pointsTooltip(makeRow({ rosteredPoints: 150, cardPoints: 150, lineupSplit: { counted: 120, bench: 30 } }), 2025)
    ).toBe("80% of rostered in a starting lineup\n120.0 counted · 30.0 bench");
  });

  it("notes the coverage gap for a pre-2018 total with no split", () => {
    expect(pointsTooltip(makeRow({ lineupSplit: null }), 2015)).toBe(
      "100.0 rostered of 150.0 total\nStarting-lineup split only tracked from 2018 on."
    );
  });

  it("notes the coverage gap for a pre-2018 row whose total all came while rostered", () => {
    expect(pointsTooltip(makeRow({ rosteredPoints: 150, cardPoints: 150, lineupSplit: null }), 2015)).toBe(
      "Starting-lineup split only tracked from 2018 on."
    );
  });

  it("explains a stint-less current-season row without the era note", () => {
    expect(pointsTooltip(makeRow({ rosteredPoints: 50, cardPoints: 50, lineupSplit: null }), 2026)).toBe(
      "All scoring came while rostered; no starting-lineup split on file for this row."
    );
  });

  it("reports a free-agent-only total as rostered with no split claim", () => {
    expect(pointsTooltip(makeRow({ rosteredPoints: 0, cardPoints: 40, lineupSplit: null }), 2026)).toBe(
      "0.0 rostered of 40.0 total"
    );
  });

  it("says plainly when there are no points on file at all", () => {
    expect(pointsTooltip(makeRow({ rosteredPoints: 0, cardPoints: 0, lineupSplit: null }), 2026)).toBe(
      "No points on file for this season."
    );
  });

  it("states the raw split instead of a nonsense percentage for a net-negative total", () => {
    expect(
      pointsTooltip(makeRow({ rosteredPoints: -14.1, cardPoints: 19, lineupSplit: { counted: -14.1, bench: 0 } }), 2026)
    ).toBe("-14.1 rostered of 19.0 total\n-14.1 counted · 0.0 bench");
  });

  it("states the raw split when bench negativity pushes the share past 100%", () => {
    expect(
      pointsTooltip(makeRow({ rosteredPoints: 7, cardPoints: 7, lineupSplit: { counted: 10, bench: -3 } }), 2026)
    ).toBe("10.0 counted · -3.0 bench");
  });
});

describe("buildAllTimeStatRows", () => {
  function makeRosterLine(playerId: number, overrides: Partial<SeasonPlayerLine> = {}): SeasonPlayerLine {
    return {
      playerId,
      playerName: "Test Player",
      weeksRostered: 1,
      countedPoints: 0,
      battingCountedPoints: 0,
      pitchingCountedPoints: 0,
      benchPoints: 0,
      batting: null,
      pitching: null,
      ilOnly: false,
      slotSide: null,
      ...overrides,
    };
  }

  it("sums the card total, the rostered share, and the season count across years", () => {
    const points = [
      { ...makePoints(2025, 1), points: 100 },
      { ...makePoints(2026, 1), points: 50 },
    ];
    const card = new Map([
      ["2025:1", 200],
      ["2026:1", 300],
    ]);

    const rows = buildAllTimeStatRows(points, [], [], card, 2026, NO_TEAMS, new Map());

    expect(rows).toHaveLength(1);
    expect(rows[0].cardPoints).toBe(500);
    expect(rows[0].rosteredPoints).toBe(150);
    expect(rows[0].seasons).toBe(2);
  });

  it("collapses a same-season move into one row and counts a single season", () => {
    const points = [
      { ...makePoints(2025, 1), owner_id: "owner-1", points: 60 },
      { ...makePoints(2025, 1, 2), owner_id: "owner-2", points: 40 },
    ];

    const rows = buildAllTimeStatRows(points, [], [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());

    expect(rows).toHaveLength(1);
    expect(rows[0].rosteredPoints).toBe(100);
    expect(rows[0].seasons).toBe(1);
  });

  it("falls back to the per-year rostered total when the card row is missing", () => {
    const points = [
      { ...makePoints(2025, 1), points: 60 },
      { ...makePoints(2026, 1), points: 40 },
    ];

    const rows = buildAllTimeStatRows(points, [], [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());

    expect(rows[0].cardPoints).toBe(100);
    expect(rows[0].rosteredPoints).toBe(100);
  });

  it("attributes the latest-season primary owner when the player was rostered that year", () => {
    const points = [makePoints(2026, 1)];
    const playerSeasons = [{ ...makePlayerSeason(2026, 1, [1], 3), fantasy_team_id: 2 }];
    const teams = [makeTeam(2026, 2, "owner-2")];

    const rows = buildAllTimeStatRows(points, playerSeasons, [], NO_CARD_POINTS, 2026, teams, new Map());

    expect(rows[0].ownerId).toBe("owner-2");
    expect(rows[0].espnTeamId).toBe(2);
  });

  it("falls back to the last stint's owner when the final season predates the latest year", () => {
    const points = [makePoints(2024, 1)];
    const playerSeasons = [makePlayerSeason(2024, 1, [1], 3)];
    const teams = [makeTeam(2026, 2, "owner-2")];

    const rows = buildAllTimeStatRows(points, playerSeasons, [], NO_CARD_POINTS, 2026, teams, new Map());

    expect(rows[0].ownerId).toBe("owner-1");
    expect(rows[0].espnTeamId).toBe(1);
  });

  it("falls back to the stint owner when the latest-season team is not in teams.json", () => {
    const points = [makePoints(2026, 1)];
    const playerSeasons = [{ ...makePlayerSeason(2026, 1, [1], 3), fantasy_team_id: 99 }];

    const rows = buildAllTimeStatRows(points, playerSeasons, [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());

    // player_seasons is trusted for current roster status even when the team
    // row is missing, so only the owner falls back to the stint.
    expect(rows[0].ownerId).toBe("owner-1");
    expect(rows[0].espnTeamId).toBe(99);
  });

  it("unions eligible positions across years, keeping the latest season's primary first", () => {
    const points = [makePoints(2025, 1), { ...makePoints(2026, 1), points: 1 }];
    const playerSeasons = [
      makePlayerSeason(2025, 1, [0, 1], 3), // C + 1B
      makePlayerSeason(2026, 1, [1, 3], 3), // 1B + 3B
    ];

    const rows = buildAllTimeStatRows(points, playerSeasons, [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());

    expect(rows[0].positionIds).toEqual([3, 2, 5]);
  });

  it("leaves positions in ascending order when the latest primary is not in the union", () => {
    const points = [makePoints(2025, 1), { ...makePoints(2026, 1), points: 1 }];
    const playerSeasons = [
      makePlayerSeason(2025, 1, [0, 1], 3), // C + 1B
      makePlayerSeason(2026, 1, [0, 0], 4), // C only, declared 2B primary not eligible
    ];

    const rows = buildAllTimeStatRows(points, playerSeasons, [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());

    expect(rows[0].positionIds).toEqual([2, 3]);
  });

  it("resolves the MLB team from the latest season, falling back to the career row", () => {
    const points = [
      { ...makePoints(2025, 1), points: 1 },
      { ...makePoints(2026, 1), points: 1 },
    ];
    const playerSeasons = [{ ...makePlayerSeason(2026, 1, [1], 3), pro_team_id: 5 }];

    const rows = buildAllTimeStatRows(points, playerSeasons, [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());
    expect(rows[0].proTeamId).toBe(5);

    const no2026Row: Player[] = [
      {
        player_id: 1,
        full_name: "Test Player",
        default_position_id: 3,
        eligible_slots: [],
        games_played_by_position: {},
        active: null,
        pro_team_id: 7,
        jersey: null,
        droppable: null,
        seasons_seen: [],
        roster_days: 0,
      },
    ];
    const fallback = buildAllTimeStatRows(points, [], no2026Row, NO_CARD_POINTS, 2026, NO_TEAMS, new Map());
    expect(fallback[0].proTeamId).toBe(7);
  });

  it("resolves a historical mid-season move to the team whose stint ended last", () => {
    const points = [
      { ...makePoints(2024, 1), owner_id: "owner-1", points: 60 },
      { ...makePoints(2024, 1, 2), owner_id: "owner-2", points: 40 },
    ];
    const boxScoresByYear = new Map<number, BoxScoreEntry[]>([
      [
        2024,
        [
          makeEntry({ year: 2024, week: 1, player_id: 1, espn_team_id: 1 }),
          makeEntry({ year: 2024, week: 2, player_id: 1, espn_team_id: 1 }),
          makeEntry({ year: 2024, week: 3, player_id: 1, espn_team_id: 1 }),
          makeEntry({ year: 2024, week: 4, player_id: 1, espn_team_id: 2, owner_id: "owner-2" }),
          makeEntry({ year: 2024, week: 5, player_id: 1, espn_team_id: 2, owner_id: "owner-2" }),
          makeEntry({ year: 2024, week: 6, player_id: 1, espn_team_id: 2, owner_id: "owner-2" }),
        ],
      ],
    ]);

    const rows = buildAllTimeStatRows(points, [], [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map(), boxScoresByYear);

    expect(rows[0].ownerId).toBe("owner-2");
    expect(rows[0].espnTeamId).toBe(2);
  });

  it("falls back to the latest stint row when the season's box scores show no rostered week", () => {
    const points = [
      { ...makePoints(2024, 1), owner_id: "owner-1", points: 60 },
      { ...makePoints(2024, 1, 2), owner_id: "owner-2", points: 40 },
    ];

    const rows = buildAllTimeStatRows(points, [], [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());

    expect(rows[0].ownerId).toBe("owner-1");
    expect(rows[0].espnTeamId).toBe(1);
  });

  it("sums batting and pitching lines across rostered years", () => {
    const points = [makePoints(2025, 1), { ...makePoints(2026, 1), points: 1 }];
    const rostersByYear = new Map<number, SeasonPlayerLine[]>([
      [2025, [makeRosterLine(1, { batting: BATTING })]],
      [2026, [makeRosterLine(1, { batting: BATTING, pitching: PITCHING })]],
    ]);

    const rows = buildAllTimeStatRows(points, [], [], NO_CARD_POINTS, 2026, NO_TEAMS, rostersByYear);

    expect(rows[0].batting?.ab).toBe(20);
    expect(rows[0].batting?.hr).toBe(2);
    expect(rows[0].pitching?.outs).toBe(18);
    expect(rows[0].pitching?.k).toBe(8);
  });

  it("keeps stat lines null when no covered season produced one", () => {
    const points = [makePoints(2025, 1)];

    const rows = buildAllTimeStatRows(points, [], [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());

    expect(rows[0].batting).toBeNull();
    expect(rows[0].pitching).toBeNull();
  });

  it("excludes players who were never rostered", () => {
    const playerSeasons = [makePlayerSeason(2026, 1, [1], 3)];

    const rows = buildAllTimeStatRows([], playerSeasons, [], NO_CARD_POINTS, 2026, NO_TEAMS, new Map());

    expect(rows).toHaveLength(0);
  });
});

describe("allTimePointsTooltip", () => {
  function makeRow(
    overrides: Partial<Pick<AllTimeStatRow, "cardPoints" | "rosteredPoints">>
  ): Pick<AllTimeStatRow, "cardPoints" | "rosteredPoints"> {
    return { cardPoints: 150, rosteredPoints: 100, ...overrides };
  }

  it("returns null when all production came while rostered", () => {
    expect(allTimePointsTooltip(makeRow({ cardPoints: 100, rosteredPoints: 100 }))).toBeNull();
  });

  it("returns null when both figures are zero", () => {
    expect(allTimePointsTooltip(makeRow({ cardPoints: 0, rosteredPoints: 0 }))).toBeNull();
  });

  it("reports the rostered share of the career total", () => {
    expect(allTimePointsTooltip(makeRow({}))).toBe("100.0 rostered of 150.0 total");
  });
});
