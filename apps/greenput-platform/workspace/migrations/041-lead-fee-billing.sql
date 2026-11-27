-- @apply: per-statement
-- 041 — Charge an accepted lead off-session, and grandfather Hi Power.
--
-- lead_fee_override_usd is whole US dollars per accepted lead. NULL keeps
-- the placeholder rate card. The Hi Power pilot (slug hi-power) is $1.
-- stripe_payment_intent_id / payment_status record the immediate charge
-- (apps/api/src/lib/lead-fee-billing.ts). status stays
-- pending|invoiced|refunded|waived; withdraw still only waives pending.
-- payment_status has no CHECK: ADD COLUMN cannot carry one. The partial
-- unique index is what production can actually enforce (many NULLs, one
-- PaymentIntent per charged lead).
ALTER TABLE workspaces ADD COLUMN lead_fee_override_usd INTEGER;
-- @statement
UPDATE workspaces SET lead_fee_override_usd = 1 WHERE slug = 'hi-power' AND lead_fee_override_usd IS NULL;
-- @statement
ALTER TABLE lead_meter_events ADD COLUMN stripe_payment_intent_id TEXT;
-- @statement
ALTER TABLE lead_meter_events ADD COLUMN payment_status TEXT;
-- @statement
CREATE UNIQUE INDEX IF NOT EXISTS idx_meter_stripe_payment_intent ON lead_meter_events(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
