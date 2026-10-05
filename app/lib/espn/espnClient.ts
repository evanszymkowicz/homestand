/** TypeScript port of the ESPN Fantasy Baseball API client core.
 *
 * This module mirrors scripts/lib/espn_client.py's surface that is relevant to
 * the Homestand backend: URL construction, era splitting, response
 * classification, auth-error detection, and season/week helpers. It is written
 * for the Workers/Pages Functions runtime (native fetch, no Node-only APIs).
 */

export const GAME_KEY = "flb";
export const BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games";

export const VIEWS = [
  "mSettings",
  "mTeam",
  "mStandings",
  "mMatchup",
  "mMatchupScore",
  "mDraftDetail",
  "mRoster",
  "kona_player_info",
] as const;

export type EspnView = (typeof VIEWS)[number];

export const MODERN_ERA_START_YEAR = 2018;
export const TRANSACTION_ERA_START_YEAR = 2019;
export const ROSTER_PERIOD_HARVEST_YEARS: readonly number[] = [2018];
export const TRADE_CAPTURE_START_YEAR = 2026;
export const ACHIEVEMENTS_ERA_START_YEAR = 2026;
export const REQUEST_DELAY_SECONDS = 0.75;
export const MAX_RETRIES = 2;

const SWID_PATTERN = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g;
const ESPN_S2_HINT = /espn_s2=[^&\s"]+/g;

/** Redact SWID-shaped GUIDs and espn_s2 cookie values so credentials never
 * reach logs or error messages. */
export function redactSwid(text: string): string {
  if (!text) return text;
  return text.replace(SWID_PATTERN, "<member-swid>").replace(ESPN_S2_HINT, "espn_s2=<redacted>");
}

/** Build the ESPN API URL for a given year, view, and league.
 *
 * Modern era (`year >= MODERN_ERA_START_YEAR`) uses the `/seasons/{year}`
 * endpoint unless `legacy` is forced. Pre-2018 uses `/leagueHistory/{id}`.
 */
export function buildUrl(
  year: number,
  view: string,
  leagueId: number,
  scoringPeriod?: number,
  legacy?: boolean
): string {
  const useLegacy = legacy ?? year < MODERN_ERA_START_YEAR;
  let url: string;
  if (!useLegacy) {
    url = `${BASE_URL}/${GAME_KEY}/seasons/${year}/segments/0/leagues/${leagueId}?view=${view}`;
  } else {
    url = `${BASE_URL}/${GAME_KEY}/leagueHistory/${leagueId}?seasonId=${year}&view=${view}`;
  }
  if (scoringPeriod !== undefined) {
    url += `&scoringPeriodId=${scoringPeriod}`;
  }
  return url;
}

/** Return the X-Fantasy-Filter header value for kona_player_info.
 *
 * `limit` is set above the full player universe so the percOwned sort never
 * truncates low-ownership players who still accumulated stats.
 */
export function konaPlayerFilter(limit = 6000): string {
  return JSON.stringify({
    players: {
      limit,
      sortPercOwned: { sortAsc: false, sortPriority: 1 },
    },
  });
}

export interface RequestResult {
  statusCode: number | null;
  content: string | null;
  note: string;
}

/** Fetch a single view with the ESPN cookie jar.
 *
 * Retries on 429 / 5xx with exponential backoff. 401 / 403 are treated as
 * persistent auth failures and returned immediately (not retried).
 */
export async function requestView(
  url: string,
  cookies: Record<string, string>,
  view: string,
  options: { konaLimit?: number; fetcher?: typeof fetch } = {}
): Promise<RequestResult> {
  const fetcher = options.fetcher ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (view === "kona_player_info") {
    headers["X-Fantasy-Filter"] = konaPlayerFilter(options.konaLimit ?? 6000);
  }

  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        headers,
        cookies,
      } as RequestInit);
    } catch (exc) {
      return { statusCode: null, content: null, note: `request error: ${redactSwid(String(exc))}` };
    }

    const statusCode = response.status;
    const content = await response.text();

    if (statusCode === 401 || statusCode === 403) {
      return { statusCode, content, note: "auth error (not retried)" };
    }

    if (statusCode === 429 || statusCode >= 500) {
      if (attempt >= MAX_RETRIES) {
        return { statusCode, content, note: `gave up after ${attempt + 1} attempts` };
      }
      attempt += 1;
      await delay(REQUEST_DELAY_SECONDS * 2 ** attempt);
      continue;
    }

    return { statusCode, content, note: "" };
  }
}

function delay(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/** Detect ESPN auth failures, including the 200-with-AUTH_LEAGUE_NOT_VISIBLE trap. */
export function isAuthError(statusCode: number | null, content: string | null): boolean {
  if (statusCode === 401 || statusCode === 403) return true;
  if (!content) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    return false;
  }
  if (Array.isArray(payload)) payload = payload[0] ?? {};
  if (!payload || typeof payload !== "object") return false;
  const details = (payload as Record<string, unknown>).details;
  if (!Array.isArray(details) || details.length === 0) return false;
  return details.some(
    d => d && typeof d === "object" && (d as Record<string, unknown>).type === "AUTH_LEAGUE_NOT_VISIBLE"
  );
}

