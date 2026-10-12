import { describe, expect, it } from "vitest";
import { COLLECTIONS, resolveCollection } from "../../lib/collections";

/** Splits a request path exactly as Pages does for the catch-all route
 * `/api/data/{importId}/[[collection]]`. Deriving the segments from a real
 * client URL -- rather than hand-writing them -- is what keeps this honest: an
 * earlier version assumed `box_scores/2024` when the router actually delivers
 * `box_scores/2024.json`, and the test passed against a shape no request had.
 */
function segmentsFor(path: string): string[] {
  const afterImport = path.replace(/^\/api\/data\/[^/]+\//, "");
  return afterImport.split("/").filter(Boolean);
}

describe("resolveCollection", () => {
  it("accepts every flat collection data.ts requests", () => {
    for (const name of COLLECTIONS) {
      expect(resolveCollection(segmentsFor(`/api/data/t/${name}`))).toBe(name);
    }
  });

  it("accepts box_scores/<year>.json as a two-segment path", () => {
    expect(resolveCollection(segmentsFor("/api/data/t/box_scores/2024.json"))).toBe("box_scores/2024.json");
  });

  it("rejects anything not on the allowlist", () => {
    for (const path of ["index.html", "package.json", "_headers", "seasons.json/extra", ""]) {
      expect(resolveCollection(segmentsFor(`/api/data/t/${path}`))).toBeNull();
    }
  });

  it("rejects traversal attempts in either shape", () => {
    expect(resolveCollection(["..", "..", "package.json"])).toBeNull();
    expect(resolveCollection(["%2e%2e%2fpackage.json"])).toBeNull();
    expect(resolveCollection(segmentsFor("/api/data/t/box_scores/.."))).toBeNull();
  });

  it("rejects a box_scores year that is not four digits", () => {
    expect(resolveCollection(["box_scores", "24.json"])).toBeNull();
    expect(resolveCollection(["box_scores", "20244.json"])).toBeNull();
    expect(resolveCollection(["box_scores", "2024"])).toBeNull();
    expect(resolveCollection(["box_scores", "2024.json", "extra.json"])).toBeNull();
  });

  it("cannot be steered at another R2 prefix", () => {
    expect(resolveCollection(["processed", "seasons.json"])).toBeNull();
    expect(resolveCollection(["import", "other", "seasons.json"])).toBeNull();
  });
});
