-- @apply: per-statement
-- 027 — contractor availability (GP-101): the recurring week, dated
-- exceptions, and the booking policy columns on workspaces.
--
-- Nothing modelled when a contractor works, so nothing could offer a
-- homeowner a time. This is the data only; slot generation is GP-102 and the
-- homeowner-facing screen is GP-103.
--
-- The two tables are new, so CREATE TABLE gives a live database exactly what
-- schema.sql gives a fresh one. The five workspaces columns are additive and
-- carry constant defaults only, because ALTER TABLE ADD COLUMN can carry
-- nothing else. `timezone` is nullable by design: a workspace that has never
-- said where it is must NOT be assumed to be in UTC, and the code refuses to
-- generate slots until it is set.
--
-- No backfill of the week tables: a workspace with no availability rows is
-- "not bookable", never "always open" — an absent answer must not publish a
-- claim (the same rule as GP-011). Every statement below is one line because
-- per-statement mode splits on newlines.
ALTER TABLE workspaces ADD COLUMN timezone TEXT;
ALTER TABLE workspaces ADD COLUMN booking_lead_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE workspaces ADD COLUMN booking_horizon_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE workspaces ADD COLUMN travel_buffer_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE workspaces ADD COLUMN concurrent_jobs INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS workspace_availability (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), opens_at TEXT, closes_at TEXT, is_open INTEGER NOT NULL DEFAULT 1, UNIQUE(workspace_id, weekday));
CREATE INDEX IF NOT EXISTS idx_workspace_availability_workspace ON workspace_availability(workspace_id);
CREATE TABLE IF NOT EXISTS workspace_availability_exceptions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, date TEXT NOT NULL, opens_at TEXT, closes_at TEXT, is_open INTEGER NOT NULL DEFAULT 1, reason TEXT, UNIQUE(workspace_id, date));
CREATE INDEX IF NOT EXISTS idx_workspace_availability_exceptions_workspace ON workspace_availability_exceptions(workspace_id, date);
