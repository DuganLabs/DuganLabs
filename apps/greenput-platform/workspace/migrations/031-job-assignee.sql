-- @apply: per-statement
-- 031 — jobs.assigned_to (GP-034): which technician does the job.
--
-- The Technicians report and the calendar's techId filter joined
-- jobs.created_by, so every job was credited to whoever typed it in — the
-- owner or the office — and the crew showed nothing. This is the column
-- those two now read (apps/api/src/routes/reports.ts, routes/jobs.ts).
--
-- Nullable, no default: ADD COLUMN cannot carry a non-constant default, and
-- there is nothing honest to default to. NO backfill on purpose — copying
-- created_by into it would launder the wrong number into looking like real
-- data. Historic rows stay NULL ("Unassigned") until someone assigns them.
-- ON DELETE SET NULL matches vehicles.assigned_to and assets.assigned_to: a
-- removed teammate unassigns their jobs rather than blocking the delete.
ALTER TABLE jobs ADD COLUMN assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_assigned_to ON jobs(assigned_to);
