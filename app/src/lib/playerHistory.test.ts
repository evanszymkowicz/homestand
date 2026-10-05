import { describe, expect, it } from "vitest";
import type { SeasonPlayerLine } from "./boxScore";
import {
  getPlayerCareerSeries,
  getPlayerCareerYears,
  getPlayerPossessionChain,
  getStatPercentileSeries,
} from "./playerHistory";
import { OF_POSITION_ID } from "./positions";
import type {
  BattingLine,
  BoxScoreEntry,
  DraftPick,
  Keeper,
  PitchingLine,
  PlayerSeason,
  PlayerSeasonBackfill,
  PlayerSeasonPoints,
  Transaction,
} from "../types";

const EMPTY_BATTING: BattingLine = {
  ab: 0,
  r: 0,
  singles: 0,
  doubles: 0,
  triples: 0,
  hr: 0,
  rbi: 0,
  bb: 0,
  hbp: 0,
  k: 0,
  sb: 0,
  cs: 0,
  gidp: 0,
  cyc: 0,
  gshr: 0,
  e: 0,
};

const EMPTY_PITCHING: PitchingLine = {
  outs: 0,
  h: 0,
  r: 0,
  er: 0,
  bb: 0,
  hb: 0,
  k: 0,
  wins: 0,
  losses: 0,
  sv: 0,
  bs: 0,
  hd: 0,
  sho: 0,
  nh: 0,
  pg: 0,
};

function makeLine(playerId: number, hr: number): SeasonPlayerLine {
  return {
    playerId,
    playerName: `P${playerId}`,
    weeksRostered: 20,
    countedPoints: 0,
    battingCountedPoints: 0,
    pitchingCountedPoints: 0,
    benchPoints: 0,
    batting: { ...EMPTY_BATTING, hr },
    pitching: null,
    ilOnly: false,
    slotSide: null,
  };
}

function makePitcherLine(playerId: number, er: number): SeasonPlayerLine {
  return {
    playerId,
    playerName: `P${playerId}`,
    weeksRostered: 20,
    countedPoints: 0,
    battingCountedPoints: 0,
    pitchingCountedPoints: 0,
    benchPoints: 0,
    batting: null,
    pitching: { ...EMPTY_PITCHING, er },
    ilOnly: false,
    slotSide: null,
  };
}

const readHr = (line: SeasonPlayerLine) => line.batting?.hr ?? null;
const readEr = (line: SeasonPlayerLine) => line.pitching?.er ?? null;

describe("getStatPercentileSeries -- position scope", () => {
  it("includes a dual-eligible player's line in either position's comparison field", () => {
    const rostersByYear = new Map([[2024, [makeLine(1, 10), makeLine(2, 30), makeLine(3, 20)]]]);
    const positionByPlayerSeason = new Map<string, number[]>([
      ["2024:1", [2, 3]], // C and 1B
      ["2024:2", [2]], // C only
      ["2024:3", [3]], // 1B only
    ]);

    const atCatcher = getStatPercentileSeries(1, rostersByYear, readHr, true, positionByPlayerSeason, 2);
    const at1B = getStatPercentileSeries(1, rostersByYear, readHr, true, positionByPlayerSeason, 3);

    expect(atCatcher.find(r => r.year === 2024)?.percentile).toBe(0); // field {10, 30}
    expect(at1B.find(r => r.year === 2024)?.percentile).toBe(0); // field {10, 20}
  });

  it("ranks the OF scope against everyone eligible at any of LF/CF/RF", () => {
    const rostersByYear = new Map([[2024, [makeLine(1, 5), makeLine(2, 25)]]]);
    const positionByPlayerSeason = new Map<string, number[]>([
      ["2024:1", [7]], // LF
      ["2024:2", [9]], // RF
    ]);

    const ofField = getStatPercentileSeries(1, rostersByYear, readHr, true, positionByPlayerSeason, OF_POSITION_ID);

    expect(ofField.find(r => r.year === 2024)?.percentile).toBe(0); // field {5, 25}
  });

  it("ranks against everyone when no position scope is given", () => {
    const rostersByYear = new Map([[2024, [makeLine(1, 5), makeLine(2, 25)]]]);

    const unscoped = getStatPercentileSeries(1, rostersByYear, readHr);

    expect(unscoped.find(r => r.year === 2024)?.percentile).toBe(0);
  });
});

