/** One asset movement inside an executed trade, reconciled by the pipeline
 * rather than read directly off a single ledger row. */
export interface TradeItem {
  player_id: number;
  /** ADD | DROP (free agency), TRADE (crossing rosters), LINEUP (start/sit). */
  item_type: string;
  from_espn_team_id: number | null;
  to_espn_team_id: number | null;
  from_lineup_slot_id: number | null;
  to_lineup_slot_id: number | null;
  /**
   * `ledger` — ESPN's own TRADE_PROPOSAL record, only recoverable when a
   * daily capture caught it before execution purged it (2026+, or the 2
   * pre-2026 trades ESPN happened to echo onto a TRADE_ACCEPT row).
   * `box_score_diff` — recovered by diffing raw per-period rosters across
   * the trade's execution boundary, for 2019-2025 trades the ledger alone
   * can't recover. See context/features/phase-8-trade-backfill-
   * reconstruction-spec.md.
   */
  source: "ledger" | "box_score_diff";
}

/** One executed trade -- grouped by the originating TRADE_PROPOSAL, kept only
 * when a TRADE_UPHOLD confirms it executed. Tracks exactly two sides; a
 * three-or-more-way trade isn't represented here (none exist in the archive
 * yet) -- see lib/trades.ts's getTradeRegistry, which reads the raw
 * transaction ledger directly for that case. */
export interface Trade {
  year: number;
  trade_id: string;
  proposed_date: number | null;
  executed_date: number | null;
  team_a_espn_team_id: number;
  team_a_owner_id: string | null;
  team_b_espn_team_id: number;
  team_b_owner_id: string | null;
  acting_member_key: string | null;
  items: TradeItem[];
}
