-- Long-horizon rate limiting.
--
-- This is now the only rate limiter on the auth surface. It was written alongside
-- Cloudflare's native `ratelimits` binding, which covered a per-minute burst with
-- no D1 write, but a Pages config cannot declare that binding, so it was removed
-- and this table took over every window from 10 minutes to a day.
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

-- Supports the prune in cron/index.ts, which deletes on window_start alone.
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window ON rate_limit_counters(window_start);
