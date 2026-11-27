-- @apply: per-statement
-- 045 — change orders: the only way a job's (or a sent estimate's) price
-- moves once it exists. Replaces editing line items in place
-- (PATCH /api/jobs/:id lineItems now answers 409 CHANGE_ORDER_REQUIRED).
-- See apps/api/src/routes/change-orders.ts and the schema.sql comment.
--
-- Both tables are new, so CREATE TABLE gives a live database exactly what
-- schema.sql gives a fresh one. Nothing to backfill: existing jobs keep
-- their line items and totals; change orders start from here.
--
-- Numbered 045 because 044 is taken by feat/quote-exact-number (PR #270).
-- If another branch lands a 045 first, renumber this file; nothing refers
-- to the number.
--
-- Every statement below is one line because per-statement mode splits on
-- newlines.
CREATE TABLE IF NOT EXISTS change_orders (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE, estimate_id TEXT REFERENCES estimates(id) ON DELETE CASCADE, number TEXT NOT NULL, title TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected')), line_items TEXT NOT NULL DEFAULT '[]', price_delta INTEGER NOT NULL DEFAULT 0, total_before INTEGER NOT NULL DEFAULT 0, decided_by TEXT REFERENCES users(id) ON DELETE SET NULL, decided_at TEXT, decision_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT NOT NULL REFERENCES users(id), CHECK ((job_id IS NULL) <> (estimate_id IS NULL)));
CREATE INDEX IF NOT EXISTS idx_change_orders_workspace ON change_orders(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_change_orders_job ON change_orders(job_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_estimate ON change_orders(estimate_id);
CREATE TABLE IF NOT EXISTS change_order_events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, change_order_id TEXT NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE, action TEXT NOT NULL CHECK(action IN ('proposed','approved','rejected')), actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, note TEXT NOT NULL DEFAULT '', total_after INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_change_order_events_co ON change_order_events(change_order_id, created_at);
