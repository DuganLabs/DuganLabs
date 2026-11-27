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