describe("getStatPercentileSeries -- pitcher ER (higherIsBetter=false)", () => {
  it("gives the best (lowest ER) pitcher a percentile near 100", () => {
    const rostersByYear = new Map([[2024, [makePitcherLine(1, 10), makePitcherLine(2, 30), makePitcherLine(3, 20)]]]);

    const series = getStatPercentileSeries(1, rostersByYear, readEr, false);

    expect(series.find(r => r.year === 2024)?.percentile).toBe(100); // lowest ER = best
  });

  it("gives the worst (highest ER) pitcher a percentile near 0", () => {
    const rostersByYear = new Map([[2024, [makePitcherLine(1, 10), makePitcherLine(2, 30), makePitcherLine(3, 20)]]]);

    const series = getStatPercentileSeries(2, rostersByYear, readEr, false);

    expect(series.find(r => r.year === 2024)?.percentile).toBe(0); // highest ER = worst
  });

  it("gives the middle pitcher a percentile near 50", () => {
    const rostersByYear = new Map([[2024, [makePitcherLine(1, 10), makePitcherLine(2, 30), makePitcherLine(3, 20)]]]);

    const series = getStatPercentileSeries(3, rostersByYear, readEr, false);

    expect(series.find(r => r.year === 2024)?.percentile).toBe(50);
  });

  it("gives tied values the average rank's percentile, then inverts", () => {
    // Field: {10, 20, 20, 40}. Tied at 20 → average rank 1.5 → raw percentile 50 → inverted 50.
    const rostersByYear = new Map([
      [2024, [makePitcherLine(1, 10), makePitcherLine(2, 20), makePitcherLine(3, 20), makePitcherLine(4, 40)]],
    ]);

    const series = getStatPercentileSeries(2, rostersByYear, readEr, false);

    expect(series.find(r => r.year === 2024)?.percentile).toBeCloseTo(50);
  });
});

describe("getPlayerCareerSeries", () => {
  it("includes backfilled seasons alongside box-score seasons", () => {
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2023, player_id: 1, player_name: "P1", points: 100 },
      { year: 2024, player_id: 1, player_name: "P1", points: 120 },
    ];
    const percentiles = new Map<string, number>([
      ["2023:1", 50],
      ["2024:1", 60],
      ["2025:1", 70],
    ]);

    const series = getPlayerCareerSeries(1, seasonPoints, percentiles);

    expect(series.map(s => s.year)).toEqual([2023, 2024]);
  });

  it("handles gaps between consecutive years with data", () => {
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2023, player_id: 1, player_name: "P1", points: 100 },
      { year: 2025, player_id: 1, player_name: "P1", points: 130 },
    ];
    const percentiles = new Map<string, number>([
      ["2023:1", 50],
      ["2025:1", 70],
    ]);

    const series = getPlayerCareerSeries(1, seasonPoints, percentiles);

    expect(series.map(s => s.percentileChange)).toEqual([null, null]);
  });

  it("populates percentile and YoY across consecutive seasons", () => {
    // Populate-contract guard: every ranked season carries its percentile,
    // and YoY chains only across truly consecutive years. (Two-way seasons
    // once got nulled here; ranking is uniform at this layer now -- their
    // combined-vs-league caveat lives in the page's UI, not this function.)
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2023, player_id: 1, player_name: "P1", points: 100 },
      { year: 2024, player_id: 1, player_name: "P1", points: 120 },
      { year: 2025, player_id: 1, player_name: "P1", points: 130 },
    ];
    const percentiles = new Map<string, number>([
      ["2023:1", 50],
      ["2024:1", 60],
      ["2025:1", 70],
    ]);

    const series = getPlayerCareerSeries(1, seasonPoints, percentiles);

    expect(series.map(s => s.percentile)).toEqual([50, 60, 70]);
    expect(series.map(s => s.percentileChange)).toEqual([null, 10, 10]);
  });
});

