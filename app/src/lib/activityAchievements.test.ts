import { describe, expect, it } from "vitest";
import { getAchievementFeats, getBattingFeats, getWeeklyStatLeaders } from "./activityAchievements";
import type { BoxScoreEntry, BattingLine, PitchingLine } from "../types";

const NO_BATTING: BattingLine = {
  ab: 0, r: 0, singles: 0, doubles: 0, triples: 0, hr: 0, rbi: 0,
  bb: 0, hbp: 0, k: 0, sb: 0, cs: 0, gidp: 0, cyc: 0, gshr: 0, e: 0,
};

const NO_PITCHING: PitchingLine = {
  outs: 0, h: 0, r: 0, er: 0, bb: 0, hb: 0, k: 0, wins: 0, losses: 0,
  sv: 0, bs: 0, hd: 0, sho: 0, nh: 0, pg: 0,
};

let nextId = 1;

function makeEntry(overrides: Partial<BoxScoreEntry> = {}): BoxScoreEntry {
  const id = nextId++;
  return {
    year: 2026,
    week: 21,
    matchup_id: 1,
    owner_id: `owner-${(id % 2) + 1}`,
    espn_team_id: (id % 2) + 1,
    player_id: id,
    player_name: `Player ${id}`,
    total_points: 10,
    batting: null,
    pitching: null,
    slots: [],
    ...overrides,
  };
}

describe("getBattingFeats", () => {
  it("detects a cycle", () => {
    const feats = getBattingFeats([makeEntry({ batting: { ...NO_BATTING, cyc: 1 } })]);
    expect(feats).toHaveLength(1);
    expect(feats[0].kind).toBe("cycle");
    expect(feats[0].count).toBe(1);
  });

  it("carries the grand-slam count so 2-slam weeks read differently", () => {
    const feats = getBattingFeats([makeEntry({ batting: { ...NO_BATTING, gshr: 2 } })]);
    expect(feats[0].kind).toBe("grand-slam");
    expect(feats[0].count).toBe(2);
  });

  it("skips entries without a batting line", () => {
    expect(getBattingFeats([makeEntry()])).toHaveLength(0);
  });
});

describe("getAchievementFeats", () => {
  it("detects shutouts, no-hitters, and perfect games independently", () => {
    const feats = getAchievementFeats([
      makeEntry({ player_id: 1, pitching: { ...NO_PITCHING, sho: 1 } }),
      makeEntry({ player_id: 2, pitching: { ...NO_PITCHING, nh: 1 } }),
      makeEntry({ player_id: 3, pitching: { ...NO_PITCHING, pg: 1 } }),
    ]);
    expect(feats.map(f => f.kind).sort()).toEqual(["no-hitter", "perfect-game", "shutout"]);
  });

  it("prefers the most specific feat when one week carries several flags", () => {
    const feats = getAchievementFeats([makeEntry({ pitching: { ...NO_PITCHING, sho: 1, nh: 1 } })]);
    expect(feats).toHaveLength(1);
    expect(feats[0].kind).toBe("no-hitter");
  });

  it("joins the week's fantasy points onto each feat", () => {
    const feats = getAchievementFeats([makeEntry({ pitching: { ...NO_PITCHING, sho: 1 }, total_points: 62.3 })]);
    expect(feats[0].points).toBe(62.3);
  });

  it("sorts most recent week first, higher points breaking ties", () => {
    const feats = getAchievementFeats([
      makeEntry({ player_id: 1, week: 19, pitching: { ...NO_PITCHING, sho: 1 }, total_points: 30 }),
      makeEntry({ player_id: 2, week: 21, pitching: { ...NO_PITCHING, sho: 1 }, total_points: 50 }),
      makeEntry({ player_id: 3, week: 21, batting: { ...NO_BATTING, cyc: 1 }, total_points: 60 }),
    ]);
    expect(feats.map(f => f.playerId)).toEqual([3, 2, 1]);
  });
});

