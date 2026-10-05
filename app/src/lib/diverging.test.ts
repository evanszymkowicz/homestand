import { describe, expect, it } from "vitest";
import { percentileBackground, percentileBarBackground } from "./diverging";

describe("percentileBackground", () => {
  it("leaves the 50th percentile untinted", () => {
    expect(percentileBackground(50)).toEqual({});
  });

  it("tints the positive pole above the median and the negative pole below it", () => {
    expect(percentileBackground(100).backgroundColor).toContain("--color-diverge-pos");
    expect(percentileBackground(0).backgroundColor).toContain("--color-diverge-neg");
  });

  it("reaches full strength at both ends and stays partial in between", () => {
    expect(percentileBackground(100).backgroundColor).toContain("70%");
    expect(percentileBackground(0).backgroundColor).toContain("70%");
    expect(percentileBackground(75).backgroundColor).toContain("35%");
  });
});

describe("percentileBarBackground", () => {
  it("renders the 50th percentile as a visible neutral gray, never an empty style", () => {
    const style = percentileBarBackground(50);
    expect(style).not.toEqual({});
    expect(style.backgroundColor).toContain("ink-faint");
  });

  it("tints the positive pole above the median and the negative pole below it", () => {
    expect(percentileBarBackground(100).backgroundColor).toContain("--color-diverge-pos");
    expect(percentileBarBackground(0).backgroundColor).toContain("--color-diverge-neg");
  });

  it("always returns a non-empty backgroundColor", () => {
    for (const percentile of [0, 1, 5, 25, 49, 50, 51, 62, 75, 90, 99, 100]) {
      expect(percentileBarBackground(percentile).backgroundColor).toBeTruthy();
    }
  });
});
