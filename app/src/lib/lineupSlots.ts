/**
 * ESPN MLB lineup slot IDs -> display labels, limited to the ids that actually
 * appear in data/processed/box_scores/*.json (checked 2019 and 2024: {0-7, 12,
 * 14-17}). Positions pinned via 2024 kona_player_info.json eligibleSlots for
 * known players -- Realmuto(C) -> 0; Freeman(1B) -> 1,7; Semien(2B) -> 2,6;
 * Henderson(3B/SS) -> 3,4 (plus 6,7 already covered); Wheeler(SP) -> 14;
 * Clase(RP) -> 15. Other slot ids this league's roster settings never actually
 * fill (e.g. individual OF slots, DH, generic P) fall back to "Slot {id}"
 * rather than guess a label unverified against real data. Bench/IR (16/17)
 * mirror scripts/validate.py's BENCH_AND_IR_SLOTS -- that's the Python source
 * of truth for which slots count toward points_for reconciliation.
 *
 * Pre-2019 box scores carry no real slot data (every entry is lineup_slot_id 0,
 * a placeholder from the era's per-matchup-only stat blocks) -- views must gate
 * on a season's coverage.stat_lines rather than trust a rendered slot label.
 */

export const LINEUP_SLOT_LABELS: Record<number, string> = {
  0: "C",
  1: "1B",
  2: "2B",
  3: "3B",
  4: "SS",
  5: "OF",
  6: "2B/SS",
  7: "1B/3B",
  12: "UTIL",
  14: "SP",
  15: "RP",
  16: "Bench",
  17: "IL",
};

export function lineupSlotLabel(slotId: number): string {
  return LINEUP_SLOT_LABELS[slotId] ?? `Slot ${slotId}`;
}

/** True bench, distinct from IL (17) -- a stashed-on-IL player isn't a lineup
 * decision the way a bench-vs-started swap is. */
export const BENCH_SLOT_ID = 16;
export const IR_SLOT_ID = 17;

export const BENCH_AND_IR_SLOT_IDS: ReadonlySet<number> = new Set([BENCH_SLOT_ID, IR_SLOT_ID]);

/** SP/RP -- the only slots a pitching performance is started in. Used to
 * attribute a started slot's points to batting vs pitching for two-way
 * players (Ohtani) rather than reporting one combined total under both. */
export const PITCHING_SLOT_IDS: ReadonlySet<number> = new Set([14, 15]);
