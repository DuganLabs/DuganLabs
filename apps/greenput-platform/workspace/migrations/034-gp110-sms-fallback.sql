-- @apply: per-statement
-- 034 — GP-110 step 2: the teammate contact column and the daily-cap
-- ledger that let chat's SMS fallback be reinstated in its safe shape.
--
-- `users.mobile_phone` is a NEW teammate contact number, set by the
-- teammate and resolved server-side from a user id. It is deliberately
-- NOT `users.recovery_phone` (011): that column is the account-recovery
-- channel, write-only from the outside, and must never become a chat
-- address. Nullable: no number offered means the fallback refuses.
--
-- `sms_fallback_sends` is the per-workspace daily counter GP-110
-- requires: one row per successful fallback send, checked before the
-- next send and written after it. The table is new, so CREATE TABLE
-- gives a live database exactly what schema.sql gives a fresh one.
-- Every statement below is one line because per-statement mode splits
-- on newlines.
ALTER TABLE users ADD COLUMN mobile_phone TEXT;
CREATE TABLE IF NOT EXISTS sms_fallback_sends (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, chat_room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE, sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_sms_fallback_sends_workspace_day ON sms_fallback_sends(workspace_id, created_at);
