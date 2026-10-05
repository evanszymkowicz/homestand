import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBoxScores, loadBoxScoresPartial, setImportContext } from "./data";

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function statusResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error(`status ${status}`);
    },
  } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setImportContext(null);
});

/** The proxy is a catch-all route whose `resolveCollection` allowlist lives in
 * app/functions/api/data/[importId]/[[collection]].ts. These pin the exact URL
 * shapes the loaders emit so a loader can never ask for a path the proxy
 * rejects -- the failure mode that silently broke every box-score read when the
 * route matched only a single segment and the SPA fallback answered with HTML. */
describe("scoped request URLs", () => {
  async function urlFor(load: () => Promise<unknown>): Promise<string> {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await load();
    return String(fetchMock.mock.calls[0][0]);
  }

  it("routes every collection through the authenticated proxy", async () => {
    setImportContext("import-abc");
    expect(await urlFor(() => loadBoxScores(2024))).toBe("/api/data/import-abc/box_scores/2024.json");
  });

  it("keeps nested box_scores paths two segments deep", async () => {
    setImportContext("import-abc");
    const url = await urlFor(() => loadBoxScoresPartial([2019, 2020]));
    expect(url).toBe("/api/data/import-abc/box_scores/2019.json");
  });

  it("never falls back to the public static bundle when no import is selected", async () => {
    setImportContext(null);
    // Still the proxy (and therefore still gated), just with a sentinel tenant
    // that matches no row, so every loader 404s instead of reading /data/ off disk.
    expect(await urlFor(() => loadBoxScores(2024))).toBe("/api/data/none/box_scores/2024.json");
  });

  it("does not serve one tenant's cached response to another", async () => {
    // Same path, different tenant: a path-only cache key would return the first
    // tenant's promise here and never hit the network again.
    const first = vi.fn().mockResolvedValue(okResponse([{ player_id: 1 }]));
    vi.stubGlobal("fetch", first);
    setImportContext("tenant-a");
    await expect(loadBoxScores(2024)).resolves.toEqual([{ player_id: 1 }]);

    const second = vi.fn().mockResolvedValue(okResponse([{ player_id: 2 }]));
    vi.stubGlobal("fetch", second);
    setImportContext("tenant-b");
    await expect(loadBoxScores(2024)).resolves.toEqual([{ player_id: 2 }]);
    expect(second.mock.calls[0][0]).toBe("/api/data/tenant-b/box_scores/2024.json");
  });
});

describe("fetchJsonWithRetry (via loadBoxScores)", () => {
  it("retries transient failures before succeeding", async () => {
    const entries = [{ player_id: 1 }];
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(okResponse(entries));
    vi.stubGlobal("fetch", fetchMock);

    const pending = loadBoxScores(1997);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual(entries);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not burn the retry schedule on a deterministic client error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusResponse(404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadBoxScores(1998)).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a later caller refetch after a fully-failed call was evicted", async () => {
    const entries = [{ player_id: 2 }];
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("outage"));
    vi.stubGlobal("fetch", fetchMock);

    const caught = loadBoxScores(1999).catch(error => error);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await caught).toBeInstanceOf(TypeError);
    // Initial attempt plus three retries at the decided 500ms/1s/2s backoff.
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockResolvedValue(okResponse(entries));
    await expect(loadBoxScores(1999)).resolves.toEqual(entries);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("loadBoxScoresPartial", () => {
  it("keeps successful years and drops failed ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/box_scores/1996.") ? statusResponse(503) : okResponse([{ player_id: 3 }])
      )
    );

    const pending = loadBoxScoresPartial([1995, 1996]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const settled = await pending;
    expect(settled.has(1995)).toBe(true);
    expect(settled.has(1996)).toBe(false);
  });

  it("throws when every year failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => statusResponse(500))
    );
    const pending = loadBoxScoresPartial([1994, 1993]).then(
      () => {
        throw new Error("should have thrown");
      },
      error => error
    );
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBeInstanceOf(Error);
  });

  it("resolves empty without fetching when no years are requested", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadBoxScoresPartial([])).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