/** On an auth-shaped failure, retry the opposite endpoint era before giving up. */
export async function fetchWithFallback(
  year: number,
  view: string,
  leagueId: number,
  cookies: Record<string, string>,
  options: {
    scoringPeriod?: number;
    legacy?: boolean;
    konaLimit?: number;
    fetcher?: typeof fetch;
  } = {}
): Promise<RequestResult> {
  const { scoringPeriod, konaLimit, fetcher } = options;
  const legacy = options.legacy ?? year < MODERN_ERA_START_YEAR;

  const url = buildUrl(year, view, leagueId, scoringPeriod, legacy);
  const result = await requestView(url, cookies, view, { konaLimit, fetcher });

  if (isAuthError(result.statusCode, result.content)) {
    await delay(REQUEST_DELAY_SECONDS);
    const altUrl = buildUrl(year, view, leagueId, scoringPeriod, !legacy);
    const alt = await requestView(altUrl, cookies, view, { fetcher });
    if (alt.content !== null && !isAuthError(alt.statusCode, alt.content)) {
      const fallbackName = legacy ? "seasons" : "leagueHistory";
      return { ...alt, note: `via ${fallbackName} fallback` };
    }
  }

  return result;
}

/** leagueHistory responses are list-wrapped; the modern endpoint isn't. */
export function unwrapLeagueObject<T extends Record<string, unknown>>(payload: unknown): T {
  if (Array.isArray(payload)) payload = payload[0] ?? {};
  return (payload && typeof payload === "object" ? payload : {}) as T;
}

export type Signal = "ok" | "empty" | "error";

export interface SignalResult {
  signal: Signal;
  note: string;
}

/** Cheap heuristic: does this payload look like real data or an empty/stub shape? */
export function classifySignal(view: string, payload: unknown): SignalResult {
  const obj = unwrapLeagueObject<Record<string, unknown>>(payload);
  if (!obj || Object.keys(obj).length === 0) {
    return { signal: "empty", note: "response is not a league object" };
  }

  if ("messages" in obj && "details" in obj) {
    const details = (obj.details as Record<string, unknown>[] | undefined) ?? [{}];
    const errorType = String(details[0]?.type ?? "");
    const messages = Array.isArray(obj.messages) ? obj.messages : [];
    const message = messages.join("; ");
    const note = `${errorType}: ${message}`.replace(/: $/, "");
    return { signal: "error", note };
  }

  switch (view) {
    case "mSettings":
      return obj.settings ? { signal: "ok", note: "" } : { signal: "empty", note: "no settings key" };

    case "mTeam":
    case "mStandings":
    case "mRoster": {
      const teams = Array.isArray(obj.teams) ? obj.teams : [];
      if (teams.length === 10) return { signal: "ok", note: "" };
      if (teams.length > 0) return { signal: "empty", note: `only ${teams.length} teams (expected 10)` };
      return { signal: "empty", note: "no teams" };
    }

    case "mMatchup":
    case "mMatchupScore": {
      const schedule = Array.isArray(obj.schedule) ? obj.schedule : [];
      return schedule.length > 0
        ? { signal: "ok", note: `${schedule.length} matchups` }
        : { signal: "empty", note: "no schedule entries" };
    }

    case "mDraftDetail": {
      const picks = ((obj.draftDetail as Record<string, unknown> | undefined)?.picks as unknown[] | undefined) ?? [];
      return picks.length > 0
        ? { signal: "ok", note: `${picks.length} picks` }
        : { signal: "empty", note: "no draft picks" };
    }

    case "kona_player_info": {
      const players = Array.isArray(obj.players) ? obj.players : [];
      return players.length > 0
        ? { signal: "ok", note: `${players.length} players` }
        : { signal: "empty", note: "no players" };
    }

    case "mTransactions2": {
      const transactions = obj.transactions;
      if (transactions === undefined) return { signal: "empty", note: "no transactions key" };
      return { signal: "ok", note: `${Array.isArray(transactions) ? transactions.length : 0} transactions` };
    }

    case "mBoxscore": {
      const schedule = Array.isArray(obj.schedule) ? obj.schedule : [];
      return schedule.length > 0
        ? { signal: "ok", note: `${schedule.length} boxscore entries` }
        : { signal: "empty", note: "no boxscore entries" };
    }

    case "mAchievements": {
      const achievements = obj.achievements;
      if (Array.isArray(achievements) && "member" in obj && "team" in obj) {
        const earned = achievements.filter(Boolean).length;
        return { signal: "ok", note: `${achievements.length} slots (${earned} earned)` };
      }
      return { signal: "empty", note: "no achievements template" };
    }

    default:
      return { signal: "empty", note: "no heuristic for this view" };
  }
}

