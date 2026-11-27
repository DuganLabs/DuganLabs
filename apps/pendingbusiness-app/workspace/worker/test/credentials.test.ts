import { describe, it, expect, beforeEach } from 'vitest';
import { listCredentials, renameCredential, revokeCredential } from '../src/routes/credentials.js';
import type { Env } from '../src/env.js';

/**
 * In-memory fake of the bits of D1 these route handlers actually touch.
 * We model two tables — `users` and `credentials` — and just enough of the
 * D1 prepare/bind/all/first/run surface for the queries the routes issue.
 *
 * The auth adapter inside getAdapter→currentUser also calls
 * `SELECT … FROM user_sessions s JOIN users u …` to resolve the cookie;
 * we honor that one too.
 */
interface FakeUser {
  id: number;
  handle: string;
  role: string;
  email: string | null;
}
interface FakeCred {
  id: string;
  user_id: number;
  nickname: string | null;
  transports: string | null;
  counter: number;
  created_at: number;
}
interface FakeSession {
  id: string;
  user_id: number;
  expires_at: number;
}

interface FakeStore {
  users: FakeUser[];
  credentials: FakeCred[];
  sessions: FakeSession[];
}

function makeDB(store: FakeStore): D1Database {
  function prepare(sql: string) {
    let bindings: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      first: async <T = unknown>(): Promise<T | null> => {
        const result = run() as T[];
        return result[0] ?? null;
      },
      all: async <T = unknown>(): Promise<{ results: T[] }> => {
        return { results: run() as T[] };
      },
      run: async () => {
        const result = run();
        return { meta: { changes: typeof result === 'number' ? result : 0 } };
      },
    };
    function run(): unknown[] | number {
      const s = sql.replace(/\s+/g, ' ').trim();

      // Session lookup (used by adapter.currentUser)
      if (
        s.startsWith(
          'SELECT u.id AS id, u.handle AS handle, u.role AS role, s.expires_at AS expiresAt FROM user_sessions',
        )
      ) {
        const sess = store.sessions.find(x => x.id === bindings[0]);
        if (!sess) return [];
        const u = store.users.find(x => x.id === sess.user_id);
        if (!u) return [];
        return [{ id: u.id, handle: u.handle, role: u.role, expiresAt: sess.expires_at }];
      }

      // List credentials
      if (
        s.startsWith(
          'SELECT id, nickname, transports, counter, created_at FROM credentials WHERE user_id = ?',
        )
      ) {
        return store.credentials
          .filter(c => c.user_id === bindings[0])
          .map(c => ({
            id: c.id,
            nickname: c.nickname,
            transports: c.transports,
            counter: c.counter,
            created_at: c.created_at,
          }));
      }

      // Rename
      if (s.startsWith('UPDATE credentials SET nickname = ? WHERE id = ? AND user_id = ?')) {
        const [nickname, id, uid] = bindings as [string | null, string, number];
        const c = store.credentials.find(x => x.id === id && x.user_id === uid);
        if (!c) return 0;
        c.nickname = nickname;
        return 1;
      }

      // Count for revoke last-credential check
      if (s.startsWith('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?')) {
        return [{ n: store.credentials.filter(c => c.user_id === bindings[0]).length }];
      }

      // Delete
      if (s.startsWith('DELETE FROM credentials WHERE id = ? AND user_id = ?')) {
        const [id, uid] = bindings as [string, number];
        const before = store.credentials.length;
        store.credentials = store.credentials.filter(c => !(c.id === id && c.user_id === uid));
        return before - store.credentials.length;
      }

      // Onboarding: load user
      if (s.startsWith('SELECT id, email, filing_status, state FROM users WHERE id = ?')) {
        const u = store.users.find(x => x.id === bindings[0]);
        return u ? [{ id: u.id, email: u.email, filing_status: null, state: null }] : [];
      }

      // /me: onboardingRequired + profile
      if (
        s.startsWith('SELECT email, display_name, filing_status, state FROM users WHERE id = ?')
      ) {
        const u = store.users.find(x => x.id === bindings[0]);
        return u ? [{ email: u.email, display_name: null, filing_status: null, state: null }] : [];
      }

      // Generic user-by-id lookup (adapter)
      if (
        s.startsWith(
          'SELECT id, handle, role, email, display_name, filing_status, state FROM users WHERE id = ?',
        )
      ) {
        const u = store.users.find(x => x.id === bindings[0]);
        return u
          ? [
              {
                id: u.id,
                handle: u.handle,
                role: u.role,
                email: u.email,
                display_name: null,
                filing_status: null,
                state: null,
              },
            ]
          : [];
      }

      return [];
    }
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function fakeEnv(store: FakeStore): Env {
  return {
    DB: makeDB(store),
    ASSETS: {} as Fetcher,
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
  };
}

/**
 * Build a (request, params) pair for the new BN-router-shaped handlers.
 * Returns a tuple so tests stay readable: `await fn(...reqFor(...), env)`
 * is awkward, so we expose it as `request` + `params` and the call sites
 * pass them positionally.
 */
function reqFor(
  url: string,
  init: RequestInit = {},
  params: Record<string, string> = {},
): { request: Request; params: Record<string, string> } {
  return { request: new Request(url, init), params };
}

const noopCtx: ExecutionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
};

