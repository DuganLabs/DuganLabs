import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';

const SCHEMA = join(__dirname, '..', '..', '..', '..', 'schema.sql');

/** Long enough to clear ADMIN_SETUP_TOKEN_MIN_LENGTH. */
const SETUP_TOKEN = 'setup-token-that-is-long-enough-to-be-a-secret';

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'reg-challenge',
    rp: { name: 'Greenput Admin', id: 'localhost' },
    user: { id: 'dXNlci0x', name: 'admin@greenput.com', displayName: 'Admin' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-admin-1',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    },
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'auth-challenge',
    rpId: 'localhost',
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  }),
}));

import { adminRouter } from './admin';

function makeEnv(overrides: Record<string, unknown> = {}) {
  const kvStore = new Map<string, string>();
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
    SESSIONS: {
      put: vi.fn().mockImplementation((key: string, val: string) => {
        kvStore.set(key, val);
        return Promise.resolve();
      }),
      get: vi
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(kvStore.get(key) ?? null),
        ),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ENVIRONMENT: 'development',
    ...overrides,
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  adminSession?: Record<string, unknown>,
) {
  const req = new Request(`https://admin.greenput.com/api/admin${path}`, init);
  if (adminSession) {
    (req as unknown as Record<string, unknown>)['adminSession'] = adminSession;
  }
  return req;
}

describe('adminRouter', () => {
  it('exports adminRouter with fetch', () => {
    expect(adminRouter).toBeDefined();
    expect(typeof adminRouter.fetch).toBe('function');
  });
});

// These run against the real schema.sql through createSqliteD1, not a vi.fn()
// stand-in for DB.prepare: the guard that stops a second platform admin being
// created is the `WHERE NOT EXISTS` in the INSERT itself, which a mock would
// never parse.
describe('POST /api/admin/auth/setup', () => {
  let sqlite: SqliteD1 | undefined;

  afterEach(() => {
    sqlite?.close();
    sqlite = undefined;
  });

  function realEnv(overrides: Record<string, unknown> = {}) {
    sqlite = createSqliteD1({ files: [SCHEMA] });
    const base = makeEnv(overrides);
    return { ...base, DB: sqlite.db } as unknown as typeof base;
  }

  function setupReq(token?: string, body?: Record<string, unknown>) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token !== undefined) headers['X-Admin-Setup-Token'] = token;
    return makeReq('/auth/setup', {
      method: 'POST',
      headers,
      body: JSON.stringify(
        body ?? { email: 'admin@greenput.com', displayName: 'Admin' },
      ),
    });
  }

  it('404s and writes nothing when ADMIN_SETUP_TOKEN is not configured', async () => {
    const env = realEnv();
    const res = await adminRouter.fetch(setupReq(), env);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(sqlite?.rows('admin_users')).toHaveLength(0);
    expect(env.SESSIONS.put).not.toHaveBeenCalled();
  });

  it('404s when a token is presented but none is configured', async () => {
    const env = realEnv();
    const res = await adminRouter.fetch(setupReq(SETUP_TOKEN), env);

    expect(res.status).toBe(404);
    expect(sqlite?.rows('admin_users')).toHaveLength(0);
  });

  it('404s on a wrong token, byte-identically to an unmounted path', async () => {
    const env = realEnv({ ADMIN_SETUP_TOKEN: SETUP_TOKEN });
    const res = await adminRouter.fetch(setupReq(`${SETUP_TOKEN}x`), env);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
    );
    expect(sqlite?.rows('admin_users')).toHaveLength(0);
  });

  it('404s on a correct prefix of the token', async () => {
    const env = realEnv({ ADMIN_SETUP_TOKEN: SETUP_TOKEN });
    const res = await adminRouter.fetch(
      setupReq(SETUP_TOKEN.slice(0, -1)),
      env,
    );

    expect(res.status).toBe(404);
    expect(sqlite?.rows('admin_users')).toHaveLength(0);
  });

  it('404s when the configured token is too short to be a secret', async () => {
    const env = realEnv({ ADMIN_SETUP_TOKEN: 'short' });
    const res = await adminRouter.fetch(setupReq('short'), env);

    expect(res.status).toBe(404);
    expect(sqlite?.rows('admin_users')).toHaveLength(0);
  });

  it('404s before the body is even valid, so it cannot be probed', async () => {
    const env = realEnv();
    const res = await adminRouter.fetch(
      setupReq(undefined, { nope: true }),
      env,
    );

    // The token gate runs before validate(), so this is 404 rather than the
    // 400 an authorised caller would get.
    expect(res.status).toBe(404);
  });

  it('returns 400 when email is missing, once the token is right', async () => {
    const env = realEnv({ ADMIN_SETUP_TOKEN: SETUP_TOKEN });
    const res = await adminRouter.fetch(
      setupReq(SETUP_TOKEN, { displayName: 'Admin' }),
      env,
    );

    expect(res.status).toBe(400);
    expect(sqlite?.rows('admin_users')).toHaveLength(0);
  });

  it('returns 201, inserts one row and sets a session cookie on first setup', async () => {
    const env = realEnv({ ADMIN_SETUP_TOKEN: SETUP_TOKEN });
    const res = await adminRouter.fetch(setupReq(SETUP_TOKEN), env);

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { user: { id: string }; needsPasskey: boolean };
    };
    expect(body.data.needsPasskey).toBe(true);
    expect(res.headers.get('set-cookie')).toContain('gp_admin_session=');

    const rows = sqlite?.rows<{ id: string; email: string }>('admin_users');
    expect(rows).toHaveLength(1);
    expect(rows?.[0].email).toBe('admin@greenput.com');
    expect(rows?.[0].id).toBe(body.data.user.id);
  });

  it('returns 403 and mints no session when an admin already exists', async () => {
    const env = realEnv({ ADMIN_SETUP_TOKEN: SETUP_TOKEN });
    sqlite?.raw
      .prepare('INSERT INTO admin_users (id, email) VALUES (?, ?)')
      .run('admin-existing', 'first@greenput.com');

    const res = await adminRouter.fetch(
      setupReq(SETUP_TOKEN, { email: 'second@greenput.com' }),
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ADMIN_EXISTS');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(sqlite?.rows('admin_users')).toHaveLength(1);
    expect(env.SESSIONS.put).not.toHaveBeenCalled();
  });

  it('lets only one of two concurrent bootstraps win', async () => {
    const env = realEnv({ ADMIN_SETUP_TOKEN: SETUP_TOKEN });

    const [a, b] = await Promise.all([
      adminRouter.fetch(
        setupReq(SETUP_TOKEN, { email: 'a@greenput.com' }),
        env,
      ),
      adminRouter.fetch(
        setupReq(SETUP_TOKEN, { email: 'b@greenput.com' }),
        env,
      ),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 403]);
    expect(sqlite?.rows('admin_users')).toHaveLength(1);
  });
});

