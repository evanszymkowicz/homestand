import { describe, expect, it } from "vitest";
import { percentileBarBackground } from "./diverging";

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
