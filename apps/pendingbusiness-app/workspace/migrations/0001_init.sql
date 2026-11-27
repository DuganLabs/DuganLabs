-- 0001_init.sql — pendingbusiness D1 baseline schema.
-- Tables mirror the domain model specified in the project brief.
-- All writes in the worker use parameterized statements via `.bind()`.

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('prospect','pending','active')) DEFAULT 'prospect',
  joined_at TEXT,
  dues_tier TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  filing_status TEXT NOT NULL CHECK (filing_status IN ('single','mfj','mfs','hoh','qw')),
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('w2','se','k1','other')),
  gross_annual REAL NOT NULL DEFAULT 0,
  employer TEXT,
  has_401k_match INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_income_user ON income_sources(user_id);

CREATE TABLE IF NOT EXISTS liabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  principal REAL NOT NULL,
  rate_apr REAL NOT NULL,
  min_payment_monthly REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('personal_loan','mortgage','student','cc','other')),
  priority INTEGER NOT NULL DEFAULT 100
);
CREATE INDEX IF NOT EXISTS idx_liabilities_user ON liabilities(user_id);

CREATE TABLE IF NOT EXISTS tax_brackets (
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('federal','ca')),
  filing_status TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  bracket_floor REAL NOT NULL,
  bracket_ceiling REAL,
  marginal_rate REAL NOT NULL,
  PRIMARY KEY (jurisdiction, filing_status, tax_year, bracket_floor)
);

CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  computed_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scenarios_user ON scenarios(user_id);
