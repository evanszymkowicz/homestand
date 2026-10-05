-- S1: per-import ESPN credential store.
-- Credentials are encrypted at rest with AES-GCM before being written.

CREATE TABLE IF NOT EXISTS espn_credentials (
  import_id TEXT PRIMARY KEY REFERENCES imports(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('auto', 'manual')),
  encrypted_email TEXT,
  encrypted_password TEXT,
  encrypted_espn_s2 TEXT,
  encrypted_swid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Imports need a little more shape to describe what is being crawled.
ALTER TABLE imports ADD COLUMN year_start INTEGER;
ALTER TABLE imports ADD COLUMN year_end INTEGER;
ALTER TABLE imports ADD COLUMN espn_league_id INTEGER;
