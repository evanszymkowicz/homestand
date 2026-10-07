-- The invite-token gate is gone: signup is email + password, then email
-- verification, then admin approval (0010_account_approval.sql). Nothing reads
-- or writes this table any more.
DROP TABLE IF EXISTS invites;
DROP INDEX IF EXISTS idx_invites_email;