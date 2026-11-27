import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { opportunitiesRouter } from './opportunities';

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
      // Runs the statements in order; atomicity is tested over schema.sql.
      batch: vi.fn(
        async (statements: Array<{ run: () => Promise<unknown> }>) => {
          const results = [];
          for (const s of statements) results.push(await s.run());
          return results;
        },
      ),
    },
    SESSIONS: {},
    ENVIRONMENT: 'development',
  };
}

const LEAD_UUID = '550e8400-e29b-41d4-a716-446655440000';

function makeReq(
  path: string,
  init: RequestInit = {},
  workspaceId = 'ws-1',
  userId = 'user-1',
) {
  const req = new Request(
    `https://api.greenput.com/api/opportunities${path}`,
    init,
  );
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: userId,
    role: 'owner',
  };
  return req;
}

describe('opportunitiesRouter', () => {
  it('exports opportunitiesRouter with fetch', () => {
    expect(opportunitiesRouter).toBeDefined();
    expect(typeof opportunitiesRouter.fetch).toBe('function');
  });
});

describe('GET /api/opportunities', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns opportunities list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [{ id: 'opp-1', title: 'Panel Upgrade', status: 'open' }],
    });
    const res = await opportunitiesRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports status filter', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(makeReq('/?status=open'), env);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/opportunities/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(makeReq('/opp-not-found'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with opportunity when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'opp-1',
      title: 'Panel Upgrade',
      status: 'open',
    });
    const res = await opportunitiesRouter.fetch(makeReq('/opp-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('opp-1');
  });
});

describe('POST /api/opportunities', () => {
  it('returns 400 when required fields are missing', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid leadId format', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test', leadId: 'not-a-uuid' }),
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
      id: 'opp-new',
      title: 'Panel Upgrade',
      status: 'open',
    });
    const res = await opportunitiesRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Panel Upgrade', leadId: LEAD_UUID }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('opp-new');
  });
});

