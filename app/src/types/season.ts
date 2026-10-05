export type CoverageLevel = "full" | "partial" | "missing";

export interface SeasonCoverage {
  teams: CoverageLevel;
  matchups: CoverageLevel;
  draft: CoverageLevel;
  rosters: CoverageLevel;
  players: CoverageLevel;
  box_scores: CoverageLevel;
  stat_lines: CoverageLevel;
  /**
   * Never "partial": ESPN's per-period transaction endpoint either serves a
   * season or it doesn't. It doesn't for 2009-2018, so this is "missing" for
   * 7 of the 17 seasons -- gate any transaction figure on it.
   */
  transactions: CoverageLevel;
  /**
   * Binary like transactions: the "Fantasy Achievements" trophies are a 2026+
   * feature (launched 2026-02-04; ESPN serves no earlier seasons), and zero
   * earned trophies is a quiet state, not a hole. Gate any trophy display on
   * this rather than on achievements data being non-empty.
   */
  achievements: CoverageLevel;
}

export interface SeasonDivision {
  division_id: number;
  name: string;
}

export interface ScoringItem {
  stat_id: number;
  points: number;
}

export interface LeagueSettings {
  league_id: number;
  league_name: string;
  league_size: number;
  is_public: boolean;
}

export interface RosterRules {
  /** Zero-count slots are omitted. */
  lineup_slot_counts: Record<string, number>;
  position_limits: Record<string, number>;
  bench_unlimited: boolean;
  move_limit: number | null;
  lineup_lock_time: string;
  roster_lock_time: string;
  using_undroppable_list: boolean;
}

export interface AcquisitionRules {
  acquisition_type: string;
  waiver_hours: number;
  waiver_order_reset: boolean;
  waiver_process_days: string[];
  waiver_process_hour: number;
  minimum_bid: number;
  using_acquisition_budget: boolean;
  acquisition_budget: number | null;
  acquisition_limit: number | null;
  matchup_acquisition_limit: number | null;
  transaction_locking_enabled: boolean;
}

export interface DraftSettings {
  draft_type: string;
  order_type: string;
  keeper_count: number;
  keeper_order_type: string;
  /** Epoch ms. Absent for 2009. */
  keeper_deadline_date: number | null;
  auction_budget: number | null;
  time_per_pick: number;
}

export interface TradeRules {
  /** Epoch ms. ESPN omits this entirely in several seasons. */
  deadline_date: number | null;
  max_trades: number | null;
  revision_hours: number;
  veto_votes_required: number;
}

export type SeasonStatus = "in_progress" | "final";

export interface Season {
  year: number;
  regular_season_weeks: number;
  playoff_weeks: number;
  playoff_team_count: number;
  playoff_brackets: string[];
  divisions: SeasonDivision[];
  scoring: ScoringItem[];
  coverage: SeasonCoverage;
  status: SeasonStatus;
  /** ESPN's currentMatchupPeriod -- the week a scoreboard should default to. */
  current_week: number;
  notes: string[];
  settings: LeagueSettings;
  roster_rules: RosterRules;
  acquisition_rules: AcquisitionRules;
  draft_settings: DraftSettings;
  trade_rules: TradeRules;
}
