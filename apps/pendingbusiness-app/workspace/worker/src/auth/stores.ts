/**
 * Custom @basenative/auth-webauthn store factory for PendingBusiness.
 *
 * The package's d1WebAuthnStores expects `users.id` to be a TEXT uuid keyed
 * by `handle`. PendingBusiness already has a `users` table with INTEGER
 * primary keys + email/display_name/filing_status/state and FKs from many
 * other tables (income_sources, liabilities, scenarios, plaid_items,
 * accounts) — we cannot change its shape without rewriting the FK graph.
 *
 * So we provide stores that satisfy the same four-method interface
 * documented in @basenative/auth-webauthn README "storage contract", but
 * back them with PB's existing schema. Specifically:
 *   - users.id stays INTEGER; we expose it as a string at the boundary.
 *   - users.handle is a new TEXT UNIQUE column added in 0004_webauthn.sql.
 *   - new tables `credentials`, `challenges`, `user_sessions` use INTEGER
 *     user_id, mirroring the rest of the schema.
 *
 * **First-time enrollment / "pick a username" flow.**
 *
 * PendingBusiness historically keys users by email, but @simplewebauthn/server
 * (and the @basenative/auth-webauthn adapter) validates handles against
 * `^[a-z0-9_-]{2,24}$`. We don't auto-derive a handle from the email — the
 * UI prompts for one at first passkey enrollment (see apps/site/src/account.ts).
 * Existing rows (currently just Warren, id=1) are backfilled in the migration
 * with `handle = 'warren'`.
 *
 * **Enrolment is closed.** PendingBusiness is a treasury OS for one:
 * `pbUsers.create` only ever succeeds while the users table is empty (the
 * one-time bootstrap of a fresh database). Once any user exists, the
 * adapter's create-on-register path throws `enrollment-closed`, and
 * routes/auth.ts refuses /api/auth/register-options for unknown handles
 * before the adapter is even consulted. New passkeys can only be added to
 * handles that already exist.
 */

const HANDLE_RX = /^[a-z0-9_-]{2,24}$/;

/** Same normalisation @basenative/auth-webauthn applies before lookup. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RX.test(handle);
}

/** True only for a never-used database — the sole case enrolment may create a user. */
export async function usersTableIsEmpty(DB: D1Database): Promise<boolean> {
  const row = await DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return (row?.n ?? 0) === 0;
}

interface UserRow {
  id: number;
  handle: string | null;
  role: string | null;
  email: string | null;
  display_name: string | null;
  filing_status: string | null;
  state: string | null;
}

interface AdapterUser {
  id: string; // string at the boundary; we coerce to/from INTEGER internally
  handle: string;
  role: 'user' | 'moderator' | 'admin';
}

function shape(row: UserRow | null): AdapterUser | null {
  if (!row) return null;
  // A user without a handle cannot authenticate via passkey; surfacing one
  // would let the adapter try to read passkeys for an empty handle.
  if (!row.handle) return null;
  return {
    id: String(row.id),
    handle: row.handle,
    role: (row.role as AdapterUser['role']) || 'user',
  };
}

export function pbWebAuthnStores(DB: D1Database) {
  return {
    users: pbUsers(DB),
    credentials: pbCredentials(DB),
    challenges: pbChallenges(DB),
    userSessions: pbUserSessions(DB),
  };
}

function pbUsers(DB: D1Database) {
  return {
    async getByHandle(handle: string): Promise<AdapterUser | null> {
      const r = await DB.prepare(
        'SELECT id, handle, role, email, display_name, filing_status, state FROM users WHERE handle = ? COLLATE NOCASE',
      )
        .bind(handle)
        .first<UserRow>();
      return shape(r);
    },

    async getById(id: string): Promise<AdapterUser | null> {
      const numeric = Number(id);
      if (!Number.isFinite(numeric)) return null;
      const r = await DB.prepare(
        'SELECT id, handle, role, email, display_name, filing_status, state FROM users WHERE id = ?',
      )
        .bind(numeric)
        .first<UserRow>();
      return shape(r);
    },

    /**
     * Create the first user of a fresh database. Refuses (`enrollment-closed`)
     * as soon as any user exists — see file comment. Email-keyed columns get
     * placeholders that /welcome.html replaces during onboarding.
     */
    async create({ handle }: { id: string; handle: string }): Promise<AdapterUser> {
      if (!HANDLE_RX.test(handle)) throw new Error('bad-handle');
      if (!(await usersTableIsEmpty(DB))) throw new Error('enrollment-closed');
      const r = await DB.prepare(
        `INSERT INTO users (email, display_name, filing_status, state, handle, role)
         VALUES (?, ?, 'single', 'CA', ?, 'user') RETURNING id`,
      )
        .bind(`${handle}@placeholder.invalid`, handle, handle)
        .first<{ id: number }>();
      if (!r) throw new Error('user-create-failed');
      return { id: String(r.id), handle, role: 'user' };
    },

    async setRole(id: string, role: string, changedBy: string | null): Promise<void> {
      const numeric = Number(id);
      if (!Number.isFinite(numeric)) return;
      await DB.prepare(
        'UPDATE users SET role = ?, role_changed_at = unixepoch(), role_changed_by = ? WHERE id = ?',
      )
        .bind(role, changedBy ?? null, numeric)
        .run();
    },
  };
}

