import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBoxScores, loadBoxScoresPartial } from "./data";

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
    vi.stubGlobal("fetch", vi.fn(async () => statusResponse(500)));
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
