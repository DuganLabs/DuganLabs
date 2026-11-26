-- Shared lead store for every DuganLabs coming-soon page.
CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL,
  name            TEXT,
  interest        TEXT,
  source          TEXT NOT NULL,           -- app tag, set server-side by the site Worker
  host            TEXT,
  consent_version TEXT NOT NULL,
  ip_hash         TEXT,                    -- SHA-256(salt + ip); abuse control only
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (email, source)
);
CREATE INDEX IF NOT EXISTS leads_source_created ON leads (source, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_ip_created ON leads (ip_hash, created_at);
