-- Manual approval gate: existing accounts stay approved, new signups must be approved by an admin.
ALTER TABLE accounts ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;
