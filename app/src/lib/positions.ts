/**
 * `Player.default_position_id` -> display label. ESPN doesn't publish this enum
 * anywhere this repo has found (checked scripts/, context/project-overview.md,
 * data/manual/) -- pinned empirically the same way lineupSlots.ts pins its own
 * (different) id space: spot-checked known players in data/processed/players.json
 * against their real-world primary position. 1 -> Kershaw/Scherzer/deGrom (SP),
 * 2 -> Realmuto (C), 3 -> Freeman (1B), 4 -> Semien (2B), 5 -> Machado (3B),
 * 6 -> Turner (SS), 7 -> Manny Ramirez/Crawford-era LF group, 8 -> Trout/Judge
 * (CF), 9 -> Ichiro/Beltran-era RF group, 10 -> Ohtani (DH), 11 -> Diaz/Clase (RP).
 *
 * The same id space keys `games_played_by_position` on Player/PlayerSeason
 * (verified: 2024 Betts reads 65 games at 6/SS and 43 at 9/RF, matching his
 * real season; 2021 Ohtani reads 23 at 1/SP and 126 at 10/DH). 12 was pinned
 * from that data rather than from a player's primary position -- it never
 * appears as a `default_position_id`, only ever as a modest games count
 * alongside a real position, and its leaders are bench bats (2021 Matt Beaty
 * 59, 2021 Ryan Zimmerman 58, 2019 Curtis Granderson 57), which is PH.
 */
export const POSITION_LABELS: Record<number, string> = {
  // 0 is a synthetic group id, not a real ESPN position -- see OF_POSITION_ID
  // below. It's safe to reuse 0 here since it never appears as a real
  // default_position_id/games_played_by_position key (that space starts at 1).
  0: "OF",
  1: "SP",
  2: "C",
  3: "1B",
  4: "2B",
  5: "3B",
  6: "SS",
  7: "LF",
  8: "CF",
  9: "RF",
  10: "DH",
  11: "RP",
  12: "PH",
};

/** POSITION_LABELS' labels in display order (OF, SP, C, 1B ... RP, PH). For
 * dropdowns that list positions by name rather than id -- the owner keeper
 * filter, say -- so the order lives with the label table instead of being
 * rebuilt at each call site. */
export const POSITION_LABEL_ORDER = Object.values(POSITION_LABELS);

/**
 * Position ids excluded from the position displays.
 *
 * 12 (PH) is a plate appearance, not a fielding position — it says nothing
 * about where a player can be used, which is the whole point of showing
 * positions here. It also never appears as a `default_position_id`, so
 * excluding it can never drop a player's primary position. Leaving it in
 * inflated the versatility board with bench bats: Jurickson Profar read 9
 * positions instead of 8, and Ben Zobrist — an actual utility player — was
 * pushed out of the top five by players who simply pinch-hit a lot.
 *
 * The label above is deliberately kept so nobody re-pins id 12 to something
 * else later.
 */
export const DISPLAY_EXCLUDED_POSITION_IDS: ReadonlySet<number> = new Set([12]);

/**
 * `PlayerSeason.eligible_slots` -> this file's own position-id space (above).
 * A DIFFERENT id space from POSITION_LABELS/games_played_by_position -- ESPN's
 * eligible_slots is its own universal lineup-slot enum, ids 0-22, not the 1-12
 * space this file otherwise uses. It also happens to share ids 0-7 with
 * lineupSlots.ts's roster-slot enum (a third, unrelated space scoped to this
 * league's own configured roster slots) -- that overlap is coincidence, not
 * kinship; do not merge the two tables.
 *
 * Empirically verified (not published anywhere ESPN documents): cross-tabulated
 * eligible_slots against games_played_by_position across all 8,584
 * player_seasons.json rows, using player-seasons with one dominant (>=20 games)
 * position as ground truth -- hundreds of samples per slot, each with a clear
 * dominant match (e.g. slot 0 co-occurs with position 2/C in 334 of 353 such
 * rows; slot 9 with position 8/CF in 398 of 580).
 *
 * Slots deliberately left unmapped, because they name a group or roster
 * concept rather than one real position:
 *   5  -- generic OF (splits across LF/CF/RF; see OF_POSITION_IDS below)
 *   6  -- 2B/SS combo slot (this league's own roster construction)
 *   7  -- 1B/3B combo slot (same)
 *   12 -- UTIL (any batter)
 *   13 -- generic "P" -- confirmed zero player_seasons.json rows carry slot 13
 *         without also carrying 14 and/or 15, so nothing is lost dropping it
 *   16 -- bench, 17 & 19 -- IL variants (every player is bench/IL-eligible)
 *   21, 22 -- rare rookie-designation flags (2-3 rows total in the archive)
 * Position id 12 (PH) has no ESPN eligible_slots equivalent at all -- it's a
 * games-derived-only pseudo-position (see POSITION_LABELS's doc comment above),
 * consistent with DISPLAY_EXCLUDED_POSITION_IDS already excluding it.
 */
