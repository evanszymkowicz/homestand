// The set of processed-archive files a client is allowed to read, shared by
// the authenticated proxy (app/functions/api/data/[importId]/[[collection]].ts)
// and src/lib/dataProxy.test.ts. Deliberately free of any runtime types so it
// can be imported from both the Worker bundle and the app tsconfig.

/** Flat collections. `box_scores` is the only nested one. */
const COLLECTIONS = new Set([
  "owners.json",
  "seasons.json",
  "teams.json",
  "matchups.json",
  "draft_picks.json",
  "keepers.json",
  "players.json",
  "mlb_teams.json",
  "player_season_points.json",
  "player_team_season_points.json",
  "player_seasons.json",
  "player_season_backfill.json",
  "card_points.json",
  "transactions.json",
  "trades.json",
  "achievements.json",
  "retired-owners.json",
  "jersey-history-overrides.json",
  "position-overrides.json",
]);

/** The catch-all hands us the raw path segments, so the box-score year arrives
 * as `2024.json`, not `2024`. */
const BOX_SCORE_YEAR = /^\d{4}\.json$/;

/** Maps the proxy's path segments to an R2 key under `processed/`, or null if
 * the request is not for something we serve.
 *
 * An allowlist rather than a path pattern: the client supplies these segments,
 * and they end up naming an object in the bucket. Anything not named here is a
 * 404, which is also what stops `../`, absolute URLs, and `index.html` from
 * being reachable. */
export function resolveCollection(segments: string[]): string | null {
  if (segments.length === 1 && COLLECTIONS.has(segments[0])) return segments[0];
  if (segments.length === 2 && segments[0] === "box_scores" && BOX_SCORE_YEAR.test(segments[1])) {
    return `box_scores/${segments[1]}`;
  }
  return null;
}
