import { describe, it, expect, vi } from 'vitest';
import { auditRouter } from './audit';

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

function makeReq(path: string, workspaceId = 'ws-1') {
  const req = new Request(`https://api.greenput.com/api/audit${path}`);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: 'user-1',
    role: 'owner',
  };
  return req;
}

describe('auditRouter', () => {
  it('exports auditRouter with fetch', () => {
    expect(auditRouter).toBeDefined();
    expect(typeof auditRouter.fetch).toBe('function');
  });
});

describe('GET /api/audit', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns audit entries list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'a1',
          entity_type: 'lead',
          entity_id: 'l1',
          action: 'created',
          first_name: 'Jane',
          last_name: 'Smith',
        },
      ],
    });
    const res = await auditRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports entityType filter', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/?entityType=lead'), env);
    expect(res.status).toBe(200);
  });

  it('supports entityId filter', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/?entityId=lead-123'), env);
    expect(res.status).toBe(200);
  });

  it('supports action filter', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/?action=created'), env);
    expect(res.status).toBe(200);
  });

  it('supports date range filters', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(
      makeReq('/?from=2026-01-01T00:00:00Z&to=2026-03-31T23:59:59Z'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('respects pagination and returns meta', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 42 });
    const res = await auditRouter.fetch(makeReq('/?page=2&perPage=10'), env);
    const body = (await res.json()) as {
      meta: { page: number; perPage: number; total: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(10);
    expect(body.meta.total).toBe(42);
  });

  it('caps perPage at 100', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/?perPage=999'), env);
    const body = (await res.json()) as { meta: { perPage: number } };
    expect(body.meta.perPage).toBe(100);
  });

  it('supports userId filter', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/?userId=user-42'), env);
    expect(res.status).toBe(200);
  });

  it('returns entries with user names from join', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'a1',
          entity_type: 'lead',
          action: 'created',
          first_name: 'Alice',
          last_name: 'Smith',
        },
      ],
    });
    const res = await auditRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as {
      data: Array<{ first_name: string; last_name: string }>;
    };
    expect(body.data[0]?.first_name).toBe('Alice');
    expect(body.data[0]?.last_name).toBe('Smith');
  });

  it('supports combining multiple filters', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(
      makeReq('/?entityType=job&action=updated&userId=user-1'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('defaults page to 1 and perPage to 25', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as {
      meta: { page: number; perPage: number };
    };
    expect(body.meta.page).toBe(1);
    expect(body.meta.perPage).toBe(25);
  });
});

describe('GET /api/audit/:entityType/:entityId', () => {
  it('returns 200 with entity audit entries', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        { id: 'a1', entity_type: 'lead', entity_id: 'l1', action: 'created' },
      ],
    });
    const res = await auditRouter.fetch(makeReq('/lead/lead-123'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 200 with empty list when entity has no audit', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/lead/unknown-id'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });

  it('returns multiple entries for the same entity', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        { id: 'a2', action: 'updated', created_at: '2026-04-02T00:00:00Z' },
        { id: 'a1', action: 'created', created_at: '2026-04-01T00:00:00Z' },
      ],
    });
    const res = await auditRouter.fetch(makeReq('/job/job-1'), env);
    const body = (await res.json()) as { data: Array<{ action: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.action).toBe('updated');
  });

  it('supports different entity types', async () => {
    const env = makeEnv();
    const res = await auditRouter.fetch(makeReq('/campaign/camp-1'), env);
    expect(res.status).toBe(200);
  });
});
