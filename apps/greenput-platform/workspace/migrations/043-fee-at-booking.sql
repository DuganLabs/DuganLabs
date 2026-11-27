-- 043: WS-1 — the lead fee bills at BOOKING, one fee per (lead, workspace).
--
-- The meter's uniqueness widens from UNIQUE(lead_id) to
-- UNIQUE(lead_id, workspace_id): a rebook at the SAME shop can never
-- insert a second billing row, while an eject-and-rebook at a DIFFERENT
-- shop is a new booking and bills that shop (canonical model v14,
-- FR-1.2). The row also gains its booking linkage — job_id and
-- delivery_id, the job and lead_deliveries row the booking commit
-- wrote — a priority flag (priority/rescue bookings bill at 50%,
-- FR-1.3), and refund_reason, the recorded reason refundLeadFee
-- requires ('fraud' or 'platform_fault' — the only two refund cases,
-- FR-1.4).
--
-- SQLite cannot drop a table-level UNIQUE in place, so the table is
-- rebuilt (the 007 pattern). This is pre-first-user: the only rows that
-- can exist are pilot/test rows written under the old accept-trigger
-- model. INSERT OR IGNORE preserves every row the new constraint
-- accepts; a duplicate (lead_id, workspace_id) pair — impossible under
-- the old UNIQUE(lead_id) — would keep its first row and drop the rest.
ALTER TABLE lead_meter_events ADD COLUMN job_id TEXT;
ALTER TABLE lead_meter_events ADD COLUMN delivery_id TEXT;
ALTER TABLE lead_meter_events ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lead_meter_events ADD COLUMN refund_reason TEXT;
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
  stripe_payment_intent_id TEXT,
  payment_status TEXT,
  invoiced_at   TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  job_id        TEXT,
  delivery_id   TEXT,
  priority      INTEGER NOT NULL DEFAULT 0,
  refund_reason TEXT,
  UNIQUE(lead_id, workspace_id)
);
INSERT OR IGNORE INTO lead_meter_events_new (
  id, workspace_id, lead_id, vertical, service_type, price_usd, status,
  stripe_usage_record_id, stripe_payment_intent_id, payment_status,
  invoiced_at, notes, created_at, job_id, delivery_id, priority,
  refund_reason
)
SELECT
  id, workspace_id, lead_id, vertical, service_type, price_usd, status,
  stripe_usage_record_id, stripe_payment_intent_id, payment_status,
  invoiced_at, notes, created_at, job_id, delivery_id, priority,
  refund_reason
FROM lead_meter_events;
DROP TABLE IF EXISTS lead_meter_events;
ALTER TABLE lead_meter_events_new RENAME TO lead_meter_events;
CREATE INDEX IF NOT EXISTS idx_meter_workspace ON lead_meter_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meter_status ON lead_meter_events(status);
CREATE INDEX IF NOT EXISTS idx_meter_lead ON lead_meter_events(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meter_stripe_payment_intent ON lead_meter_events(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
