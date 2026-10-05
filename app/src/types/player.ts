export interface Player {
  player_id: number;
  full_name: string;
  /** Career-level primary position. For a given year use PlayerSeason's.
   * Non-null: ESPN reports it for all 2,010 players in the archive, and
   * validate.py's player_positions check keeps it that way. */
  default_position_id: number;
  /** Union across every season seen. ESPN slot ids run 0-22; 0 is catcher. */
  eligible_slots: number[];
  /** position-id-as-string -> career games. Legitimately exceeds 162/season. */
  games_played_by_position: Record<string, number>;
  /** Latest-season-wins, not career facts. */
  active: boolean | null;
  pro_team_id: number | null;
  /** ESPN serves this as a string. null before 2017 (not reported, not "none"). */
  jersey: string | null;
  droppable: boolean | null;
  seasons_seen: number[];
  /** Days this player spent on any fantasy roster, 2019+ only */
  roster_days: number;
}

/** Per-player-per-season eligibility, health, and market value — the
 * year-by-year counterpart to Player's career aggregates. */
export interface PlayerSeason {
  year: number;
  player_id: number;
  player_name: string;
  /** That season's slots, not the career union. */
  eligible_slots: number[];
  /** position-id-as-string -> games that season. */
  games_played_by_position: Record<string, number>;
  /** That season's PRIMARY position. Non-null: present for all 8,039 rows
   * across all 17 seasons, asserted by validate.py's player_positions check. */
  default_position_id: number;
  /** 2017+ only — null earlier means "ESPN reported none", not "no number". */
  jersey: string | null;
  /**
   * Status as of ESPN's last update to that season's data, i.e. roughly
   * season-end — NOT "was injured during this season". null before 2017.
   */
  injury_status: string | null;
  injured: boolean | null;
  /** That season's real MLB team, same per-year truth as DraftPick/Keeper's
   * field. null only for a player outside both kona_player_info's ~500-cap
   * and that year's mRoster. */
  pro_team_id: number | null;
  /**
   * ESPN fantasy team id for the current season, from kona_player_info's
   * onTeamId. 0 means free agent; null when the source view didn't report it
   * (historical seasons or pre-kona eras).
   */
  fantasy_team_id?: number | null;
}

/** ESPN's league-wide draft/ownership market for one player in the latest
 * season. Latest season only — historical ownership is never used by the app.
 * Cross-league, NOT this league's 10 rosters — which is what makes it useful:
 * a high scorer at low percent_owned is a player the whole fantasy world
 * undervalued. */
export interface PlayerSeasonOwnership {
  year: number;
  player_id: number;
  player_name: string;
  percent_owned: number;
  percent_started: number;
  percent_change: number;
  /** null where ESPN reports no ADP — this does NOT mean the player went undrafted. */
  average_draft_position: number | null;
  average_draft_position_percent_change: number | null;
  auction_value_average: number | null;
  auction_value_average_change: number | null;
}
