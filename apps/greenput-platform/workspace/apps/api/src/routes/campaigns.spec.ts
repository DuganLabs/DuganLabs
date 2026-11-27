import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Campaign } from '@greenput/shared/models';
import type { Env } from '../env';
import { campaignsRouter } from './campaigns';
import { reportsRouter } from './reports';

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
  const req = new Request(
    `https://api.greenput.com/api/campaigns${path}`,
    init,
  );
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: userId,
    role: 'owner',
  };
  return req;
}

describe('campaignsRouter', () => {
  it('exports campaignsRouter with fetch', () => {
    expect(campaignsRouter).toBeDefined();
    expect(typeof campaignsRouter.fetch).toBe('function');
  });
});

describe('GET /api/campaigns', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await campaignsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns campaigns list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'camp-1',
          name: 'Spring Promo',
          channel: 'email',
          status: 'active',
        },
      ],
    });
    const res = await campaignsRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });
});

describe('GET /api/campaigns/:id', () => {
  it('returns 404 when campaign not found', async () => {
    const env = makeEnv();
    const res = await campaignsRouter.fetch(makeReq('/camp-not-found'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with campaign when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'camp-1',
      name: 'Spring Promo',
      channel: 'email',
    });
    const res = await campaignsRouter.fetch(makeReq('/camp-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('camp-1');
  });
});

describe('POST /api/campaigns', () => {
  it('returns 400 when required fields are missing', async () => {
    const env = makeEnv();
    const res = await campaignsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid channel', async () => {
    const env = makeEnv();
    const res = await campaignsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          channel: 'invalid',
          startDate: '2026-04-01T00:00:00Z',
        }),
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
      id: 'camp-new',
      name: 'Spring HVAC Promo',
      channel: 'email',
    });
    const res = await campaignsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Spring HVAC Promo',
          channel: 'email',
          startDate: '2026-04-01T00:00:00Z',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/campaigns/:id', () => {
  it('returns 404 when campaign not found', async () => {
    const env = makeEnv();
    const res = await campaignsRouter.fetch(
      makeReq('/camp-not-found', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful update', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'camp-1' })
      .mockResolvedValueOnce({ id: 'camp-1', status: 'active' });
    const res = await campaignsRouter.fetch(
      makeReq('/camp-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/campaigns/:id', () => {
  it('returns 404 when campaign not found', async () => {
    const env = makeEnv();
    const res = await campaignsRouter.fetch(
      makeReq('/camp-not-found', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 when campaign is deleted', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'camp-1' });
    const res = await campaignsRouter.fetch(
      makeReq('/camp-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('campaigns schema validation', () => {
  it('accepts all valid channels', async () => {
    const { CreateCampaignSchema } =
      await import('@greenput/shared/validators');
    const channels = ['email', 'sms', 'postcard', 'social', 'google'];
    for (const channel of channels) {
      const result = CreateCampaignSchema.safeParse({
        name: 'Test',
        channel,
        startDate: '2026-04-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    }
  });

  it('defaults status to draft', async () => {
    const { CreateCampaignSchema } =
      await import('@greenput/shared/validators');
    const result = CreateCampaignSchema.safeParse({
      name: 'Test',
      channel: 'email',
      startDate: '2026-04-01T00:00:00Z',
    });
    if (result.success) expect(result.data.status).toBe('draft');
  });

  it('accepts partial PATCH updates', async () => {
    const { UpdateCampaignSchema } =
      await import('@greenput/shared/validators');
    expect(UpdateCampaignSchema.safeParse({ status: 'active' }).success).toBe(
      true,
    );
    expect(UpdateCampaignSchema.safeParse({ budget: 5000 }).success).toBe(true);
  });
});

// ── GP-034: two lead counts, one label ────────────────────────
//
// `campaigns.leads_generated` is a number the contractor types; the count
// behind Cost/lead on /reports is COUNT(DISTINCT leads.id) over the rows that
// cite the campaign. Both are on the wire now, under different names, and
// this runs BOTH routers over one real database to prove the counted number
// is the same on each screen. A mocked env.DB cannot see a join, so the
// mocked cases above say nothing about any of this.
describe('campaigns over the real schema', () => {
  const SCHEMA = join(__dirname, '..', '..', '..', '..', 'schema.sql');
  const CREATED = '2026-03-01T00:00:00.000Z';
  // The report windows on campaigns.created_at; pin a window around CREATED
  // rather than depend on the default "last 12 months" still covering it.
  const REPORT_WINDOW = '/campaigns?from=2026-01-01&to=2026-12-31';

  let d1: SqliteD1;
  let env: Env;

  function reportReq(path: string, workspaceId = 'ws-1') {
    const req = new Request(`https://api.greenput.com/api/reports${path}`);
    (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
    (req as unknown as Record<string, unknown>)['user'] = {
      id: 'u-1',
      role: 'owner',
    };
    return req;
  }

  async function listCampaigns(): Promise<Record<string, Campaign>> {
    const res = await campaignsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Campaign[] };
    return Object.fromEntries(data.map((c) => [c.id, c]));
  }

  beforeEach(() => {
    d1 = createSqliteD1({
      files: [SCHEMA],
      sql: [
        `INSERT INTO workspaces (id, name) VALUES ('ws-1', 'Acme Electric'), ('ws-2', 'Someone Else');`,
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
           VALUES ('u-1', 'ws-1', 'Ada', 'Owner', 'ada@acme.test', 'owner', 'x'),
                  ('u-2', 'ws-2', 'Bob', 'Other', 'bob@else.test', 'owner', 'x');`,
        // The contractor says the postcards brought 40 leads and typed that
        // in. Three lead rows actually cite the campaign. The van wrap has a
        // typed count and no rows at all — an off-platform channel.
        `INSERT INTO campaigns (id, workspace_id, name, status, channel, spent, leads_generated, start_date, created_at, updated_at, created_by)
           VALUES ('cmp-1', 'ws-1', 'Spring postcards', 'active', 'postcard', 30000, 40, '2026-03-01', '${CREATED}', '${CREATED}', 'u-1'),
                  ('cmp-van', 'ws-1', 'Van wrap', 'active', 'social', 50000, 15, '2026-03-01', '${CREATED}', '${CREATED}', 'u-1');`,
        // Exactly three in ws-1 cite cmp-1. Nothing in the schema stops a
        // lead in another workspace from citing it too; that one must not
        // count, and neither must the lead that cites nothing.
        `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, campaign_id, created_at, updated_at, created_by)
           VALUES ('l-1', 'ws-1', 'A', 'One', 'new', 'campaign', 'cmp-1', '${CREATED}', '${CREATED}', 'u-1'),
                  ('l-2', 'ws-1', 'B', 'Two', 'contacted', 'campaign', 'cmp-1', '${CREATED}', '${CREATED}', 'u-1'),
                  ('l-3', 'ws-1', 'C', 'Three', 'converted', 'campaign', 'cmp-1', '${CREATED}', '${CREATED}', 'u-1'),
                  ('l-none', 'ws-1', 'D', 'Walkin', 'new', 'website', NULL, '${CREATED}', '${CREATED}', 'u-1'),
                  ('l-elsewhere', 'ws-2', 'E', 'Else', 'new', 'campaign', 'cmp-1', '${CREATED}', '${CREATED}', 'u-2');`,
      ],
    });
    env = {
      DB: d1.db,
      SESSIONS: {} as Env['SESSIONS'],
      ENVIRONMENT: 'development',
    } as unknown as Env;
  });

  afterEach(() => d1.close());

  it('GET /api/campaigns carries the typed count and the counted leads side by side', async () => {
    const byId = await listCampaigns();
    expect(byId['cmp-1']).toMatchObject({ leadsGenerated: 40, leadCount: 3 });
    // The typed number survives untouched when no row cites the campaign.
    expect(byId['cmp-van']).toMatchObject({ leadsGenerated: 15, leadCount: 0 });
  });

  it('GET /api/campaigns/:id carries both counts', async () => {
    const res = await campaignsRouter.fetch(makeReq('/cmp-1'), env);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Campaign };
    expect(data).toMatchObject({
      id: 'cmp-1',
      leadsGenerated: 40,
      leadCount: 3,
    });
  });

  it('still answers 404 for a campaign in another workspace', async () => {
    const res = await campaignsRouter.fetch(makeReq('/cmp-1', {}, 'ws-2'), env);
    expect(res.status).toBe(404);
  });

  it('the row a PATCH answers with carries the counted leads too', async () => {
    const res = await campaignsRouter.fetch(
      makeReq(
        '/cmp-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spent: 45000 }),
        },
        'ws-1',
        'u-1',
      ),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Campaign };
    expect(data).toMatchObject({
      spent: 45000,
      leadsGenerated: 40,
      leadCount: 3,
    });
  });

  it('filters and pagination survive the join', async () => {
    const res = await campaignsRouter.fetch(
      makeReq('/?q=postcards&perPage=1'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Campaign[];
      meta: { total: number };
    };
    expect(body.data.map((c) => c.id)).toEqual(['cmp-1']);
    expect(body.meta.total).toBe(1);
  });

  it('/api/campaigns and /api/reports/campaigns count the same leads and divide by the same number', async () => {
    const byId = await listCampaigns();
    const res = await reportsRouter.fetch(reportReq(REPORT_WINDOW), env);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        campaigns: Array<{
          id: string;
          spent: number;
          leadCount: number;
          costPerLead: number | null;
        }>;
      };
    };
    expect(data.campaigns).toHaveLength(2);
    for (const reported of data.campaigns) {
      const listed = byId[reported.id];
      // The count /reports divides by is the count /campaigns shows.
      expect(listed, reported.id).toMatchObject({
        leadCount: reported.leadCount,
        spent: reported.spent,
      });
    }
    // 30000 cents over the 3 counted leads, not the 40 typed: $100/lead on
    // both screens. The van wrap has spend and no counted leads: no figure.
    expect(byId['cmp-1']).toMatchObject({ spent: 30000, leadCount: 3 });
    expect(data.campaigns.find((c) => c.id === 'cmp-1')).toMatchObject({
      leadCount: 3,
      costPerLead: 10000,
    });
    expect(data.campaigns.find((c) => c.id === 'cmp-van')).toMatchObject({
      leadCount: 0,
      costPerLead: null,
    });
  });
});
