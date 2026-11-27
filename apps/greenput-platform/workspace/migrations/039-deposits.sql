-- 039 — Booking deposits (fee paper v2 §3, 2026-10-19).
--
-- One row per auto-booked job that carries a deposit, collected at booking
-- as a Stripe Connect destination charge with manual capture. The row is
-- the deposit's state machine: 'pending' until the authorization lands,
-- 'held' while the booking is live, then exactly one settlement —
-- 'applied' (job completed, captured in full to the shop), 'refunded'
-- (every non-forfeit exit; authorization voided / charge refunded), or
-- 'forfeited' (confirmed booking cancelled inside the 24h window, or a
-- no-show; captured with GreenPut's fee as the application fee, fee
-- first, remainder to the shop, shortfall absorbed by GreenPut).
-- 'failed' records a creation/authorization failure with its error.
--
-- Amounts are integer cents (CLAUDE.md §5.0.1). fee_cents snapshots the
-- delivered-lead fee actually charged (the lead's meter price_usd × 100);
-- quote_low_cents snapshots the quote band's low end the deposit cap was
-- computed from, when a quote exists.
--
-- Plain statements, one per line, `-- @statement` separated (the runner
-- cannot split a multi-statement string). schema.sql carries the same
-- table for fresh databases.
CREATE TABLE IF NOT EXISTS deposits (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL, customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL, stripe_payment_intent_id TEXT UNIQUE, connected_account_id TEXT, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd', fee_cents INTEGER NOT NULL, quote_low_cents INTEGER, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','held','refunded','forfeited','applied','failed')), stripe_status TEXT, fee_portion_cents INTEGER, shop_portion_cents INTEGER, shortfall_cents INTEGER, confirmed_at TEXT, settled_at TEXT, settle_reason TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
-- @statement
CREATE INDEX IF NOT EXISTS idx_deposits_workspace ON deposits(workspace_id);
-- @statement
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_job ON deposits(job_id);
-- @statement
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
-- @statement
CREATE INDEX IF NOT EXISTS idx_deposits_stripe ON deposits(stripe_payment_intent_id);
