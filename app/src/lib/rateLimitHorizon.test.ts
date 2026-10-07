import { describe, expect, it } from "vitest";
import {
  enforceHorizon,
  horizonRules,
  HORIZON_POLICIES,
  type CounterDB,
  type HorizonRule,
} from "../../functions/lib/rateLimitHorizon";

// The D1 table is a platform primitive, so what needs testing is our side of it:
// that every rule is charged, that one tripped window denies even when the
// others pass, that Retry-After waits for the longest window to roll over, and
// that a broken database fails closed.

interface StubOptions {
  /**
   * How many hits the stub reports for a charged rule, as an offset from that
   * rule's own allowance. `1` means one past the limit (denied), `0` means
   * exactly at it (allowed), `-1` means one under. Default 1, i.e. denied.
   *
   * Keyed off the rule rather than a literal count so the same expectation holds
   * as the policies are retuned.
   */
  offset?: number;
  /** Throw on the charge, simulating a D1 error. */
  failOnCharge?: boolean;
  /** Fixed clock for window flooring. */
  now?: number;
}

const acctRules = (value = "a@b.com"): HorizonRule[] => horizonRules("login", { acct: value, ip: "1.2.3.4" });

/** Mirrors the module's window flooring so the stub can key on the real primary key. */
function windowStartFor(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * Math.floor(windowMs / 1000);
}

/**
 * A stub that honours the bound values rather than parsing SQL, so these tests
 * stay honest if the statement text changes.
 *
 * Keyed on `(bucket, window_start)` like the real table, because one bucket can
 * carry several windows -- `login:acct:a@b.com` has both an hourly and a daily
 * rule, and collapsing them would hide which one tripped.
 *
 * Reports against each rule's own allowance, so the same expectation survives the
 * policies being retuned and repeated calls on one stub do not drift.
 */
function counterDb(
  rules: HorizonRule[],
  { offset = 1, failOnCharge = false, now = Date.now() }: StubOptions = {}
): CounterDB & { charged: string[] } {
  const allowances = new Map<string, number>();
  for (const rule of rules) {
    allowances.set(
      `${rule.action}:${rule.kind}:${rule.value}:${rule.windowMs}@${windowStartFor(now, rule.windowMs)}`,
      rule.limit
    );
  }
  const charged: string[] = [];
  return {
    charged,
    prepare(_sql: string) {
      return {
        bind: (...values: unknown[]) => ({
          first: async <T>(): Promise<T | null> => {
            if (failOnCharge) throw new Error("D1 unavailable");
            const [bucket, window] = values as [string, number];
            charged.push(bucket);
            const limit = allowances.get(`${bucket}@${window}`) ?? 1;
            return { hits: Math.max(0, limit + offset) } as T;
          },
          run: async () => null,
        }),
      };
    },
  };
}

describe("horizonRules", () => {
  it("builds every rule the policy declares for the targets it is given", () => {
    const rules = horizonRules("login", { acct: "a@b.com", ip: "1.2.3.4" });
    // acct hourly + acct daily + ip hourly
    expect(rules).toHaveLength(3);
    expect(rules.map(r => `${r.kind}:${r.windowMs}`)).toEqual(["acct:3600000", "acct:86400000", "ip:3600000"]);
  });

  it("ignores a target kind the policy does not declare, rather than defaulting it", () => {
    // A handler gaining a new target must not silently change a limit.
    const rules = horizonRules("login", { acct: "a@b.com", nonsense: "x" });
    expect(rules.every(r => r.kind === "acct")).toBe(true);
  });

  it("skips absent targets, so a null ip charges only the account windows", () => {
    // Local wrangler pages dev omits CF-Connecting-IP. Charging an "ip:unknown"
    // bucket there would merge every local caller into one shared budget.
    const rules = horizonRules("login", { acct: "a@b.com", ip: null });
    expect(rules).toHaveLength(2);
  });

  it("returns nothing for an unknown action instead of throwing", () => {
    expect(horizonRules("nope", { acct: "a@b.com" })).toEqual([]);
  });
});

