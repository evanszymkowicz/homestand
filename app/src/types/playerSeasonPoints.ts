export interface PlayerSeasonPoints {
  year: number;
  player_id: number;
  player_name: string;
  points: number;
}

/**
 * Points a player produced for ONE team in a season — the per-owner split that
 * `PlayerSeasonPoints` rolls up. 1,307 of the archive's 7,195 player-seasons
 * are split across more than one owner, so for those the season total credits
 * production a given manager never actually received.
 */
export interface PlayerTeamSeasonPoints {
  year: number;
  player_id: number;
  player_name: string;
  owner_id: string;
  espn_team_id: number;
  points: number;
  /** Started-slot production — the share of `points` scored in a starting
   * lineup. Always present in the JSON (REAL NOT NULL in D1); pre-2018 it
   * trivially equals `points` because bench tracking didn't exist yet. */
  counted_points: number;
  /** Bench/IL production — the share of `points` left out of starting
   * lineups. Always 0 pre-2018. */
  bench_points: number;
}

/**
 * ESPN's full-season player-card total for one player-season — everything the
 * player scored in real life under the league's scoring, rostered days and
 * free-agent days alike (`data/processed/card_points.json`, harvested from
 * each kona snapshot's own full-season block). Missing rows mean ESPN
 * reported no season block; consumers fall back to rostered points, never to
 * zero.
 */
export interface CardPoints {
  year: number;
  player_id: number;
  player_name: string;
  card_points: number;
}

/**
 * Full-season batting/pitching stats and fantasy points for player-seasons that
 * are missing from the box-score archive — e.g., players active in MLB who were
 * never rostered in the league that season.
 */
export interface PlayerSeasonBackfill {
  year: number;
  player_id: number;
  player_name: string;
  points: number;
  batting: import("./boxScore").BattingLine | null;
  pitching: import("./boxScore").PitchingLine | null;
  eligible_slots: number[];
  default_position_id: number | null;
  source: string;
}

