-- @apply: per-statement
-- 032 — jobs.invoice_token and user_invitations (GP-008): the two links a
-- contractor hands over themselves, because nothing here sends mail.
--
-- jobs.invoice_token is the capability behind the public invoice page,
-- https://<slug>.greenput.com/invoice/<token> (apps/tenant-site). Minted by
-- POST /api/jobs/:id/invoice — a random UUID, so the URL cannot be guessed
-- from a job number — and NULL on every job invoiced before this, which is
-- the honest state: no link was ever produced for them. Nothing backfills
-- it; marking such a job invoiced again is not possible, so those rows keep
-- no public page. The uniqueness is a partial index, not a column UNIQUE:
-- ADD COLUMN cannot carry one (see migrations/README.md).
--
-- user_invitations is the one-time enrolment ticket for an invited teammate.
-- POST /api/workspace/users writes a row and hands back
-- https://app.greenput.com/accept-invite/<token>; POST
-- /api/auth/invite/:token/accept stamps accepted_at and signs the holder in
-- so they can enrol a passkey. accepted_at IS NULL and expires_at in the
-- future is the whole "still valid" test, and the UPDATE that stamps it is
-- conditional on both, so a token admits exactly one session. Re-inviting a
-- teammate who never enrolled a credential deletes their open rows and
-- writes a new one, which is what makes the recovery screen's "ask to be
-- invited again" advice true.
--
-- Every statement below is one line because per-statement mode splits on
-- newlines.
ALTER TABLE jobs ADD COLUMN invoice_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_invoice_token ON jobs(invoice_token) WHERE invoice_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS user_invitations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL, invited_by TEXT REFERENCES users(id) ON DELETE SET NULL, expires_at TEXT NOT NULL, accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_user ON user_invitations(user_id);
