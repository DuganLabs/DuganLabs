-- 0006_household_profile.sql — the household facts every projection is
-- computed from, as columns on `users` instead of literals in the worker.
--
-- worker/src/routes/situation.ts used to hand every user the same numbers:
-- `+ 5_000` of living expenses, a `200` liquidity floor, `3` kids,
-- `augustaBenefit(14, 350, …)` and a `0.5` S-Corp salary split. None had a
-- column, a write route or a Settings field. These are read and written by
-- GET/PATCH /api/household (worker/src/routes/household.ts) and edited on
-- /settings.
--
-- Defaults are 0, not the old literals: a zero that is visibly wrong beats a
-- plausible $5,000 that is silently someone else's. The one exception is
-- scorp_salary_split — a 0% salary is not "visibly wrong", it is silently
-- optimistic (every ladder rung would show the maximum FICA saving, on a
-- position the IRS rejects outright), so it starts at the conventional 50/50
-- and is shown, editable, in Settings.
--
-- The CHECKs go on the ADD COLUMN because SQLite cannot ALTER a CHECK in
-- place (see worker/test/schema-drift.test.ts). The write route mirrors
-- these bounds so a violation is a 400 naming the field, never a 500.

ALTER TABLE users ADD COLUMN monthly_living_expenses REAL NOT NULL DEFAULT 0
  CHECK (monthly_living_expenses >= 0);
ALTER TABLE users ADD COLUMN liquidity_floor_monthly REAL NOT NULL DEFAULT 0
  CHECK (liquidity_floor_monthly >= 0);
ALTER TABLE users ADD COLUMN kids_count INTEGER NOT NULL DEFAULT 0
  CHECK (kids_count >= 0);
ALTER TABLE users ADD COLUMN augusta_days INTEGER NOT NULL DEFAULT 0
  CHECK (augusta_days >= 0 AND augusta_days <= 14);
ALTER TABLE users ADD COLUMN augusta_daily_rate REAL NOT NULL DEFAULT 0
  CHECK (augusta_daily_rate >= 0);
ALTER TABLE users ADD COLUMN scorp_salary_split REAL NOT NULL DEFAULT 0.5
  CHECK (scorp_salary_split >= 0 AND scorp_salary_split <= 1);

-- Seed user 1 (0002_seed_warren.sql) with the figures the dashboard showed
-- before this migration, so local dev and the existing deploy see no change
-- until the owner edits them. Like the income/liability rows in 0002 these
-- are illustrative placeholders, not real financial data — replace them via
-- /settings. This lives here rather than in 0002 because on a fresh install
-- 0002 runs before these columns exist.
UPDATE users
SET monthly_living_expenses = 5000,
    liquidity_floor_monthly = 200,
    kids_count = 3,
    augusta_days = 14,
    augusta_daily_rate = 350,
    scorp_salary_split = 0.5
WHERE id = 1;
