-- @apply: per-statement
-- 028 — job_slots (GP-104): the table whose PRIMARY KEY prevents double
-- booking. One row per half-hour a job occupies, per lane, and a booking
-- inserts the job and its slot rows in one batch: a colliding row raises
-- SQLITE_CONSTRAINT and the whole booking fails. `lane` runs
-- 0..workspaces.concurrent_jobs-1 (027). See apps/api/src/lib/job-slots.ts.
--
-- The table is new, so CREATE TABLE gives a live database exactly what
-- schema.sql gives a fresh one.
--
-- Backfill: every scheduled / in_progress job claims lane 0 for each
-- half-hour between its start (floored to the grid) and its end, at least one
-- row even for a zero-length job. Where two existing jobs genuinely overlap
-- the migration must not erase either of them, so it inserts with OR IGNORE
-- and the earlier job (by scheduled_start, then created_at, then id) claims
-- the shared half-hours: BOTH jobs stay, only the first holds the lane for
-- the slots they share, and the second keeps every half-hour it does not
-- share. That is deliberate — every half-hour any job occupies is claimed,
-- so no taken time is offered as free. Nothing is logged from inside SQL;
-- overlaps are visible afterwards as a job with fewer slot rows than its
-- span. Cancelled and finished-status jobs get no rows (cancelling frees
-- them at runtime too); a job whose dates SQLite cannot parse is skipped.
-- OR IGNORE also makes a re-run over an already-backfilled table a no-op.
-- Every statement below is one line because per-statement mode splits on
-- newlines.
CREATE TABLE IF NOT EXISTS job_slots (workspace_id TEXT NOT NULL, slot_start TEXT NOT NULL, lane INTEGER NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, PRIMARY KEY (workspace_id, slot_start, lane));
CREATE INDEX IF NOT EXISTS idx_job_slots_job ON job_slots(job_id);
INSERT OR IGNORE INTO job_slots (workspace_id, slot_start, lane, job_id) WITH RECURSIVE slots(workspace_id, job_id, slot_start, scheduled_end, sort_key) AS (SELECT workspace_id, id, strftime('%Y-%m-%dT%H:', scheduled_start) || CASE WHEN CAST(strftime('%M', scheduled_start) AS INTEGER) < 30 THEN '00' ELSE '30' END || ':00.000Z', scheduled_end, scheduled_start || created_at || id FROM jobs WHERE status IN ('scheduled', 'in_progress') AND strftime('%s', scheduled_start) IS NOT NULL AND strftime('%s', scheduled_end) IS NOT NULL UNION ALL SELECT workspace_id, job_id, strftime('%Y-%m-%dT%H:%M:00.000Z', slot_start, '+30 minutes'), scheduled_end, sort_key FROM slots WHERE julianday(strftime('%Y-%m-%dT%H:%M:00.000Z', slot_start, '+30 minutes')) < julianday(scheduled_end)) SELECT workspace_id, slot_start, 0, job_id FROM (SELECT workspace_id, slot_start, job_id, MIN(sort_key) FROM slots GROUP BY workspace_id, slot_start);
