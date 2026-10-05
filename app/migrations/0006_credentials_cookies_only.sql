-- ESPN gates password login behind a captcha (the login endpoint rejects
-- automated attempts with PALOMINO_CHECK_FAILED), so every client library
-- authenticates with the espn_s2 + SWID cookies instead. There is no OAuth for
-- the v3 fantasy endpoints either.
--
-- That makes `mode`, `encrypted_email` and `encrypted_password` permanently
-- dead: nothing writes them and nothing reads them. Dropping them means the
-- schema cannot be used to store an ESPN password later, which is the posture
-- we want anyway -- we hold a revocable session, not a login. Rebuild is
-- required because D1's SQLite baseline cannot DROP COLUMN.
CREATE TABLE espn_credentials_new (
  import_id TEXT PRIMARY KEY REFERENCES imports(id) ON DELETE CASCADE,
  encrypted_espn_s2 TEXT NOT NULL,
  encrypted_swid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only rows that already carry a usable session survive; a half-configured row
-- has nothing to crawl with and would be indistinguishable from a real one.
INSERT INTO espn_credentials_new (import_id, encrypted_espn_s2, encrypted_swid, created_at, updated_at)
SELECT import_id, encrypted_espn_s2, encrypted_swid, created_at, updated_at
FROM espn_credentials
WHERE encrypted_espn_s2 IS NOT NULL AND encrypted_swid IS NOT NULL;

DROP TABLE espn_credentials;
ALTER TABLE espn_credentials_new RENAME TO espn_credentials;