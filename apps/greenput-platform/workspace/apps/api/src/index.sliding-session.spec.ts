import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from './index';
import type { Env } from './env';
import { createFakeKv } from './test-helpers';
import {
  SESSION_MAX_IDLE_SECONDS,
  SESSION_TTL_SECONDS,
  resetRenewalCoalescingForTests,
  revokedKey,
  sessionKey,
} from './lib/session';

// ── The sliding session, through the REAL worker ────────────────────────────
//
// Not a replica of the composition: this drives the exported `default.fetch`
// from apps/api/src/index.ts, so the outer router, requireAuth, the sub-router
// dispatch, withErrorHandler, the security/CORS header rebuilds and the renewal
// drain are all the production ones. The previous round of this work was tested
// against a hand-rolled stand-in for that chain, which is exactly how a
// middleware that returned 500s on concurrent requests passed its suite.
//
// The KV fake enforces Workers KV's documented rules (one write per second per
// key → 429, expirations at least 60s out, optional read staleness), because
// those rules are what broke it.

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-09-11T12:00:00Z');

/**
 * requireAuth calls touchSession with no clock, so the only way to control the
 * time the REAL worker sees is to control Date itself. Timers are left alone —
 * only Date is faked.
 */
function setNow(at: number): void {
  vi.setSystemTime(at);
}

/** A clock that reads the faked Date, so the KV fake and the worker agree. */
const liveClock = {
  get now(): number {
    return Date.now();
  },
};

const PRINCIPAL = {
  id: 'u1',
  workspaceId: 'ws-1',
  email: 'owner@example.com',
  role: 'owner',
  firstName: 'Warren',
  lastName: 'Dugan',
};

/** Unique per test: the rate limiter's window is keyed by client IP. */
let clientSeq = 0;
function nextIp(): string {
  clientSeq += 1;
  return `203.0.113.${clientSeq}`;
}

