-- @apply: per-statement
-- 004 — billing pipeline columns on workspaces (PR #36).
ALTER TABLE workspaces ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'trialing';
ALTER TABLE workspaces ADD COLUMN trial_started_at TEXT;
ALTER TABLE workspaces ADD COLUMN trial_ends_at TEXT;
