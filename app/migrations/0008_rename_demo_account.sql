-- Rename the seeded demo account to "Jon Dowd".
--
-- 0007 anonymized this row because 0002 had shipped the owner's real name into a
-- committed migration. The display persona is being changed, so the demo account
-- now carries a different name than 0007 installed.
--
-- Separate file rather than an edit to 0007 on purpose: D1 tracks applied
-- migrations by filename in d1_migrations, so rewriting an already-applied
-- migration is silently a no-op on every existing database -- local and
-- production. Only a new file actually runs.
--
-- Keyed on the demo flag, not the id, matching how functions/api/auth/demo.ts
-- resolves the account. That keeps this correct regardless of whether the row
-- came from 0002's seed or was renamed by 0007.
--
-- The id is deliberately left alone: imports.account_id and sessions.account_id
-- both reference it, and rewriting a primary key means updating the children
-- first for no benefit. Nothing reads it as a literal now that demo.ts looks the
-- account up by flag.
UPDATE accounts
SET email = 'jon@homestand.demo',
    display_name = 'Jon Dowd'
WHERE demo = 1;
