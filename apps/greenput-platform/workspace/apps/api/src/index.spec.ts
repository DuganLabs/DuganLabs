import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import worker from './index';
import { clearRateLimitStore } from './middleware/rate-limit';

const SCHEMA = join(__dirname, '..', '..', '..', 'schema.sql');

/** Long enough to clear ADMIN_SETUP_TOKEN_MIN_LENGTH. */
const SETUP_TOKEN = 'setup-token-that-is-long-enough-to-be-a-secret';

/**
 * End-to-end tests through the Worker's real entry point, so the thing under
 * test is the ORDER routes are registered in and the middleware actually
 * attached to each mount — neither of which a sub-router spec can see. The
 * database is real SQLite over schema.sql; only KV is a stub.
 */
let sqlite: SqliteD1;
let kv: Map<string, string>;

interface TestEnv {
  DB: unknown;
  SESSIONS: unknown;
  ENVIRONMENT: string;
  ADMIN_SETUP_TOKEN?: string;
}

function makeEnv(overrides: Partial<TestEnv> = {}) {
  sqlite = createSqliteD1({ files: [SCHEMA] });
  kv = new Map<string, string>();
  return {
    DB: sqlite.db,
    SESSIONS: {
      get: (key: string) => Promise.resolve(kv.get(key) ?? null),
      put: (key: string, value: string) => {
        kv.set(key, value);
        return Promise.resolve();
      },
      delete: (key: string) => {
        kv.delete(key);
        return Promise.resolve();
      },
      list: () => Promise.resolve({ keys: [], list_complete: true }),
    },
    ENVIRONMENT: 'staging',
    ...overrides,
  };
}

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

/**
 * Rate limits are keyed by client IP, and the store is module-level, so every
 * request gets an explicit IP and each test its own.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function call(
  path: string,
  init: RequestInit & { ip?: string } = {},
  env: ReturnType<typeof makeEnv> = currentEnv,
) {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', init.ip ?? ip);
  return worker.fetch(
    new Request(`https://greenput-api-staging.greenput.workers.dev${path}`, {
      ...init,
      headers,
    }),
    env as never,
    ctx,
  );
}

let currentEnv: ReturnType<typeof makeEnv>;
let ip: string;

beforeEach(() => {
  clearRateLimitStore();
  ip = nextIp();
  currentEnv = makeEnv();
});

afterEach(() => {
  sqlite.close();
});

function setupBody(email = 'admin@greenput.com') {
  return JSON.stringify({ email, displayName: 'Admin' });
}

describe('POST /api/admin/auth/setup through the Worker entry point', () => {
  it('404s on a Worker with no ADMIN_SETUP_TOKEN, and creates nothing', async () => {
    // This is the reported hole: staging answered 201 + a platform-admin
    // cookie to this exact unauthenticated request.
    const res = await call('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: setupBody(),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(sqlite.rows('admin_users')).toHaveLength(0);
    expect(kv.size).toBe(0);
  });

  it('404s on a wrong token', async () => {
    currentEnv = makeEnv({ ADMIN_SETUP_TOKEN: SETUP_TOKEN });
    const res = await call('/api/admin/auth/setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Setup-Token': 'not-the-token-but-long-enough-to-look-like-it',
      },
      body: setupBody(),
    });

    expect(res.status).toBe(404);
    expect(sqlite.rows('admin_users')).toHaveLength(0);
  });

  it('bootstraps exactly once for an operator holding the token', async () => {
    currentEnv = makeEnv({ ADMIN_SETUP_TOKEN: SETUP_TOKEN });
    const headers = {
      'Content-Type': 'application/json',
      'X-Admin-Setup-Token': SETUP_TOKEN,
    };

    const first = await call('/api/admin/auth/setup', {
      method: 'POST',
      headers,
      body: setupBody(),
    });
    expect(first.status).toBe(201);
    expect(first.headers.get('set-cookie')).toContain('gp_admin_session=');

    const second = await call('/api/admin/auth/setup', {
      method: 'POST',
      headers,
      body: setupBody('someone-else@greenput.com'),
    });
    expect(second.status).toBe(403);
    expect(sqlite.rows('admin_users')).toHaveLength(1);
  });

  it('is rate limited, unlike before, at the credential budget', async () => {
    const body = setupBody();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await call('/api/admin/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(statuses[5]).toBe(429);
  });
});

describe('admin auth mount ordering', () => {
  async function signIn() {
    const token = 'admin-session-token';
    await currentEnv.SESSIONS.put(
      `admin_session:${token}`,
      JSON.stringify({
        isAdmin: true,
        adminId: 'admin-1',
        email: 'admin@greenput.com',
      }),
    );
    return `gp_admin_session=${token}`;
  }

  it('runs requireAdmin on /api/admin/auth/me instead of being shadowed', async () => {
    // Registered AFTER the /api/admin/auth/* catch-all, requireAdmin never
    // ran and /auth/me answered 401 to a signed-in admin.
    const cookie = await signIn();
    const res = await call('/api/admin/auth/me', { headers: { cookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user: { email: string } } };
    expect(body.data.user.email).toBe('admin@greenput.com');
  });

  it('still refuses /api/admin/auth/me without a session', async () => {
    const res = await call('/api/admin/auth/me');
    expect(res.status).toBe(401);
  });

  it('serves /api/admin/auth/status off the general budget', async () => {
    // Six of these used to be impossible to distinguish from six sign-in
    // attempts. They must not spend the credential budget.
    for (let i = 0; i < 6; i += 1) {
      const res = await call('/api/admin/auth/status');
      expect(res.status).toBe(200);
    }

    // …and the setup route's own budget is still intact afterwards.
    const res = await call('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: setupBody(),
    });
    expect(res.status).toBe(404);
  });

  it('reports configured once an admin row exists', async () => {
    sqlite.raw
      .prepare('INSERT INTO admin_users (id, email) VALUES (?, ?)')
      .run('admin-1', 'admin@greenput.com');

    const res = await call('/api/admin/auth/status');
    const body = (await res.json()) as { data: { configured: boolean } };
    expect(body.data.configured).toBe(true);
  });

  it('still requires an admin session for the rest of /api/admin/*', async () => {
    const metrics = await call('/api/admin/metrics');
    expect(metrics.status).toBe(401);

    const del = await call('/api/admin/workspaces/ws-1', { method: 'DELETE' });
    expect(del.status).toBe(401);
  });

  it('lets an admin reach /api/admin/* with a session', async () => {
    const cookie = await signIn();
    const res = await call('/api/admin/metrics', { headers: { cookie } });
    expect(res.status).toBe(200);
  });
});

describe('public brand assets — moved to apps/brand-assets (GP-108)', () => {
  // /api/public/brand/* used to serve the share card from this Worker. The
  // rasterizer is 2.4 MB of WASM and this Worker serves every authenticated
  // request, so it now lives at brand.greenput.com. Nothing here may answer
  // the old path with a card, a brand-route refusal, or anything a crawler
  // would mistake for an image — it falls through to the ordinary guards.
  it('no longer answers the old share-card path', async () => {
    const res = await call('/api/public/brand/demo/deadbeef/card.png');
    expect([401, 404]).toContain(res.status);
    expect(res.headers.get('Content-Type')).not.toBe('image/png');
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).not.toBe('Invalid asset version');
  });
});

describe('the chat WebSocket upgrade is behind the session (GP-055)', () => {
  it('answers 401 with no cookie, before any room or Durable Object is looked at', async () => {
    const res = await call('/api/chat/rooms/any-room/ws', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(401);
  });
});