const SESSION_COOKIE = 'pb_auth=session-token-abc';

describe('GET /api/auth/credentials', () => {
  let store: FakeStore;

  beforeEach(() => {
    store = {
      users: [{ id: 1, handle: 'warren', role: 'admin', email: 'owner@example.com' }],
      credentials: [
        {
          id: 'cred-1',
          user_id: 1,
          nickname: 'MacBook',
          transports: '["internal"]',
          counter: 5,
          created_at: 1700000000,
        },
        {
          id: 'cred-2',
          user_id: 1,
          nickname: null,
          transports: '["hybrid"]',
          counter: 0,
          created_at: 1700001000,
        },
      ],
      sessions: [{ id: 'session-token-abc', user_id: 1, expires_at: 9999999999 }],
    };
  });

  it('rejects unauthenticated callers with 401', async () => {
    const env = fakeEnv(store);
    const { request } = reqFor('https://pb.com/api/auth/credentials');
    const res = await listCredentials(request, env);
    expect(res.status).toBe(401);
  });

  it("returns the current user's credentials with derived platform", async () => {
    const env = fakeEnv(store);
    const { request } = reqFor('https://pb.com/api/auth/credentials', {
      headers: { Cookie: SESSION_COOKIE },
    });
    const res = await listCredentials(request, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      credentials: Array<{ id: string; platform: string; nickname: string | null }>;
    };
    expect(body.credentials).toHaveLength(2);
    expect(body.credentials[0]).toMatchObject({
      id: 'cred-1',
      platform: 'platform',
      nickname: 'MacBook',
    });
    expect(body.credentials[1]).toMatchObject({
      id: 'cred-2',
      platform: 'cross-device',
      nickname: null,
    });
  });
});

