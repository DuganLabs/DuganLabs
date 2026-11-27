-- @apply: per-statement
-- 008 — Stripe identifiers on workspaces and customers.
--
-- These columns were added to schema.sql's CREATE TABLE bodies when Stripe
-- billing landed, and the matching ALTERs were written as a COMMENT in
-- schema.sql instead of being wired into a migration. Fresh databases got
-- them; `greenput` and `greenput-staging` never did. This migration is that
-- missed step.
ALTER TABLE workspaces ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE workspaces ADD COLUMN stripe_account_id TEXT;
ALTER TABLE customers ADD COLUMN stripe_customer_id TEXT;
