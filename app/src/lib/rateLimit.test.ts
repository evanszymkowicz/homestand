import { describe, expect, it, vi } from "vitest";
import {
  clientIp,
  enforceRateLimit,
  loginKey,
  probeKey,
  resetKey,
  type RateLimiter,
} from "../../functions/lib/rateLimit";

// The native binding is a platform primitive, so what needs testing is our side
// of it: which keys get charged, that one exhausted key denies even when the
// others pass, that every key is charged (no short-circuit oracle), and that a
// broken limiter fails closed.

function limiter(allow: (key: string) => boolean): RateLimiter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    limit: vi.fn(async ({ key }: { key: string }) => {
      calls.push(key);
      return { success: allow(key) };
    }),
  };
}

const always = () => true;
const request = (ip?: string) =>
  new Request("https://homestand.test/api", {
    headers: ip ? { "CF-Connecting-IP": ip } : {},
  });

describe("keys", () => {
  it("charges login by host and by account, never by host alone", () => {
    // Per-host alone lets one attacker spray many accounts; per-account alone
    // lets a botnet grind one account. Both keys must be present.
    expect(loginKey(request("1.2.3.4"), "a@b.com")).toEqual(["ip:1.2.3.4", "acct:a@b.com"]);
  });

  it("separates accounts so two users on one NAT do not share a bucket", () => {
    const host = loginKey(request("1.2.3.4"), "a@b.com")[0];
    const other = loginKey(request("1.2.3.4"), "c@d.com")[0];
    expect(host).toBe(other); // same host, shared bucket...
    expect(loginKey(request("1.2.3.4"), "a@b.com")[1]).not.toBe(loginKey(request("1.2.3.4"), "c@d.com")[1]); // ...but distinct account buckets
  });

  it("keys reset by recipient, since the abuse is hammering one inbox", () => {
    expect(resetKey("a@b.com")).toBe("email:a@b.com");
    expect(resetKey("a@b.com")).not.toBe(resetKey("c@d.com"));
  });

  it("keys probe by account when known and falls back to host otherwise", () => {
    expect(probeKey(request("1.2.3.4"), "acct-1")).toBe("acct:acct-1");
    expect(probeKey(request("1.2.3.4"), null)).toBe("ip:1.2.3.4");
  });

  it("does not collapse to a single shared bucket when the IP header is absent", () => {
    // Local wrangler pages dev omits the header. "unknown" is right there, but
    // it must not silently become the empty string, which would merge everyone.
    expect(clientIp(request())).toBe("unknown");
  });
});

describe("enforceRateLimit", () => {
  it("returns null (allow) while every key is under its limit", async () => {
    const res = await enforceRateLimit(limiter(always), ["ip:1", "acct:a"]);
    expect(res).toBeNull();
  });

  it("returns 429 when any single key is exhausted", async () => {
    const res = await enforceRateLimit(
      limiter(k => k !== "acct:victim"),
      ["ip:1", "acct:victim"]
    );
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("60");
  });

  it("charges every key even when one already failed, so the response leaks nothing", async () => {
    // Short-circuiting on the first denial would let an attacker probe which of
    // their own buckets is spent and rotate to the others.
    const l = limiter(k => k !== "acct:victim");
    await enforceRateLimit(l, ["ip:1", "acct:victim", "extra"]);
    expect(l.calls).toEqual(["ip:1", "acct:victim", "extra"]);
  });

  it("fails closed with 503 when the limiter throws", async () => {
    const broken: RateLimiter = {
      limit: vi.fn(async () => {
        throw new Error("binding unavailable");
      }),
    };
    const res = await enforceRateLimit(broken, ["ip:1"]);
    expect(res?.status).toBe(503);
  });

  it("fails closed with 503 when the binding is missing entirely", async () => {
    // A limiter that allows traffic when it is not wired up is not a limiter.
    const res = await enforceRateLimit(undefined, ["ip:1"]);
    expect(res?.status).toBe(503);
  });

  it("never echoes the key back, which would confirm an account exists", async () => {
    const res = await enforceRateLimit(
      limiter(() => false),
      ["acct:victim@example.com"]
    );
    const body = await res?.text();
    expect(body).not.toContain("victim@example.com");
  });
});
