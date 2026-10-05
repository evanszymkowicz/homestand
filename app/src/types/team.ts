export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
}

export type StreakType = "WIN" | "LOSS";

/** ESPN's own season transaction counters, present for all 17 seasons —
 * distinct from `transactions.json`, which is the per-event ledger and only
 * covers 2019+. These counters are the only transaction data that spans the
 * full archive. */
export interface TeamTransactions {
  /**
   * Repaired where ESPN's season scalar contradicts its own per-week totals:
   * `max(scalar, sum(acquisitions_by_week))`. Affects 2018 only, whose scalar
   * reads 14 league-wide against 348 from the per-week data.
   */
  acquisitions: number;
  drops: number;
  /** Counted once per participating team, so two team-sides make one trade. */
  trades: number;
  moves_to_active: number;
  moves_to_ir: number;
  /** Always 0 — this league has never run an acquisition budget or fees. */
  acquisitions_budget_spent: number;
  team_charges: number;
  /** week-as-string -> acquisitions made that week. */
  acquisitions_by_week: Record<string, number>;
}

export interface Team {
  year: number;
  espn_team_id: number;
  owner_ids: string[];
  primary_owner_id: string;
  team_name: string;
  division_id: number;
  final_rank: number;
  playoff_seed: number;
  overall: TeamRecord;
  home: TeamRecord;
  away: TeamRecord;
  division_record: TeamRecord;
  streak_type: StreakType;
  streak_length: number;

  // --- Phase 9.1 enrichment ---
  /** Preseason projection. Real for 2021+ only; null earlier. */
  draft_day_projected_rank: number | null;
  /** Waiver priority as of the season's end. */
  waiver_rank: number | null;
  logo_url: string | null;
  /**
   * Raw season stat COUNTS keyed by statId-as-string — not fantasy points, and
   * NOT a decomposition of points_for (the counts include bench players, so
   * weighting them by the season's scoring lands ~7-16% above it). Empty for
   * 2009-2018.
   */
  value_by_stat: Record<string, number>;
  transactions: TeamTransactions;

  // --- in-season-only fields ---
  // ESPN populates these while a season is live and resets them when it ends,
  // so every archived row carries the reset value. Treat a historical row's
  // value as ESPN's post-season reset, not as evidence about that season.
  eliminated: boolean;
  elimination_matchup_period: number | null;
  points_adjusted: number;
  current_projected_rank: number | null;
  is_transaction_locked: boolean;
}
