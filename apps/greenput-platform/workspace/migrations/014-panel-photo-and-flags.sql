-- 014 — the panel photo, and the flag that keeps it dark.
--
-- Migration 010 landed the engine, its versioned flows and the sessions
-- homeowners fill in. It left the one screen whose answer nobody can type —
-- the panel photo — with no file behind it: `coerceScreenAnswers` took the
-- photo's status straight from the request body, so `unreviewed` was an
-- unverifiable claim, `reviewed` was unreachable, and a spanning band could
-- never narrow. This adds the two tables that fix that.
--
--   pricing_photo_reviews  the uploaded file, and what a human read off it
--   feature_flags          shared by both Workers (they share D1, not KV)
--
-- Both are new TABLES, so `CREATE TABLE IF NOT EXISTS` is the whole change —
-- there is no ALTER here and nothing to reconcile with a hand-applied shape.
-- They are declared here as well as in schema.sql because migrations run
-- BEFORE schema.sql and schema.sql indexes them, which is the ordering
-- guarantee the runner is built on.
--
-- NOT here: the two immutability TRIGGERS schema.sql now declares on
-- `pricing_fsm_versions.graph_json` and `rate_card_versions.rates_json`.
-- `scripts/db/check-migration-coverage.mjs` replays every migration by
-- splitting it on ';', which cannot carry a trigger's BEGIN…END body (nor can
-- migrate.sh's `@apply: per-statement` mode, which this file does not use).
-- schema.sql is applied to the live databases on every production deploy, and
-- wrangler's own splitter does handle trigger bodies (verified against a local
-- D1), so `CREATE TRIGGER IF NOT EXISTS` there reaches an existing database
-- just as it reaches a fresh one.

-- ── Panel photos: the file, and what a human read off it ──────
-- The machines' `photo` screens are the one step whose answer nobody can type
-- (seeds/pricing/fragments/panel-check.json). A homeowner sends an image; a
-- licensed electrician reads it later; the quote narrows. Until this table
-- existed the photo screen accepted a CLIENT-ASSERTED status with no file
-- behind it, so `unreviewed` was an unverifiable claim and `reviewed` was
-- unreachable — the band could never narrow.
--
-- One row per (session, answer key). `status` and `fields_json` are the ONLY
-- source of a photo answer from now on: `photoAnswerOf()` reads them
-- server-side, so a consumer cannot assert what is in their own panel.
--
-- status='unreviewed' + fields_json='{}' is the shipping default. Nothing
-- classifies panel photos, so the traversal falls back to each interpretation
-- field's `default_when_missing`, lands on whatever the machine decides that
-- means (usually a spanning band), and this row is what puts the photo in the
-- contractor's review queue. That is greenput-fsm-pricing.md §3(c), and the
-- seed's own resolution_policy: "Never block the first number on this."
CREATE TABLE IF NOT EXISTS pricing_photo_reviews (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES pricing_quote_sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The machine's answer key, e.g. 'panel_photo'.
  answer_key   TEXT NOT NULL,
  file_id      TEXT NOT NULL REFERENCES files(id),
  method       TEXT NOT NULL DEFAULT 'unresolved'
               CHECK(method IN ('contractor_review','greenput_ops_review','automated_classification','unresolved')),
  status       TEXT NOT NULL DEFAULT 'unreviewed'
               CHECK(status IN ('missing','unreviewed','reviewed','unreadable')),
  -- JSON object of whatever the reviewer could read, keyed by the machine's
  -- own interpretation field names. `{}` means nothing was read.
  fields_json  TEXT NOT NULL DEFAULT '{}',
  confidence   REAL,
  reviewed_by  TEXT REFERENCES users(id),
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, answer_key)
);
CREATE INDEX IF NOT EXISTS idx_photo_reviews_pending ON pricing_photo_reviews(workspace_id, status);

-- ── Feature flags ─────────────────────────────────────────────
-- Read by both the API and tenant-site Workers, which share the D1 binding but
-- not a KV namespace — so D1, not KV, is where a flag both of them must agree
-- on has to live. Consumed through @basenative/flags' createFlagManager via the
-- D1 provider in libs/shared/pricing/src/flags.ts; the rollout and rule
-- semantics are the package's, not a reimplementation.
-- Absent row = disabled, which is what "ships dark" means here.
CREATE TABLE IF NOT EXISTS feature_flags (
  name        TEXT PRIMARY KEY,
  -- @basenative/flags flag config: { enabled, percentage?, rules? }
  config_json TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- The platform admin (admin_users.id) who last flipped it. Not a workspace
  -- user: a global flag is not a tenant's to set (GP-107).
  updated_by  TEXT REFERENCES admin_users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
