-- 0003_plaid.sql — Plaid integration: credentials, items, accounts.

CREATE TABLE IF NOT EXISTS plaid_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT NOT NULL,
  secret TEXT NOT NULL,
  env TEXT NOT NULL CHECK (env IN ('sandbox','production')) DEFAULT 'sandbox',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plaid_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_plaid_items_user ON plaid_items(user_id);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plaid_item_id INTEGER REFERENCES plaid_items(id) ON DELETE CASCADE,
  plaid_account_id TEXT,
  name TEXT NOT NULL,
  official_name TEXT,
  type TEXT NOT NULL,
  subtype TEXT,
  mask TEXT,
  current_balance REAL,
  available_balance REAL,
  iso_currency TEXT DEFAULT 'USD',
  last_synced_at TEXT,
  UNIQUE(plaid_item_id, plaid_account_id)
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_item ON accounts(plaid_item_id);
