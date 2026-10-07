-- A crawl failure needs a reason the UI can read. crawl_from_env.py used to
-- append it as a SQL comment, which D1 discards -- every failure looked
-- identical to the user, so ImportDetail guessed "your cookie expired" for
-- extract errors, owner-derivation errors and normalization errors alike.
ALTER TABLE imports ADD COLUMN failure_reason TEXT;