import type {
  BoxScoreEntry,
  CardPoints,
  DraftPick,
  Keeper,
  Matchup,
  MlbTeam,
  Owner,
  Player,
  PlayerSeason,
  PlayerSeasonBackfill,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  Trade,
  Transaction,
  TrophyRecord,
  Season,
  Team,
} from "../types";

const cache = new Map<string, Promise<unknown>>();

// Every read goes through the tenant-scoped proxy. There is deliberately no
// fallback to the build-time static bundle: the processed JSON is not public,
// so the proxy is the only way in. An account with no completed import gets
// 404s from every loader, which the routes already render as "unknown".
let currentImportId: string | null = null;

export function setImportContext(importId: string | null) {
  currentImportId = importId;
}

function dataBaseUrl(): string {
  return `/api/data/${currentImportId ?? "none"}/`;
}

const FETCH_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [500, 1000, 2000];

/** Server rejection worth distinguishing from a network error -- status decides
 * whether retrying could ever help (coding-standards.md "Reliability"). */
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`Failed to load ${url}: ${status}`);
    this.status = status;
  }
}

async function fetchJsonWithRetry<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    } catch (error) {
      lastError = error;
      //  Fails a 408 and 429 area code automaticlly to prevent wasting resources on rechecking something that won't change its status
      if (error instanceof HttpError && error.status < 500 && error.status !== 408 && error.status !== 429) {
        throw error;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw lastError;
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }
}

function loadJson<T>(path: string): Promise<T> {
  // Key on tenant + path, not path alone. Keying on path means a tenant switch
  // silently hands the previous account's data to whoever asks next, and the
  // invariant is maintained only by remembering to clear() on switch.
  const key = `${currentImportId ?? "none"}/${path}`;
  const cached = cache.get(key) as Promise<T> | undefined;
  if (cached) return cached;

  const promise = fetchJsonWithRetry<T>(`${dataBaseUrl()}${path}`);
  cache.set(key, promise);
  // Evict rejected promises: otherwise the first transient failure would be
  // replayed forever -- every later caller gets the cached rejection even
  // after the outage ends. The guard keeps an already-replaced entry intact,
  // and this catch also marks the promise handled between callers.
  promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

/** Degrades a loader to `fallback` instead of rejecting, for routes that bundle
 * this call into a `Promise.all` alongside required data -- one 404 on an
 * optional data/manual/ file (see call sites) shouldn't fail the whole page
 * when the UI already treats that file's absence as "unknown", not an error. */
export function withFallback<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(error => {
    console.error(error);
    return fallback;
  });
}

export function loadOwners(): Promise<Owner[]> {
  return loadJson<Owner[]>("owners.json");
}

export function loadSeasons(): Promise<Season[]> {
  return loadJson<Season[]>("seasons.json");
}

export function loadTeams(): Promise<Team[]> {
  return loadJson<Team[]>("teams.json");
}

export function loadMatchups(): Promise<Matchup[]> {
  return loadJson<Matchup[]>("matchups.json");
}

export function loadDraftPicks(): Promise<DraftPick[]> {
  return loadJson<DraftPick[]>("draft_picks.json");
}

export function loadKeepers(): Promise<Keeper[]> {
  return loadJson<Keeper[]>("keepers.json");
}

export function loadPlayers(): Promise<Player[]> {
  return loadJson<Player[]>("players.json");
}

export function loadMlbTeams(): Promise<MlbTeam[]> {
  return loadJson<MlbTeam[]>("mlb_teams.json");
}

export function loadPlayerSeasonPoints(): Promise<PlayerSeasonPoints[]> {
  return loadJson<PlayerSeasonPoints[]>("player_season_points.json");
}

export function loadPlayerTeamSeasonPoints(): Promise<PlayerTeamSeasonPoints[]> {
  return loadJson<PlayerTeamSeasonPoints[]>("player_team_season_points.json");
}

export function loadPlayerSeasons(): Promise<PlayerSeason[]> {
  return loadJson<PlayerSeason[]>("player_seasons.json");
}

