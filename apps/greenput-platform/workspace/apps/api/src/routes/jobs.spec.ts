import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { jobsRouter } from './jobs';

function makeEnv() {
  const firstMock = vi.fn().mockResolvedValue(null);
  const allMock = vi.fn().mockResolvedValue({ results: [] });
  const runMock = vi.fn().mockResolvedValue({});
  const bindMock = vi
    .fn()
    .mockReturnValue({ first: firstMock, all: allMock, run: runMock });
  const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
  // A mocked batch just runs its statements in order. Atomicity and the
  // job_slots collision are exercised over the real schema further down.
  const batchMock = vi.fn(
    async (statements: Array<{ run: () => Promise<unknown> }>) => {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results;
    },
  );

  return {
    env: {
      DB: { prepare: prepareMock, batch: batchMock },
      SESSIONS: {},
      ENVIRONMENT: 'development',
    },
    firstMock,
    allMock,
    runMock,
    bindMock,
    prepareMock,
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  workspaceId = 'ws-1',
  role = 'owner',
) {
  const req = new Request(`https://api.greenput.com/api/jobs${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = { id: 'user-1', role };
  return req;
}

function postReq(path: string, body: unknown) {
  return makeReq(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(path: string, body: unknown) {
  return makeReq(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('jobsRouter', () => {
  it('exports jobsRouter with fetch', () => {
    expect(jobsRouter).toBeDefined();
    expect(typeof jobsRouter.fetch).toBe('function');
  });
});

describe('GET /api/jobs', () => {
  it('returns 200 with empty list', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns job list with line items attached', async () => {
    const { env, allMock } = makeEnv();
    allMock
      .mockResolvedValueOnce({
        results: [
          {
            id: 'j1',
            job_number: '#1001',
            title: 'Panel Upgrade',
            status: 'scheduled',
          },
        ],
      })
      .mockResolvedValueOnce({ results: [] }); // line items
    const res = await jobsRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as {
      data: Array<{ lineItems: unknown[] }>;
    };
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.lineItems).toBeDefined();
  });

  it('includes pagination meta', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({ total: 50 });
    const res = await jobsRouter.fetch(makeReq('/?page=2&perPage=10'), env);
    const body = (await res.json()) as {
      meta: { page: number; perPage: number; total: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(10);
    expect(body.meta.total).toBe(50);
  });

  it('supports status filter', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(makeReq('/?status=completed'), env);
    expect(res.status).toBe(200);
  });

  it('supports search query filter', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(makeReq('/?q=panel'), env);
    expect(res.status).toBe(200);
  });

  it('attaches line items to jobs in list', async () => {
    const { env, allMock } = makeEnv();
    allMock
      .mockResolvedValueOnce({ results: [{ id: 'j1', job_number: '#1001' }] })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'li1',
            job_id: 'j1',
            description: 'Labor',
            quantity: 2,
            unit_price: 100,
            total: 200,
          },
        ],
      });
    const res = await jobsRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as {
      data: Array<{ lineItems: unknown[] }>;
    };
    expect(body.data[0]?.lineItems).toHaveLength(1);
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns 404 when job not found', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(makeReq('/nonexistent'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with job and line items when found', async () => {
    const { env, firstMock, allMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'j1',
      job_number: '#1001',
      title: 'Panel',
      status: 'scheduled',
    });
    allMock.mockResolvedValue({ results: [] });
    const res = await jobsRouter.fetch(makeReq('/j1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { jobNumber: string; lineItems: unknown[] };
    };
    expect(body.data.jobNumber).toBe('#1001');
    expect(body.data.lineItems).toBeDefined();
  });

  it('includes line items in detail response', async () => {
    const { env, firstMock, allMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'j1',
      job_number: '#1002',
      title: 'HVAC',
    });
    allMock.mockResolvedValue({
      results: [
        {
          id: 'li1',
          description: 'Labor',
          quantity: 3,
          unit_price: 80,
          total: 240,
        },
      ],
    });
    const res = await jobsRouter.fetch(makeReq('/j1'), env);
    const body = (await res.json()) as { data: { lineItems: unknown[] } };
    expect(body.data.lineItems).toHaveLength(1);
  });
});

describe('POST /api/jobs', () => {
  it('returns 400 when required fields missing', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(postReq('/', {}), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is missing', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(
      postReq('/', {
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('creates job and returns 201', async () => {
    const { env, firstMock, allMock } = makeEnv();
    firstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'j-new',
      job_number: '#1001',
      title: 'Panel',
      status: 'scheduled',
    });
    allMock.mockResolvedValue({ results: [] });

    const res = await jobsRouter.fetch(
      postReq('/', {
        title: 'Panel Upgrade',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('generates #1001 when no prior jobs exist', async () => {
    const { env, firstMock, allMock, bindMock } = makeEnv();
    firstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'j-new',
      job_number: '#1001',
      title: 'Panel',
    });
    allMock.mockResolvedValue({ results: [] });

    await jobsRouter.fetch(
      postReq('/', {
        title: 'New Job',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
      }),
      env,
    );
    const allCalls = bindMock.mock.calls.flat();
    expect(allCalls).toContain('#1001');
  });

  it('increments job number from last existing job', async () => {
    const { env, firstMock, allMock, bindMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ job_number: '#1005' })
      .mockResolvedValueOnce({
        id: 'j-new',
        job_number: '#1006',
        title: 'New',
      });
    allMock.mockResolvedValue({ results: [] });

    await jobsRouter.fetch(
      postReq('/', {
        title: 'New Job',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
      }),
      env,
    );
    const allCalls = bindMock.mock.calls.flat();
    expect(allCalls).toContain('#1006');
  });

  it('inserts line items when provided', async () => {
    const { env, firstMock, allMock, runMock } = makeEnv();
    firstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'j-new',
      job_number: '#1001',
      title: 'Job',
    });
    allMock.mockResolvedValue({ results: [] });

    await jobsRouter.fetch(
      postReq('/', {
        title: 'Electrical',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
        lineItems: [{ description: 'Labor', quantity: 4, unitPrice: 75 }],
      }),
      env,
    );
    // INSERT jobs + one job_slots row (a job with no schedule claims the
    // half-hour of `now`) + INSERT line_item + INSERT activity_log
    expect(runMock).toHaveBeenCalledTimes(4);
  });
});

describe('PATCH /api/jobs/:id', () => {
  it('returns 404 when job not found', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(
      patchReq('/nonexistent', { status: 'completed' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid status value', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(
      patchReq('/j1', { status: 'INVALID' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(patchReq('/j1', {}), env);
    expect(res.status).toBe(400);
  });

  it('returns 200 when updating status', async () => {
    const { env, firstMock, allMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'j1', status: 'in_progress' })
      .mockResolvedValueOnce({ id: 'j1', status: 'completed' });
    allMock.mockResolvedValue({ results: [] });

    const res = await jobsRouter.fetch(
      patchReq('/j1', { status: 'completed' }),
      env,
    );
    expect(res.status).toBe(200);
  });

  // Line items used to be replaced in place here, rewriting the price with no
  // trail. They now change only through POST /api/change-orders
  // (change-orders.spec.ts covers the whole flow over the real schema).
  it('refuses to replace line items: that is a change order now', async () => {
    const { env, firstMock, runMock } = makeEnv();
    firstMock.mockResolvedValueOnce({ id: 'j1' });

    const res = await jobsRouter.fetch(
      patchReq('/j1', {
        lineItems: [{ description: 'Labor', quantity: 4, unitPrice: 100 }],
      }),
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CHANGE_ORDER_REQUIRED');
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/jobs/:id', () => {
  it('returns 404 when job not found', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(
      makeReq('/nonexistent', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with deleted:true on success', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({ id: 'j1' });
    const res = await jobsRouter.fetch(
      makeReq('/j1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it('logs deletion to activity_log', async () => {
    const { env, firstMock, runMock } = makeEnv();
    firstMock.mockResolvedValue({ id: 'j1' });
    await jobsRouter.fetch(makeReq('/j1', { method: 'DELETE' }), env);
    // DELETE + INSERT activity_log
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/jobs/:id/invoice', () => {
  it('returns 404 when job not found', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(
      postReq('/nonexistent/invoice', {}),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when job is not completed', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({ id: 'j1', status: 'scheduled' });
    const res = await jobsRouter.fetch(postReq('/j1/invoice', {}), env);
    expect(res.status).toBe(400);
  });

  it('marks job as invoiced and returns 200', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({
        id: 'j1',
        status: 'completed',
        customer_id: 'c1',
      })
      .mockResolvedValueOnce({ id: 'j1', status: 'invoiced' });
    const res = await jobsRouter.fetch(postReq('/j1/invoice', {}), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('invoiced');
  });
});

describe('POST /api/jobs/:id/paid', () => {
  it('returns 404 when job not found', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(postReq('/nonexistent/paid', {}), env);
    expect(res.status).toBe(404);
  });

  it('returns 400 when job is not invoiced', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'j1',
      status: 'completed',
      customer_id: 'c1',
    });
    const res = await jobsRouter.fetch(postReq('/j1/paid', {}), env);
    expect(res.status).toBe(400);
  });

  it('marks job as paid and updates customer totals', async () => {
    const { env, firstMock, runMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({
        id: 'j1',
        status: 'invoiced',
        customer_id: 'c1',
        total: 1500,
      })
      .mockResolvedValueOnce({ id: 'j1', status: 'paid' });
    const res = await jobsRouter.fetch(postReq('/j1/paid', {}), env);
    expect(res.status).toBe(200);
    // UPDATE jobs + UPDATE customers + INSERT activity_log
    expect(runMock).toHaveBeenCalledTimes(3);
  });

  it('returns paid status in response', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({
        id: 'j1',
        status: 'invoiced',
        customer_id: 'c1',
        total: 500,
      })
      .mockResolvedValueOnce({ id: 'j1', status: 'paid' });
    const res = await jobsRouter.fetch(postReq('/j1/paid', {}), env);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('paid');
  });
});

describe('GET /api/jobs/:id/invoice (HTML render)', () => {
  it('returns 404 when job not found', async () => {
    const { env } = makeEnv();
    const res = await jobsRouter.fetch(makeReq('/nonexistent/invoice'), env);
    expect(res.status).toBe(404);
  });

  it('returns 400 when job is not invoiced or paid', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'j1',
      status: 'completed',
      customer_id: 'c1',
    });
    const res = await jobsRouter.fetch(makeReq('/j1/invoice'), env);
    expect(res.status).toBe(400);
  });

  it('returns 404 when customer not found for invoiced job', async () => {
    const { env, firstMock, allMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({
        id: 'j1',
        status: 'invoiced',
        customer_id: 'c1',
        total: 100,
      })
      .mockResolvedValueOnce(null) // customer
      .mockResolvedValueOnce(null); // workspace
    allMock.mockResolvedValue({ results: [] });
    const res = await jobsRouter.fetch(makeReq('/j1/invoice'), env);
    expect(res.status).toBe(404);
  });

  it('returns HTML with text/html content-type for valid invoiced job', async () => {
    const { env, firstMock, allMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({
        id: 'j1',
        status: 'invoiced',
        customer_id: 'c1',
        job_number: '#1001',
        title: 'Panel Upgrade',
        invoiced_at: '2026-04-01T00:00:00Z',
        paid_at: null,
        total: 1500,
        notes: '',
        street: '123 Main',
        city: 'Portland',
        state: 'OR',
        zip: '97201',
      })
      .mockResolvedValueOnce({
        first_name: 'John',
        last_name: 'Doe',
        company: null,
        email: 'j@example.com',
        phone: '503-555-0000',
        street: '456 Oak',
        city: 'Portland',
        state: 'OR',
        zip: '97202',
      })
      .mockResolvedValueOnce({
        name: 'Acme Electric',
        phone: '503-555-1234',
        email: 'info@acme.com',
        street: '789 Elm',
        city: 'Portland',
        state: 'OR',
        zip: '97203',
        license_num: null,
        logo_url: null,
      });
    allMock.mockResolvedValue({ results: [] });

    const res = await jobsRouter.fetch(makeReq('/j1/invoice'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Panel Upgrade');
  });
});

// GP-104. The mocked env.DB above cannot show a double booking — nothing in
// it has a PRIMARY KEY. These run the handlers unmodified over the real
// schema.sql (FKs on) so the job_slots key and the batch rollback are the
// things under test, not a fixture shaped like the reader.
describe('double booking against schema.sql (GP-104)', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-000000000001';
  const OWNER = '00000000-0000-4000-8000-000000000002';
  const OPP = '00000000-0000-4000-8000-000000000201';
  const CUSTOMER = '00000000-0000-4000-8000-000000000901';

  interface SlotRow {
    workspace_id: string;
    slot_start: string;
    lane: number;
    job_id: string;
  }

  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
      sql: [
        `INSERT INTO customers (id, workspace_id, first_name, last_name, created_at, updated_at, created_by)
         VALUES ('${CUSTOMER}', '${WS}', 'Jane', 'Smith', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${OWNER}')`,
      ],
    });
    env = { DB: sqlite.db } as unknown as Env;
  });

  afterEach(() => sqlite.close());

  function setLanes(n: number) {
    sqlite.raw
      .prepare('UPDATE workspaces SET concurrent_jobs = ? WHERE id = ?')
      .run(n, WS);
  }

  function req(path: string, init: RequestInit) {
    return makeReq(path, init, WS, 'owner');
  }

  function withUser(r: Request): Request {
    (r as unknown as Record<string, unknown>)['user'] = {
      id: OWNER,
      role: 'owner',
    };
    return r;
  }

  async function book(
    title: string,
    scheduledStart: string,
    scheduledEnd: string,
  ): Promise<Response> {
    return jobsRouter.fetch(
      withUser(
        req('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            opportunityId: OPP,
            customerId: CUSTOMER,
            scheduledStart,
            scheduledEnd,
          }),
        }),
      ),
      env,
    );
  }

  async function bookedId(
    title: string,
    scheduledStart: string,
    scheduledEnd: string,
  ): Promise<string> {
    const res = await book(title, scheduledStart, scheduledEnd);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    return body.data.id;
  }

  function patch(id: string, body: Record<string, unknown>): Promise<Response> {
    return jobsRouter.fetch(
      withUser(
        req(`/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
      env,
    );
  }

  const slotsOf = (jobId: string) =>
    sqlite
      .rows<SlotRow>('job_slots')
      .filter((r) => r.job_id === jobId)
      .map((r) => r.slot_start)
      .sort();
  const jobTitles = () =>
    sqlite.rows<{ title: string }>('jobs').map((r) => r.title);

  const NINE = '2027-03-04T09:00:00.000Z';
  const ELEVEN = '2027-03-04T11:00:00.000Z';
  const HALF_ELEVEN = '2027-03-04T11:30:00.000Z';
  const ONE = '2027-03-04T13:00:00.000Z';
  const THREE = '2027-03-04T15:00:00.000Z';

  it('writes one slot row per half-hour, five for 09:00–11:30', async () => {
    const id = await bookedId('Panel', NINE, HALF_ELEVEN);
    expect(slotsOf(id)).toEqual([
      '2027-03-04T09:00:00.000Z',
      '2027-03-04T09:30:00.000Z',
      '2027-03-04T10:00:00.000Z',
      '2027-03-04T10:30:00.000Z',
      '2027-03-04T11:00:00.000Z',
    ]);
  });

  it('at concurrent_jobs = 1 the second booking of a slot is 409 SLOT_TAKEN and leaves no jobs row', async () => {
    await bookedId('First', NINE, ELEVEN);
    const res = await book('Second', NINE, ELEVEN);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: 'SLOT_TAKEN',
        message: 'That time just went — pick another',
      },
    });
    expect(jobTitles()).toEqual(['First']);
    expect(sqlite.rows('job_slots')).toHaveLength(4);
    // Nothing of the failed booking survives the rolled-back batch.
    expect(
      sqlite
        .rows<{ entity_type: string; action: string }>('activity_log')
        .filter((r) => r.entity_type === 'job' && r.action === 'created'),
    ).toHaveLength(1);
  });

  it('a partial overlap is a collision too', async () => {
    await bookedId('First', NINE, ELEVEN);
    const res = await book('Overlapping', '2027-03-04T10:30:00.000Z', ONE);
    expect(res.status).toBe(409);
    expect(jobTitles()).toEqual(['First']);
  });

  it('back-to-back jobs do not collide: the slot beginning at the end is free', async () => {
    await bookedId('First', NINE, ELEVEN);
    const res = await book('Next', ELEVEN, ONE);
    expect(res.status).toBe(201);
  });

  it('at concurrent_jobs = 2 both bookings succeed in lanes 0 and 1 and a third fails', async () => {
    setLanes(2);
    const a = await bookedId('Van one', NINE, ELEVEN);
    const b = await bookedId('Van two', NINE, ELEVEN);
    const third = await book('No van', NINE, ELEVEN);
    expect(third.status).toBe(409);
    const lanes = sqlite.rows<SlotRow>('job_slots');
    expect(
      new Set(lanes.filter((r) => r.job_id === a).map((r) => r.lane)),
    ).toEqual(new Set([0]));
    expect(
      new Set(lanes.filter((r) => r.job_id === b).map((r) => r.lane)),
    ).toEqual(new Set([1]));
    expect(jobTitles()).toEqual(['Van one', 'Van two']);
  });

  it('a reschedule frees the original slot for someone else', async () => {
    const a = await bookedId('Moving', NINE, ELEVEN);
    const moved = await patch(a, { scheduledStart: ONE, scheduledEnd: THREE });
    expect(moved.status).toBe(200);
    expect(slotsOf(a)).toEqual([
      '2027-03-04T13:00:00.000Z',
      '2027-03-04T13:30:00.000Z',
      '2027-03-04T14:00:00.000Z',
      '2027-03-04T14:30:00.000Z',
    ]);
    expect((await book('Takes the morning', NINE, ELEVEN)).status).toBe(201);
  });

  it('a reschedule onto a taken slot is 409 and the job keeps its old time', async () => {
    const a = await bookedId('Stays', NINE, ELEVEN);
    await bookedId('Afternoon', ONE, THREE);
    const res = await patch(a, { scheduledStart: ONE, scheduledEnd: THREE });
    expect(res.status).toBe(409);
    const row = sqlite
      .rows<{ id: string; scheduled_start: string }>('jobs')
      .find((r) => r.id === a);
    expect(row?.scheduled_start).toBe(NINE);
    expect(slotsOf(a)).toEqual([
      '2027-03-04T09:00:00.000Z',
      '2027-03-04T09:30:00.000Z',
      '2027-03-04T10:00:00.000Z',
      '2027-03-04T10:30:00.000Z',
    ]);
  });

  it('a job can move onto time it held itself (the drag that shifts by half an hour)', async () => {
    const a = await bookedId('Shift', NINE, ELEVEN);
    const res = await patch(a, {
      scheduledStart: '2027-03-04T09:30:00.000Z',
      scheduledEnd: HALF_ELEVEN,
    });
    expect(res.status).toBe(200);
    expect(slotsOf(a)).toEqual([
      '2027-03-04T09:30:00.000Z',
      '2027-03-04T10:00:00.000Z',
      '2027-03-04T10:30:00.000Z',
      '2027-03-04T11:00:00.000Z',
    ]);
  });

  it('cancelling frees the slots', async () => {
    const a = await bookedId('Cancelled later', NINE, ELEVEN);
    expect((await patch(a, { status: 'cancelled' })).status).toBe(200);
    expect(slotsOf(a)).toEqual([]);
    expect((await book('Replacement', NINE, ELEVEN)).status).toBe(201);
  });

  it('a status change that is not a cancellation keeps the slots', async () => {
    const a = await bookedId('Started', NINE, ELEVEN);
    expect((await patch(a, { status: 'in_progress' })).status).toBe(200);
    expect(slotsOf(a)).toHaveLength(4);
  });

  it('deleting a job cascades to its slot rows', async () => {
    const a = await bookedId('Deleted', NINE, ELEVEN);
    const res = await jobsRouter.fetch(
      withUser(req(`/${a}`, { method: 'DELETE' })),
      env,
    );
    expect(res.status).toBe(200);
    expect(sqlite.rows('job_slots')).toHaveLength(0);
    expect((await book('Replacement', NINE, ELEVEN)).status).toBe(201);
  });
});

/* GP-034. A job carries who does it, separately from who typed it in. The
   FK alone would accept any users row, so the workspace and role checks are
   the handler's — and only a real database can show a 400 left no row. */
describe('the assignee against schema.sql (GP-034)', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-000000000001';
  const OWNER = '00000000-0000-4000-8000-000000000002';
  const TECH = '00000000-0000-4000-8000-00000000c0de';
  const OFFICE = '00000000-0000-4000-8000-00000000f1ce';
  const OTHER_WS = '00000000-0000-4000-8000-0000000000ff';
  const OTHER_TECH = '00000000-0000-4000-8000-00000000fffe';
  const OPP = '00000000-0000-4000-8000-000000000201';
  const CUSTOMER = '00000000-0000-4000-8000-000000000901';

  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
      sql: [
        `INSERT INTO customers (id, workspace_id, first_name, last_name, created_at, updated_at, created_by)
         VALUES ('${CUSTOMER}', '${WS}', 'Jane', 'Smith', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${OWNER}')`,
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
         VALUES ('${TECH}', '${WS}', 'Bo', 'Tech', 'bo@acme.test', 'tech', ''),
                ('${OFFICE}', '${WS}', 'Cy', 'Office', 'cy@acme.test', 'office', '')`,
        `INSERT INTO workspaces (id, name) VALUES ('${OTHER_WS}', 'Someone Else')`,
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
         VALUES ('${OTHER_TECH}', '${OTHER_WS}', 'Di', 'Elsewhere', 'di@other.test', 'tech', '')`,
      ],
    });
    env = { DB: sqlite.db } as unknown as Env;
  });

  afterEach(() => sqlite.close());

  function send(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    const r = makeReq(
      path,
      {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      },
      WS,
      'owner',
    );
    (r as unknown as Record<string, unknown>)['user'] = {
      id: OWNER,
      role: 'owner',
    };
    return jobsRouter.fetch(r, env);
  }

  const START = '2027-05-04T09:00:00.000Z';
  const END = '2027-05-04T11:00:00.000Z';

  function post(extra: Record<string, unknown>): Promise<Response> {
    return send('/', 'POST', {
      title: 'Panel',
      opportunityId: OPP,
      customerId: CUSTOMER,
      scheduledStart: START,
      scheduledEnd: END,
      ...extra,
    });
  }

  const assignedToOf = (id: string) =>
    sqlite
      .rows<{ id: string; assigned_to: string | null }>('jobs')
      .find((r) => r.id === id)?.assigned_to;

  it('POST stores assignedTo and answers with it', async () => {
    const res = await post({ assignedTo: TECH });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; assignedTo?: string; createdBy: string };
    };
    expect(body.data.assignedTo).toBe(TECH);
    // Who typed it in is still recorded, separately.
    expect(body.data.createdBy).toBe(OWNER);
    expect(assignedToOf(body.data.id)).toBe(TECH);
  });

  it('POST without assignedTo leaves the job unassigned — never created_by copied in', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect('assignedTo' in body.data).toBe(false);
    expect(assignedToOf(body.data.id)).toBeNull();
  });

  it('POST with a user from another workspace is 400 and writes no row', async () => {
    const before = sqlite.rows('jobs').length;
    const res = await post({ assignedTo: OTHER_TECH });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(sqlite.rows('jobs')).toHaveLength(before);
    expect(sqlite.rows('job_slots')).toHaveLength(0);
  });

  it('POST with an office user is 400: only owner, admin and tech do jobs', async () => {
    expect((await post({ assignedTo: OFFICE })).status).toBe(400);
    // The owner can be assigned to their own job.
    expect((await post({ assignedTo: OWNER })).status).toBe(201);
  });

  it('PATCH assignedTo: null unassigns; a UUID reassigns; a foreign one is 400', async () => {
    const created = (await (await post({ assignedTo: TECH })).json()) as {
      data: { id: string };
    };
    const id = created.data.id;

    const unassigned = await send(`/${id}`, 'PATCH', { assignedTo: null });
    expect(unassigned.status).toBe(200);
    const body = (await unassigned.json()) as { data: Record<string, unknown> };
    expect('assignedTo' in body.data).toBe(false);
    expect(assignedToOf(id)).toBeNull();

    expect((await send(`/${id}`, 'PATCH', { assignedTo: OWNER })).status).toBe(
      200,
    );
    expect(assignedToOf(id)).toBe(OWNER);

    expect(
      (await send(`/${id}`, 'PATCH', { assignedTo: OTHER_TECH })).status,
    ).toBe(400);
    expect(assignedToOf(id)).toBe(OWNER);
  });

  it('GET /schedule?techId= filters by assignee and names them on the block', async () => {
    const mine = (await (await post({ assignedTo: TECH })).json()) as {
      data: { id: string };
    };
    const nobodys = (await (
      await post({
        scheduledStart: '2027-05-05T09:00:00.000Z',
        scheduledEnd: '2027-05-05T11:00:00.000Z',
      })
    ).json()) as { data: { id: string } };

    const window = '?start=2027-05-01&end=2027-05-31';
    type Block = { id: string; assignedTo?: string; assigneeName?: string };

    const all = (await (await send(`/schedule${window}`, 'GET')).json()) as {
      data: Block[];
    };
    expect(all.data.map((b) => b.id).sort()).toEqual(
      [mine.data.id, nobodys.data.id].sort(),
    );
    expect(all.data.find((b) => b.id === mine.data.id)).toMatchObject({
      assignedTo: TECH,
      assigneeName: 'Bo Tech',
    });
    const unassigned = all.data.find((b) => b.id === nobodys.data.id);
    expect(unassigned && 'assignedTo' in unassigned).toBe(false);
    expect(unassigned && 'assigneeName' in unassigned).toBe(false);

    const filtered = (await (
      await send(`/schedule${window}&techId=${TECH}`, 'GET')
    ).json()) as { data: Block[] };
    expect(filtered.data.map((b) => b.id)).toEqual([mine.data.id]);

    // The owner typed both in; filtering by them finds neither, because the
    // filter is the assignee and not created_by.
    const byTypist = (await (
      await send(`/schedule${window}&techId=${OWNER}`, 'GET')
    ).json()) as { data: Block[] };
    expect(byTypist.data).toEqual([]);
  });
});