describe('PATCH /api/auth/credentials/:id', () => {
  let store: FakeStore;

  beforeEach(() => {
    store = {
      users: [{ id: 1, handle: 'warren', role: 'admin', email: 'owner@example.com' }],
      credentials: [
        { id: 'cred-1', user_id: 1, nickname: null, transports: null, counter: 0, created_at: 1 },
        {
          id: 'someone-elses',
          user_id: 99,
          nickname: 'do not touch',
          transports: null,
          counter: 0,
          created_at: 1,
        },
      ],
      sessions: [{ id: 'session-token-abc', user_id: 1, expires_at: 9999999999 }],
    };
  });

  it('renames a credential the user owns', async () => {
    const env = fakeEnv(store);
    const { request, params } = reqFor(
      'https://pb.com/api/auth/credentials/cred-1',
      {
        method: 'PATCH',
        headers: { Cookie: SESSION_COOKIE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Work laptop' }),
      },
      { id: 'cred-1' },
    );
    const res = await renameCredential(request, env, noopCtx, params);
    expect(res.status).toBe(200);
    expect(store.credentials[0].nickname).toBe('Work laptop');
  });

  it('refuses to rename a credential owned by another user (404)', async () => {
    const env = fakeEnv(store);
    const { request, params } = reqFor(
      'https://pb.com/api/auth/credentials/someone-elses',
      {
        method: 'PATCH',
        headers: { Cookie: SESSION_COOKIE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'pwned' }),
      },
      { id: 'someone-elses' },
    );
    const res = await renameCredential(request, env, noopCtx, params);
    expect(res.status).toBe(404);
    expect(store.credentials[1].nickname).toBe('do not touch');
  });

  it('rejects nicknames longer than 64 chars', async () => {
    const env = fakeEnv(store);
    const { request, params } = reqFor(
      'https://pb.com/api/auth/credentials/cred-1',
      {
        method: 'PATCH',
        headers: { Cookie: SESSION_COOKIE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'x'.repeat(65) }),
      },
      { id: 'cred-1' },
    );
    const res = await renameCredential(request, env, noopCtx, params);
    expect(res.status).toBe(400);
  });

  it('accepts null to clear the nickname', async () => {
    store.credentials[0].nickname = 'old';
    const env = fakeEnv(store);
    const { request, params } = reqFor(
      'https://pb.com/api/auth/credentials/cred-1',
      {
        method: 'PATCH',
        headers: { Cookie: SESSION_COOKIE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: null }),
      },
      { id: 'cred-1' },
    );
    const res = await renameCredential(request, env, noopCtx, params);
    expect(res.status).toBe(200);
    expect(store.credentials[0].nickname).toBeNull();
  });
});

describe('DELETE /api/auth/credentials/:id', () => {
  let store: FakeStore;

  beforeEach(() => {
    store = {
      users: [{ id: 1, handle: 'warren', role: 'admin', email: 'owner@example.com' }],
      credentials: [
        { id: 'cred-1', user_id: 1, nickname: null, transports: null, counter: 0, created_at: 1 },
        { id: 'cred-2', user_id: 1, nickname: null, transports: null, counter: 0, created_at: 1 },
      ],
      sessions: [{ id: 'session-token-abc', user_id: 1, expires_at: 9999999999 }],
    };
  });

  it('revokes a credential when more than one exists', async () => {
    const env = fakeEnv(store);
    const { request, params } = reqFor(
      'https://pb.com/api/auth/credentials/cred-1',
      {
        method: 'DELETE',
        headers: { Cookie: SESSION_COOKIE },
      },
      { id: 'cred-1' },
    );
    const res = await revokeCredential(request, env, noopCtx, params);
    expect(res.status).toBe(200);
    expect(store.credentials.find(c => c.id === 'cred-1')).toBeUndefined();
  });

  it("refuses to revoke the user's only credential without ?force=1", async () => {
    store.credentials = [store.credentials[0]];
    const env = fakeEnv(store);
    const { request, params } = reqFor(
      'https://pb.com/api/auth/credentials/cred-1',
      {
        method: 'DELETE',
        headers: { Cookie: SESSION_COOKIE },
      },
      { id: 'cred-1' },
    );
    const res = await revokeCredential(request, env, noopCtx, params);
    expect(res.status).toBe(409);
    expect(store.credentials).toHaveLength(1);
  });

  it('revokes the last credential when ?force=1 is passed', async () => {
    store.credentials = [store.credentials[0]];
    const env = fakeEnv(store);
    const { request, params } = reqFor(
      'https://pb.com/api/auth/credentials/cred-1?force=1',
      {
        method: 'DELETE',
        headers: { Cookie: SESSION_COOKIE },
      },
      { id: 'cred-1' },
    );
    const res = await revokeCredential(request, env, noopCtx, params);
    expect(res.status).toBe(200);
    expect(store.credentials).toHaveLength(0);
  });
});