describe("getPlayerCareerYears", () => {
  // James Wood's real shape: two draft-eligible minor-league pool years with
  // no MLB games, then three seasons he actually played.
  const POOL_YEARS = [2022, 2023];
  const playerSeasons: PlayerSeason[] = [
    {
      year: 2022,
      player_id: 1,
      player_name: "P1",
      eligible_slots: [],
      games_played_by_position: {},
      default_position_id: 8,
      jersey: null,
      injury_status: null,
      injured: null,
      pro_team_id: 20,
    },
    {
      year: 2023,
      player_id: 1,
      player_name: "P1",
      eligible_slots: [],
      games_played_by_position: {},
      default_position_id: 8,
      jersey: null,
      injury_status: null,
      injured: null,
      pro_team_id: 20,
    },
    {
      year: 2024,
      player_id: 1,
      player_name: "P1",
      eligible_slots: [],
      games_played_by_position: { "7": 79 },
      default_position_id: 8,
      jersey: null,
      injury_status: null,
      injured: null,
      pro_team_id: 20,
    },
    {
      year: 2025,
      player_id: 1,
      player_name: "P1",
      eligible_slots: [],
      games_played_by_position: { "7": 123 },
      default_position_id: 7,
      jersey: null,
      injury_status: null,
      injured: null,
      pro_team_id: 20,
    },
  ];
  const seen = [2022, 2023, 2024, 2025];

  it("excludes leading minor-league pool years with no games and no fantasy activity", () => {
    expect(getPlayerCareerYears(1, playerSeasons, [], [], [], [], seen)).toEqual([2024, 2025]);
  });

  it("ignores other players' rows", () => {
    const otherSeasons: PlayerSeason[] = [{ ...playerSeasons[2], player_id: 2 }];

    expect(getPlayerCareerYears(1, otherSeasons, [], [], [], [], POOL_YEARS)).toEqual(POOL_YEARS);
  });

  it("does not treat an all-zero games map as evidence", () => {
    // ESPN emits the slot keys with 0 counts for a season the player never
    // played; counting that would set a debut year before the real one.
    const zeroGames: PlayerSeason[] = [{ ...playerSeasons[0], games_played_by_position: { "1": 0 } }, playerSeasons[2]];

    expect(getPlayerCareerYears(1, zeroGames, [], [], [], [], seen)).toEqual([2024, 2025]);
  });

  it("counts a scored season even when no games were recorded", () => {
    // Pre-2010 stat lines don't exist, so points are the only evidence there.
    const points: PlayerSeasonPoints[] = [{ year: 2009, player_id: 1, player_name: "P1", points: 12.5 }];

    expect(getPlayerCareerYears(1, [], points, [], [], [], [2008, 2009, 2010])).toEqual([2009, 2010]);
  });

  it("counts a backfilled season (active in MLB, never rostered here)", () => {
    const backfill: PlayerSeasonBackfill[] = [
      {
        year: 2026,
        player_id: 1,
        player_name: "P1",
        points: 40,
        batting: null,
        pitching: null,
        eligible_slots: [],
        default_position_id: null,
        source: "test",
      },
    ];

    expect(getPlayerCareerYears(1, [], [], backfill, [], [], [2024, 2025, 2026])).toEqual([2026]);
  });

  it("counts a draft or keeper year, the only evidence for an injury season", () => {
    const draftPicks: DraftPick[] = [
      {
        year: 2010,
        overall_pick_number: 4,
        round_id: 1,
        round_pick_number: 4,
        espn_team_id: 3,
        owner_id: "o1",
        player_id: 1,
        player_name: "P1",
        keeper: false,
        traded_pick: false,
        traded_from_espn_team_id: null,
        pro_team_id: 8,
      },
    ];
    const keepers: Keeper[] = [
      {
        year: 2011,
        espn_team_id: 3,
        owner_id: "o1",
        player_id: 1,
        player_name: "P1",
        round_id: 1,
        overall_pick_number: 2,
        validated_on_prior_roster: true,
        pro_team_id: 8,
      },
    ];

    expect(getPlayerCareerYears(1, [], [], [], draftPicks, keepers, [2009, 2010, 2011, 2012])).toEqual([
      2010, 2011, 2012,
    ]);
  });

  it("keeps interior and trailing years that lack evidence", () => {
    // The whole point of the leading-only trim: games coverage is partial, so a
    // missing year is "unreported", not "didn't play". Ichiro 2020-21 and
    // Verlander 2021 are real seasons that per-year evidence would have deleted.
    const points: PlayerSeasonPoints[] = [
      { year: 2009, player_id: 1, player_name: "P1", points: 5 },
      { year: 2010, player_id: 1, player_name: "P1", points: 5 },
      { year: 2014, player_id: 1, player_name: "P1", points: 5 },
    ];
    const seasons = [2009, 2010, 2011, 2012, 2013, 2014];

    expect(getPlayerCareerYears(1, [], points, [], [], [], seasons)).toEqual(seasons);
  });

  it("keeps seasons_seen unchanged when there is no evidence at all", () => {
    expect(getPlayerCareerYears(1, [playerSeasons[0]], [], [], [], [], POOL_YEARS)).toEqual(POOL_YEARS);
  });
});

function makeBoxScoreEntry(
  playerId: number,
  year: number,
  week: number,
  ownerId: string,
  espnTeamId: number,
  scoringPeriod = 1
): BoxScoreEntry {
  return {
    year,
    week,
    matchup_id: 1,
    owner_id: ownerId,
    espn_team_id: espnTeamId,
    player_id: playerId,
    player_name: `P${playerId}`,
    total_points: 0,
    batting: null,
    pitching: null,
    slots: [{ scoring_period: scoringPeriod, lineup_slot_id: 5, points: 0 }],
  };
}

function makeTransaction(overrides: Partial<Transaction> & { year: number; week: number | null }): Transaction {
  return {
    transaction_id: "txn",
    transaction_type: "FREEAGENT",
    scoring_period_id: 1,
    proposed_date: null,
    espn_team_id: 1,
    owner_id: null,
    acting_member_key: null,
    status: "EXECUTED",
    is_league_manager: false,
    related_transaction_id: null,
    bid_amount: 0,
    items: [],
    ...overrides,
  };
}

