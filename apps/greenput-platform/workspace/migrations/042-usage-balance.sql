-- @apply: per-statement
-- 042 — Prepaid SMS balance per workspace.
--
-- usage_balance_micro_usd is micro-USD (1 USD = 1000000), not cents.
-- A US long-code SMS segment is $0.0083. usage_topup_cents and
-- usage_topup_threshold_cents are integer cents (Stripe charges).
-- Defaults: $10 top-up, $2 threshold. See apps/api/src/lib/usage-balance.ts.
ALTER TABLE workspaces ADD COLUMN usage_balance_micro_usd INTEGER NOT NULL DEFAULT 0;
-- @statement
ALTER TABLE workspaces ADD COLUMN usage_topup_cents INTEGER NOT NULL DEFAULT 1000;
-- @statement
ALTER TABLE workspaces ADD COLUMN usage_topup_threshold_cents INTEGER NOT NULL DEFAULT 200;
-- @statement
CREATE TABLE IF NOT EXISTS workspace_usage_ledger (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('topup','sms_estimate','sms_reconcile','sms_reversal')), amount_micro_usd INTEGER NOT NULL, balance_after_micro_usd INTEGER NOT NULL, twilio_message_sid TEXT, segments INTEGER, stripe_payment_intent_id TEXT, payment_status TEXT, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- @statement
CREATE INDEX IF NOT EXISTS idx_usage_ledger_workspace_created ON workspace_usage_ledger(workspace_id, created_at);
-- @statement
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_sms_estimate_sid ON workspace_usage_ledger(twilio_message_sid) WHERE kind = 'sms_estimate' AND twilio_message_sid IS NOT NULL;
-- @statement
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_sms_reconcile_sid ON workspace_usage_ledger(twilio_message_sid) WHERE kind = 'sms_reconcile' AND twilio_message_sid IS NOT NULL;
-- @statement
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_topup_pi ON workspace_usage_ledger(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
-- @statement
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_topup_pending ON workspace_usage_ledger(workspace_id) WHERE kind = 'topup' AND payment_status = 'pending';
