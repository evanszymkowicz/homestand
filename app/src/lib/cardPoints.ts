import type { CardPoints } from "../types";

/** Join key for card rows — matches the `${year}:${player_id}` convention
 * used for team stints elsewhere. */
export function cardKey(year: number, playerId: number): string {
  return `${year}:${playerId}`;
}

export function buildCardPointsMap(rows: CardPoints[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(cardKey(row.year, row.player_id), row.card_points);
  return map;
}

/**
 * A season's card total for display, falling back to rostered points when ESPN
 * reported no season block (e.g. season-long injuries with no stat line) — a
 * missing card row means "unknown", never zero, so the fallback keeps the
 * column honest rather than printing a false 0.0.
 */
export function cardPointsFor(
  map: Map<string, number>,
  year: number,
  playerId: number,
  rosteredPoints: number
): number {
  return map.get(cardKey(year, playerId)) ?? rosteredPoints;
}

/** A whole season-points table re-based onto card totals. Shared re-basing for
 * tables that carry `player_id` (the league-wide field `percentiles` is built
 * from). A single player's career series has no `player_id` on its rows and
 * re-bases inline in PlayerPage instead -- so this is not a chokepoint, and the
 * two bases can still drift if one copy is edited without the other. */
export function toCardBasis<T extends { year: number; player_id: number; points: number }>(
  rows: T[],
  map: Map<string, number>
): T[] {
  return rows.map(r => ({ ...r, points: cardPointsFor(map, r.year, r.player_id, r.points) }));
}
