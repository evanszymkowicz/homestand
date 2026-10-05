import { describe, expect, it, vi, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACHIEVEMENTS_ERA_START_YEAR,
  MODERN_ERA_START_YEAR,
  TRANSACTION_ERA_START_YEAR,
  buildUrl,
  classifySignal,
  decidedWeekPeriods,
  determineCurrentWeek,
  determineFinalScoringPeriod,
  determineLatestScoringPeriod,
  determineSeasonStatus,
  fetchWithFallback,
  isAuthError,
  konaPlayerFilter,
  redactSwid,
  requestView,
  unwrapLeagueObject,
} from "../../../lib/espn/espnClient";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const upstreamRawDir = process.env.UPSTREAM_RAW_DIR ?? path.resolve(repoRoot, "../wsob-record-book/data/raw");

const upstreamAvailable = fs.existsSync(upstreamRawDir);
const fixtures = new Map<string, unknown>();

function loadFixture(year: number | string, filename: string): unknown | undefined {
  const key = `${year}/${filename}`;
  if (fixtures.has(key)) return fixtures.get(key);
  const filePath = path.join(upstreamRawDir, String(year), filename);
  if (!fs.existsSync(filePath)) return undefined;
  const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
  fixtures.set(key, content);
  return content;
}

function listYears(): number[] {
  if (!upstreamAvailable) return [];
  return fs
    .readdirSync(upstreamRawDir)
    .map(n => Number(n))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
}

beforeAll(() => {
  if (!upstreamAvailable) {
    console.warn(`upstream raw dir not found at ${upstreamRawDir}; parity tests will skip`);
  }
});

describe("buildUrl", () => {
  it("builds a modern-era URL", () => {
    expect(buildUrl(2025, "mSettings", 6121)).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2025/segments/0/leagues/6121?view=mSettings"
    );
  });

  it("builds a legacy-era URL", () => {
    expect(buildUrl(2017, "mSettings", 6121)).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/leagueHistory/6121?seasonId=2017&view=mSettings"
    );
  });

  it("forces legacy for a modern year when asked", () => {
    expect(buildUrl(2025, "mSettings", 6121, undefined, true)).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/leagueHistory/6121?seasonId=2025&view=mSettings"
    );
  });

  it("adds scoringPeriodId when provided", () => {
    expect(buildUrl(2025, "mBoxscore", 6121, 42)).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2025/segments/0/leagues/6121?view=mBoxscore&scoringPeriodId=42"
    );
  });

  it("adds scoringPeriodId to legacy URLs", () => {
    expect(buildUrl(2010, "mRoster", 6121, 7)).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/leagueHistory/6121?seasonId=2010&view=mRoster&scoringPeriodId=7"
    );
  });
});

describe("konaPlayerFilter", () => {
  it("emits the expected X-Fantasy-Filter shape", () => {
    const filter = JSON.parse(konaPlayerFilter(6000));
    expect(filter).toEqual({
      players: {
        limit: 6000,
        sortPercOwned: { sortAsc: false, sortPriority: 1 },
      },
    });
  });
});

describe("redactSwid", () => {
  it("redacts a bare SWID", () => {
    expect(redactSwid("{12345678-1234-1234-1234-123456789ABC}")).toBe("<member-swid>");
  });

  it("redacts espn_s2 cookie values", () => {
    expect(redactSwid("https://...?espn_s2=ABC123&view=mSettings")).toBe(
      "https://...?espn_s2=<redacted>&view=mSettings"
    );
  });

  it("leaves unrelated text alone", () => {
    expect(redactSwid("no credentials here")).toBe("no credentials here");
  });
});

describe("unwrapLeagueObject", () => {
  it("unwraps a leagueHistory list-wrapped payload", () => {
    const wrapped = [{ settings: { name: "x" } }];
    expect(unwrapLeagueObject(wrapped)).toEqual({ settings: { name: "x" } });
  });

  it("passes through a modern object payload", () => {
    const obj = { settings: { name: "x" } };
    expect(unwrapLeagueObject(obj)).toEqual(obj);
  });

  it("returns an empty object for null/undefined", () => {
    expect(unwrapLeagueObject(null)).toEqual({});
    expect(unwrapLeagueObject(undefined)).toEqual({});
  });
});

describe("isAuthError", () => {
  it("detects 401 and 403 status codes", () => {
    expect(isAuthError(401, null)).toBe(true);
    expect(isAuthError(403, null)).toBe(true);
    expect(isAuthError(200, null)).toBe(false);
  });

  it("detects the AUTH_LEAGUE_NOT_VISIBLE trap", () => {
    const content = JSON.stringify({
      messages: ["not visible"],
      details: [{ type: "AUTH_LEAGUE_NOT_VISIBLE" }],
    });
    expect(isAuthError(200, content)).toBe(true);
  });

  it("handles list-wrapped error payloads", () => {
    const content = JSON.stringify([{ messages: [], details: [{ type: "AUTH_LEAGUE_NOT_VISIBLE" }] }]);
    expect(isAuthError(200, content)).toBe(true);
  });
});

