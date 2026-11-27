-- 023: every amount column becomes INTEGER CENTS.
--
-- The canonical unit is now integer minor units (US cents) — declared and
-- enforced in libs/shared/models/src/wire.ts (`kind: 'cents'`), which rounds
-- on the way out and whose contract test rejects a fractional amount. Before
-- this the same columns meant three different things depending on who was
-- looking:
--
--   apps/platform          divided by 100          -> cents
--   apps/api  pdf/invoice  printed the raw number  -> dollars
--   apps/tenant-site       printed the raw number  -> dollars
--   scripts/preview/seed.sql wrote 2652.13         -> dollars
--
-- So app.greenput.com showed $26.52 for a $2,652 job, and an invoice — a
-- billing document a contractor sends a homeowner — would have read
-- $265,213.00. This migration multiplies the rows written under the dollars
-- reading by 100, once.
--
-- WHY A BLANKET x100 IS CORRECT HERE, AND WHY IT WOULD NOT BE LATER.
-- Every amount row in `greenput` and `greenput-staging` was written either by
-- scripts/preview/seed.sql or by the earlier hand-seeded `ws-001` demo data,
-- both in dollars. Nothing has ever been written in cents, because the only
-- writer that sends cents is apps/platform's create/edit forms and its read
-- path has been broken since it shipped — the board was empty, so nobody
-- created anything through it. Verified against the live `greenput` database
-- before writing this (7 opportunities, 3 jobs, 3 estimates, 7 job line items,
-- 5 valued leads, 2 customers, 1 campaign, 0 inventory items; largest value
-- 12000, smallest 1190.75 — all plainly dollars). Once cents rows exist this
-- migration must never be re-run; migrate.sh's `schema_migrations` ledger
-- records it so it cannot be, and a fresh database records it as applied
-- WITHOUT running it (schema.sql plus the now-cents seed already produce the
-- right values).
--
-- DO NOT point migrate.sh at `greenput-preview`. That database is reset from
-- schema.sql + the (now cents) seed by scripts/preview/setup.sh and has never
-- run a migration, so it has no ledger — a first run there would seed the
-- ledger from 000-applied-at-baseline.txt, not find this file in it, and
-- multiply cents by 100 a second time. `greenput` and `greenput-staging` are
-- the only databases migrate.sh is for.
--
-- ROUND before CAST: a REAL column holding 1190.75 becomes 119075, not 119074.
-- The columns keep REAL affinity — SQLite cannot change a column's type in
-- place, and the application layer is what guarantees whole cents.

UPDATE leads SET estimated_value = CAST(ROUND(estimated_value * 100) AS INTEGER)
WHERE estimated_value IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

UPDATE opportunities SET value = CAST(ROUND(value * 100) AS INTEGER)
WHERE value IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

UPDATE jobs SET total = CAST(ROUND(total * 100) AS INTEGER)
WHERE total IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

UPDATE job_line_items
SET unit_price = CAST(ROUND(unit_price * 100) AS INTEGER),
    total = CAST(ROUND(total * 100) AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

UPDATE customers SET total_job_value = CAST(ROUND(total_job_value * 100) AS INTEGER)
WHERE total_job_value IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

UPDATE campaigns
SET budget = CASE WHEN budget IS NULL THEN NULL ELSE CAST(ROUND(budget * 100) AS INTEGER) END,
    spent = CASE WHEN spent IS NULL THEN NULL ELSE CAST(ROUND(spent * 100) AS INTEGER) END
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

UPDATE inventory_items
SET unit_cost = CAST(ROUND(unit_cost * 100) AS INTEGER),
    unit_price = CAST(ROUND(unit_price * 100) AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

UPDATE estimates
SET subtotal = CAST(ROUND(subtotal * 100) AS INTEGER),
    tax_amount = CAST(ROUND(tax_amount * 100) AS INTEGER),
    total = CAST(ROUND(total * 100) AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

-- estimates.line_items is a JSON array, not a table, and apps/tenant-site
-- renders it straight onto the public /proposal/:id page. Rebuild each element
-- with json_set so any key the object carries beyond these two survives.
UPDATE estimates
SET line_items = (
  SELECT json_group_array(json(json_set(
    value,
    '$.unitPrice', CAST(ROUND(COALESCE(json_extract(value, '$.unitPrice'), 0) * 100) AS INTEGER),
    '$.total', CAST(ROUND(COALESCE(json_extract(value, '$.total'), 0) * 100) AS INTEGER)
  )))
  FROM json_each(estimates.line_items)
)
WHERE json_valid(line_items) AND json_array_length(line_items) > 0
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '023-money-to-cents.sql');

-- estimates.tax_rate is NOT an amount: it is a PERCENTAGE, and always was as
-- far as the code is concerned — apps/api computes `taxAmount = subtotal *
-- (taxRate / 100)` and apps/platform's estimate editor does the same. Only the
-- seed disagreed, writing 0.0825 for 8.25%, which made apps/tenant-site's
-- proposal page print "Tax (0.0825%)". The three estimate rows in `greenput`
-- all hold 0.0825; a rate below 1 can only be a fraction written by that seed,
-- since no contractor's sales tax is under 1%. Anything already >= 1 is
-- already a percentage and is left alone.
UPDATE estimates SET tax_rate = tax_rate * 100
WHERE tax_rate > 0 AND tax_rate < 1;