// GP-008. "Send invoice" flipped the status and produced nothing a homeowner
// could open: GET /:id/invoice needs the contractor's session. The public
// page is keyed on `jobs.invoice_token`, which this mints. Over the real
// schema, so the column and its partial unique index are the ones under test.
describe('POST /api/jobs/:id/invoice mints the share link (GP-008)', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-000000000001';
  const OWNER = '00000000-0000-4000-8000-000000000002';
  const OPP = '00000000-0000-4000-8000-000000000201';
  const CUSTOMER = '00000000-0000-4000-8000-000000000901';
  const JOB = '00000000-0000-4000-8000-000000000a01';

  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
      sql: [
        `INSERT INTO customers (id, workspace_id, first_name, last_name, created_at, updated_at, created_by)
         VALUES ('${CUSTOMER}', '${WS}', 'Jane', 'Smith', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${OWNER}')`,
        `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                           scheduled_start, scheduled_end, total, created_at, updated_at, created_by)
         VALUES ('${JOB}', '${WS}', '${OPP}', '${CUSTOMER}', 'JOB-0900', 'Panel upgrade', 'completed',
                 '2027-01-02T09:00:00Z', '2027-01-02T11:00:00Z', 265213,
                 '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${OWNER}')`,
      ],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'production' } as unknown as Env;
  });
  afterEach(() => sqlite.close());

  const invoice = () => {
    const req = makeReq(
      `/${JOB}/invoice`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      WS,
    );
    // The activity_log row's user_id is a real FK over the real schema.
    (req as unknown as Record<string, unknown>)['user'] = {
      id: OWNER,
      role: 'owner',
    };
    return jobsRouter.fetch(req, env);
  };

  type Body = {
    data: { status: string; invoiceToken?: string };
    share?: { url: string; message: string };
  };

  it('stores a random token on the row and answers with the public URL built on it', async () => {
    const res = await invoice();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.data.status).toBe('invoiced');

    const row = sqlite
      .rows<{ id: string; invoice_token: string | null }>('jobs')
      .find((j) => j.id === JOB);
    expect(row?.invoice_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.invoice_token).not.toBe(JOB);
    expect(body.data.invoiceToken).toBe(row?.invoice_token);
    // The seeded demo workspace's slug is `demo`.
    expect(body.share?.url).toBe(
      `https://demo.greenput.com/invoice/${row?.invoice_token}`,
    );
    expect(body.share?.message).toContain('Hi Jane');
    expect(body.share?.message).toContain('Panel upgrade');
    expect(body.share?.message).toContain(body.share?.url);
    expect(body.share?.message).not.toMatch(/\bsent\b/i);
  });

  it('is staging-aware: the link is on greenput.site there', async () => {
    env = { DB: sqlite.db, ENVIRONMENT: 'staging' } as unknown as Env;
    const body = (await (await invoice()).json()) as Body;
    expect(body.share?.url).toMatch(
      /^https:\/\/demo\.greenput\.site\/invoice\//,
    );
  });

  it('omits share, not the invoice, when the workspace has no site address', async () => {
    sqlite.raw
      .prepare('UPDATE workspaces SET slug = NULL WHERE id = ?')
      .run(WS);
    const res = await invoice();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.data.status).toBe('invoiced');
    expect(body.data.invoiceToken).toBeTruthy();
    expect(body.share).toBeUndefined();
  });

  it('cannot be invoiced twice, so a token is minted once', async () => {
    const first = (await (await invoice()).json()) as Body;
    const res = await invoice();
    expect(res.status).toBe(400);
    const row = sqlite
      .rows<{ id: string; invoice_token: string | null }>('jobs')
      .find((j) => j.id === JOB);
    expect(row?.invoice_token).toBe(first.data.invoiceToken);
  });
});

