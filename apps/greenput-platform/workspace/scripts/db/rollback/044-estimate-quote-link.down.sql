-- Rollback for migrations/044-estimate-quote-link.sql. Hand-run only; see README.md.
-- Revert PR #270 on main first, or the next deploy re-adds the index via schema.sql.
-- Loses only estimates.quote_session_id (the quote an estimate was drafted
-- from); the estimates themselves and every other column are untouched.
DROP INDEX IF EXISTS idx_estimates_quote_session;
ALTER TABLE estimates DROP COLUMN quote_session_id;
DELETE FROM schema_migrations WHERE name = '044-estimate-quote-link.sql';