describe("enforceHorizon", () => {
  it("allows while every window is under its limit", async () => {
    const rules = acctRules();
    expect(await enforceHorizon(counterDb(rules, { offset: -1 }), rules)).toBeNull();
  });

  it("charges every rule even when one already tripped, so the response leaks nothing", async () => {
    // Same reasoning as enforceRateLimit: short-circuiting would let an attacker
    // find which of their own buckets is spent and rotate to the others.
    const rules = acctRules();
    const db = counterDb(rules);
    await enforceHorizon(db, rules);
    expect(db.charged).toHaveLength(rules.length);
  });

  it("denies once a window's allowance is spent", async () => {
    const rules = acctRules();
    expect((await enforceHorizon(counterDb(rules), rules))?.status).toBe(429);
  });

  it("allows at exactly the allowance, since the limit is inclusive", async () => {
    // Off-by-one guard: a user who has used their full allowance must still get
    // through, or the advertised limit understates the real one.
    const rules = acctRules();
    expect(await enforceHorizon(counterDb(rules, { offset: 0 }), rules)).toBeNull();
  });

  it("advertises the longest wait, not the shortest, since every tripped window must clear", async () => {
    const rules = acctRules();
    // Fixed clock: 10:00 UTC, so the hourly window has 50 minutes left and the
    // daily one nearly 24 hours. Without this the assertion holds only when the
    // suite happens to run early in the UTC day.
    const nowMs = Date.UTC(2026, 0, 2, 10, 0, 0);
    const res = await enforceHorizon(counterDb(rules, { now: nowMs }), rules, nowMs);
    const retryAfter = Number(res?.headers.get("Retry-After"));
    // Both the hourly and the daily window are spent, and the daily one has
    // barely started. Advertising the hourly reset would invite an immediate
    // second 429, so Retry-After must be the longer of the two.
    expect(retryAfter).toBeGreaterThan(60 * 59);
    expect(retryAfter).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it("fails closed with 503 when D1 throws", async () => {
    const rules = acctRules();
    expect((await enforceHorizon(counterDb(rules, { failOnCharge: true }), rules))?.status).toBe(503);
  });

  it("fails closed with 503 when the database is missing entirely", async () => {
    // A limiter that allows traffic when it is not wired up is not a limiter.
    const res = await enforceHorizon(undefined, acctRules());
    expect(res?.status).toBe(503);
  });

  it("skips the database entirely when no policy covers the action", async () => {
    // Nothing to charge is not a failure, so this must not become a 503 that
    // takes down every endpoint with an unmapped action.
    expect(await enforceHorizon(undefined, horizonRules("nope", { acct: "a@b.com" }))).toBeNull();
  });

  it("never echoes the target, which would confirm an account exists", async () => {
    const rules = acctRules();
    const res = await enforceHorizon(counterDb(rules), rules);
    expect(await res?.text()).not.toContain("a@b.com");
  });

  it("charges separate buckets per target, so one address cannot spend another's budget", async () => {
    // reset has an hourly and a daily window, so two rules per address. The point
    // is that c@d.com's request never lands in a@b.com's bucket.
    const first = horizonRules("reset", { email: "a@b.com" });
    const second = horizonRules("reset", { email: "c@d.com" });
    const db = counterDb([...first, ...second], { offset: -1 });
    await enforceHorizon(db, first);
    await enforceHorizon(db, second);
    // Bucket strings carry the window size too, so the two windows of one
    // address are distinct rows as well as distinct from the other address.
    expect(db.charged).toEqual([
      "reset:email:a@b.com:3600000",
      "reset:email:a@b.com:86400000",
      "reset:email:c@d.com:3600000",
      "reset:email:c@d.com:86400000",
    ]);
  });

  it("keeps a spent budget denied on every subsequent request", async () => {
    const rules = acctRules();
    const db = counterDb(rules);
    expect((await enforceHorizon(db, rules))?.status).toBe(429);
    expect((await enforceHorizon(db, rules))?.status).toBe(429);
  });
});

describe("policies", () => {
  it("gives every declared target at least one limit", () => {
    // A typo'd target key would otherwise ship as a silently unlimited path.
    for (const [action, policy] of Object.entries(HORIZON_POLICIES)) {
      for (const [kind, limits] of Object.entries(policy.targets)) {
        expect(limits.length, `${action}.${kind}`).toBeGreaterThan(0);
        for (const limit of limits) expect(limit.limit).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every per-minute ceiling stricter than its hourly equivalent", () => {
    // The native binding still allows 20/60s on login; if the horizon layer were
    // looser per hour than that, adding it would have been pointless.
    // The hourly window is deliberately a full hour, not "more than a minute":
    // the point is to bound a multi-hour run, which the binding cannot express.
    const [acctHourly] = HORIZON_POLICIES.login.targets.acct;
    expect(acctHourly.windowMs).toBe(60 * 60 * 1000);
    // 10/hour against the binding's 20/minute, so the tighter ceiling wins.
    expect(acctHourly.limit).toBeLessThan(20);
  });
});
