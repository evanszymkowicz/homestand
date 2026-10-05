import { describe, expect, it } from "vitest";
import {
  getEligiblePositionIds,
  matchesPositionScope,
  OF_POSITION_ID,
  orderEligiblePositionIdsForPicker,
} from "./positions";

describe("getEligiblePositionIds", () => {
  it("maps every real single-position slot to positions.ts's id space", () => {
    expect(getEligiblePositionIds([0], 2)).toEqual([2]); // C
    expect(getEligiblePositionIds([1], 3)).toEqual([3]); // 1B
    expect(getEligiblePositionIds([2], 4)).toEqual([4]); // 2B
    expect(getEligiblePositionIds([3], 5)).toEqual([5]); // 3B
    expect(getEligiblePositionIds([4], 6)).toEqual([6]); // SS
    expect(getEligiblePositionIds([8], 7)).toEqual([7]); // LF
    expect(getEligiblePositionIds([9], 8)).toEqual([8]); // CF
    expect(getEligiblePositionIds([10], 9)).toEqual([9]); // RF
    expect(getEligiblePositionIds([11], 10)).toEqual([10]); // DH
    expect(getEligiblePositionIds([14], 1)).toEqual([1]); // SP
    expect(getEligiblePositionIds([15], 11)).toEqual([11]); // RP
  });

  it("drops combo/generic/bench/IL/rookie-flag slots that don't name a single position", () => {
    expect(getEligiblePositionIds([5, 6, 7, 12, 13, 16, 17, 19, 21, 22], 3)).toEqual([3]);
  });

  it("dedupes and sorts ascending by position id", () => {
    expect(getEligiblePositionIds([14, 15, 14], 1)).toEqual([1, 11]);
    expect(getEligiblePositionIds([10, 0, 4], 4)).toEqual([2, 6, 9]); // C, SS, RF
  });

  it("falls back to the default position when eligible_slots is empty", () => {
    expect(getEligiblePositionIds([], 5)).toEqual([5]);
  });

  it("falls back to the default position when every present slot is unmapped", () => {
    expect(getEligiblePositionIds([12, 16, 17], 6)).toEqual([6]);
  });
});

describe("matchesPositionScope", () => {
  it("matches an ordinary scope id only against itself", () => {
    expect(matchesPositionScope([2, 3], 2)).toBe(true);
    expect(matchesPositionScope([2, 3], 5)).toBe(false);
  });

  it("matches the OF sentinel against any of LF/CF/RF", () => {
    expect(matchesPositionScope([7], OF_POSITION_ID)).toBe(true);
    expect(matchesPositionScope([8], OF_POSITION_ID)).toBe(true);
    expect(matchesPositionScope([9], OF_POSITION_ID)).toBe(true);
  });

  it("rejects the OF sentinel for a player with no outfield eligibility", () => {
    expect(matchesPositionScope([10], OF_POSITION_ID)).toBe(false); // DH only
    expect(matchesPositionScope([], OF_POSITION_ID)).toBe(false);
  });
});

describe("orderEligiblePositionIdsForPicker", () => {
  it("puts DH last, after RP, and keeps non-outfield positions in natural order", () => {
    // SP, C, 3B, SS, DH, RP
    expect(orderEligiblePositionIdsForPicker([10, 11, 1, 2, 5, 6])).toEqual([1, 2, 5, 6, 11, 10]);
  });

  it("leads the outfield group with OF, then LF, CF, RF", () => {
    expect(orderEligiblePositionIdsForPicker([7, 8, 9, OF_POSITION_ID])).toEqual([0, 7, 8, 9]);
  });

  it("omits outfield spots the player is not eligible at", () => {
    // LF + RF only -> OF, LF, RF with CF omitted
    expect(orderEligiblePositionIdsForPicker([7, 9, OF_POSITION_ID])).toEqual([0, 7, 9]);
  });

  it("orders a full utility set with outfield grouped and DH last", () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, OF_POSITION_ID];
    expect(orderEligiblePositionIdsForPicker(all)).toEqual([1, 2, 3, 4, 5, 6, 0, 7, 8, 9, 11, 10]);
  });

  it("places unknown ids last instead of breaking the order", () => {
    expect(orderEligiblePositionIdsForPicker([10, 99, 2])).toEqual([2, 10, 99]);
  });
});