describe("getPlayerPossessionChain", () => {
  const playerId = 99;

  it("collapses consecutive box-score activity into one run per owner", () => {
    const boxScores = new Map<number, BoxScoreEntry[]>([
      [
        2024,
        [
          makeBoxScoreEntry(playerId, 2024, 1, "owner-a", 1),
          makeBoxScoreEntry(playerId, 2024, 5, "owner-a", 1),
          makeBoxScoreEntry(playerId, 2024, 9, "owner-a", 1),
        ],
      ],
    ]);

    const runs = getPlayerPossessionChain(playerId, boxScores);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      ownerId: "owner-a",
      espnTeamId: 1,
      startYear: 2024,
      startWeek: 1,
      endYear: 2024,
      endWeek: 9,
    });
  });

  it("splits runs when owner changes", () => {
    const boxScores = new Map<number, BoxScoreEntry[]>([
      [2024, [makeBoxScoreEntry(playerId, 2024, 1, "owner-a", 1), makeBoxScoreEntry(playerId, 2024, 5, "owner-b", 2)]],
    ]);

    const runs = getPlayerPossessionChain(playerId, boxScores);

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ ownerId: "owner-a", startWeek: 1, endWeek: 1 });
    expect(runs[1]).toMatchObject({ ownerId: "owner-b", startWeek: 5, endWeek: 5 });
  });

  it("drops phantom post-trade fragments from the original team", () => {
    const boxScores = new Map<number, BoxScoreEntry[]>([
      [
        2026,
        [
          // Evan owns weeks 1-18, then a mid-week trade in wk 18 attributes wk 19 to both teams.
          makeBoxScoreEntry(playerId, 2026, 1, "evan-szymkowicz", 8),
          makeBoxScoreEntry(playerId, 2026, 18, "evan-szymkowicz", 8),
          makeBoxScoreEntry(playerId, 2026, 19, "ryan-cooper", 1),
          makeBoxScoreEntry(playerId, 2026, 19, "evan-szymkowicz", 8),
          makeBoxScoreEntry(playerId, 2026, 20, "ryan-cooper", 1),
        ],
      ],
    ]);
    const transactions: Transaction[] = [
      makeTransaction({
        year: 2026,
        week: 18,
        transaction_type: "TRADE_ACCEPT",
        espn_team_id: 1,
        owner_id: "ryan-cooper",
        items: [
          {
            player_id: playerId,
            item_type: "TRADE",
            from_espn_team_id: 8,
            to_espn_team_id: 1,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
    ];

    const runs = getPlayerPossessionChain(
      playerId,
      boxScores,
      new Map(), // releaseKeys are not needed for this specific fix
      transactions
    );

    expect(runs).toHaveLength(2);
    expect(runs.find(r => r.ownerId === "evan-szymkowicz")).toMatchObject({
      startYear: 2026,
      startWeek: 1,
      endYear: 2026,
      endWeek: 18,
    });
    expect(runs.find(r => r.ownerId === "ryan-cooper")).toMatchObject({
      startYear: 2026,
      startWeek: 19,
      endYear: 2026,
      endWeek: 20,
    });
  });

  it("keeps a post-trade run when the original team genuinely re-acquires the player", () => {
    const boxScores = new Map<number, BoxScoreEntry[]>([
      [
        2026,
        [
          makeBoxScoreEntry(playerId, 2026, 1, "evan-szymkowicz", 8),
          makeBoxScoreEntry(playerId, 2026, 10, "ryan-cooper", 1),
          makeBoxScoreEntry(playerId, 2026, 15, "evan-szymkowicz", 8),
        ],
      ],
    ]);
    const transactions: Transaction[] = [
      makeTransaction({
        year: 2026,
        week: 10,
        transaction_type: "TRADE_ACCEPT",
        espn_team_id: 1,
        owner_id: "ryan-cooper",
        items: [
          {
            player_id: playerId,
            item_type: "TRADE",
            from_espn_team_id: 8,
            to_espn_team_id: 1,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
      makeTransaction({
        year: 2026,
        week: 15,
        transaction_type: "FREEAGENT",
        espn_team_id: 8,
        owner_id: "evan-szymkowicz",
        items: [
          {
            player_id: playerId,
            item_type: "ADD",
            from_espn_team_id: null,
            to_espn_team_id: 8,
            from_lineup_slot_id: null,
            to_lineup_slot_id: null,
          },
        ],
      }),
    ];

    const runs = getPlayerPossessionChain(playerId, boxScores, new Map(), transactions);

    expect(runs).toHaveLength(3);
    expect(runs.filter(r => r.ownerId === "evan-szymkowicz")).toHaveLength(2);
  });
});
