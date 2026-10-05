-- S5 hardening:
-- - imports.espn_league_id duplicated imports.league_id and was never read or
--   written by any code path. SQLite cannot DROP COLUMN on this engine's D1
--   baseline, so the table is rebuilt without it.
-- - imports.expires_at was declared but never written, so the retention gate in
--   api/data/[importId]/[[collection]].ts could never fire. Backfill free-tier
--   imports with the 30-day TTL the spec promises; subscriber imports stay NULL
--   (indefinite).
CREATE TABLE imports_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  league_id INTEGER,
  league_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  year_start INTEGER,
  year_end INTEGER
);

INSERT INTO imports_new (id, account_id, league_id, league_name, status, expires_at, created_at, year_start, year_end)
SELECT
  i.id,
  i.account_id,
  i.league_id,
  i.league_name,
  i.status,
  CASE WHEN a.tier = 'free' THEN datetime(i.created_at, '+30 days') ELSE NULL END,
  i.created_at,
  i.year_start,
  i.year_end
FROM imports i
JOIN accounts a ON a.id = i.account_id;

DROP TABLE imports;
ALTER TABLE imports_new RENAME TO imports;

CREATE INDEX IF NOT EXISTS idx_imports_account_id ON imports(account_id);
CREATE INDEX IF NOT EXISTS idx_imports_expires_at ON imports(expires_at);