export function loadPlayerSeasonBackfill(): Promise<PlayerSeasonBackfill[]> {
  return loadJson<PlayerSeasonBackfill[]>("player_season_backfill.json");
}

export function loadCardPoints(): Promise<CardPoints[]> {
  return loadJson<CardPoints[]>("card_points.json");
}

/**
 * The league's add/drop/trade ledger. **2019+ only* — ESPN serves no
 * transaction data for 2009-2018, so gate any total on a season's
 * `coverage.transactions` rather than on this array being non-empty.
 */
export function loadTransactions(): Promise<Transaction[]> {
  return loadJson<Transaction[]>("transactions.json");
}

export function loadTrades(): Promise<Trade[]> {
  return loadJson<Trade[]>("trades.json");
}

/**
 * ESPN "Fantasy Achievements" trophies. **2026+ only** — the feature launched
 * 2026-02-04 and ESPN serves no earlier seasons, so gate any trophy display on
 * a season's `coverage.achievements` rather than on this array's shape.
 */
export function loadAchievements(): Promise<TrophyRecord[]> {
  return loadJson<TrophyRecord[]>("achievements.json");
}

export function loadBoxScores(year: number): Promise<BoxScoreEntry[]> {
  return loadJson<BoxScoreEntry[]>(`box_scores/${year}.json`);
}

/** The multi-year fan-out used by box-score-heavy views. Resolves with every
 * year that loaded and drops those that didn't -- one failed fetch must not
 * kill a 15-year tab (coding-standards.md "Reliability"). Throws only when
 * *nothing* loaded, so callers keep their whole-view error state for total
 * failure; partial failure surfaces as missing keys plus `PartialCoverageNote`.
 * Callers derive failed years as requested minus returned. */
export async function loadBoxScoresPartial(years: number[]): Promise<Map<number, BoxScoreEntry[]>> {
  const results = await Promise.allSettled(years.map(loadBoxScores));
  const byYear = new Map<number, BoxScoreEntry[]>();
  const failedYears: number[] = [];
  let firstRejection: unknown = null;
  for (const [i, year] of years.entries()) {
    const result = results[i];
    if (result.status === "fulfilled") {
      byYear.set(year, result.value);
      continue;
    }
    if (firstRejection === null) firstRejection = result.reason;
    failedYears.push(year);
  }
  if (years.length > 0 && byYear.size === 0) throw firstRejection ?? new Error("Failed to load all box scores");
  if (failedYears.length > 0) {
    console.warn(`loadBoxScoresPartial: box scores unavailable for ${failedYears.join(", ")}`);
  }
  return byYear;
}

/** owner_ids who've left the league but whose latest team-season still shows
 * them as active (that year hasn't been backfilled yet) -- see
 * data/manual/retired-owners.json for why this is hand-maintained rather
 * than pipeline-derived. */
export async function loadRetiredOwnerIds(): Promise<string[]> {
  const data = await loadJson<{ retired_owner_ids: string[] }>("retired-owners.json");
  return data.retired_owner_ids;
}

export interface JerseyHistoryOverride {
  player_id: number;
  pro_team_id: number;
  jersey: string;
  start_year: number;
  end_year: number;
  start_date?: string;
  end_date?: string;
}

//  Hand verified team/jersey changes that are not captured by ESPN's infra.
export async function loadJerseyHistoryOverrides(): Promise<JerseyHistoryOverride[]> {
  const data = await loadJson<{ overrides: JerseyHistoryOverride[] }>("jersey-history-overrides.json");
  return data.overrides;
}

export interface PositionOverride {
  player_id: number;
  year: number;
  position_id: number;
}

// Override layer for player primary positions: ESPN's value is usually
// "most games at previous season", but corrupted rows get written over
// here. The "league-wide primary position rule" deferred work lives in
// context/future-items.md.
export async function loadPositionOverrides(): Promise<PositionOverride[]> {
  const data = await loadJson<{ overrides: PositionOverride[] }>("position-overrides.json");
  return data.overrides;
}
