// Rate limiting on top of Cloudflare's native `ratelimits` binding.
//
// Applied to the three endpoints that are unauthenticated or carry credentials:
//   login        -- 100k-iteration PBKDF2 per attempt, so a CPU-burn lever and
//                   an online password oracle
//   reset-request-- a D1 write plus an outbound email per call
//   probe        -- an oracle for a full ESPN session
//
// Why the native binding and not a D1 counter: it is a platform feature, it costs
// no D1 write on the hot path, and the limits live in wrangler.jsonc where they
// are reviewable. Nothing here needs a migration.
//
// Two documented ceilings, both inherited from the API rather than chosen:
//
//   - Counters are per Cloudflare location, so a client spread across N
//     locations effectively gets N x the configured limit. Fine as a throttle,
//     not a hard cap.
//   - Period must be 10 or 60 seconds. There is no hourly window, so
//     reset-request can still send at most 5 emails/minute to one address
//     (~300/hour). A longer horizon needs a D1-backed counter or a WAF rule.
//   - The API is permissive and eventually consistent by design; Cloudflare is
//     explicit that it is not an accounting system. A determined distributed
//     attacker will get through more than `limit`.
//
// Both are acceptable for throttling. If any of them ever needs to be a real
// guarantee, that is the point to add a D1-backed counter or a WAF rate-limiting
// rule -- not to raise these numbers.

const IP_HEADER = "CF-Connecting-IP";
/** Cloudflare always sets this; the fallback only fires in local `wrangler pages
 * dev`, where the header is synthetic anyway. Using "unknown" rather than
 * refusing keeps local testing usable. */
const FALLBACK_CLIENT = "unknown";

/** The subset of the binding we use, so tests can pass a stub. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The client's IP, used as one of the keys.
 *
 * Cloudflare's own docs discourage keying on IP because NAT and mobile
 * carriers share addresses between unrelated users -- so this is deliberately
 * never the *only* key. It bounds one host's brute force; the account or
 * credential key is what actually protects a single victim. See
 * `loginKey`, which checks both.
 */
export function clientIp(request: Request): string {
  return request.headers.get(IP_HEADER) ?? FALLBACK_CLIENT;
}

/** Key for login: bounded per host *and* per target account.
 *
 * Both are needed. Per-host alone lets one attacker spray many accounts from one
 * IP; per-account alone lets a botnet grind one account from anywhere. The
 * per-account limit is the one that protects a victim, so it is the tighter of
 * the two. */
export function loginKey(request: Request, email: string): string[] {
  return [`ip:${clientIp(request)}`, `acct:${email}`];
}

/** Key for reset-request: per recipient.
 *
 * Keyed on the address rather than the IP because the abuse is "hammer one
 * victim's inbox", not "hammer the endpoint". */
export function resetKey(email: string): string {
  return `email:${email}`;
}

/** Key for probe: per account when we have one, per host otherwise. */
export function probeKey(request: Request, accountId: string | null): string {
  return accountId ? `acct:${accountId}` : `ip:${clientIp(request)}`;
}

/**
 * Charges every key and returns a 429 when any is over.
 *
 * Charges *all* keys rather than short-circuiting, so an attacker cannot learn
 * which of their keys is exhausted from the response.
 *
 * Fails closed: if the binding itself errors, the request is rejected. A rate
 * limiter that silently allows traffic when it is broken is not a rate limiter,
 * and the alternative -- letting everyone log in during a platform blip -- is
 * the wrong trade for a password-verification endpoint.
 */
export async function enforceRateLimit(limiter: RateLimiter | undefined, keys: string[]): Promise<Response | null> {
  if (!limiter) {
    return new Response(JSON.stringify({ error: "rate limiting is unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  let allowed: boolean;
  try {
    const results = await Promise.all(keys.map(key => limiter.limit({ key })));
    allowed = results.every(r => r.success);
  } catch {
    return new Response(JSON.stringify({ error: "rate limiting is unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  if (allowed) return null;
  return new Response(JSON.stringify({ error: "too many requests, slow down" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "60" },
  });
}
