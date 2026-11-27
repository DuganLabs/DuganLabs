import { describe, it, expect, vi } from 'vitest';
import { userWorkspacesRouter } from './user-workspaces';

function makeUser(id = 'user-1') {
  return { id, workspaceId: 'ws-1', role: 'owner' };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
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
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

function makeRequest(
  path: string,
  options: RequestInit & { user?: Record<string, unknown> } = {},
) {
  const { user, ...init } = options;
  const req = new Request(
    `https://api.greenput.com/api/user/workspaces${path}`,
    init,
  );
  if (user) {
    (req as unknown as Record<string, unknown>)['user'] = user;
  }
  return req;
}

describe('userWorkspacesRouter', () => {
  it('exports userWorkspacesRouter', async () => {
    expect(userWorkspacesRouter).toBeDefined();
    expect(typeof userWorkspacesRouter.fetch).toBe('function');
  });
});

describe('GET /api/user/workspaces', () => {
  it('returns list of workspaces for the current user', async () => {
    const env = makeEnv();
    const dbResult = {
      results: [
        {
          id: 'ws-1',
          name: 'Acme Electric',
          slug: 'acme',
          trade: 'electrical',
          logo_url: null,
          role: 'owner',
          joined_at: '2025-01-01T00:00:00Z',
        },
      ],
    };
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue(dbResult);

    const res = await userWorkspacesRouter.fetch(
      makeRequest('/', { user: makeUser() }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns empty array when user has no workspaces', async () => {
    const env = makeEnv();
    const res = await userWorkspacesRouter.fetch(
      makeRequest('/', { user: makeUser() }),
      env,
    );
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('POST /api/user/workspaces', () => {
  it('returns 400 when name is missing', async () => {
    const env = makeEnv();
    const res = await userWorkspacesRouter.fetch(
      makeRequest('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade: 'plumbing' }),
        user: makeUser(),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('creates workspace and returns 201', async () => {
    const env = makeEnv();
    const res = await userWorkspacesRouter.fetch(
      makeRequest('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Company', trade: 'hvac' }),
        user: makeUser(),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { name: string; role: string } };
    expect(body.data.name).toBe('New Company');
    expect(body.data.role).toBe('owner');
  });

  it('defaults trade to electrical when not provided', async () => {
    const env = makeEnv();
    const res = await userWorkspacesRouter.fetch(
      makeRequest('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Company' }),
        user: makeUser(),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });
});

describe('POST /api/user/workspaces/switch', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const env = makeEnv();
    const res = await userWorkspacesRouter.fetch(
      makeRequest('/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        user: makeUser(),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  const WS_UUID = '00000000-0000-4000-8000-000000000002';

  it('returns 403 when user is not a member of the workspace', async () => {
    const env = makeEnv();
    // first() returns null → not a member
    const res = await userWorkspacesRouter.fetch(
      makeRequest('/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WS_UUID }),
        user: makeUser(),
      }),
      env,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_MEMBER');
  });

  it('returns 200 with new workspace when switch succeeds', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ role: 'admin' });

    const res = await userWorkspacesRouter.fetch(
      makeRequest('/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WS_UUID }),
        user: makeUser(),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { workspaceId: string; role: string };
    };
    expect(body.data.workspaceId).toBe(WS_UUID);
    expect(body.data.role).toBe('admin');
  });

  it('updates session KV when session token is present', async () => {
    const TARGET_UUID = '00000000-0000-4000-8000-000000000003';
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ role: 'owner' });
    (env.SESSIONS.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ userId: 'user-1', workspaceId: WS_UUID }),
    );

    const req = makeRequest('/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: TARGET_UUID }),
      user: makeUser(),
    });
    (req as unknown as Record<string, unknown>)['sessionToken'] = 'tok-abc';

    const res = await userWorkspacesRouter.fetch(req, env);
    expect(res.status).toBe(200);
    expect(env.SESSIONS.put).toHaveBeenCalledWith(
      'tok-abc',
      expect.stringContaining(`"workspaceId":"${TARGET_UUID}"`),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });
});