export const ESPN_ELIGIBLE_SLOT_TO_POSITION_ID: Partial<Record<number, number>> = {
  0: 2, // C
  1: 3, // 1B
  2: 4, // 2B
  3: 5, // 3B
  4: 6, // SS
  8: 7, // LF
  9: 8, // CF
  10: 9, // RF
  11: 10, // DH
  14: 1, // SP
  15: 11, // RP
};

/**
 * Every position a player was ESPN fantasy-eligible for, given one season's
 * raw `eligible_slots`, mapped through the table above and deduped, ascending
 * by position id (which already reads SP...RP, POSITION_LABELS's own order).
 *
 * Falls back to `[defaultPositionId]` when the mapped set is empty and a
 * default is provided -- either because `eligible_slots` itself was empty
 * (one row in the whole archive, 2009 A. Sonnanstine) or because every slot
 * present mapped to nothing (a combo/generic/bench slot only). When
 * `defaultPositionId` is null the set stays empty, which callers should treat
 * as "eligibility unknown" (used for backfilled seasons). */
export function getEligiblePositionIds(eligibleSlots: number[], defaultPositionId: number | null): number[] {
  const ids = new Set<number>();
  for (const slot of eligibleSlots) {
    const positionId = ESPN_ELIGIBLE_SLOT_TO_POSITION_ID[slot];
    if (positionId !== undefined) ids.add(positionId);
  }
  if (ids.size === 0 && defaultPositionId !== null) ids.add(defaultPositionId);
  return Array.from(ids).sort((a, b) => a - b);
}

/** LF/CF/RF -- the individual outfield positions ESPN's own generic "OF"
 * roster slot (eligible_slots id 5, deliberately unmapped above) actually
 * groups together. */
export const OF_POSITION_IDS: ReadonlySet<number> = new Set([7, 8, 9]);

/** Synthetic id for the "OF" grouping filter/picker option -- not a real
 * ESPN or games_played_by_position id (that space starts at 1), so 0 is free
 * to reuse here. Resolves to the label "OF" via POSITION_LABELS above. */
export const OF_POSITION_ID = 0;

/** Whether a player's eligible-position set matches a chosen filter/picker
 * scope. Ordinary ids are exact membership; OF_POSITION_ID is a stand-in for
 * "any of LF/CF/RF" rather than a real id on the player's own eligible list. */
export function matchesPositionScope(eligiblePositionIds: number[], scopePositionId: number): boolean {
  if (scopePositionId === OF_POSITION_ID) {
    return eligiblePositionIds.some(id => OF_POSITION_IDS.has(id));
  }
  return eligiblePositionIds.includes(scopePositionId);
}

/** Preferred display order for a position picker/dropdown. Every non-outfield,
 * non-DH id keeps its natural ascending order; the outfield group reads
 * "OF, LF, CF, RF" (OF_POSITION_ID leading the specific spots it stands in
 * for), and DH sorts last so it never lands mid-list between RF and RP. */
const PICKER_POSITION_ORDER: number[] = [1, 2, 3, 4, 5, 6, OF_POSITION_ID, 7, 8, 9, 11, 10];

/** Sort an eligible-position set into the picker's display order. Only ids
 * actually present in the input are returned, so an outfielder eligible at
 * just LF/RF shows OF, LF, RF with CF omitted. Ids outside the known table
 * sort last rather than breaking the order. */
export function orderEligiblePositionIdsForPicker(ids: number[]): number[] {
  const rank = new Map(PICKER_POSITION_ORDER.map((id, i) => [id, i]));
  return [...ids].sort(
    (a, b) => (rank.get(a) ?? PICKER_POSITION_ORDER.length) - (rank.get(b) ?? PICKER_POSITION_ORDER.length)
  );
}

/**
 * ESPN's public headshot CDN. Not a field in any archived response — the
 * pattern is `.../full/{playerId}.png`, verified against real ids spanning the
 * archive (Jamie Moyer 1799 and Derek Jeter 3246 through Jackson Chourio
 * 4917869 all return a real image). A player with no photo 404s cleanly rather
 * than serving a silhouette, so callers can fall back on the error event.
 *
 * This hotlinks a third party: images load from espncdn.com at view time, so
 * they break if ESPN moves them, and the request happens from the viewer's
 * browser.
 */
export function headshotUrl(playerId: number): string {
  return `https://a.espncdn.com/i/headshots/mlb/players/full/${playerId}.png`;
}

export function positionLabel(id: number): string {
  return POSITION_LABELS[id] ?? `Pos ${id}`;
}
