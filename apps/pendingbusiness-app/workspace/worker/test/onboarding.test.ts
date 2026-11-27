import { describe, it, expect, beforeEach } from 'vitest';
import {
  postOnboarding,
  isOnboarded,
  checkOnboarding,
  FILING_STATUSES,
} from '../src/routes/onboarding.js';
import type { Env } from '../src/env.js';

interface FakeUser {
  id: number;
  handle: string;
  role: string;
  email: string | null;
  filing_status: string | null;
  state: string | null;
}
interface FakeSession {
  id: string;
  user_id: number;
  expires_at: number;
}
interface FakeStore {
  users: FakeUser[];
  sessions: FakeSession[];
  /**
   * Mirrors migrations/0001_init.sql's `users.filing_status` CHECK
   * constraint. Defaults to the real production set so this fake actually
   * enforces the same rule D1 does — the original bug shipped because this
   * double previously accepted *any* string, so no test here could ever
   * have caught the vocabulary drift between the API and the live schema.
   */
  allowedFilingStatuses?: readonly string[];
}

const DB_FILING_STATUS_CHECK = ['single', 'mfj', 'mfs', 'hoh', 'qw'] as const;

function makeDB(store: FakeStore): D1Database {
  function prepare(sql: string) {
    let bindings: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      first: async () => {
        const r = run() as unknown[];
        return r[0] ?? null;
      },
      all: async () => ({ results: run() as unknown[] }),
      run: async () => ({ meta: { changes: typeof run() === 'number' ? (run() as number) : 0 } }),
    };
    function run(): unknown[] | number {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (
        s.startsWith(
          'SELECT u.id AS id, u.handle AS handle, u.role AS role, s.expires_at AS expiresAt FROM user_sessions',
        )
      ) {
        const sess = store.sessions.find(x => x.id === bindings[0]);
        if (!sess) return [];
        const u = store.users.find(x => x.id === sess.user_id);
        return u ? [{ id: u.id, handle: u.handle, role: u.role, expiresAt: sess.expires_at }] : [];
      }
      if (s.startsWith('SELECT id, email, filing_status, state FROM users WHERE id = ?')) {
        const u = store.users.find(x => x.id === bindings[0]);
        return u
          ? [{ id: u.id, email: u.email, filing_status: u.filing_status, state: u.state }]
          : [];
      }
      if (s.startsWith('UPDATE users SET email = ?, filing_status = ?, state = ? WHERE id = ?')) {
        const [email, fs, state, id] = bindings as [string, string, string, number];
        // Simulate UNIQUE constraint on email.
        if (store.users.some(u => u.email === email && u.id !== id)) {
          throw new Error('UNIQUE constraint failed: users.email');
        }
        // Simulate the real `filing_status` CHECK constraint — see the
        // FakeStore.allowedFilingStatuses doc comment.
        const allowed = store.allowedFilingStatuses ?? DB_FILING_STATUS_CHECK;
        if (!allowed.includes(fs)) {
          throw new Error(
            `CHECK constraint failed: filing_status IN (${allowed.map(v => `'${v}'`).join(',')})`,
          );
        }
        const u = store.users.find(x => x.id === id);
        if (u) {
          u.email = email;
          u.filing_status = fs;
          u.state = state;
          return 1;
        }
        return 0;
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

const COOKIE = 'pb_auth=session-token-abc';

function authedReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { Cookie: COOKIE, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

describe('isOnboarded()', () => {
  it('treats placeholder emails as not-yet-onboarded', () => {
    expect(isOnboarded({ email: 'foo@placeholder.invalid' })).toBe(false);
  });
  it('treats real emails as onboarded', () => {
    expect(isOnboarded({ email: 'owner@example.com' })).toBe(true);
  });
  it('treats null/empty as not-yet-onboarded', () => {
    expect(isOnboarded(null)).toBe(false);
    expect(isOnboarded({ email: null })).toBe(false);
    expect(isOnboarded({})).toBe(false);
  });
});

describe('POST /api/auth/onboarding', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = {
      users: [
        {
          id: 7,
          handle: 'newbie',
          role: 'user',
          email: 'newbie@placeholder.invalid',
          filing_status: 'single',
          state: 'CA',
        },
      ],
      sessions: [{ id: 'session-token-abc', user_id: 7, expires_at: 9999999999 }],
    };
  });

  it('rejects unauthenticated callers', async () => {
    const env = fakeEnv(store);
    const res = await postOnboarding(
      new Request('https://pb.com/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', filingStatus: 'single', state: 'NY' }),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('updates the user row with real values', async () => {
    const env = fakeEnv(store);
    const res = await postOnboarding(
      authedReq('https://pb.com/api/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          email: 'Real@Example.com',
          filingStatus: 'mfj',
          state: 'ny',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(store.users[0].email).toBe('real@example.com');
    expect(store.users[0].filing_status).toBe('mfj');
    expect(store.users[0].state).toBe('NY');
  });

  // Regression test for the production incident: every status this
  // endpoint claims to accept (worker/src/routes/onboarding.ts
  // FILING_STATUSES, which is also every option apps/site/src/welcome.html
  // offers) must actually save. Before this fix, `mfj`/`mfs`/`hoh` weren't
  // even offered — the form sent 'married_jointly' etc., which passed this
  // endpoint's validation and then blew up the real D1 CHECK constraint,
  // which only allows 'single'|'mfj'|'mfs'|'hoh'|'qw'. This test would have
  // caught that: it exercises the handler against a DB double that enforces
  // the real constraint, for every value the API and form actually offer.
  it.each(FILING_STATUSES)('saves successfully for filingStatus=%s', async filingStatus => {
    const env = fakeEnv(store);
    const res = await postOnboarding(
      authedReq('https://pb.com/api/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({ email: `${filingStatus}@example.com`, filingStatus, state: 'CA' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(store.users[0].filing_status).toBe(filingStatus);
  });

  it('surfaces a filing_status CHECK-constraint violation as 400 naming the field, not a 500', async () => {
    // Simulate the DB CHECK having drifted narrower than this handler's
    // allow-list (the mirror image of the shipped bug) — e.g. a migration
    // dropped support for 'qw' before this endpoint's validation caught up.
    // This is the regression test for the *response shape* of that failure
    // mode: it must come back as an actionable 400, never a generic 500.
    store.allowedFilingStatuses = ['single', 'mfj', 'mfs', 'hoh'];
    const env = fakeEnv(store);
    const res = await postOnboarding(
      authedReq('https://pb.com/api/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', filingStatus: 'qw', state: 'CA' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('CONSTRAINT_VIOLATION');
    expect(body.error.field).toBe('filingStatus');
  });

  it('rejects placeholder emails', async () => {
    const env = fakeEnv(store);
    const res = await postOnboarding(
      authedReq('https://pb.com/api/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          email: 'fake@placeholder.invalid',
          filingStatus: 'single',
          state: 'CA',
        }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PLACEHOLDER_EMAIL');
  });

  it('rejects unknown filing statuses', async () => {
    const env = fakeEnv(store);
    const res = await postOnboarding(
      authedReq('https://pb.com/api/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', filingStatus: 'space-cadet', state: 'CA' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects non-two-letter states', async () => {
    const env = fakeEnv(store);
    const res = await postOnboarding(
      authedReq('https://pb.com/api/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', filingStatus: 'single', state: 'California' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('checkOnboarding() middleware predicate', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = {
      users: [
        {
          id: 1,
          handle: 'warren',
          role: 'admin',
          email: 'owner@example.com',
          filing_status: 'mfj',
          state: 'CA',
        },
        {
          id: 7,
          handle: 'newbie',
          role: 'user',
          email: 'newbie@placeholder.invalid',
          filing_status: 'single',
          state: 'CA',
        },
      ],
      sessions: [],
    };
  });

  it('lets onboarded users through', async () => {
    const env = fakeEnv(store);
    const result = await checkOnboarding(new Request('https://pb.com/api/situation'), env, 1);
    expect(result).toBeNull();
  });

  it('returns 403 onboarding-required for placeholder users', async () => {
    const env = fakeEnv(store);
    const result = await checkOnboarding(new Request('https://pb.com/api/situation'), env, 7);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = (await result!.json()) as { error: { code: string } };
    expect(body.error.code).toBe('onboarding-required');
  });

  it('always lets /api/auth/* requests pass (so the user can onboard / log out)', async () => {
    const env = fakeEnv(store);
    const result = await checkOnboarding(
      new Request('https://pb.com/api/auth/me'),
      env,
      7, // not onboarded
    );
    expect(result).toBeNull();
  });

  it('lets /api/auth/onboarding pass for placeholder users', async () => {
    const env = fakeEnv(store);
    const result = await checkOnboarding(
      new Request('https://pb.com/api/auth/onboarding', { method: 'POST' }),
      env,
      7,
    );
    expect(result).toBeNull();
  });
});
