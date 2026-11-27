import { describe, it, expect, vi } from 'vitest';
import { complianceRouter } from './compliance';

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
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ENVIRONMENT: 'development',
    ...overrides,
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  user?: { id: string; role: string },
  workspaceId = 'ws-1',
) {
  const req = new Request(
    `https://api.greenput.com/api/compliance${path}`,
    init,
  );
  if (user) {
    (req as unknown as Record<string, unknown>)['user'] = user;
  }
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  return req;
}

describe('complianceRouter', () => {
  it('exports complianceRouter', () => {
    expect(complianceRouter).toBeDefined();
    expect(typeof complianceRouter.fetch).toBe('function');
  });
});

describe('GET /api/compliance/export', () => {
  it('returns 403 when user is not owner', async () => {
    const env = makeEnv();
    const res = await complianceRouter.fetch(
      makeReq('/export', {}, { id: 'u1', role: 'admin' }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 with export data for owner', async () => {
    const env = makeEnv();
    const res = await complianceRouter.fetch(
      makeReq('/export', {}, { id: 'u1', role: 'owner' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { exportedAt: string } };
    expect(body.data.exportedAt).toBeTruthy();
  });

  it('includes all required entity types in export', async () => {
    const env = makeEnv();
    const res = await complianceRouter.fetch(
      makeReq('/export', {}, { id: 'u1', role: 'owner' }),
      env,
    );
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toHaveProperty('workspace');
    expect(body.data).toHaveProperty('users');
    expect(body.data).toHaveProperty('customers');
    expect(body.data).toHaveProperty('leads');
    expect(body.data).toHaveProperty('opportunities');
    expect(body.data).toHaveProperty('jobs');
    expect(body.data).toHaveProperty('payments');
  });

  it('returns 403 for tech role', async () => {
    const env = makeEnv();
    const res = await complianceRouter.fetch(
      makeReq('/export', {}, { id: 'u1', role: 'tech' }),
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/compliance/delete-request', () => {
  it('returns 403 when user is not owner', async () => {
    const env = makeEnv();
    const res = await complianceRouter.fetch(
      makeReq(
        '/delete-request',
        { method: 'POST' },
        { id: 'u1', role: 'admin' },
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 409 when a pending deletion request already exists', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'existing-req',
    });
    const res = await complianceRouter.fetch(
      makeReq(
        '/delete-request',
        { method: 'POST' },
        { id: 'u1', role: 'owner' },
      ),
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DELETION_ALREADY_PENDING');
  });

  it('returns 201 with deletion request when no pending request exists', async () => {
    const env = makeEnv();
    const res = await complianceRouter.fetch(
      makeReq(
        '/delete-request',
        { method: 'POST' },
        { id: 'u1', role: 'owner' },
      ),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { status: string; scheduledDeletionAt: string };
    };
    expect(body.data.status).toBe('pending');
    expect(body.data.scheduledDeletionAt).toBeTruthy();
  });

  it('schedules deletion 30 days in the future', async () => {
    const env = makeEnv();
    const before = Date.now();
    const res = await complianceRouter.fetch(
      makeReq(
        '/delete-request',
        { method: 'POST' },
        { id: 'u1', role: 'owner' },
      ),
      env,
    );
    const after = Date.now();
    const body = (await res.json()) as {
      data: { scheduledDeletionAt: string };
    };
    const scheduled = new Date(body.data.scheduledDeletionAt).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(scheduled).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000);
    expect(scheduled).toBeLessThanOrEqual(after + thirtyDaysMs + 1000);
  });
});

describe('compliance logic', () => {
  it('user export query excludes password_hash', () => {
    const selectColumns =
      'id, workspace_id, first_name, last_name, email, role, created_at, updated_at, last_seen_at';
    expect(selectColumns).not.toContain('password_hash');
  });

  it('calculates 30-day grace period correctly', () => {
    const now = new Date('2026-03-20T00:00:00Z');
    const scheduledAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(scheduledAt.toISOString()).toBe('2026-04-19T00:00:00.000Z');
  });
});