export function determineFinalScoringPeriod(settingsPayload: unknown): number | undefined {
  const payload = unwrapLeagueObject<Record<string, unknown>>(settingsPayload);
  const status = (payload.status as Record<string, unknown> | undefined) ?? {};
  return (status.finalScoringPeriod as number | undefined) ?? (status.latestScoringPeriod as number | undefined);
}

export function determineLatestScoringPeriod(settingsPayload: unknown): number | undefined {
  const payload = unwrapLeagueObject<Record<string, unknown>>(settingsPayload);
  const status = (payload.status as Record<string, unknown> | undefined) ?? {};
  return status.latestScoringPeriod as number | undefined;
}

export function determineCurrentWeek(settingsPayload: unknown): number {
  const payload = unwrapLeagueObject<Record<string, unknown>>(settingsPayload);
  const status = (payload.status as Record<string, unknown> | undefined) ?? {};
  return (status.currentMatchupPeriod as number) ?? 1;
}

/** "final" once ESPN has advanced through the last scheduled matchup period and
 * every active game in that period is decided. */
export function determineSeasonStatus(settingsPayload: unknown, matchupscore?: unknown): "final" | "in_progress" {
  const payload = unwrapLeagueObject<Record<string, unknown>>(settingsPayload);
  const status = (payload.status as Record<string, unknown> | undefined) ?? {};
  const settings = (payload.settings as Record<string, unknown> | undefined) ?? {};
  const scheduleSettings = (settings.scheduleSettings as Record<string, unknown> | undefined) ?? {};
  const matchupPeriods = (scheduleSettings.matchupPeriods as Record<string, unknown> | undefined) ?? {};
  const totalPeriods = Object.keys(matchupPeriods).length;
  const currentPeriod = (status.currentMatchupPeriod as number) ?? 0;

  if (!totalPeriods) return "in_progress";
  if (currentPeriod < totalPeriods) return "in_progress";
  if (currentPeriod > totalPeriods) return "final";

  if (matchupscore !== undefined) {
    const ms = unwrapLeagueObject<Record<string, unknown>>(matchupscore);
    const schedule = Array.isArray(ms.schedule) ? ms.schedule : [];
    for (const m of schedule) {
      if (!m || typeof m !== "object") continue;
      const game = m as Record<string, unknown>;
      if (game.matchupPeriodId !== totalPeriods) continue;
      if (game.winner === "UNDECIDED") {
        const home = game.home;
        const away = game.away;
        if (home !== null && home !== undefined && away !== null && away !== undefined) {
          return "in_progress";
        }
      }
    }
  }

  return "final";
}

export function decidedWeekPeriods(matchupscorePayload: unknown, matchupPayload?: unknown): Map<number, Set<number>> {
  const scorePayload = unwrapLeagueObject<Record<string, unknown>>(matchupscorePayload);
  const schedule = Array.isArray(scorePayload.schedule) ? scorePayload.schedule : [];

  const gamesByWeek = new Map<number, Record<string, unknown>[]>();
  for (const m of schedule) {
    if (!m || typeof m !== "object") continue;
    const game = m as Record<string, unknown>;
    const week = game.matchupPeriodId;
    if (typeof week === "number") {
      const list = gamesByWeek.get(week) ?? [];
      list.push(game);
      gamesByWeek.set(week, list);
    }
  }

  const matchupWinners = new Map<number, string>();
  if (matchupPayload !== undefined) {
    const mu = unwrapLeagueObject<Record<string, unknown>>(matchupPayload);
    const muSchedule = Array.isArray(mu.schedule) ? mu.schedule : [];
    for (const m of muSchedule) {
      if (!m || typeof m !== "object") continue;
      const game = m as Record<string, unknown>;
      const gameId = game.id;
      if (typeof gameId === "number") {
        matchupWinners.set(gameId, String(game.winner ?? "UNDECIDED"));
      }
    }
  }

  const winnerOf = (g: Record<string, unknown>): string =>
    matchupWinners.get(g.id as number) ?? String(g.winner ?? "UNDECIDED");

  const decided = new Map<number, Set<number>>();
  for (const [week, games] of [...gamesByWeek.entries()].sort((a, b) => a[0] - b[0])) {
    if (games.some(g => winnerOf(g) === "UNDECIDED")) continue;
    const periods = new Set<number>();
    for (const g of games) {
      for (const sideKey of ["home", "away"] as const) {
        const side = (g[sideKey] as Record<string, unknown> | undefined) ?? {};
        const byPeriod = (side.pointsByScoringPeriod as Record<string, unknown> | undefined) ?? {};
        for (const key of Object.keys(byPeriod)) {
          const num = Number(key);
          if (!Number.isNaN(num)) periods.add(num);
        }
      }
    }
    decided.set(week, periods);
  }

  return decided;
}
