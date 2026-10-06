export interface CounterDB {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** One `{ limit, windowMs }` allowance. A bucket is denied if any of its rules trips. */
export interface HorizonLimit {
  /** Hits allowed within one window. */
  limit: number;
  windowMs: number;
}

export interface HorizonPolicy {
  targets: Record<string, HorizonLimit[]>;
}

export const HORIZON_POLICIES: Record<string, HorizonPolicy> = {
  login: {
    targets: {
      // A real user who fat-fingers a password a few times should not be locked
      // out; 10 an hour is generous for a human and hopeless for a guessing run.
      acct: [
        { limit: 10, windowMs: HOUR },
        // The daily ceiling is what actually bounds a slow, patient attack.
        { limit: 25, windowMs: DAY },
      ],
      // Catches credential spraying: many accounts, one host. Deliberately much
      // higher than the per-account limit, because NAT and mobile carriers share
      // addresses between unrelated users.
      ip: [{ limit: 60, windowMs: HOUR }],
    },
  },
  reset: {
    targets: {
      // Keyed on the recipient, since the abuse is "hammer one victim's inbox",
      // not "hammer the endpoint".
      email: [
        { limit: 3, windowMs: HOUR },
        // A genuinely locked-out user can still reach their mailbox once a day,
        // which is enough to recover an account without turning this into a
        // mail-bomb primitive.
        { limit: 5, windowMs: DAY },
      ],
    },
  },
  probe: {
    targets: {
      // Tighter than the others on purpose
      acct: [
        { limit: 5, windowMs: 10 * MINUTE },
        { limit: 20, windowMs: DAY },
      ],
    },
  },
  signup: {
    targets: {
      ip: [{ limit: 5, windowMs: HOUR }],
      email: [{ limit: 3, windowMs: HOUR }],
    },
  },
};

/**
 * Builds the rules for one action from the targets a handler actually has.
 */
export function horizonRules(action: string, targets: Record<string, string | null | undefined>): HorizonRule[] {
  const policy = HORIZON_POLICIES[action];
  if (!policy) return [];
  const rules: HorizonRule[] = [];
  for (const [kind, value] of Object.entries(targets)) {
    if (!value) continue;
    const limits = policy.targets[kind];
    if (!limits) continue;
    for (const limit of limits) rules.push({ action, kind, value, ...limit });
  }
  return rules;
}

export interface HorizonRule extends HorizonLimit {
  action: string;
  kind: string;
  value: string;
}

function bucketOf(rule: HorizonRule): string {
  return `${rule.action}:${rule.kind}:${rule.value}`;
}

/** Floors `nowMs` to the start of its window, in epoch seconds. */
function windowStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * Math.floor(windowMs / 1000);
}

const BUMP = `INSERT INTO rate_limit_counters (bucket, window_start, hits) VALUES (?, ?, 1)
ON CONFLICT (bucket, window_start) DO UPDATE SET hits = hits + 1
RETURNING hits`;

const PRUNE = "DELETE FROM rate_limit_counters WHERE window_start < ?";

/** Rows older than this are unreachable by any policy, so the prune can drop them. */
const PRUNE_AFTER_SECONDS = 2 * 24 * 60 * 60;

/** Probability of running the prune on any given request. */
const PRUNE_PROBABILITY = 0.02;

function unavailable(): Response {
  return new Response(JSON.stringify({ error: "rate limiting is unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Retry-After": "60" },
  });
}

function tooMany(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "too many requests, slow down" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
  });
}

export async function enforceHorizon(db: CounterDB | undefined, rules: HorizonRule[]): Promise<Response | null> {
  // No rules means no policy covers this call, which is not a failure -- the
  // caller simply had nothing to charge. A missing database *is* a failure.
  if (rules.length === 0) return null;
  if (!db) return unavailable();

  const nowMs = Date.now();

  try {
    let retryAfterSeconds = 0;

    for (const rule of rules) {
      const windowSec = Math.floor(rule.windowMs / 1000);
      const start = windowStart(nowMs, rule.windowMs);
      const row = await db.prepare(BUMP).bind(bucketOf(rule), start).first<{ hits: number }>();

      const hits = row?.hits ?? rule.limit + 1;
      if (hits > rule.limit) {
        const secondsUntilReset = Math.max(1, start + windowSec - Math.floor(nowMs / 1000));
        retryAfterSeconds = Math.max(retryAfterSeconds, secondsUntilReset);
      }
    }

    if (Math.random() < PRUNE_PROBABILITY) {
      // Awaited rather than fire-and-forget
      await db
        .prepare(PRUNE)
        .bind(Math.floor(nowMs / 1000) - PRUNE_AFTER_SECONDS)
        .run();
    }

    return retryAfterSeconds > 0 ? tooMany(retryAfterSeconds) : null;
  } catch {
    return unavailable();
  }
}