describe("classifySignal (upstream parity)", () => {
  const viewCases: { view: string; filename?: string; years?: number[] }[] = [
    { view: "mSettings" },
    { view: "mTeam" },
    { view: "mStandings" },
    { view: "mMatchup" },
    { view: "mMatchupScore" },
    { view: "mDraftDetail" },
    { view: "kona_player_info" },
    { view: "mRoster", filename: "mRoster.json" },
  ];

  it.each(viewCases)("classifies $view as ok across available years", ({ view, filename }) => {
    if (!upstreamAvailable) return;
    const file = filename ?? `${view}.json`;
    const checks: { year: number; result: string }[] = [];
    for (const year of listYears()) {
      const payload = loadFixture(year, file);
      if (payload === undefined) continue;
      const { signal, note } = classifySignal(view, payload);
      if (signal !== "ok") {
        checks.push({ year, result: `${signal}: ${note}` });
      }
    }
    expect(checks).toEqual([]);
  });

  it("classifies mTransactions2 when present", () => {
    if (!upstreamAvailable) return;
    const checks: { year: number; result: string }[] = [];
    for (const year of listYears()) {
      if (year < TRANSACTION_ERA_START_YEAR) continue;
      const payload = loadFixture(year, "mTransactions2-period1.json");
      if (payload === undefined) continue;
      const { signal, note } = classifySignal("mTransactions2", payload);
      if (signal !== "ok") checks.push({ year, result: `${signal}: ${note}` });
    }
    expect(checks).toEqual([]);
  });

  it("classifies mBoxscore when present", () => {
    if (!upstreamAvailable) return;
    const checks: { year: number; result: string }[] = [];
    for (const year of listYears()) {
      if (year < MODERN_ERA_START_YEAR) continue;
      const payload = loadFixture(year, "mBoxscore-period1.json");
      if (payload === undefined) continue;
      const { signal, note } = classifySignal("mBoxscore", payload);
      if (signal !== "ok") checks.push({ year, result: `${signal}: ${note}` });
    }
    expect(checks).toEqual([]);
  });

  it("classifies achievements when present", () => {
    if (!upstreamAvailable) return;
    const checks: { year: number; result: string }[] = [];
    for (const year of listYears()) {
      if (year < ACHIEVEMENTS_ERA_START_YEAR) continue;
      const files = fs.readdirSync(path.join(upstreamRawDir, String(year))).filter(f => f.startsWith("achievements-"));
      for (const file of files.slice(0, 1)) {
        const payload = loadFixture(year, file);
        if (payload === undefined) continue;
        const { signal, note } = classifySignal("mAchievements", payload);
        if (signal !== "ok") checks.push({ year, result: `${signal}: ${note}` });
      }
    }
    expect(checks).toEqual([]);
  });
});

describe("season helpers (upstream parity)", () => {
  it("reads finalScoringPeriod/latestScoringPeriod from mSettings", () => {
    if (!upstreamAvailable) return;
    for (const year of listYears()) {
      const payload = loadFixture(year, "mSettings.json");
      if (payload === undefined) continue;
      const final = determineFinalScoringPeriod(payload);
      expect(final).toBeTypeOf("number");
      expect(final).toBeGreaterThan(0);
    }
  });

  it("reads latestScoringPeriod and currentMatchupPeriod from mSettings", () => {
    if (!upstreamAvailable) return;
    for (const year of listYears()) {
      const payload = loadFixture(year, "mSettings.json");
      if (payload === undefined) continue;
      const latest = determineLatestScoringPeriod(payload);
      const currentWeek = determineCurrentWeek(payload);
      expect(typeof latest === "number" || latest === undefined).toBe(true);
      expect(typeof currentWeek).toBe("number");
      expect(currentWeek).toBeGreaterThan(0);
    }
  });

  it("determines season status consistently", () => {
    if (!upstreamAvailable) return;
    for (const year of listYears()) {
      const settings = loadFixture(year, "mSettings.json");
      const matchupScore = loadFixture(year, "mMatchupScore.json");
      if (settings === undefined || matchupScore === undefined) continue;
      const status = determineSeasonStatus(settings, matchupScore);
      expect(["final", "in_progress"]).toContain(status);
    }
  });

  it("decides weeks from mMatchupScore", () => {
    if (!upstreamAvailable) return;
    for (const year of listYears()) {
      const matchupScore = loadFixture(year, "mMatchupScore.json");
      if (matchupScore === undefined) continue;
      const decided = decidedWeekPeriods(matchupScore);
      expect(decided.size).toBeGreaterThan(0);
      for (const periods of decided.values()) {
        expect(periods.size).toBeGreaterThan(0);
      }
    }
  });
});

describe("requestView", () => {
  it("returns auth error immediately on 401 without retry", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      status: 401,
      text: async () => "unauthorized",
    } as Response);

    const result = await requestView("https://example.com", { espn_s2: "x", SWID: "y" }, "mSettings", {
      fetcher,
    });

    expect(result.statusCode).toBe(401);
    expect(result.note).toBe("auth error (not retried)");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries 429 up to MAX_RETRIES with REQUEST_DELAY_SECONDS backoff", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ status: 429, text: async () => "" } as Response)
      .mockResolvedValueOnce({ status: 429, text: async () => "" } as Response)
      .mockResolvedValueOnce({ status: 429, text: async () => "" } as Response);

    const promise = requestView("https://example.com", {}, "mSettings", { fetcher });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.statusCode).toBe(429);
    expect(result.note).toBe("gave up after 3 attempts");
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("sets X-Fantasy-Filter for kona_player_info", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => "{}",
    } as Response);

    await requestView("https://example.com", {}, "kona_player_info", { fetcher, konaLimit: 1234 });

    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "X-Fantasy-Filter": konaPlayerFilter(1234),
    });
  });
});

describe("fetchWithFallback", () => {
  it("uses era fallback on auth-shaped failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify([{ messages: ["nope"], details: [{ type: "AUTH_LEAGUE_NOT_VISIBLE" }] }]),
      } as Response)
      .mockResolvedValueOnce({ status: 200, text: async () => "{}" } as Response);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const promise = fetchWithFallback(2025, "mSettings", 6121, {}, { fetcher });
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.statusCode).toBe(200);
    expect(result.note).toBe("via leagueHistory fallback");
  });
});
