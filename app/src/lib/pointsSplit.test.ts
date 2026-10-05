import { describe, expect, it } from "vitest";
import type { SeasonPlayerLine } from "./boxScore";
import { buildScoringByYear, splitLinePoints } from "./pointsSplit";
import type { BattingLine, PitchingLine, Season } from "../types";

function battingLine(over: Partial<BattingLine> = {}): BattingLine {
  return {
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
    ...over,
  };
}

function pitchingLine(over: Partial<PitchingLine> = {}): PitchingLine {
  return {
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
    ...over,
  };
}

function line(over: Partial<SeasonPlayerLine> = {}): SeasonPlayerLine {
  return {
    playerId: 1,
    playerName: "Two Way",
    weeksRostered: 1,
    countedPoints: 0,
    battingCountedPoints: 0,
    pitchingCountedPoints: 0,
    benchPoints: 0,
    batting: null,
    pitching: null,
    ilOnly: false,
    slotSide: null,
    ...over,
  };
}

// A trimmed stand-in for one season's scoringItems: AB -0.4, HR 4.2, RBI 1.4
// on the batting side; OUT 0.5, K 1.0, ER -1.0 on the pitching side.
const SEASON = {
  year: 2024,
  scoring: [
    { stat_id: 0, points: -0.4 },
    { stat_id: 5, points: 4.2 },
    { stat_id: 21, points: 1.4 },
    { stat_id: 34, points: 0.5 },
    { stat_id: 48, points: 1 },
    { stat_id: 45, points: -1 },
  ],
} as unknown as Season;

const RULES = buildScoringByYear([SEASON]).get(2024);

describe("splitLinePoints", () => {
  it("scores each half from that season's rules", () => {
    const split = splitLinePoints(
      line({
        batting: battingLine({ ab: 10, hr: 2, rbi: 5 }),
        pitching: pitchingLine({ outs: 18, k: 7, er: 3 }),
      }),
      RULES
    );

    expect(split.batting).toBeCloseTo(-4 + 8.4 + 7);
    expect(split.pitching).toBeCloseTo(9 + 7 - 3);
  });

  it("returns null for a side the player has no line for", () => {
    const batOnly = splitLinePoints(line({ batting: battingLine({ hr: 1 }) }), RULES);

    expect(batOnly.batting).toBeCloseTo(4.2);
    expect(batOnly.pitching).toBeNull();
  });

  it("lets a bad pitching half go negative rather than clamping it", () => {
    const split = splitLinePoints(line({ pitching: pitchingLine({ outs: 3, er: 8 }) }), RULES);

    expect(split.pitching).toBeCloseTo(1.5 - 8);
  });

  it("returns nulls for a year with no scoring rules on file", () => {
    expect(splitLinePoints(line({ batting: battingLine({ hr: 1 }) }), undefined)).toEqual({
      batting: null,
      pitching: null,
    });
  });

  it("adds up to the line's whole total, the reconciliation stat_ids.py guarantees", () => {
    const both = line({
      batting: battingLine({ ab: 4, hr: 1, rbi: 3 }),
      pitching: pitchingLine({ outs: 21, k: 9, er: 2 }),
    });
    const split = splitLinePoints(both, RULES);
    const total = -1.6 + 4.2 + 4.2 + 10.5 + 9 - 2;

    expect((split.batting ?? 0) + (split.pitching ?? 0)).toBeCloseTo(total);
  });
});
