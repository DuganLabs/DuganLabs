-- 007: Add UNIQUE(lead_id) to lead_meter_events so accepting a lead twice
-- (races included) can never insert two billing rows for it — the DB-level
-- backstop behind recordLeadMeter()'s INSERT ... ON CONFLICT(lead_id) DO
-- NOTHING (apps/api/src/lib/lead-meter.ts). Safe recreate: no other table's
-- foreign key targets lead_meter_events, so this never touches the
-- RESTRICT-guarded leads/opportunities/jobs chain (see the note above the
-- "leads" migration steps in the CI additive-migrations job for why THAT
-- table can't get the same treatment yet). Under normal operation there is
-- already at most one row per lead_id (the old code only ever inserted once,
-- at lead creation), so INSERT OR IGNORE here is a no-op safety net, not an
-- expected dedup.
CREATE TABLE IF NOT EXISTS lead_meter_events_new (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  vertical      TEXT NOT NULL,
  service_type  TEXT NOT NULL DEFAULT '',
  price_usd     REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','invoiced','refunded','waived')),
  stripe_usage_record_id TEXT,
  invoiced_at   TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(lead_id)
);
INSERT OR IGNORE INTO lead_meter_events_new (
  id, workspace_id, lead_id, vertical, service_type, price_usd, status,
  stripe_usage_record_id, invoiced_at, notes, created_at
)
SELECT
  id, workspace_id, lead_id, vertical, service_type, price_usd, status,
  stripe_usage_record_id, invoiced_at, notes, created_at
FROM lead_meter_events;
DROP TABLE IF EXISTS lead_meter_events;
ALTER TABLE lead_meter_events_new RENAME TO lead_meter_events;
CREATE INDEX IF NOT EXISTS idx_meter_workspace ON lead_meter_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meter_status ON lead_meter_events(status);
CREATE INDEX IF NOT EXISTS idx_meter_lead ON lead_meter_events(lead_id);
