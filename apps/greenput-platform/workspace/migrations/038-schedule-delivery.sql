-- 038 — Schedule-aware delivery (gap H3 / plan item 10b, 2026-10-16).
--
-- Enrollment is how a shop opts INTO automatic booking: configuration,
-- not a paid tier (GP-045 "no subscription tiers" is untouched; the
-- dormant plan-tier code is not activated). One row per enrolled scope:
--
--   TIME    — window_ids_json names which of the member's
--             availability_windows are exposed to auto-booking; an empty
--             array means "all of that member's active windows".
--   SERVICE — service_type names the service this enrollment covers; ''
--             means every service the shop offers. Per-service
--             enablement is imperative while FSM pricing coverage is
--             partial: only services a shop turns on can auto-book.
--   TEAM    — user_id names the enrolled team member; a multi-team shop
--             enrolls one member at a time and the rest keep working the
--             request flow.
--
-- lead_deliveries is the delivery record: a lead, the job it became, the
-- slot it took, and its state. status 'undone' is the one-tap undo —
-- the job is cancelled, its slots freed, and the lead's meter event is
-- waived by the same code path that withdraws a lead.
--
-- Plain statements, one per line, `-- @statement` separated (the runner
-- cannot split a multi-statement string); mirrors docs/UNTRACKED-
-- PRODUCTION-TABLES.md style. schema.sql carries the same tables for
-- fresh databases.
CREATE TABLE IF NOT EXISTS schedule_delivery_enrollments (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_type    TEXT NOT NULL DEFAULT '',
  window_ids_json TEXT NOT NULL DEFAULT '[]',
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
-- @statement
CREATE INDEX IF NOT EXISTS idx_sde_workspace ON schedule_delivery_enrollments(workspace_id, enabled);
-- @statement
CREATE TABLE IF NOT EXISTS lead_deliveries (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  slot_start    TEXT NOT NULL,
  slot_end      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'booked'
                  CHECK (status IN ('booked', 'undone')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at     TEXT
);
-- @statement
CREATE INDEX IF NOT EXISTS idx_lead_deliveries_lead ON lead_deliveries(lead_id, status);
