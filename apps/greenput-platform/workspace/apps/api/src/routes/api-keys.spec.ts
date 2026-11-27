import { describe, it, expect, vi } from 'vitest';
import { apiKeysRouter } from './api-keys';

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
    SESSIONS: {},
    ENVIRONMENT: 'development',
  };
}

// POST re-reads the row it just wrote so the create response and the list
// response are the same shape (see WIRE_API_KEY_CREATED). With a vi.fn() DB
// that means the `first()` for that read has to be given a row — real coverage
// of the create path lives in src/routes/wire-contract.spec.ts, against the
// real schema.
function mockCreatedRow(
  env: ReturnType<typeof makeEnv>,
  row: Record<string, unknown>,
): void {
  (
    env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
  ).mockResolvedValue(row);
}

function createdRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    workspace_id: 'ws-1',
    name: 'CI Key',
    key_prefix: 'abcdefgh',
    scopes: '["read","leads"]',
    last_used_at: null,
    expires_at: null,
    created_at: '2026-09-12T00:00:00.000Z',
    created_by: 'user-1',
    ...overrides,
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  workspaceId = 'ws-1',
  userId = 'user-1',
  role = 'owner',
) {
  const req = new Request(`https://api.greenput.com/api/api-keys${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = { id: userId, role };
  return req;
}

describe('apiKeysRouter', () => {
  it('exports apiKeysRouter with fetch', () => {
    expect(apiKeysRouter).toBeDefined();
    expect(typeof apiKeysRouter.fetch).toBe('function');
  });
});

describe('GET /api/api-keys', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 200 with list of keys (no raw key)', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'key-1',
          name: 'CI Key',
          key_prefix: 'abcdefgh',
          scopes: '["read"]',
        },
      ],
    });
    const res = await apiKeysRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('returns 403 for non-owner/admin role', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq('/', {}, 'ws-1', 'user-1', 'tech'),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('allows admin role to list keys', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq('/', {}, 'ws-1', 'user-1', 'admin'),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/api-keys', () => {
  it('returns 400 when name is missing', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: ['read'] }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when scopes is empty array', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Key', scopes: [] }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-owner/admin role', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq(
        '/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'My Key', scopes: ['read'] }),
        },
        'ws-1',
        'user-1',
        'office',
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 201 with the raw key on success', async () => {
    const env = makeEnv();
    mockCreatedRow(env, createdRow());
    const res = await apiKeysRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CI Key', scopes: ['read', 'leads'] }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { key: string; name: string; keyPrefix: string; scopes: string[] };
    };
    expect(body.data.name).toBe('CI Key');
    expect(body.data.key).toMatch(/^gp_[0-9a-f]{32}$/);
    // `scopes` comes back parsed, exactly as the list endpoint hands it out —
    // the create response used to be the only place it was an array.
    expect(body.data.scopes).toEqual(['read', 'leads']);
  });

  it('returns 201 with expiresAt when provided', async () => {
    const env = makeEnv();
    const future = new Date(Date.now() + 86400000).toISOString();
    mockCreatedRow(env, createdRow({ expires_at: future }));
    const res = await apiKeysRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Temp Key',
          scopes: ['read'],
          expiresAt: future,
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { expiresAt: string | null } };
    expect(body.data.expiresAt).toBeTruthy();
  });

  it('omits expiresAt when not provided', async () => {
    const env = makeEnv();
    mockCreatedRow(env, createdRow({ expires_at: null }));
    const res = await apiKeysRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Perm Key', scopes: ['read'] }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    // A NULL column omits the key rather than handing out a null the reader
    // is not typed for (ApiKey declares `expiresAt?: Timestamp`).
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect('expiresAt' in body.data).toBe(false);
  });
});

describe('PATCH /api/api-keys/:id', () => {
  it('returns 404 when key not found', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq('/key-not-found', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 for non-owner/admin role', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq(
        '/key-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Name' }),
        },
        'ws-1',
        'user-1',
        'tech',
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when body is empty', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq('/key-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful update', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'key-1' }) // existence check
      .mockResolvedValueOnce({
        id: 'key-1',
        name: 'Updated Name',
        scopes: '["read"]',
      }); // updated
    const res = await apiKeysRouter.fetch(
      makeReq('/key-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/api-keys/:id', () => {
  it('returns 404 when key not found', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq('/key-not-found', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 for non-owner/admin role', async () => {
    const env = makeEnv();
    const res = await apiKeysRouter.fetch(
      makeReq('/key-1', { method: 'DELETE' }, 'ws-1', 'user-1', 'office'),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 with deleted:true on success', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'key-1',
    });
    const res = await apiKeysRouter.fetch(
      makeReq('/key-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { deleted: boolean; id: string };
    };
    expect(body.data.deleted).toBe(true);
    expect(body.data.id).toBe('key-1');
  });
});

describe('api-keys schema validation', () => {
  it('CreateApiKeySchema requires name and scopes', async () => {
    const { CreateApiKeySchema } = await import('@greenput/shared/validators');
    expect(
      CreateApiKeySchema.safeParse({ name: 'My Key', scopes: ['read'] })
        .success,
    ).toBe(true);
    expect(CreateApiKeySchema.safeParse({ scopes: ['read'] }).success).toBe(
      false,
    );
    expect(CreateApiKeySchema.safeParse({ name: 'My Key' }).success).toBe(true); // scopes defaults to ["read"]
  });

  it('UpdateApiKeySchema rejects empty object', async () => {
    const { UpdateApiKeySchema } = await import('@greenput/shared/validators');
    expect(UpdateApiKeySchema.safeParse({}).success).toBe(false);
  });

  it('UpdateApiKeySchema accepts name only', async () => {
    const { UpdateApiKeySchema } = await import('@greenput/shared/validators');
    expect(UpdateApiKeySchema.safeParse({ name: 'New Name' }).success).toBe(
      true,
    );
  });

  it('UpdateApiKeySchema accepts scopes only', async () => {
    const { UpdateApiKeySchema } = await import('@greenput/shared/validators');
    expect(
      UpdateApiKeySchema.safeParse({ scopes: ['read', 'write'] }).success,
    ).toBe(true);
  });
});
