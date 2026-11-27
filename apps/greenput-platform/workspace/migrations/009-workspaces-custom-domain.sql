-- @apply: per-statement
-- 009 — Cloudflare for SaaS custom-hostname columns on workspaces.
--
-- Same miss as 008: schema.sql declared these columns and listed their ALTERs
-- only in a comment. schema.sql then indexes custom_hostname, so applying it
-- to a database without these columns aborted with
--   "no such column: custom_hostname at offset 234: SQLITE_ERROR"
-- which is what broke every GreenPut main deploy from PR #103 onward.
--
-- SQLite cannot add a NOT NULL column with a CHECK in one step on a populated
-- table, so custom_domain_status is added nullable with a default and then
-- backfilled. The CHECK constraint schema.sql declares applies to fresh
-- databases; on migrated ones the application layer
-- (apps/api/src/lib/cloudflare-saas.ts) is the enforcement point.
ALTER TABLE workspaces ADD COLUMN custom_hostname TEXT;
ALTER TABLE workspaces ADD COLUMN custom_domain_status TEXT DEFAULT 'none';
ALTER TABLE workspaces ADD COLUMN custom_domain_verification_method TEXT;
ALTER TABLE workspaces ADD COLUMN custom_domain_verification_token TEXT;
ALTER TABLE workspaces ADD COLUMN custom_domain_cf_hostname_id TEXT;
ALTER TABLE workspaces ADD COLUMN custom_domain_failure_reason TEXT;
ALTER TABLE workspaces ADD COLUMN custom_domain_requested_at TEXT;
ALTER TABLE workspaces ADD COLUMN custom_domain_verified_at TEXT;
ALTER TABLE workspaces ADD COLUMN custom_domain_last_checked_at TEXT;
ALTER TABLE workspaces ADD COLUMN custom_domain_setup_fee_paid_at TEXT;
UPDATE workspaces SET custom_domain_status = 'none' WHERE custom_domain_status IS NULL;

