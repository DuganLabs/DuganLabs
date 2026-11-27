-- 0002_seed_warren.sql — canonical first user (id 1) and 2026 federal/CA
-- MFJ tax brackets, seeded for local dev and fresh installs. Idempotent via
-- INSERT OR IGNORE.
--
-- The income/liability rows below are illustrative placeholders, not real
-- financial data — replace them with your own via /settings and the
-- onboarding flow after your first deploy. The household figures for this
-- user (living expenses, liquidity floor, children, Augusta rule, S-Corp
-- salary split) are seeded in 0006_household_profile.sql, which is where the
-- columns are added; they are placeholders in exactly the same sense.
--
-- Sources:
--  - Federal brackets: IRS Rev. Proc. 2025-32 (2026 MFJ).
--  - California brackets: FTB 2026 MFJ schedule (seeds 2025 values if the
--    FTB has not yet published 2026 — refresh when they do).

INSERT OR IGNORE INTO users (id, email, display_name, filing_status, state)
VALUES (1, 'owner@example.com', 'Warren Dugan', 'mfj', 'CA');

INSERT OR IGNORE INTO income_sources (id, user_id, label, type, gross_annual, employer, has_401k_match, notes)
VALUES
  (1, 1, 'Primary job', 'w2', 120000, 'Example Employer, Inc.', 1, 'Sample W-2 income source with a 401(k) match available — replace via Settings.'),
  (2, 1, 'Household member', 'w2', 65000, 'Example School District', 0, 'Sample second W-2 income source — use this row for a spouse or co-filer.'),
  (3, 1, 'Greenput', 'se', 0, NULL, 0, 'Sample self-employment income source — replace via Settings.');

INSERT OR IGNORE INTO liabilities (id, user_id, label, principal, rate_apr, min_payment_monthly, type, priority)
VALUES
  (1, 1, 'Example personal loan', 25000, 0.09, 650, 'personal_loan', 1);

INSERT OR IGNORE INTO tax_brackets (jurisdiction, filing_status, tax_year, bracket_floor, bracket_ceiling, marginal_rate)
VALUES
  ('federal', 'mfj', 2026, 0,       23850,  0.10),
  ('federal', 'mfj', 2026, 23850,   96950,  0.12),
  ('federal', 'mfj', 2026, 96950,   206700, 0.22),
  ('federal', 'mfj', 2026, 206700,  394600, 0.24),
  ('federal', 'mfj', 2026, 394600,  501050, 0.32),
  ('federal', 'mfj', 2026, 501050,  751600, 0.35),
  ('federal', 'mfj', 2026, 751600,  NULL,   0.37);

INSERT OR IGNORE INTO tax_brackets (jurisdiction, filing_status, tax_year, bracket_floor, bracket_ceiling, marginal_rate)
VALUES
  ('ca', 'mfj', 2026, 0,        21512,   0.010),
  ('ca', 'mfj', 2026, 21512,    50998,   0.020),
  ('ca', 'mfj', 2026, 50998,    80490,   0.040),
  ('ca', 'mfj', 2026, 80490,    111732,  0.060),
  ('ca', 'mfj', 2026, 111732,   141212,  0.080),
  ('ca', 'mfj', 2026, 141212,   721318,  0.093),
  ('ca', 'mfj', 2026, 721318,   865574,  0.103),
  ('ca', 'mfj', 2026, 865574,   1442628, 0.113),
  ('ca', 'mfj', 2026, 1442628,  NULL,    0.123);