describe("getWeeklyStatLeaders", () => {
  it("finds the max per stat, ignoring entries without the relevant line", () => {
    const leaders = getWeeklyStatLeaders([
      makeEntry({ player_id: 1, batting: { ...NO_BATTING, hr: 2 } }),
      makeEntry({ player_id: 2, batting: { ...NO_BATTING, hr: 4 } }),
      makeEntry({ player_id: 3, pitching: { ...NO_PITCHING, k: 14 } }),
    ]);
    expect(leaders.hr?.playerId).toBe(2);
    expect(leaders.pitcherK?.playerId).toBe(3);
    // Entries 1-2 carry real batting lines, so one of them legitimately holds
    // the RBI lead at 0 — a null batting line, not a zero stat, is what
    // disqualifies an entry.
    expect(leaders.rbi?.value).toBe(0);
  });

  it("reads the points leader off total_points", () => {
    const leaders = getWeeklyStatLeaders([
      makeEntry({ player_id: 1, total_points: 50 }),
      makeEntry({ player_id: 2, total_points: 78.1 }),
    ]);
    expect(leaders.points?.playerId).toBe(2);
    expect(leaders.points?.value).toBeCloseTo(78.1);
  });

  it("breaks value ties on fantasy points, then lower player id", () => {
    const leaders = getWeeklyStatLeaders([
      makeEntry({ player_id: 2, batting: { ...NO_BATTING, hr: 4 }, total_points: 70 }),
      makeEntry({ player_id: 1, batting: { ...NO_BATTING, hr: 4 }, total_points: 78.1 }),
      makeEntry({ player_id: 3, batting: { ...NO_BATTING, hr: 4 }, total_points: 78.1 }),
    ]);
    expect(leaders.hr?.playerId).toBe(1);
  });

  it("counts appearances from days with recorded outs, bench days included", () => {
    const leaders = getWeeklyStatLeaders([
      makeEntry({
        player_id: 1,
        pitching: { ...NO_PITCHING, outs: 42, k: 18, wins: 2 },
        // Two real starts: one while benched, one slotted; the other SP-slot
        // days are the starter sitting idle and carry no stats.
        slots: [
          { scoring_period: 154, lineup_slot_id: 16, points: 20.3, raw_stats: { "34": 21, "48": 9 } },
          { scoring_period: 155, lineup_slot_id: 14, points: 20.3, raw_stats: { "34": 21, "48": 9 } },
          { scoring_period: 156, lineup_slot_id: 14, points: 0 },
          { scoring_period: 157, lineup_slot_id: 14, points: 0 },
        ],
      }),
    ]);
    expect(leaders.pitcherK?.appearances).toBe(2);
  });

  it("collapses a start duplicated onto two slot days (anchoring artifact)", () => {
    // Sale wk21 2026: one 9-IP shutout whose identical line landed on both
    // day-slots — slots sum 54 outs against an authoritative weekly 27.
    const duplicated = makeEntry({
      player_id: 1,
      pitching: { ...NO_PITCHING, outs: 27, k: 11, wins: 1, sho: 1 },
      slots: [
        { scoring_period: 154, lineup_slot_id: 14, points: 13.65, raw_stats: { "34": 27, "48": 11 } },
        { scoring_period: 156, lineup_slot_id: 14, points: 13.65, raw_stats: { "34": 27, "48": 11 } },
      ],
    });
    expect(getWeeklyStatLeaders([duplicated]).pitcherK?.appearances).toBe(1);
  });

  it("grows the count when a benched start never got its own slot day", () => {
    // One slot day carrying 21 of the week's 42 outs — the second start's
    // slot is missing entirely.
    const missing = makeEntry({
      player_id: 1,
      pitching: { ...NO_PITCHING, outs: 42, k: 18, wins: 2 },
      slots: [{ scoring_period: 155, lineup_slot_id: 14, points: 40.6, raw_stats: { "34": 21, "48": 18 } }],
    });
    expect(getWeeklyStatLeaders([missing]).pitcherK?.appearances).toBe(2);
  });
});
