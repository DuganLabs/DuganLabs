-- 030 — leads created by the instant quote were valued in dollars (GP-111).
--
-- leads.estimated_value is integer cents (CLAUDE.md §5.0.1; 023 converted
-- every amount column). createLeadFromQuote in libs/shared/pricing, which
-- shipped in PR #116 on 2026-09-11 — AFTER 023 — wrote the quote band's
-- midpoint in whole dollars, and resolvePhotoReview did the same when it
-- re-priced. So a $1,000–$1,275 quote produced a lead worth $11.38 on /leads
-- and, once GP-103 booked it, a job worth $1,137.50 from the same band. Both
-- writers now multiply by 100; this converts the rows they wrote before.
--
-- THE PREDICATE. Only a lead the quote flow created can be affected, and the
-- session that created it still holds the band it was valued from
-- (pricing_quote_sessions.quote_low / quote_high, in dollars). A row is
-- converted only while its value still EQUALS that band's rounded dollar
-- midpoint — the exact number the old code wrote. A row already in cents is
-- 100x that and is left alone, which also makes a re-run a no-op: after the
-- first pass no row matches. A lead whose value has since been edited by
-- hand no longer matches either and is deliberately not touched. No date
-- heuristic, no size heuristic.
UPDATE leads
SET estimated_value = CAST(ROUND(estimated_value * 100) AS INTEGER)
WHERE estimated_value IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pricing_quote_sessions s
    WHERE s.lead_id = leads.id
      AND s.quote_low IS NOT NULL
      AND s.quote_high IS NOT NULL
      AND leads.estimated_value = ROUND((s.quote_low + s.quote_high) / 2.0)
  );