describe('PATCH /api/opportunities/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(
      makeReq('/opp-not-found', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open' }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(
      makeReq('/opp-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'invalid' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful update', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'opp-1' })
      .mockResolvedValueOnce({ id: 'opp-1', status: 'proposal_sent' });
    const res = await opportunitiesRouter.fetch(
      makeReq('/opp-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'proposal_sent' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/opportunities/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(
      makeReq('/opp-not-found', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 when deleted', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'opp-1' });
    const res = await opportunitiesRouter.fetch(
      makeReq('/opp-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('POST /api/opportunities/:id/convert', () => {
  it('returns 404 when opportunity not found', async () => {
    const env = makeEnv();
    const res = await opportunitiesRouter.fetch(
      makeReq('/opp-not-found/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when already converted', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'opp-1',
      converted_to_job_id: 'job-existing',
    });
    const res = await opportunitiesRouter.fetch(
      makeReq('/opp-1/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 201 with jobId on successful conversion', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: 'opp-1',
        title: 'Panel Upgrade',
        lead_id: 'lead-1',
        value: 5000,
      }) // opp
      .mockResolvedValueOnce({
        id: 'lead-1',
        first_name: 'Jane',
        last_name: 'Smith',
      }) // lead
      .mockResolvedValueOnce(null); // lastJob (none)
    const res = await opportunitiesRouter.fetch(
      makeReq('/opp-1/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledStart: '2026-05-01T09:00:00Z',
          scheduledEnd: '2026-05-01T17:00:00Z',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { jobId: string; jobNumber: string };
    };
    expect(body.data.jobId).toBeTruthy();
    expect(body.data.jobNumber).toBeTruthy();
  });
});

describe('opportunities schema validation', () => {
  it('requires title and leadId', async () => {
    const { CreateOpportunitySchema } =
      await import('@greenput/shared/validators');
    expect(CreateOpportunitySchema.safeParse({}).success).toBe(false);
    expect(
      CreateOpportunitySchema.safeParse({ title: 'Test', leadId: LEAD_UUID })
        .success,
    ).toBe(true);
  });

  it('defaults status to open and value to 0', async () => {
    const { CreateOpportunitySchema } =
      await import('@greenput/shared/validators');
    const result = CreateOpportunitySchema.safeParse({
      title: 'Test',
      leadId: LEAD_UUID,
    });
    if (result.success) {
      expect(result.data.status).toBe('open');
      expect(result.data.value).toBe(0);
    }
  });

  it('accepts partial PATCH updates', async () => {
    const { UpdateOpportunitySchema } =
      await import('@greenput/shared/validators');
    expect(
      UpdateOpportunitySchema.safeParse({ status: 'proposal_sent' }).success,
    ).toBe(true);
    expect(UpdateOpportunitySchema.safeParse({ value: 10000 }).success).toBe(
      true,
    );
  });

  it('rejects empty PATCH body', async () => {
    const { UpdateOpportunitySchema } =
      await import('@greenput/shared/validators');
    expect(UpdateOpportunitySchema.safeParse({}).success).toBe(false);
  });
});

// GP-037. The mocked env.DB above cannot show the defect this guards
// against — a job whose scheduled_end equals its scheduled_start — because
// nothing reads the row back. This runs the handler unmodified against the
// real schema.sql (FKs on) and the preview seed, then asserts on the row.
describe('POST /api/opportunities/:id/convert against schema.sql', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const DEMO_WORKSPACE = '00000000-0000-4000-8000-000000000001';
  const DEMO_OWNER = '00000000-0000-4000-8000-000000000002';
  // Seeded as 'won' with no converted_to_job_id and a lead to build the
  // customer from.
  const WON_OPPORTUNITY = '00000000-0000-4000-8000-000000000201';
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  interface JobRow {
    id: string;
    opportunity_id: string;
    scheduled_start: string;
    scheduled_end: string;
  }

  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db } as unknown as Env;
  });

  afterEach(() => {
    sqlite.close();
  });

  async function convert(payload: Record<string, unknown>): Promise<JobRow> {
    const res = await opportunitiesRouter.fetch(
      makeReq(
        `/${WON_OPPORTUNITY}/convert`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        DEMO_WORKSPACE,
        DEMO_OWNER,
      ),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { jobId: string } };
    const job = sqlite
      .rows<JobRow>('jobs')
      .find((row) => row.id === body.data.jobId);
    expect(job).toBeDefined();
    return job as JobRow;
  }

  it('defaults scheduled_end to two hours after scheduled_start when no schedule is sent', async () => {
    const job = await convert({});
    expect(job.opportunity_id).toBe(WON_OPPORTUNITY);
    const start = new Date(job.scheduled_start).getTime();
    const end = new Date(job.scheduled_end).getTime();
    expect(Number.isNaN(start)).toBe(false);
    expect(end - start).toBe(TWO_HOURS_MS);
  });

  it('anchors the default end to the sent start, not to now', async () => {
    const job = await convert({ scheduledStart: '2027-03-04T09:00:00.000Z' });
    expect(job.scheduled_start).toBe('2027-03-04T09:00:00.000Z');
    expect(job.scheduled_end).toBe('2027-03-04T11:00:00.000Z');
  });

  it('stores the schedule the client sends verbatim', async () => {
    const job = await convert({
      scheduledStart: '2027-03-04T09:00:00.000Z',
      scheduledEnd: '2027-03-04T17:30:00.000Z',
    });
    expect(job.scheduled_start).toBe('2027-03-04T09:00:00.000Z');
    expect(job.scheduled_end).toBe('2027-03-04T17:30:00.000Z');
  });

  // GP-104: convert books through the same job_slots key as POST /api/jobs.
  describe('double booking', () => {
    const SECOND_OPPORTUNITY = '00000000-0000-4000-8000-000000000299';
    const SECOND_LEAD = '00000000-0000-4000-8000-000000000102';

    beforeEach(() => {
      sqlite.raw
        .prepare(
          `INSERT INTO opportunities (id, workspace_id, lead_id, title, status, value, created_at, updated_at, created_by)
           VALUES (?, ?, ?, 'Second won deal', 'won', 100, '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', ?)`,
        )
        .run(SECOND_OPPORTUNITY, DEMO_WORKSPACE, SECOND_LEAD, DEMO_OWNER);
    });

    function convertSecond(payload: Record<string, unknown>) {
      return opportunitiesRouter.fetch(
        makeReq(
          `/${SECOND_OPPORTUNITY}/convert`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          DEMO_WORKSPACE,
          DEMO_OWNER,
        ),
        env,
      );
    }

    it('claims one slot row per half-hour of the new job', async () => {
      const job = await convert({
        scheduledStart: '2027-03-04T09:00:00.000Z',
        scheduledEnd: '2027-03-04T11:30:00.000Z',
      });
      const slots = sqlite
        .rows<{ job_id: string; slot_start: string; lane: number }>('job_slots')
        .filter((r) => r.job_id === job.id);
      expect(slots.map((r) => r.slot_start).sort()).toEqual([
        '2027-03-04T09:00:00.000Z',
        '2027-03-04T09:30:00.000Z',
        '2027-03-04T10:00:00.000Z',
        '2027-03-04T10:30:00.000Z',
        '2027-03-04T11:00:00.000Z',
      ]);
      expect(slots.every((r) => r.lane === 0)).toBe(true);
    });

    it('converting a second deal onto a taken slot is 409 SLOT_TAKEN and leaves the deal untouched', async () => {
      await convert({
        scheduledStart: '2027-03-04T09:00:00.000Z',
        scheduledEnd: '2027-03-04T11:00:00.000Z',
      });
      const customersBefore = sqlite.rows('customers').length;
      const res = await convertSecond({
        scheduledStart: '2027-03-04T10:00:00.000Z',
        scheduledEnd: '2027-03-04T12:00:00.000Z',
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: {
          code: 'SLOT_TAKEN',
          message: 'That time just went — pick another',
        },
      });
      // One batch, rolled back whole: no job, no customer, no 'won' flip.
      expect(sqlite.rows('jobs')).toHaveLength(1);
      expect(sqlite.rows('customers')).toHaveLength(customersBefore);
      const opp = sqlite
        .rows<{ id: string; converted_to_job_id: string | null }>(
          'opportunities',
        )
        .find((r) => r.id === SECOND_OPPORTUNITY);
      expect(opp?.converted_to_job_id).toBeNull();
    });

    it('a second lane lets the second deal in', async () => {
      sqlite.raw
        .prepare('UPDATE workspaces SET concurrent_jobs = 2 WHERE id = ?')
        .run(DEMO_WORKSPACE);
      await convert({
        scheduledStart: '2027-03-04T09:00:00.000Z',
        scheduledEnd: '2027-03-04T11:00:00.000Z',
      });
      const res = await convertSecond({
        scheduledStart: '2027-03-04T09:00:00.000Z',
        scheduledEnd: '2027-03-04T11:00:00.000Z',
      });
      expect(res.status).toBe(201);
      expect(sqlite.rows('jobs')).toHaveLength(2);
    });
  });
});
