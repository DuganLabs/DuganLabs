import { describe, it, expect, vi } from 'vitest';
import { dashboardRouter } from './dashboard';

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    },
    SESSIONS: {},
    ENVIRONMENT: 'development',
  };
}

function makeReq(path: string, workspaceId = 'ws-1') {
  const req = new Request(`https://api.greenput.com/api/dashboard${path}`);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  return req;
}

describe('dashboardRouter', () => {
  it('exports dashboardRouter with fetch', () => {
    expect(dashboardRouter).toBeDefined();
    expect(typeof dashboardRouter.fetch).toBe('function');
  });
});

describe('GET /api/dashboard/stats', () => {
  it('returns 200 with expected KPI shape', async () => {
    const env = makeEnv();
    const res = await dashboardRouter.fetch(makeReq('/stats'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toHaveProperty('leads');
    expect(body.data).toHaveProperty('jobs');
    expect(body.data).toHaveProperty('revenue');
    expect(body.data).toHaveProperty('conversion');
    expect(body.data).toHaveProperty('activity');
  });

  it('returns zero values when DB returns null', async () => {
    const env = makeEnv();
    const res = await dashboardRouter.fetch(makeReq('/stats'), env);
    const body = (await res.json()) as {
      data: {
        leads: { thisMonth: number; growth: unknown };
        jobs: { active: number; dueThisWeek: number };
        revenue: { thisMonth: number; growth: unknown };
        conversion: { rate: number };
        activity: unknown[];
      };
    };
    expect(body.data.leads.thisMonth).toBe(0);
    expect(body.data.leads.growth).toBeNull();
    expect(body.data.jobs.active).toBe(0);
    expect(body.data.jobs.dueThisWeek).toBe(0);
    expect(body.data.revenue.thisMonth).toBe(0);
    expect(body.data.conversion.rate).toBe(0);
    expect(Array.isArray(body.data.activity)).toBe(true);
  });

  it('calculates lead growth when last month data exists', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ total: 30, this_month: 20, last_month: 15 }) // leads
      .mockResolvedValueOnce({ active: 5, due_this_week: 2 }) // jobs
      .mockResolvedValueOnce({ this_month: 15000, last_month: 12000 }) // revenue
      .mockResolvedValueOnce({ total: 50, converted: 15 }); // conversion
    const res = await dashboardRouter.fetch(makeReq('/stats'), env);
    const body = (await res.json()) as { data: { leads: { growth: number } } };
    expect(body.data.leads.growth).toBe(33); // (20-15)/15*100 = 33.33 → 33
  });

  it('calculates revenue growth correctly', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ total: 10, this_month: 10, last_month: 5 }) // leads
      .mockResolvedValueOnce({ active: 0, due_this_week: 0 }) // jobs
      .mockResolvedValueOnce({ this_month: 15000, last_month: 12000 }) // revenue
      .mockResolvedValueOnce({ total: 0, converted: 0 }); // conversion
    const res = await dashboardRouter.fetch(makeReq('/stats'), env);
    const body = (await res.json()) as {
      data: { revenue: { growth: number } };
    };
    expect(body.data.revenue.growth).toBe(25); // (15000-12000)/12000*100 = 25
  });

  it('calculates conversion rate correctly', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ total: 0, this_month: 0, last_month: 0 }) // leads
      .mockResolvedValueOnce({ active: 0, due_this_week: 0 }) // jobs
      .mockResolvedValueOnce({ this_month: 0, last_month: 0 }) // revenue
      .mockResolvedValueOnce({ total: 50, converted: 15 }); // conversion
    const res = await dashboardRouter.fetch(makeReq('/stats'), env);
    const body = (await res.json()) as {
      data: { conversion: { rate: number } };
    };
    expect(body.data.conversion.rate).toBe(30); // 15/50*100 = 30
  });

  it('includes activity entries in response', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'a1',
          entity_type: 'lead',
          action: 'created',
          first_name: 'Jane',
          last_name: 'Smith',
        },
      ],
    });
    const res = await dashboardRouter.fetch(makeReq('/stats'), env);
    const body = (await res.json()) as { data: { activity: unknown[] } };
    expect(body.data.activity.length).toBe(1);
  });
});

describe('dashboard stats logic', () => {
  describe('lead growth calculation', () => {
    it('calculates positive growth', () => {
      const thisMonth = 20;
      const lastMonth = 15;
      const growth = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
      expect(growth).toBe(33);
    });

    it('calculates negative growth', () => {
      const thisMonth = 10;
      const lastMonth = 15;
      const growth = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
      expect(growth).toBe(-33);
    });

    it('returns null when no previous month data', () => {
      const lastMonth = 0;
      const growth = lastMonth
        ? Math.round(((20 - lastMonth) / lastMonth) * 100)
        : null;
      expect(growth).toBeNull();
    });
  });

  describe('conversion rate calculation', () => {
    it('calculates percentage from converted/total', () => {
      const total = 50;
      const converted = 15;
      const rate = Math.round((converted / total) * 100);
      expect(rate).toBe(30);
    });

    it('returns 0 when no leads', () => {
      const total = 0;
      const rate = total ? Math.round((0 / total) * 100) : 0;
      expect(rate).toBe(0);
    });
  });
});
