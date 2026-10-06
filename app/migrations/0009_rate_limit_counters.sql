-- Long-horizon rate limiting.
--
-- The native `ratelimits` binding in wrangler.jsonc covers the per-minute burst
-- and costs no D1 write, but its period may only be 10 or 60 seconds. That leaves
-- exactly the two ceilings worth closing on an auth surface: an unbounded hourly
-- run at one account's password, and ~300 reset emails an hour to one victim.
--
-- One row per (bucket, fixed window). `bucket` is the plain target string
-- ("login", "ip", "203.0.113.7") rather than a hash: an unsalted digest of an
-- email is dictionary-reversible, so hashing here would look protective while
-- adding nothing. This table is no more sensitive than `accounts.email`, which
-- it only ever references.
--
-- Fixed windows, not sliding. A sliding window needs every individual hit
-- timestamp to be exact, which means a row per request and a read-modify-write
-- race. A fixed window can overshoot by up to 2x across a boundary -- an
-- acceptable trade for an auth throttle, and the reason the limits in
-- functions/lib/rateLimitHorizon.ts are set well under the user-visible pain.
--
-- WITHOUT ROWID: the pair is the primary key, there is no other column to look
-- up by, and it keeps each bucket's windows co-located on one page.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL, -- epoch seconds, floored to the window boundary
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
) WITHOUT ROWID;

-- Supports the opportunistic prune in rateLimitHorizon.ts, which deletes on
-- window_start alone.
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window ON rate_limit_counters(window_start);
