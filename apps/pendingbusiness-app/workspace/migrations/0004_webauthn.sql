-- 0004_webauthn.sql — passkey (WebAuthn) auth schema for @basenative/auth-webauthn.
--
-- PendingBusiness already has a `users` table (INTEGER id, email-keyed) with
-- FK references from income_sources, liabilities, scenarios, plaid_items, and
-- accounts. We preserve that table and add the columns the auth package
-- requires, then create the three new auth tables (credentials, challenges,
-- user_sessions). A custom store layer (worker/src/auth/stores.ts) adapts our
-- INTEGER user_id to the package's TEXT-id interface.
--
-- The package ships a 0001_webauthn_schema.sql that CREATEs a `users` table
-- with TEXT id; we cannot use that directly because of the existing FK graph,
-- so we ALTER the table instead — see playbook in
-- @basenative/auth-webauthn README "Migrating an existing project".

-- 1. Augment users with role + handle for the passkey adapter.
--    `handle` is the short login-id the passkey client uses; users pick it
--    once at first passkey enrollment (see worker/src/auth/stores.ts comments).
ALTER TABLE users ADD COLUMN handle TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user','moderator','admin'));
ALTER TABLE users ADD COLUMN role_changed_at INTEGER;
ALTER TABLE users ADD COLUMN role_changed_by TEXT;

-- Backfill: Warren (id=1) gets handle 'warren' so the seeded admin works.
UPDATE users SET handle = 'warren' WHERE id = 1 AND handle IS NULL;

-- Case-insensitive uniqueness on handle (NULLs are allowed; D1 unique indexes
-- treat NULLs as distinct, matching SQLite semantics).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users(handle COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. Passkey credentials. user_id is INTEGER to match users(id).
CREATE TABLE IF NOT EXISTS credentials (
  id          TEXT PRIMARY KEY,                            -- WebAuthn credentialID (base64url)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL,                               -- base64url-encoded COSE pubkey
  counter     INTEGER NOT NULL DEFAULT 0,
  transports  TEXT,                                        -- JSON array: ['internal','hybrid',...]
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

-- 3. WebAuthn challenges (single-use, ≤ 5min TTL enforced by adapter).
CREATE TABLE IF NOT EXISTS challenges (
  challenge   TEXT PRIMARY KEY,
  user_id     INTEGER,                                     -- NULL for usernameless flows
  purpose     TEXT NOT NULL,                               -- 'register' | 'authenticate'
  expires_at  INTEGER NOT NULL                             -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);

-- 4. Session tokens (cookie value → user lookup).
CREATE TABLE IF NOT EXISTS user_sessions (
  id          TEXT PRIMARY KEY,                            -- session token (cookie value)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
