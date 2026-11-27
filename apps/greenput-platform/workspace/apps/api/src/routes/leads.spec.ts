import { describe, it, expect, vi } from 'vitest';
import { leadsRouter } from './leads';

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

function makeReq(
  path: string,
  init: RequestInit = {},
  workspaceId = 'ws-1',
  userId = 'user-1',
) {
  const req = new Request(`https://api.greenput.com/api/leads${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: userId,
    role: 'owner',
  };
  return req;
}

describe('leadsRouter', () => {
  it('exports leadsRouter with fetch', () => {
    expect(leadsRouter).toBeDefined();
    expect(typeof leadsRouter.fetch).toBe('function');
  });
});

describe('GET /api/leads', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns leads list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        { id: 'lead-1', first_name: 'John', last_name: 'Doe', status: 'new' },
      ],
    });
    const res = await leadsRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports status filter', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(makeReq('/?status=new'), env);
    expect(res.status).toBe(200);
  });

  it('supports source filter', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(makeReq('/?source=website'), env);
    expect(res.status).toBe(200);
  });

  it('supports search query', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(makeReq('/?q=john'), env);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/leads/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(makeReq('/lead-not-found'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with lead when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'lead-1',
      first_name: 'John',
      last_name: 'Doe',
      status: 'new',
    });
    const res = await leadsRouter.fetch(makeReq('/lead-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('lead-1');
  });
});

describe('POST /api/leads', () => {
  it('returns 400 when required fields are missing', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 201 on successful creation', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'lead-new',
      first_name: 'John',
      last_name: 'Doe',
      status: 'new',
    });
    const res = await leadsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '555-1234',
          serviceType: 'Electrical',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('does not fire a lead meter event at creation — billing only happens at booking', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'lead-new',
      first_name: 'John',
      last_name: 'Doe',
      status: 'new',
    });
    await leadsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          serviceType: 'Electrical',
        }),
      }),
      env,
    );
    const calls = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some((call) => String(call[0]).includes('lead_meter_events')),
    ).toBe(false);
  });
});

describe('PATCH /api/leads/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(
      makeReq('/lead-not-found', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contacted' }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful update', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'lead-1' })
      .mockResolvedValueOnce({ id: 'lead-1', status: 'contacted' });
    const res = await leadsRouter.fetch(
      makeReq('/lead-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contacted' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/leads/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(
      makeReq('/lead-not-found', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 when deleted', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'lead-1' });
    const res = await leadsRouter.fetch(
      makeReq('/lead-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('POST /api/leads/:id/convert', () => {
  it('returns 404 when lead not found', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(
      makeReq('/lead-not-found/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when lead is already converted', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'lead-1',
      status: 'converted',
      converted_to_opportunity_id: 'opp-existing',
    });
    const res = await leadsRouter.fetch(
      makeReq('/lead-1/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 201 with opportunityId on successful conversion', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'lead-1',
      status: 'new',
      first_name: 'John',
      last_name: 'Doe',
    });
    const res = await leadsRouter.fetch(
      makeReq('/lead-1/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Panel Upgrade', value: 5000 }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { opportunityId: string } };
    expect(body.data.opportunityId).toBeTruthy();
  });
});

describe('leads schema validation', () => {
  it('requires firstName, lastName, serviceType', async () => {
    const { CreateLeadSchema } = await import('@greenput/shared/validators');
    expect(CreateLeadSchema.safeParse({}).success).toBe(false);
    expect(
      CreateLeadSchema.safeParse({
        firstName: 'John',
        lastName: 'Doe',
        serviceType: 'HVAC',
        email: 'j@e.com',
        phone: '555-0001',
      }).success,
    ).toBe(true);
  });

  it('defaults status to new and source to manual', async () => {
    const { CreateLeadSchema } = await import('@greenput/shared/validators');
    const result = CreateLeadSchema.safeParse({
      firstName: 'John',
      lastName: 'Doe',
      serviceType: 'HVAC',
      email: 'j@e.com',
      phone: '555-0001',
    });
    if (result.success) {
      expect(result.data.status).toBe('new');
      expect(result.data.source).toBe('manual');
    }
  });
});

// Full qualify -> accept -> withdraw behavior (idempotency, exact-once
// billing, withdrawal timing) is covered against the real schema in
// ./lead-lifecycle.spec.ts, where D1's `meta.changes` semantics and the
// UNIQUE(lead_id) constraint are genuinely exercised rather than mocked.
// These are just routing/404 smoke tests plus the PATCH auto-stamp behavior.

describe('POST /api/leads/:id/qualify', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(
      makeReq('/lead-not-found/qualify', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/leads/:id/accept', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(
      makeReq('/lead-not-found/accept', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when the lead has not been qualified yet', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'lead-1',
      qualified_at: null,
      accepted_at: null,
      withdrawn_at: null,
    });
    const res = await leadsRouter.fetch(
      makeReq('/lead-1/accept', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 409 when the lead has already been withdrawn', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'lead-1',
      qualified_at: '2026-01-01T00:00:00.000Z',
      accepted_at: null,
      withdrawn_at: '2026-01-02T00:00:00.000Z',
    });
    const res = await leadsRouter.fetch(
      makeReq('/lead-1/accept', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(409);
  });
});

describe('POST /api/leads/:id/withdraw', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await leadsRouter.fetch(
      makeReq('/lead-not-found/withdraw', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/leads/:id status=qualified auto-stamps qualified_at', () => {
  it('includes qualified_at in the UPDATE when moving status to qualified', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'lead-1' })
      .mockResolvedValueOnce({ id: 'lead-1', status: 'qualified' });
    const res = await leadsRouter.fetch(
      makeReq('/lead-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'qualified' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const calls = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const updateCall = calls.find((call) =>
      String(call[0]).includes('UPDATE leads SET'),
    );
    expect(String(updateCall?.[0])).toContain(
      'qualified_at = COALESCE(qualified_at, ?)',
    );
  });

  it('does not touch qualified_at for other status values', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'lead-1' })
      .mockResolvedValueOnce({ id: 'lead-1', status: 'contacted' });
    await leadsRouter.fetch(
      makeReq('/lead-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contacted' }),
      }),
      env,
    );
    const calls = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const updateCall = calls.find((call) =>
      String(call[0]).includes('UPDATE leads SET'),
    );
    expect(String(updateCall?.[0])).not.toContain('qualified_at');
  });
});