describe('PATCH status transitions against schema.sql', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-000000000001';
  const OWNER = '00000000-0000-4000-8000-000000000002';
  const OPP = '00000000-0000-4000-8000-000000000201';
  const CUSTOMER = '00000000-0000-4000-8000-000000000901';
  const JOB = '00000000-0000-4000-8000-000000000b01';

  let sqlite: SqliteD1;
  let env: Env;

  const seed = (status: string) => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
      sql: [
        `INSERT INTO customers (id, workspace_id, first_name, last_name, created_at, updated_at, created_by)
         VALUES ('${CUSTOMER}', '${WS}', 'Jane', 'Smith', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${OWNER}')`,
        `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                           scheduled_start, scheduled_end, total, created_at, updated_at, created_by)
         VALUES ('${JOB}', '${WS}', '${OPP}', '${CUSTOMER}', 'JOB-0910', 'Panel upgrade', '${status}',
                 '2027-01-02T09:00:00Z', '2027-01-02T11:00:00Z', 1000,
                 '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${OWNER}')`,
      ],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'production' } as unknown as Env;
  };
  afterEach(() => sqlite?.close());

  const patch = (body: unknown) => {
    const req = makeReq(
      `/${JOB}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      WS,
    );
    (req as unknown as Record<string, unknown>)['user'] = {
      id: OWNER,
      role: 'owner',
    };
    return jobsRouter.fetch(req, env);
  };
  const statusNow = () =>
    sqlite
      .rows<{ id: string; status: string }>('jobs')
      .find((j) => j.id === JOB)?.status;

  // Every ordered pair of distinct statuses, written out by hand so the
  // test does not just replay the table it is checking.
  const ALLOWED_BY_PATCH: ReadonlyArray<[string, string]> = [
    ['scheduled', 'in_progress'],
    ['scheduled', 'completed'],
    ['scheduled', 'cancelled'],
    ['in_progress', 'scheduled'],
    ['in_progress', 'completed'],
    ['in_progress', 'cancelled'],
    ['completed', 'in_progress'],
    ['cancelled', 'scheduled'],
  ];
  // Legal moves that only their own route may make.
  const ROUTE_ONLY: ReadonlyArray<[string, string]> = [
    ['completed', 'invoiced'],
    ['invoiced', 'paid'],
  ];
  const ALL = [
    'scheduled',
    'in_progress',
    'completed',
    'invoiced',
    'paid',
    'cancelled',
  ];
  const key = ([a, b]: [string, string]) => `${a}>${b}`;
  const listed = new Set([...ALLOWED_BY_PATCH, ...ROUTE_ONLY].map(key));
  const ILLEGAL: Array<[string, string]> = ALL.flatMap((from) =>
    ALL.filter((to) => to !== from && !listed.has(`${from}>${to}`)).map(
      (to) => [from, to] as [string, string],
    ),
  );

  it('covers all 30 edges', () => {
    expect(ALLOWED_BY_PATCH.length + ROUTE_ONLY.length + ILLEGAL.length).toBe(
      30,
    );
    expect(ILLEGAL.map(key)).toEqual(
      expect.arrayContaining(['paid>scheduled', 'invoiced>completed']),
    );
  });

  it.each(ILLEGAL)(
    'refuses %s -> %s with 409 and writes nothing',
    async (from, to) => {
      seed(from);
      const res = await patch({ status: to, title: 'Renamed' });
      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('INVALID_TRANSITION');
      expect(body.error.message).toBe(
        `A job cannot move from ${from} to ${to}`,
      );
      expect(statusNow()).toBe(from);
      const title = sqlite
        .rows<{ id: string; title: string }>('jobs')
        .find((j) => j.id === JOB)?.title;
      expect(title).toBe('Panel upgrade');
    },
  );

  it.each(ROUTE_ONLY)(
    'refuses %s -> %s by PATCH: that edge belongs to its own route',
    async (from, to) => {
      seed(from);
      const res = await patch({ status: to });
      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('INVALID_TRANSITION');
      expect(body.error.message).toMatch(/^Use the (invoice|mark-paid) action/);
      expect(statusNow()).toBe(from);
    },
  );

  it.each(ALLOWED_BY_PATCH)('allows %s -> %s', async (from, to) => {
    seed(from);
    const res = await patch({ status: to });
    expect(res.status).toBe(200);
    expect(statusNow()).toBe(to);
  });

  it('a same-status PATCH on a paid job still edits other fields', async () => {
    seed('paid');
    const res = await patch({ status: 'paid', notes: 'Paid by check' });
    expect(res.status).toBe(200);
    expect(statusNow()).toBe('paid');
  });
});
