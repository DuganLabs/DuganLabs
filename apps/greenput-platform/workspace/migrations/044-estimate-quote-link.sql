-- @apply: per-statement
-- 044: H1 — an estimate drafted from a homeowner's quote remembers which quote.
--
-- POST /api/estimates/from-quote/:sessionId confirms the work order, collapses
-- the quote to one exact number when nothing is left to guess, and drafts the
-- estimate at that number. The link lets the platform show the quote beside
-- the estimate and flag an estimate that drifts from what the homeowner saw.
-- NULL for every estimate written by hand, which is all of them today.
ALTER TABLE estimates ADD COLUMN quote_session_id TEXT REFERENCES pricing_quote_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_quote_session ON estimates(quote_session_id);
