import { describe, expect, it } from "vitest";
import {
  getBenchPoints,
  getCountedPoints,
  getDistinctScoringPeriods,
  getMatchupSideEntries,
  getPlayerWeekSlots,
  getSidePointsByPeriod,
  splitEntriesByStatAvailability,
} from "./boxScore";
import { IR_SLOT_ID } from "./lineupSlots";
import type { BoxScoreEntry, BoxScoreSlot } from "../types";

interface MakeEntryOptions {
  matchupId?: number;
  espnTeamId?: number;
  playerId?: number;
  playerName?: string;
  totalPoints?: number;
  batting?: BoxScoreEntry["batting"];
  pitching?: BoxScoreEntry["pitching"];
  slots?: BoxScoreSlot[];
}

function makeEntry(opts: MakeEntryOptions = {}): BoxScoreEntry {
  return {
    year: 2024,
    week: 1,
    matchup_id: opts.matchupId ?? 1,
    owner_id: "alice",
    espn_team_id: opts.espnTeamId ?? 1,
    player_id: opts.playerId ?? 1,
    player_name: opts.playerName ?? "Player One",
    total_points: opts.totalPoints ?? 10,
    batting: opts.batting ?? null,
    pitching: opts.pitching ?? null,
    slots: opts.slots ?? [{ scoring_period: 1, lineup_slot_id: 0, points: opts.totalPoints ?? 10 }],
  };
}

describe("getMatchupSideEntries", () => {
  it("filters by matchup_id and espn_team_id, ignoring the other side", () => {
    const entries = [
      makeEntry({ matchupId: 1, espnTeamId: 1, playerId: 1 }),
      makeEntry({ matchupId: 1, espnTeamId: 2, playerId: 2 }),
      makeEntry({ matchupId: 2, espnTeamId: 1, playerId: 3 }),
    ];

    const result = getMatchupSideEntries(entries, 1, 1);

    expect(result.map(e => e.player_id)).toEqual([1]);
  });
});

describe("getCountedPoints / getBenchPoints", () => {
  it("counts only started (non-bench/IR) slot points", () => {
    const entry = makeEntry({
      totalPoints: 15,
      slots: [
        { scoring_period: 1, lineup_slot_id: 4, points: 10 },
        { scoring_period: 2, lineup_slot_id: 16, points: 5 },
      ],
    });

    expect(getCountedPoints(entry)).toBe(10);
    expect(getBenchPoints(entry)).toBe(5);
  });

  it("returns zero bench points for a player never benched", () => {
    const entry = makeEntry({
      totalPoints: 12,
      slots: [{ scoring_period: 1, lineup_slot_id: 0, points: 12 }],
    });

    expect(getCountedPoints(entry)).toBe(12);
    expect(getBenchPoints(entry)).toBe(0);
  });

  it("returns zero counted points for a player benched every day", () => {
    const entry = makeEntry({
      totalPoints: 8,
      slots: [
        { scoring_period: 1, lineup_slot_id: 16, points: 3 },
        { scoring_period: 2, lineup_slot_id: 17, points: 5 },
      ],
    });

    expect(getCountedPoints(entry)).toBe(0);
    expect(getBenchPoints(entry)).toBe(8);
  });

  it("derives bench points from slots, never from total_points subtraction", () => {
    // Mid-week live captures can lag total_points behind slot detail (bench
    // days land at the weekly rebuild) -- the split must read slots directly.
    const entry = makeEntry({
      totalPoints: 4,
      slots: [
        { scoring_period: 1, lineup_slot_id: 4, points: 10 },
        { scoring_period: 2, lineup_slot_id: 16, points: 5 },
      ],
    });

    expect(getCountedPoints(entry)).toBe(10);
    expect(getBenchPoints(entry)).toBe(5);
  });
});

