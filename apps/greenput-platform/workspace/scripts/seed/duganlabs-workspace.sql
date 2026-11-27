-- ─────────────────────────────────────────────────────────────
-- Greenput's OWN workspace — the one greenput.com/contact files inbound
-- sales leads into (apps/marketing/src/worker/contact.ts, via
-- CONTACT_WORKSPACE_SLUG in apps/marketing/wrangler*.toml).
--
-- In production this row already exists: it is the owner's real workspace,
-- "Dugan Labs", slug `duganlabs`, named by migration 025 and signed into
-- with a passkey. This file exists for every OTHER database — staging, a
-- fresh preview, a test built from schema.sql — so that the slug the
-- marketing Worker is configured with resolves there too, and a contact
-- submission never 500s with WORKSPACE_MISSING because an environment
-- forgot the row (GP-005: every submission on greenput.com/contact failed
-- for as long as the form existed, because nothing anywhere created it).
--
-- Every statement is INSERT OR IGNORE on a fixed id, so the file is
-- idempotent and safe against a database that already has the real row:
-- `idx_workspaces_slug` (migration 015) is a partial UNIQUE index, so a
-- second `duganlabs` is ignored rather than inserted, and the same goes for
-- the user's email.
--
-- The user carries the NO_PASSWORD sentinel ('') and no passkey: it is an
-- attribution target for `leads.created_by` (NOT NULL), not an account
-- anyone signs into. See migrations/017-revoke-demo-credential.sql for why a
-- seeded credential is never acceptable.
-- ─────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip)
VALUES (
  '00000000-0000-4000-8000-00000000d0a1',
  'Dugan Labs',
  'duganlabs',
  'general',
  '',
  'hello@greenput.com',
  '',
  '',
  '',
  ''
);

INSERT OR IGNORE INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-00000000d0a2',
  '00000000-0000-4000-8000-00000000d0a1',
  'Greenput',
  'Inbox',
  'inbox@greenput.com',
  'owner',
  '',
  datetime('now'),
  datetime('now')
);
