-- @apply: per-statement
-- 036 — consent records (gap C2): the persisted consent artifact the
-- product never had. One row per consumer grant to one workspace,
-- shaped like the MCP booking grant (fields / purpose /
-- allow_network_reroute / granted_at), with revocation as a timestamp
-- on the same row. The table is new, so CREATE TABLE gives a live
-- database exactly what schema.sql gives a fresh one. Every statement
-- below is one line because per-statement mode splits on newlines.
CREATE TABLE IF NOT EXISTS consent_records (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL, consumer_id TEXT, consumer_phone TEXT NOT NULL DEFAULT '', consumer_email TEXT NOT NULL DEFAULT '', fields TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'quote-and-schedule', allow_network_reroute INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, consent_text TEXT NOT NULL, granted_at TEXT NOT NULL, revoked_at TEXT, revoke_source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_consent_workspace_phone ON consent_records(workspace_id, consumer_phone);
CREATE INDEX IF NOT EXISTS idx_consent_workspace_email ON consent_records(workspace_id, consumer_email);
CREATE INDEX IF NOT EXISTS idx_consent_lead ON consent_records(lead_id);
