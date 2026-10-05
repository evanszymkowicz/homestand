-- Anonymize the seeded demo account.
--
-- 0002 originally seeded the real person's name and email. Every other part of
-- the demo was anonymized (data/processed/ carries "Otis Nash", "Duke Dean",
-- ...), but this committed migration was missed, so any fresh database -- local
-- or production -- seeded the real name into the public demo tenant.
--
-- Only the email and display_name are rewritten. The id ('demo-jon-dowd') is
-- left alone deliberately: it is referenced by imports.account_id and
-- sessions.account_id, and rewriting a primary key needs the children updated
-- first for no benefit -- nothing reads that id as a literal any more, since
-- api/auth/demo.ts now looks the account up by its `demo` flag.

UPDATE accounts
SET email = 'john@homestand.demo',
    display_name = 'John Doe'
WHERE id = 'demo-jon-dowd';