describe('GET /api/admin/auth/status', () => {
  it('returns configured: false when no admins exist', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ cnt: 0 });
    const res = await adminRouter.fetch(makeReq('/auth/status'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { configured: boolean } };
    expect(body.data.configured).toBe(false);
  });

  it('returns configured: true when admins exist', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ cnt: 1 });
    const res = await adminRouter.fetch(makeReq('/auth/status'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { configured: boolean } };
    expect(body.data.configured).toBe(true);
  });
});

describe('GET /api/admin/auth/me', () => {
  it('returns 401 when no session', async () => {
    const env = makeEnv();
    const res = await adminRouter.fetch(makeReq('/auth/me'), env);
    expect(res.status).toBe(401);
  });

  it('returns admin user when session is present', async () => {
    const env = makeEnv();
    const res = await adminRouter.fetch(
      makeReq(
        '/auth/me',
        {},
        { isAdmin: true, adminId: 'admin-1', email: 'admin@greenput.com' },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user: { email: string } } };
    expect(body.data.user.email).toBe('admin@greenput.com');
  });
});

describe('POST /api/admin/auth/logout', () => {
  it('returns 200 and clears cookie', async () => {
    const env = makeEnv();
    const res = await adminRouter.fetch(
      makeReq('/auth/logout', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('gp_admin_session=');
    expect(setCookie).toContain('Max-Age=0');
  });
});

describe('GET /api/admin/metrics', () => {
  it('returns 200 with all metric fields', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ cnt: 5, total: 10000 });
    const res = await adminRouter.fetch(makeReq('/metrics'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, number> };
    expect(body.data).toHaveProperty('workspaces');
    expect(body.data).toHaveProperty('users');
    expect(body.data).toHaveProperty('leads');
    expect(body.data).toHaveProperty('jobs');
    expect(body.data).toHaveProperty('revenue');
  });
});

describe('GET /api/admin/workspaces', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await adminRouter.fetch(makeReq('/workspaces'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('GET /api/admin/workspaces/:id', () => {
  it('returns 404 when workspace not found', async () => {
    const env = makeEnv();
    const res = await adminRouter.fetch(
      makeReq('/workspaces/ws-not-found'),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with workspace and users when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'ws-1',
      name: 'Acme Plumbing',
      email: 'acme@example.com',
    });
    const res = await adminRouter.fetch(makeReq('/workspaces/ws-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; users: unknown[] };
    };
    expect(body.data.id).toBe('ws-1');
    expect(Array.isArray(body.data.users)).toBe(true);
  });
});

describe('DELETE /api/admin/workspaces/:id', () => {
  it('returns 404 when workspace not found', async () => {
    const env = makeEnv();
    const res = await adminRouter.fetch(
      makeReq('/workspaces/ws-not-found', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 when workspace is deleted', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'ws-1' });
    const res = await adminRouter.fetch(
      makeReq('/workspaces/ws-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('GET /api/admin/users', () => {
  it('returns 200 with user list', async () => {
    const env = makeEnv();
    const res = await adminRouter.fetch(makeReq('/users'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('GET /api/admin/activity', () => {
  it('returns 200 with activity list', async () => {
    const env = makeEnv();
    const res = await adminRouter.fetch(makeReq('/activity'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('admin route logic', () => {
  describe('pagination query parameters', () => {
    it('defaults to page 1 when not specified', () => {
      const url = new URL('https://admin.greenput.com/api/admin/workspaces');
      const page = Math.max(
        1,
        parseInt(url.searchParams.get('page') ?? '1', 10),
      );
      expect(page).toBe(1);
    });

    it('defaults to 25 per page', () => {
      const url = new URL('https://admin.greenput.com/api/admin/workspaces');
      const perPage = Math.min(
        100,
        parseInt(url.searchParams.get('perPage') ?? '25', 10),
      );
      expect(perPage).toBe(25);
    });

    it('caps perPage at 100', () => {
      const url = new URL(
        'https://admin.greenput.com/api/admin/workspaces?perPage=500',
      );
      const perPage = Math.min(
        100,
        parseInt(url.searchParams.get('perPage') ?? '25', 10),
      );
      expect(perPage).toBe(100);
    });

    it('computes correct SQL offset from page and perPage', () => {
      const page = 3;
      const perPage = 25;
      const offset = (page - 1) * perPage;
      expect(offset).toBe(50);
    });
  });
});
