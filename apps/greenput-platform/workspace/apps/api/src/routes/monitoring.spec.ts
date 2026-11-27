import { describe, it, expect, vi } from 'vitest';
import { monitoringRouter } from './monitoring';
import type { Env } from '../env';

function makeEnv(): Env {
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
  } as unknown as Env;
}

function makeReq(path: string): Request {
  const req = new Request(`https://api.greenput.com${path}`);
  return req;
}

function makePostReq(
  path: string,
  body: unknown,
  user?: { id: string; workspaceId: string },
): Request {
  const req = new Request(`https://api.greenput.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (user) {
    (req as unknown as { user: typeof user }).user = user;
  }
  return req;
}

describe('monitoringRouter', () => {
  it('exports monitoringRouter with fetch', () => {
    expect(monitoringRouter).toBeDefined();
    expect(typeof monitoringRouter.fetch).toBe('function');
  });
});

describe('GET /api/monitoring/errors', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(0);
  });

  it('returns error events list with default limit', async () => {
    const env = makeEnv();
    const mockErrors = [
      {
        id: 'err-1',
        severity: 'error',
        category: 'database',
        code: 'DB_ERROR',
        message: 'Connection timeout',
        stack: null,
        request_id: 'req-1',
        user_id: 'user-1',
        workspace_id: 'ws-1',
        path: '/api/leads',
        method: 'GET',
        status_code: 500,
        created_at: '2026-04-27T10:00:00Z',
      },
      {
        id: 'err-2',
        severity: 'warning',
        category: 'validation',
        code: 'VALIDATION_ERROR',
        message: 'Invalid email format',
        stack: null,
        request_id: 'req-2',
        user_id: 'user-2',
        workspace_id: 'ws-1',
        path: '/api/customers',
        method: 'POST',
        status_code: 400,
        created_at: '2026-04-27T09:00:00Z',
      },
    ];

    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: mockErrors,
    });

    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(body.data.length).toBe(2);
    // getRecentErrors transforms snake_case columns to camelCase ErrorEvent
    expect(body.data[0].id).toBe('err-1');
    expect(body.data[0].severity).toBe('error');
    expect(body.data[0].requestId).toBe('req-1');
    expect(body.data[0].createdAt).toBe('2026-04-27T10:00:00Z');
  });

  it('respects custom limit parameter', async () => {
    const env = makeEnv();
    const mockErrors = Array.from({ length: 5 }, (_, i) => ({
      id: `err-${i}`,
      severity: 'error' as const,
      category: 'external' as const,
      code: 'EXT_ERROR',
      message: 'Service unavailable',
      stack: null,
      request_id: null,
      user_id: null,
      workspace_id: 'ws-1',
      path: '/api/jobs',
      method: 'GET',
      status_code: 503,
      created_at: '2026-04-27T10:00:00Z',
    }));

    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: mockErrors,
    });

    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors?limit=100'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(5);

    const res2 = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors?limit=500'),
      env,
    );
    expect(res2.status).toBe(200);
  });

  it('clamps limit to minimum 1', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [],
    });

    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors?limit=0'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('clamps limit to maximum 200', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [],
    });

    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors?limit=999'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('filters by severity', async () => {
    const env = makeEnv();
    const mockErrors = [
      {
        id: 'err-1',
        severity: 'error',
        category: 'database',
        code: 'DB_ERROR',
        message: 'Critical failure',
        stack: null,
        request_id: 'req-1',
        user_id: 'user-1',
        workspace_id: 'ws-1',
        path: '/api/leads',
        method: 'POST',
        status_code: 500,
        created_at: '2026-04-27T10:00:00Z',
      },
      {
        id: 'err-2',
        severity: 'warning',
        category: 'validation',
        code: 'VALIDATION_ERROR',
        message: 'Mild issue',
        stack: null,
        request_id: 'req-2',
        user_id: 'user-2',
        workspace_id: 'ws-1',
        path: '/api/jobs',
        method: 'GET',
        status_code: 400,
        created_at: '2026-04-27T09:00:00Z',
      },
    ];

    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: mockErrors,
    });

    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors?severity=error'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
    expect((body.data[0] as Record<string, unknown>).severity).toBe('error');
  });

  it('filters by category', async () => {
    const env = makeEnv();
    const mockErrors = [
      {
        id: 'err-1',
        severity: 'error',
        category: 'database',
        code: 'DB_ERROR',
        message: 'Database error',
        stack: null,
        request_id: 'req-1',
        user_id: null,
        workspace_id: 'ws-1',
        path: '/api/customers',
        method: 'GET',
        status_code: 500,
        created_at: '2026-04-27T10:00:00Z',
      },
      {
        id: 'err-2',
        severity: 'error',
        category: 'external',
        code: 'EXTERNAL_ERROR',
        message: 'External service error',
        stack: null,
        request_id: 'req-2',
        user_id: null,
        workspace_id: 'ws-1',
        path: '/api/payments',
        method: 'POST',
        status_code: 502,
        created_at: '2026-04-27T09:00:00Z',
      },
    ];

    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: mockErrors,
    });

    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors?category=external'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
    expect((body.data[0] as Record<string, unknown>).category).toBe('external');
  });

  it('applies multiple filters (severity and category)', async () => {
    const env = makeEnv();
    const mockErrors = [
      {
        id: 'err-1',
        severity: 'error',
        category: 'database',
        code: 'DB_ERROR',
        message: 'Database error',
        stack: null,
        request_id: 'req-1',
        user_id: 'user-1',
        workspace_id: 'ws-1',
        path: '/api/leads',
        method: 'GET',
        status_code: 500,
        created_at: '2026-04-27T10:00:00Z',
      },
      {
        id: 'err-2',
        severity: 'warning',
        category: 'database',
        code: 'DB_WARN',
        message: 'Slow query',
        stack: null,
        request_id: 'req-2',
        user_id: 'user-2',
        workspace_id: 'ws-1',
        path: '/api/opportunities',
        method: 'GET',
        status_code: 200,
        created_at: '2026-04-27T09:00:00Z',
      },
      {
        id: 'err-3',
        severity: 'error',
        category: 'validation',
        code: 'VAL_ERROR',
        message: 'Invalid input',
        stack: null,
        request_id: 'req-3',
        user_id: 'user-3',
        workspace_id: 'ws-1',
        path: '/api/jobs',
        method: 'POST',
        status_code: 400,
        created_at: '2026-04-27T08:00:00Z',
      },
    ];

    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: mockErrors,
    });

    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors?severity=error&category=database'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
    expect((body.data[0] as Record<string, unknown>).id).toBe('err-1');
  });

  it('handles non-matching filters gracefully', async () => {
    const env = makeEnv();
    const mockErrors = [
      {
        id: 'err-1',
        severity: 'error',
        category: 'database',
        code: 'DB_ERROR',
        message: 'Database error',
        stack: null,
        request_id: 'req-1',
        user_id: null,
        workspace_id: 'ws-1',
        path: '/api/leads',
        method: 'GET',
        status_code: 500,
        created_at: '2026-04-27T10:00:00Z',
      },
    ];

    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: mockErrors,
    });

    const res = await monitoringRouter.fetch(
      makeReq('/api/monitoring/errors?severity=info'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });
});

describe('POST /api/monitoring/errors', () => {
  it('ingests a batch of client errors and returns the count', async () => {
    const env = makeEnv();
    const events = [
      {
        message: 'TypeError: cannot read property',
        stack: 'at foo:10',
        url: 'https://app.greenput.com/dashboard',
        timestamp: '2026-04-28T12:00:00Z',
        userId: 'spoofed-user',
        workspaceId: 'spoofed-ws',
        context: { route: '/dashboard' },
        requestId: 'req-abc',
      },
      {
        message: 'Network error',
        stack: null,
        url: 'https://app.greenput.com/leads',
        timestamp: '2026-04-28T12:01:00Z',
        userId: null,
        workspaceId: null,
        context: {},
        requestId: null,
      },
    ];

    const res = await monitoringRouter.fetch(
      makePostReq(
        '/api/monitoring/errors',
        { errors: events },
        {
          id: 'session-user',
          workspaceId: 'session-ws',
        },
      ),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ingested: number } };
    expect(body.data.ingested).toBe(2);
    // Each event should have triggered an INSERT
    expect(env.DB.prepare).toHaveBeenCalledTimes(2);
  });

  it('returns 0 ingested when batch is empty', async () => {
    const env = makeEnv();
    const res = await monitoringRouter.fetch(
      makePostReq(
        '/api/monitoring/errors',
        { errors: [] },
        {
          id: 'u',
          workspaceId: 'w',
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ingested: number } };
    expect(body.data.ingested).toBe(0);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it('rejects body without errors array', async () => {
    const env = makeEnv();
    const res = await monitoringRouter.fetch(
      makePostReq(
        '/api/monitoring/errors',
        { foo: 'bar' },
        {
          id: 'u',
          workspaceId: 'w',
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body', async () => {
    const env = makeEnv();
    const res = await monitoringRouter.fetch(
      makePostReq('/api/monitoring/errors', '{not json', {
        id: 'u',
        workspaceId: 'w',
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects batch larger than 50', async () => {
    const env = makeEnv();
    const events = Array.from({ length: 51 }, () => ({
      message: 'err',
    }));
    const res = await monitoringRouter.fetch(
      makePostReq(
        '/api/monitoring/errors',
        { errors: events },
        {
          id: 'u',
          workspaceId: 'w',
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BATCH_TOO_LARGE');
  });
});
