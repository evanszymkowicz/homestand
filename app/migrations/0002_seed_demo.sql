-- Seed the anonymized demo tenant (S2 deliverable).
-- The demo account is tier 'subscriber' so the public demo never expires;
-- real free-tier accounts get 1 import and a short TTL applied elsewhere.
--
-- Anonymized like the rest of the demo dataset (data/processed/ carries
-- "Otis Nash", "Duke Dean", ...), because this migration is committed and gets
-- applied to production. Migration 0007 corrects databases seeded before the
-- rename.

INSERT OR IGNORE INTO accounts (id, email, display_name, verified, tier, demo)
VALUES ('demo-john-doe', 'john@homestand.demo', 'John Doe', 1, 'subscriber', 1);

INSERT OR IGNORE INTO imports (id, account_id, league_id, league_name, status)
VALUES ('demo-import', 'demo-john-doe', 6121, 'Homestand Demo League', 'completed');
