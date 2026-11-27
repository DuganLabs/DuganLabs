-- ─────────────────────────────────────────────────────────────
-- Additive migrations for existing D1 databases.
-- Each statement must be safe to re-run (idempotent).
-- ─────────────────────────────────────────────────────────────

-- 001: Add slug column to workspaces for tenant-site routing.
-- SQLite ALTER TABLE does NOT support UNIQUE constraints on new columns,
-- so we add the column bare and rely on CREATE INDEX in schema.sql for
-- uniqueness. On re-runs the ADD COLUMN fails (column exists) — expected.
ALTER TABLE workspaces ADD COLUMN slug TEXT;

-- 002: Recreate activity_log to add 'workspace' and 'user' entity types.
-- Safe to re-run: creates temp table, migrates data, drops/recreates, restores.
CREATE TABLE IF NOT EXISTS activity_log_new (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type  TEXT NOT NULL CHECK(entity_type IN ('lead','opportunity','job','customer','campaign','workspace','user')),
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  meta         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO activity_log_new SELECT * FROM activity_log;
DROP TABLE IF EXISTS activity_log;
ALTER TABLE activity_log_new RENAME TO activity_log;
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);

-- 003: Add chat_rooms table for video+text chat.
CREATE TABLE IF NOT EXISTS chat_rooms (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'Chat Room',
  entity_type  TEXT,
  entity_id    TEXT,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_workspace ON chat_rooms(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_entity ON chat_rooms(entity_type, entity_id);

-- (004/005, workspaces.billing_status + trial columns and its index, are
-- applied inline in .github/workflows/ci.yml rather than as files here —
-- see that workflow for the exact commands.)

-- 006: Lead billing lifecycle columns. Plain nullable ADD COLUMN, safe to
-- re-run (fails harmlessly the second time). NOT widening leads.status's
-- CHECK constraint here — see the long comment above this migration step in
-- .github/workflows/ci.yml for why (leads is a RESTRICT-guarded FK parent
-- that D1 can't safely recreate without a bigger, separate migration).
ALTER TABLE leads ADD COLUMN qualified_at TEXT;
ALTER TABLE leads ADD COLUMN accepted_at TEXT;
ALTER TABLE leads ADD COLUMN withdrawn_at TEXT;

-- 007: see migrate-007-lead-meter-unique.sql — adds UNIQUE(lead_id) to
-- lead_meter_events so accepting a lead twice can never double-bill it.
