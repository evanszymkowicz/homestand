-- Email token table for verification and password reset
CREATE TABLE IF NOT EXISTS email_tokens (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('verification', 'password_reset')),
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_account_id ON email_tokens(account_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_type ON email_tokens(type);