interface CredentialRow {
  id: string;
  userId: number;
  publicKey: string;
  counter: number;
  transports: string | null;
}

function pbCredentials(DB: D1Database) {
  // exactOptionalPropertyTypes: only include `transports` in the returned
  // object when there's an actual array — `transports: undefined` is not
  // assignable to `transports?: string[]` under that flag.
  function shapeRow(c: CredentialRow): {
    id: string;
    userId: string;
    publicKey: string;
    counter: number;
    transports?: string[];
  } {
    const base = {
      id: c.id,
      userId: String(c.userId),
      publicKey: c.publicKey,
      counter: c.counter,
    };
    return c.transports ? { ...base, transports: JSON.parse(c.transports) as string[] } : base;
  }

  return {
    async listByUser(userId: string) {
      const numeric = Number(userId);
      if (!Number.isFinite(numeric)) return [];
      const r = await DB.prepare(
        'SELECT id, user_id AS userId, public_key AS publicKey, counter, transports FROM credentials WHERE user_id = ?',
      )
        .bind(numeric)
        .all<CredentialRow>();
      return (r.results || []).map(shapeRow);
    },

    async getById(credId: string) {
      const r = await DB.prepare(
        'SELECT id, user_id AS userId, public_key AS publicKey, counter, transports FROM credentials WHERE id = ?',
      )
        .bind(credId)
        .first<CredentialRow>();
      if (!r) return null;
      return shapeRow(r);
    },

    async create({
      id,
      userId,
      publicKey,
      counter,
      transports,
    }: {
      id: string;
      userId: string;
      publicKey: string;
      counter?: number;
      transports?: string[];
    }) {
      await DB.prepare(
        'INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(
          id,
          Number(userId),
          publicKey,
          counter || 0,
          transports ? JSON.stringify(transports) : null,
        )
        .run();
    },

    async updateCounter(id: string, counter: number) {
      await DB.prepare('UPDATE credentials SET counter = ? WHERE id = ?').bind(counter, id).run();
    },
  };
}

function pbChallenges(DB: D1Database) {
  return {
    async create({
      challenge,
      userId,
      purpose,
      ttlSeconds = 300,
    }: {
      challenge: string;
      userId: string | null;
      purpose: string;
      ttlSeconds?: number;
    }) {
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
      const numeric = userId == null ? null : Number(userId);
      await DB.prepare(
        'INSERT INTO challenges (challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)',
      )
        .bind(challenge, numeric, purpose, expiresAt)
        .run();
    },

    async consume(challenge: string, purpose: string) {
      const r = await DB.prepare(
        'SELECT challenge, user_id AS userId, purpose, expires_at AS expiresAt FROM challenges WHERE challenge = ? AND purpose = ?',
      )
        .bind(challenge, purpose)
        .first<{ challenge: string; userId: number | null; purpose: string; expiresAt: number }>();
      if (!r) return null;
      await DB.prepare('DELETE FROM challenges WHERE challenge = ?').bind(challenge).run();
      if (r.expiresAt < Math.floor(Date.now() / 1000)) return null;
      return {
        challenge: r.challenge,
        userId: r.userId == null ? null : String(r.userId),
        purpose: r.purpose as 'register' | 'authenticate',
        expiresAt: r.expiresAt,
      };
    },
  };
}

function pbUserSessions(DB: D1Database) {
  return {
    async create({ id, userId, ttlSeconds }: { id: string; userId: string; ttlSeconds: number }) {
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
      await DB.prepare('INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(id, Number(userId), expiresAt)
        .run();
    },

    async getUser(token: string): Promise<AdapterUser | null> {
      const r = await DB.prepare(
        `SELECT u.id AS id, u.handle AS handle, u.role AS role, s.expires_at AS expiresAt
         FROM user_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`,
      )
        .bind(token)
        .first<{ id: number; handle: string | null; role: string | null; expiresAt: number }>();
      if (!r) return null;
      if (r.expiresAt < Math.floor(Date.now() / 1000)) return null;
      if (!r.handle) return null;
      return {
        id: String(r.id),
        handle: r.handle,
        role: (r.role as AdapterUser['role']) || 'user',
      };
    },

    async destroy(token: string) {
      await DB.prepare('DELETE FROM user_sessions WHERE id = ?').bind(token).run();
    },
  };
}
