-- Rollback for migrations/045-change-orders.sql. Hand-run only; see README.md.
-- Revert PR #273 on main first, or the next deploy recreates these tables via schema.sql.
-- Discards every change order and its event trail. Jobs and estimates keep
-- their current line items and totals, including lines an approved change
-- order already appended; nothing here edits them.
DROP INDEX IF EXISTS idx_change_order_events_co;
DROP TABLE IF EXISTS change_order_events;
DROP INDEX IF EXISTS idx_change_orders_estimate;
DROP INDEX IF EXISTS idx_change_orders_job;
DROP INDEX IF EXISTS idx_change_orders_workspace;
DROP TABLE IF EXISTS change_orders;
DELETE FROM schema_migrations WHERE name = '045-change-orders.sql';
