-- @apply: per-statement
-- 006 — lead billing lifecycle timestamps.
--
-- Deliberately NOT included: widening leads.status's CHECK constraint to add
-- 'accepted'/'withdrawn'. schema.sql declares the widened CHECK for fresh
-- installs, but changing it on an existing database needs the recreate-table
-- trick (see 002), and `leads` is the parent of
-- `opportunities.lead_id ON DELETE RESTRICT`. Per Cloudflare's D1 docs,
-- "relationships with RESTRICT applied return errors immediately, and not at
-- the end of the transaction" — so PRAGMA defer_foreign_keys cannot defer it,
-- and DROP TABLE leads fails outright while any lead has a linked opportunity.
-- Until that larger migration is scheduled, the qualify/accept/withdraw
-- handlers in apps/api/src/routes/leads.ts never write 'accepted' or
-- 'withdrawn' into `status` on ANY database, so behaviour is uniform;
-- qualified_at/accepted_at/withdrawn_at are the authoritative signal.
ALTER TABLE leads ADD COLUMN qualified_at TEXT;
ALTER TABLE leads ADD COLUMN accepted_at TEXT;
ALTER TABLE leads ADD COLUMN withdrawn_at TEXT;
