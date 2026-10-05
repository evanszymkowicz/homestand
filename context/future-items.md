# Future Items

Work that is planned but not in flight. The full phase rationale is in
@context/features/homestand-league-import-spec.md — this file is the short list of
known-open work, not a second source of truth.

## Blocking before this is publicly reachable

Nothing outstanding. The three unthrottled endpoints were closed 2026-10-05;
the ceilings that remain are recorded below as non-blocking.

## Non-blocking, carried from the S5 review

| Item | Why |
|---|---|
| ~~Rate-limit `login`, `reset-request`, `probe`~~ | **Done 2026-10-05.** All three charge Cloudflare's native `ratelimits` binding (`functions/lib/rateLimit.ts`; limits declared in `wrangler.jsonc`) and fail **closed** on a missing or erroring binding. `login` is keyed by host **and** account, so neither one host spraying many accounts nor a botnet rotating IPs gets an unlimited run; `reset-request` is keyed by recipient; `probe` by account. Verified live against the running app: all three trip at their configured threshold. **Ceilings inherited from the API, not chosen** — counters are per Cloudflare location, `period` may only be 10 or 60s (so reset-request can still send ~300 emails/hour to one address), and the counters are permissive and eventually-consistent by Cloudflare's own description. A WAF rule or D1 counter is the upgrade if any of those ever has to be a real guarantee. |
| `reset-request` response-time oracle | The body is already constant (`{ok:true}` either way), but an unknown address skips both the D1 insert and the outbound email, so timing still distinguishes it from a real account. Deliberately not fixed: making it constant-time means doing that work unconditionally, i.e. emailing addresses that do not exist. Fix it when Resend lands, since that adds a real network call to the gap. |
| Retention countdown banner | `imports.expires_at` is now written (free tier +30d, migration `0005_import_expiry.sql`) and enforced by the data proxy (`410`). Nothing surfaces the countdown to the user yet — the landing page advertises "30-day access". |
| Gate the league switcher to subscriber tier | The `<select>` renders for any account with more than one completed import. Free tier is clamped to 1 import server-side, so this is currently unreachable, but the UI does not enforce it. |
| ~~Per-import R2 prefix for the processed archive~~ | **Done 2026-10-05.** Keys are now `processed/{importId}/…`; `upload-r2.mjs` writes the demo dataset under `processed/demo-import/` and `crawl_from_env.py` writes each tenant's own prefix. Two tenants' bytes are isolated at the storage layer, not just by the D1 ownership check. |
| ~~Per-league owner resolution~~ | **Done 2026-10-05.** `scripts/derive_owner_map.py` builds a league's owner map from its own ESPN `members[]` + `teams[].owners[]`, unioning SWID renames and same-name account changes, and stubs every other manual file empty so no league inherits this league's answers. Verified against the real 18-season archive: 30 owners / 180 team-seasons, identical to the hand-curated map, and `validate.py` reports **0 failures across 30 checks** (was 27). Two related fixes went with it: the fork's own `owner-map.json` stored canonical *names* where the schema wants owner_id *slugs* (all 180 entries corrected), and `validate.main()` hardcoded `Path("data/raw")` instead of reading its own `RAW_DIR` global. |
| ~~Proxy-served manual files~~ | **Done 2026-10-05.** `retired-owners.json`, `jersey-history-overrides.json` and `position-overrides.json` are allowlisted in `app/lib/collections.ts` but live in `data/manual/`, not `data/processed/`, so they 404'd for **every** tenant including the demo. Both the crawl and `upload-r2.mjs` now publish them alongside the processed output. |
| Resend email provider | `functions/lib/email.ts` is a log-line stub. It deliberately does not print message bodies, because they carry single-use verification and reset tokens and Workers logs ship to Logpush. Replace the body with a real provider call, keeping the signature. |
| `cron` trigger for TTL eviction | `api/admin/evict` is an HTTP endpoint standing in for a Cron Trigger. Pages has no scheduled handler wired up; the endpoint skips in-flight crawls and reports a count, so it is safe to call by hand until then. |
| Stack-trace disclosure on 5xx | An unhandled D1 error currently returns a stack with absolute build paths in local dev. Production Pages returns a generic 500, but any future `onError` handler must not regress this. |
