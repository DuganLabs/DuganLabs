-- @apply: per-statement
-- 037 — the network pool mechanism (gap C1): cross-workspace consumer
-- identity (consumers), the offer record (lead_offers), and the transfer
-- ledger (lead_transfers). Leads keep their NOT NULL workspace_id — a
-- lead still belongs to exactly one workspace at a time; acceptance of
-- an offer re-points it, and lead_transfers is the permanent record of
-- the move. consent_records.consumer_id (036) links grants to the
-- consumer row from here on; the column already exists on live
-- databases as plain TEXT, and SQLite cannot add a foreign key by
-- ALTER, so the REFERENCES lives in schema.sql for fresh databases and
-- the application maintains the link on migrated ones (the same
-- divergence pattern as 029's CHECK — documented, enforced in code).
-- The tables are new, so CREATE TABLE gives a live database exactly
-- what schema.sql gives a fresh one. Every statement below is one line
-- because per-statement mode splits on newlines.
CREATE TABLE IF NOT EXISTS consumers (id TEXT PRIMARY KEY, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS idx_consumers_phone ON consumers(phone) WHERE phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_consumers_email ON consumers(email) WHERE email <> '';
CREATE TABLE IF NOT EXISTS lead_offers (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE, consumer_id TEXT NOT NULL REFERENCES consumers(id) ON DELETE CASCADE, from_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, to_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'offered' CHECK(status IN ('offered','accepted','declined','expired','withdrawn')), offered_at TEXT NOT NULL, responded_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_lead_offers_lead ON lead_offers(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_offers_to ON lead_offers(to_workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_offers_from ON lead_offers(from_workspace_id, status);
CREATE TABLE IF NOT EXISTS lead_transfers (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE, offer_id TEXT NOT NULL REFERENCES lead_offers(id) ON DELETE CASCADE, consumer_id TEXT NOT NULL REFERENCES consumers(id) ON DELETE CASCADE, from_workspace_id TEXT NOT NULL, to_workspace_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_lead_transfers_lead ON lead_transfers(lead_id);
