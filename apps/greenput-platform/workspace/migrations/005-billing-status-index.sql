-- @apply: per-statement
-- 005 — index for billing_status sweeps.
CREATE INDEX IF NOT EXISTS idx_workspaces_billing_status ON workspaces(billing_status);
