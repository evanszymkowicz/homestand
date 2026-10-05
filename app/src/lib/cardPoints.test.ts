import { describe, expect, it } from "vitest";
import { buildCardPointsMap, cardKey, cardPointsFor, toCardBasis } from "./cardPoints";
import type { CardPoints } from "../types";

const ROWS: CardPoints[] = [
  { year: 2026, player_id: 1, player_name: "A", card_points: 19.0 },
  { year: 2025, player_id: 1, player_name: "A", card_points: 100.5 },
];

describe("cardKey", () => {
  it("keys on year and player id", () => {
    expect(cardKey(2026, 1)).toBe("2026:1");
  });
});

describe("buildCardPointsMap", () => {
  it("indexes rows by year and player", () => {
    const map = buildCardPointsMap(ROWS);

    expect(map.get("2026:1")).toBe(19.0);
    expect(map.get("2025:1")).toBe(100.5);
    expect(map.get("2026:2")).toBeUndefined();
  });
});

describe("cardPointsFor", () => {
  it("returns the card total when present", () => {
    expect(cardPointsFor(buildCardPointsMap(ROWS), 2026, 1, -14.1)).toBe(19.0);
  });

  it("falls back to rostered points when the card row is missing, never zero", () => {
    expect(cardPointsFor(buildCardPointsMap(ROWS), 2026, 999, -14.1)).toBe(-14.1);
    expect(cardPointsFor(buildCardPointsMap(ROWS), 2026, 999, 0)).toBe(0);
  });

  it("keeps a real zero card total instead of falling back", () => {
    const map = buildCardPointsMap([{ year: 2026, player_id: 2, player_name: "B", card_points: 0 }]);

    expect(cardPointsFor(map, 2026, 2, 5.5)).toBe(0);
  });
});

describe("toCardBasis", () => {
  const seasonPoints = [
    { year: 2025, player_id: 1, player_name: "A", points: 100 },
    { year: 2026, player_id: 1, player_name: "A", points: 120 },
    { year: 2026, player_id: 2, player_name: "B", points: 50 },
  ];

  it("swaps in card totals, falling back per row", () => {
    const map = buildCardPointsMap([{ year: 2026, player_id: 1, player_name: "A", card_points: 150 }]);

    expect(toCardBasis(seasonPoints, map).map(r => r.points)).toEqual([100, 150, 50]);
  });

  it("does not mutate its input", () => {
    toCardBasis(seasonPoints, buildCardPointsMap(ROWS));

    expect(seasonPoints[1].points).toBe(120);
  });
});
