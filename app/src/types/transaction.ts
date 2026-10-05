/** One player movement inside a transaction. */
export interface TransactionItem {
  player_id: number;
  /** ADD | DROP (free agency), TRADE (crossing rosters), LINEUP (start/sit). */
  item_type: string;
  /** null means free agency / no team (ESPN's team-id 0, normalized away). */
  from_espn_team_id: number | null;
  to_espn_team_id: number | null;
  /** null means "not on a lineup". 0 is a REAL slot id (catcher). */
  from_lineup_slot_id: number | null;
  to_lineup_slot_id: number | null;
}

/**
 * One entry in the league's add/drop/trade ledger.
 *
 * Coverage is 2019-2025 ONLY -- ESPN serves no transaction data for 2009-2018,
 * which is 7 of the archive's 17 seasons. Check a season's
 * `coverage.transactions` before presenting any figure as all-time.
 *
 * Routine lineup shuffling (FUTURE_ROSTER) and draft picks (DRAFT) are not in
 * this file: the first is noise, and `draft_picks.json` is the source of truth
 * for the second.
 */
export interface Transaction {
  year: number;
  transaction_id: string;
  /** FREEAGENT | ROSTER | TRADE_PROPOSAL | TRADE_ACCEPT | TRADE_DECLINE | ... */
  transaction_type: string;
  /** A DAY in this daily-scoring league, not a week. */
  scoring_period_id: number;
  /** null when the day fell outside any scheduled matchup week (68 of 3,143). */
  week: number | null;
  /** Epoch ms. null on ~236 rows ESPN serves with no date, mostly 2020. */
  proposed_date: number | null;
  espn_team_id: number;
  owner_id: string | null;
  /**
   * Salted hash identifying WHICH co-owner acted; never a raw ESPN member id
   * (that id is the SWID session cookie). null where ESPN omits it.
   */
  acting_member_key: string | null;
  status: string | null;
  is_league_manager: boolean;
  /** Links a TRADE_ACCEPT/DECLINE back to the TRADE_PROPOSAL it answers. */
  related_transaction_id: string | null;
  /** Always 0: this league has never used an acquisition budget. */
  bid_amount: number;
  /**
   * EMPTY FOR MOST EXECUTED TRADES. ESPN prunes the proposal once a trade
   * executes, so 10 of the 12 executed trades in 2019-2025 have no recoverable
   * player exchange -- only the collateral drops. Do not build a trade-grading
   * view on the assumption these are populated. Adds and drops are complete.
   */
  items: TransactionItem[];
}
