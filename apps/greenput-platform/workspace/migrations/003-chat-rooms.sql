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