function makeCtx(): ExecutionContext {
  return {
    // withErrorHandler hands its D1 error-tracking promise to waitUntil; these
    // tests give it a D1 that throws, so the rejection has to be absorbed here
    // the way the platform absorbs it.
    waitUntil: (promise: Promise<unknown>) => {
      void promise?.catch?.(() => undefined);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
}

/** A D1 that throws on any use — for the routes these tests never reach. */
function unusedDb(): D1Database {
  return {
    prepare: () => {
      throw new Error('this test should not touch D1');
    },
  } as unknown as D1Database;
}

function makeEnv(kv: KVNamespace, db: D1Database = unusedDb()): Env {
  return {
    ENVIRONMENT: 'production',
    DB: db,
    SESSIONS: kv,
  } as Env;
}

interface Harness {
  clock: { readonly now: number };
  fake: ReturnType<typeof createFakeKv>;
  env: Env;
  token: string;
  key: string;
  ip: string;
  get(path: string, token?: string): Promise<Response>;
  post(path: string, token?: string): Promise<Response>;
}

/**
 * A session three days old — past a renewal slot, so the next authenticated
 * request is renewal-due. Seeded two minutes back so the fixture is history
 * rather than a write racing the one under test.
 */
async function harness(
  options: {
    stalenessMs?: number;
    db?: D1Database;
    createdAt?: number;
    expiresAt?: number;
  } = {},
): Promise<Harness> {
  const fake = createFakeKv(liveClock, { stalenessMs: options.stalenessMs });
  const env = makeEnv(fake.kv, options.db);
  const token = 'sliding-tok';
  const ip = nextIp();

  setNow(BASE - 120_000);
  const expiresAt = options.expiresAt ?? BASE + 4 * DAY_MS;
  await fake.kv.put(
    sessionKey(token),
    JSON.stringify({
      ...PRINCIPAL,
      createdAt: options.createdAt ?? BASE - 3 * DAY_MS,
      expiresAt,
    }),
    { expiration: Math.floor(expiresAt / 1000) },
  );
  setNow(BASE);
  fake.forgetWrites();

  const send = (path: string, method: string, cookieToken?: string) => {
    const headers: Record<string, string> = { 'CF-Connecting-IP': ip };
    const value = cookieToken === undefined ? token : cookieToken;
    if (value) headers.Cookie = `gp_session=${value}`;
    return worker.fetch(
      new Request(`https://api.greenput.com${path}`, { method, headers }),
      env,
      makeCtx(),
    );
  };

  return {
    clock: liveClock,
    fake,
    env,
    token,
    key: sessionKey(token),
    ip,
    get: (path, cookieToken) => send(path, 'GET', cookieToken),
    post: (path, cookieToken) => send(path, 'POST', cookieToken),
  };
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function sessionCookie(response: Response): string | undefined {
  return setCookies(response).find((cookie) =>
    cookie.startsWith('gp_session='),
  );
}

function maxAgeOf(cookie: string): number {
  const match = cookie.match(/Max-Age=(\d+)/);
  if (!match) throw new Error(`no Max-Age in cookie: ${cookie}`);
  return Number(match[1]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow(BASE);
  resetRenewalCoalescingForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the worker — a renewal-due page load', () => {
  it('serves TWO concurrent authenticated requests without a 500', async () => {
    // The production shape. apps/platform/src/routes/dashboard/dashboard.ts
    // creates two auto-firing resources in one synchronous mount, so every
    // dashboard load is at least two concurrent requests on the same session
    // key — and KV throws 429 on the second write to a key within a second.
    const h = await harness();

    const responses = await Promise.all([
      h.get('/api/auth/me'),
      h.get('/api/auth/me'),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    for (const response of responses) {
      const body = (await response.json()) as { data: { user: unknown } };
      expect(body.data.user).toEqual(PRINCIPAL);
    }
    // One KV write for the page load, and no rejected write to swallow.
    expect(h.fake.applied(h.key)).toHaveLength(1);
    expect(h.fake.rejected(h.key)).toEqual([]);
  });

  it('serves six concurrent requests, and refreshes the cookie exactly once', async () => {
    const h = await harness();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => h.get('/api/auth/me')),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(200));
    const cookies = responses
      .map(sessionCookie)
      .filter((cookie): cookie is string => cookie !== undefined);
    expect(cookies.length).toBeGreaterThan(0);
    // Every cookie issued promises the same window, because the expiry written
    // is a function of the renewal slot and not of each request's clock.
    expect(new Set(cookies.map(maxAgeOf)).size).toBe(1);
    const maxAge = maxAgeOf(cookies[0]);
    expect(maxAge).toBeGreaterThanOrEqual(SESSION_TTL_SECONDS);
    expect(maxAge).toBeLessThanOrEqual(SESSION_MAX_IDLE_SECONDS);
    expect(h.fake.applied(h.key)).toHaveLength(1);
  });

  it('puts the refreshed cookie on the response, through every header rebuild', async () => {
    const h = await harness();

    const response = await h.get('/api/auth/me');

    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);
    expect(cookie).toContain('gp_session=sliding-tok');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Domain=.greenput.com');
    // Survived applySecurityHeaders + the outer rebuild, and the CORS/security
    // headers are still there too.
    expect(response.headers.get('X-Frame-Options')).toBeTruthy();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();

    // KV moved by the same amount the cookie did.
    const stored = h.fake.stored(h.key);
    expect(stored?.expiresAt).toBe(h.clock.now + maxAgeOf(cookie ?? '') * 1000);
  });

  it('sends the refreshed cookie even when the handler 500s', async () => {
    // requireAuth writes KV before the handler runs. If the handler throws,
    // withErrorHandler builds a 500 from scratch — so a drain that lived inside
    // routerFetch was skipped and the KV entry slid while the browser's Max-Age
    // did not. That asymmetry is the thing this feature exists to remove.
    const h = await harness({
      db: {
        prepare: () => {
          throw new Error('a D1 hiccup');
        },
      } as unknown as D1Database,
    });

    const response = await h.get('/api/leads');

    expect(response.status).toBe(500);
    expect(h.fake.applied(h.key)).toHaveLength(1);
    const cookie = sessionCookie(response);
    expect(cookie).toContain('gp_session=sliding-tok');
    expect(maxAgeOf(cookie ?? '')).toBeGreaterThanOrEqual(SESSION_TTL_SECONDS);
  });

  it('keeps serving when the renewal write is rejected outright', async () => {
    const h = await harness();
    const blocked = makeEnv({
      get: h.fake.kv.get.bind(h.fake.kv),
      put: async () => {
        throw new Error('KV PUT failed: 429 Too Many Requests');
      },
      delete: async () => undefined,
    } as unknown as KVNamespace);

    const response = await worker.fetch(
      new Request('https://api.greenput.com/api/auth/me', {
        headers: { Cookie: `gp_session=${h.token}` },
      }),
      blocked,
      makeCtx(),
    );

    expect(response.status).toBe(200);
    // No cookie, because there is no KV entry behind a longer one.
    expect(sessionCookie(response)).toBeUndefined();
  });

  it('does not 500 when concurrent requests both find a session past the cap', async () => {
    const h = await harness({
      createdAt: BASE - 31 * DAY_MS,
      expiresAt: BASE + 4 * DAY_MS,
    });

    const responses = await Promise.all([
      h.get('/api/auth/me'),
      h.get('/api/auth/me'),
    ]);

    expect(responses.map((r) => r.status)).toEqual([401, 401]);
    for (const response of responses) {
      expect(sessionCookie(response)).toContain('Max-Age=0');
    }
    expect(h.fake.stored(h.key)).toBeNull();
  });
});

describe('the worker — logout is final', () => {
  it('clears the cookie and kills the token', async () => {
    const h = await harness();

    const loggedOut = await h.post('/api/auth/logout');
    expect(loggedOut.status).toBe(200);
    expect(sessionCookie(loggedOut)).toContain('Max-Age=0');

    // Somebody still holding the token gets nowhere.
    const after = await h.get('/api/auth/me');
    expect(after.status).toBe(401);
    expect(sessionCookie(after)).toContain('Max-Age=0');
  });

  it('cannot be undone by a renewal that was still in flight', async () => {
    // Press Log out while the dashboard is still loading. The in-flight
    // request's renewal put lands after logout's delete, so the record comes
    // back and its response carries a fresh cookie. Before the tombstone, that
    // left the person signed in with a new window.
    const h = await harness();

    const release = h.fake.holdNextWrite({ key: h.key, op: 'put' });
    const inFlight = h.get('/api/auth/me');

    const loggedOut = await h.post('/api/auth/logout');
    expect(loggedOut.status).toBe(200);
    expect(h.fake.stored(h.key)).toBeNull();

    setNow(BASE + 1500); // the held write comes back a round trip later
    release();
    const resurrecting = await inFlight;
    expect(resurrecting.status).toBe(200); // it was authorised before the click

    // The record really is back, and its response really did re-issue a cookie:
    // this is the defect, reproduced, not avoided.
    expect(h.fake.stored(h.key)).not.toBeNull();
    expect(sessionCookie(resurrecting)).toContain('gp_session=sliding-tok');

    // And it is worth nothing. The tombstone outranks the record.
    const after = await h.get('/api/auth/me');
    expect(after.status).toBe(401);
    expect(sessionCookie(after)).toContain('Max-Age=0');
    expect(h.fake.stored(revokedKey(h.token))).not.toBeNull();
  });

  it('still revokes when KV rate-limits the delete', async () => {
    const h = await harness();

    // A renewal wrote the session key a moment ago, so logout's delete is the
    // second write to it inside a second and KV refuses it.
    await h.get('/api/auth/me');
    expect(h.fake.applied(h.key)).toHaveLength(1);

    const loggedOut = await h.post('/api/auth/logout');
    expect(loggedOut.status).toBe(200);
    expect(h.fake.rejected(h.key).length).toBeGreaterThan(0);
    expect(h.fake.stored(h.key)).not.toBeNull(); // the record survived

    const after = await h.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('does not claim success when nothing could be revoked', async () => {
    const h = await harness();
    const broken = makeEnv({
      get: h.fake.kv.get.bind(h.fake.kv),
      put: async () => {
        throw new Error('KV unavailable');
      },
      delete: async () => {
        throw new Error('KV unavailable');
      },
    } as unknown as KVNamespace);

    const response = await worker.fetch(
      new Request('https://api.greenput.com/api/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: `gp_session=${h.token}`,
          'CF-Connecting-IP': nextIp(),
        },
      }),
      broken,
      makeCtx(),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('LOGOUT_INCOMPLETE');
    // The browser's copy is still cleared — it is the half we can always reach.
    expect(sessionCookie(response)).toContain('Max-Age=0');
  });
});

describe('the worker — a request with no session', () => {
  it('401s without writing anything', async () => {
    const h = await harness();

    const response = await h.get('/api/auth/me', '');

    expect(response.status).toBe(401);
    expect(h.fake.applied()).toEqual([]);
  });
});
