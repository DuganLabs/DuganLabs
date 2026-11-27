-- @apply: per-statement
-- 035 — capture the four per-user scheduling tables that have lived in
-- both production databases since before 2026-09-11 with no commit and
-- no migration (docs/UNTRACKED-PRODUCTION-TABLES.md): availability_windows,
-- availability_blackouts, schedule_buffers, schedule_settings.
--
-- Every statement is CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS, so on the two live databases — where the tables already exist
-- with production rows — this is a no-op that changes nothing. On a
-- fresh or preview database it creates exactly what schema.sql creates,
-- which is the point: the tables are now under the drift guard and a
-- new environment silently lacking them is no longer possible.
--
-- Column lists are the production record in
-- docs/UNTRACKED-PRODUCTION-TABLES.md. If a live table's hand-applied
-- shape ever differs from this declaration, IF NOT EXISTS keeps the live
-- shape (nothing is rebuilt, no row is touched) and the drift is a
-- follow-up migration's job, not this one's.
-- Every statement below is one line because per-statement mode splits
-- on newlines.
CREATE TABLE IF NOT EXISTS availability_windows (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6), start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL, timezone TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_availability_windows_workspace_user ON availability_windows(workspace_id, user_id);
CREATE TABLE IF NOT EXISTS availability_blackouts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, start_at TEXT NOT NULL, end_at TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_availability_blackouts_workspace_user ON availability_blackouts(workspace_id, user_id);
CREATE TABLE IF NOT EXISTS schedule_buffers (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, service_type TEXT NOT NULL DEFAULT '', pre_buffer_minutes INTEGER NOT NULL DEFAULT 0, post_buffer_minutes INTEGER NOT NULL DEFAULT 0, min_gap_minutes INTEGER NOT NULL DEFAULT 0, max_jobs_per_day INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_schedule_buffers_workspace ON schedule_buffers(workspace_id);
CREATE TABLE IF NOT EXISTS schedule_settings (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, timezone TEXT, buffer_before_minutes INTEGER NOT NULL DEFAULT 0, buffer_after_minutes INTEGER NOT NULL DEFAULT 0, travel_buffer_minutes INTEGER NOT NULL DEFAULT 0, min_notice_hours INTEGER NOT NULL DEFAULT 0, max_lead_time_days INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
