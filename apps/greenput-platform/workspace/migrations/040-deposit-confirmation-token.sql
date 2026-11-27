-- @apply: per-statement
-- 040 — Booking deposit confirmation token (fee paper v2 §3, 2026-10-19).
--
-- The capability that authorises the homeowner's card-confirmation page
-- on the shop's tenant site (GET /deposit/<token>): a UUID minted by the
-- API when the deposit is created, never derived from the deposit or job
-- id (both of which appear in staff URLs and logs). Same pattern as
-- jobs.invoice_token (GP-008): the token is the whole authorisation, the
-- tenant Worker scopes it to its workspace, and a wrong token answers an
-- indistinguishable 404. Rows created before this migration carry NULL —
-- they predate the confirmation page and have no page to open.
ALTER TABLE deposits ADD COLUMN confirmation_token TEXT;
-- @statement
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_confirmation_token ON deposits(confirmation_token);