describe("splitEntriesByStatAvailability", () => {
  const battingLine = {
    ab: 4,
    r: 1,
    singles: 1,
    doubles: 0,
    triples: 0,
    hr: 0,
    rbi: 1,
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
  const pitchingLine = {
    outs: 18,
    h: 4,
    r: 2,
    er: 2,
    bb: 1,
    hb: 0,
    k: 6,
    wins: 1,
    losses: 0,
    sv: 0,
    bs: 0,
    hd: 0,
    sho: 0,
    nh: 0,
    pg: 0,
  };

  it("buckets a hitter into batting, a pitcher into pitching, and a two-way player into both", () => {
    const entries = [
      makeEntry({ playerId: 1, batting: battingLine }),
      makeEntry({ playerId: 2, pitching: pitchingLine }),
      makeEntry({ playerId: 3, batting: battingLine, pitching: pitchingLine }),
    ];

    const { batting, pitching, pointsOnly } = splitEntriesByStatAvailability(entries);

    expect(batting.map(e => e.player_id)).toEqual([1, 3]);
    expect(pitching.map(e => e.player_id)).toEqual([2, 3]);
    expect(pointsOnly).toEqual([]);
  });

  it("falls an entry with neither stat line back to pointsOnly, never dropping the player", () => {
    const entries = [makeEntry({ playerId: 1 })];

    const { batting, pitching, pointsOnly } = splitEntriesByStatAvailability(entries);

    expect(batting).toEqual([]);
    expect(pitching).toEqual([]);
    expect(pointsOnly.map(e => e.player_id)).toEqual([1]);
  });
});

describe("getDistinctScoringPeriods", () => {
  it("returns the sorted union of scoring periods across all entries", () => {
    const entries = [
      makeEntry({
        slots: [
          { scoring_period: 3, lineup_slot_id: 0, points: 1 },
          { scoring_period: 1, lineup_slot_id: 0, points: 1 },
        ],
      }),
      makeEntry({ slots: [{ scoring_period: 2, lineup_slot_id: 0, points: 1 }] }),
    ];

    expect(getDistinctScoringPeriods(entries)).toEqual([1, 2, 3]);
  });

  it("returns a single period for a pre-2019-shaped entry (one slot, no day granularity)", () => {
    const entries = [makeEntry({ slots: [{ scoring_period: 1, lineup_slot_id: 0, points: 10 }] })];

    expect(getDistinctScoringPeriods(entries)).toEqual([1]);
  });
});

describe("getSidePointsByPeriod", () => {
  it("sums only started-slot points per period, excluding bench/IR", () => {
    const entries = [
      makeEntry({
        playerId: 1,
        slots: [
          { scoring_period: 1, lineup_slot_id: 0, points: 5 },
          { scoring_period: 2, lineup_slot_id: 16, points: 3 },
        ],
      }),
      makeEntry({
        playerId: 2,
        slots: [{ scoring_period: 1, lineup_slot_id: 4, points: 2 }],
      }),
    ];

    const result = getSidePointsByPeriod(entries, [1, 2]);

    expect(result).toEqual([7, 0]);
  });

  it("reconciles its total to a side's counted points across every period", () => {
    const entries = [
      makeEntry({
        playerId: 1,
        slots: [
          { scoring_period: 1, lineup_slot_id: 0, points: 4 },
          { scoring_period: 2, lineup_slot_id: 0, points: 6 },
        ],
      }),
    ];
    const periods = getDistinctScoringPeriods(entries);

    const byPeriod = getSidePointsByPeriod(entries, periods);
    const total = byPeriod.reduce((sum, n) => sum + n, 0);
    const counted = getCountedPoints(entries[0]);

    expect(total).toBe(counted);
  });
});

describe("getPlayerWeekSlots", () => {
  it("prefers the player's actual position over IL days and flags onIL", () => {
    const entry = makeEntry({
      slots: [
        { scoring_period: 1, lineup_slot_id: 1, points: 4 }, // 1B
        { scoring_period: 2, lineup_slot_id: 1, points: 5 },
        { scoring_period: 3, lineup_slot_id: IR_SLOT_ID, points: 0 },
        { scoring_period: 4, lineup_slot_id: IR_SLOT_ID, points: 0 },
        { scoring_period: 5, lineup_slot_id: IR_SLOT_ID, points: 0 },
      ],
    });

    const slots = getPlayerWeekSlots(entry)!;

    expect(slots.primaryLabel).toBe("1B");
    expect(slots.onIL).toBe(true);
    expect(slots.changedMidWeek).toBe(true);
  });

  it("leaves a player never on the IL with onIL false and their position unchanged", () => {
    const entry = makeEntry({
      slots: [
        { scoring_period: 1, lineup_slot_id: 4, points: 3 }, // SS
        { scoring_period: 2, lineup_slot_id: 4, points: 3 },
      ],
    });

    const slots = getPlayerWeekSlots(entry)!;

    expect(slots.primaryLabel).toBe("SS");
    expect(slots.onIL).toBe(false);
  });

  it("falls back to IL when the player never left the IL slot", () => {
    const entry = makeEntry({
      slots: [
        { scoring_period: 1, lineup_slot_id: IR_SLOT_ID, points: 0 },
        { scoring_period: 2, lineup_slot_id: IR_SLOT_ID, points: 0 },
      ],
    });

    const slots = getPlayerWeekSlots(entry)!;

    expect(slots.primaryLabel).toBe("IL");
    expect(slots.onIL).toBe(true);
  });

  it("returns null for an entry with no slot data", () => {
    const entry = makeEntry({ slots: [] });

    expect(getPlayerWeekSlots(entry)).toBeNull();
  });
});


describe("PointsPerDay reconciliation", () => {
  it("matches the header score for a complete week with no missing periods", () => {
    const entries = [
      makeEntry({
        playerId: 1,
        slots: [
          { scoring_period: 1, lineup_slot_id: 0, points: 4 },
          { scoring_period: 2, lineup_slot_id: 0, points: 6 },
        ],
      }),
      makeEntry({
        playerId: 2,
        slots: [
          { scoring_period: 1, lineup_slot_id: 1, points: 3 },
          { scoring_period: 2, lineup_slot_id: 1, points: -1 },
        ],
      }),
    ];
    const periods = getDistinctScoringPeriods(entries);
    const byPeriod = getSidePointsByPeriod(entries, periods);
    const total = byPeriod.reduce((sum, n) => sum + n, 0);

    expect(total).toBeCloseTo(12, 5);
  });

  it("under-reports when a scoring period is missing from the box score", () => {
    const entries = [
      makeEntry({
        playerId: 1,
        slots: [
          { scoring_period: 1, lineup_slot_id: 0, points: 4 },
          // period 2 is missing from the data
          { scoring_period: 3, lineup_slot_id: 0, points: 6 },
        ],
      }),
    ];
    const periods = getDistinctScoringPeriods(entries);
    const byPeriod = getSidePointsByPeriod(entries, periods);
    const total = byPeriod.reduce((sum, n) => sum + n, 0);

    // The real week total would be 4 + ? + 6; with period 2 missing we only see 10.
    expect(total).toBeCloseTo(10, 5);
    expect(total).not.toBeCloseTo(15, 5);
  });
});

