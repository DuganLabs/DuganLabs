-- The pricing state-machine engine: its flows, its versions, its rate cards and
-- the sessions homeowners fill in.
--
-- Adds the six tables schema.sql now declares, and removes the five that were
-- applied to `greenput` by hand, outside CI, and declared in no commit.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE FIVE ARE DROPPED RATHER THAN ADOPTED
-- ─────────────────────────────────────────────────────────────────────────────
-- docs/UNTRACKED-PRODUCTION-TABLES.md left this decision to whoever landed the
-- FSM: "either declare these tables in schema.sql and add the migration that
-- reconciles the live copies, or drop them and create the real ones through CI."
--
-- They are dropped, for three reasons.
--
-- 1. They model the wrong thing. `flow_states` + `flow_transitions` is a
--    NORMALISED graph — one row per state, one per edge. The engine that
--    actually landed evaluates a whole machine DOCUMENT: fragments inlined,
--    terminals carrying line items, uncertainty and presentation copy, plus
--    machine-level honesty rules and overlays. A normalised store either loses
--    that or hides it in a `config` blob, and it is reassembled on every single
--    step of every session to feed a function that wanted the document to begin
--    with.
--
-- 2. They have nowhere to put a version. `flow_instances.flow_version` is an
--    integer pointing at nothing: the state and transition rows carry no
--    version, so editing a flow silently changes the price a half-finished
--    session is heading towards. A range a contractor has promised to honour
--    cannot rest on that. The replacement pins both the graph version and the
--    rate-card version onto the session row.
--
-- 3. `flow_instances` and `flow_instance_events` are names the engine needs at a
--    different shape. `CREATE TABLE IF NOT EXISTS` would silently keep the
--    hand-applied shape on `greenput` and create the new one everywhere else —
--    two databases, one name, two schemas, and nothing able to tell. That is
--    precisely the invisible drift migrations/ and check-migration-coverage.mjs
--    exist to end. An explicit DROP is the only way to know what is there.
--
-- WHAT IS BEING DROPPED, AND ON WHAT EVIDENCE
-- No commit in this repository's history has ever read or written these tables:
-- the only commit that mentions them at all is the one that recorded their
-- existence (`fix(db): one migration source of truth…`), and `grep` over the
-- working tree finds no reference outside that documentation. They exist in
-- `greenput` only, not in `greenput-staging`, so nothing that runs in both can
-- depend on them. Their live row counts were NOT read: this branch has no
-- database access by design, and the README's "count the rows that would be
-- rejected" rule is written for a table rebuild under a live feature — these
-- sit under nothing. If rows were put there by hand and matter, this file is
-- the place to say so before it merges.
--
-- Every DROP is guarded with IF EXISTS, so this migration is a no-op against
-- `greenput-staging`, which never had them.
--
-- Applied whole (no `@apply: per-statement`): there are no additive ALTERs here,
-- and the schema_migrations ledger already guarantees it runs exactly once.

DROP TABLE IF EXISTS flow_instance_events;
DROP TABLE IF EXISTS flow_instances;
DROP TABLE IF EXISTS flow_transitions;
DROP TABLE IF EXISTS flow_states;
DROP TABLE IF EXISTS intake_flows;

-- ─────────────────────────────────────────────────────────────────────────────
-- The real tables. Identical to the CREATE TABLE bodies in schema.sql — a fresh
-- database gets them from there, a long-lived one from here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing_fsms (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  slug               TEXT NOT NULL,
  vertical           TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  current_version_id TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_fsms_slug ON pricing_fsms(COALESCE(workspace_id, ''), slug);
CREATE INDEX IF NOT EXISTS idx_pricing_fsms_workspace ON pricing_fsms(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pricing_fsms_vertical ON pricing_fsms(vertical);

CREATE TABLE IF NOT EXISTS pricing_fsm_versions (
  id             TEXT PRIMARY KEY,
  fsm_id         TEXT NOT NULL REFERENCES pricing_fsms(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  graph_json     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK(status IN ('draft','published','archived')),
  published_at   TEXT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fsm_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_pricing_fsm_versions_fsm ON pricing_fsm_versions(fsm_id, status);

CREATE TABLE IF NOT EXISTS rate_cards (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_cards_workspace ON rate_cards(workspace_id);

CREATE TABLE IF NOT EXISTS rate_card_versions (
  id             TEXT PRIMARY KEY,
  rate_card_id   TEXT NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  rates_json     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK(status IN ('draft','published','archived')),
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(rate_card_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_rate_card_versions_card ON rate_card_versions(rate_card_id, status);

CREATE TABLE IF NOT EXISTS pricing_quote_sessions (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fsm_id               TEXT NOT NULL REFERENCES pricing_fsms(id),
  fsm_version_id       TEXT NOT NULL REFERENCES pricing_fsm_versions(id),
  rate_card_version_id TEXT NOT NULL REFERENCES rate_card_versions(id),
  lead_id              TEXT REFERENCES leads(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'in_progress'
                       CHECK(status IN ('in_progress','completed','abandoned')),
  current_state_id     TEXT,
  answers              TEXT NOT NULL DEFAULT '{}',
  env                  TEXT NOT NULL DEFAULT '{}',
  terminal_id          TEXT,
  quote_low            REAL,
  quote_high           REAL,
  quote_json           TEXT,
  source_url           TEXT,
  started_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_quote_sessions_workspace ON pricing_quote_sessions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_quote_sessions_lead ON pricing_quote_sessions(lead_id);
CREATE INDEX IF NOT EXISTS idx_quote_sessions_fsm ON pricing_quote_sessions(fsm_id);

CREATE TABLE IF NOT EXISTS pricing_quote_events (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES pricing_quote_sessions(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  from_state_id TEXT NOT NULL,
  to_state_id   TEXT,
  input         TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, seq)
);
