import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { parseDateRange, reportsRouter } from './reports';

const SCHEMA = join(__dirname, '..', '..', '..', '..', 'schema.sql');

function makeReq(path: string, workspaceId = 'ws-1') {
  const req = new Request(`https://api.greenput.com/api/reports${path}`);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: 'u-1',
    role: 'owner',
  };
  return req;
}

describe('reportsRouter', () => {
  it('exports reportsRouter', () => {
    expect(reportsRouter).toBeDefined();
    expect(typeof reportsRouter.fetch).toBe('function');
  });
});

describe('parseDateRange', () => {
  const at = (query: string) => new URL(`https://api.greenput.com/x${query}`);

  it('echoes the caller’s from/to and binds the day after to', () => {
    expect(parseDateRange(at('?from=2026-09-01&to=2026-09-12'))).toEqual({
      from: '2026-09-01',
      to: '2026-09-12',
      toExclusive: '2026-09-13',
    });
  });

  it('rolls over a month end', () => {
    expect(parseDateRange(at('?to=2026-09-30')).toExclusive).toBe('2026-10-01');
  });

  it('rolls over a year end', () => {
    expect(parseDateRange(at('?to=2026-12-31')).toExclusive).toBe('2027-01-01');
  });

  it('knows about leap days', () => {
    expect(parseDateRange(at('?to=2024-02-28')).toExclusive).toBe('2024-02-29');
    expect(parseDateRange(at('?to=2024-02-29')).toExclusive).toBe('2024-03-01');
    expect(parseDateRange(at('?to=2026-02-28')).toExclusive).toBe('2026-03-01');
  });

  it('defaults to the last 12 months ending today, exclusive of tomorrow', () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const lastYear = new Date(today);
    lastYear.setFullYear(lastYear.getFullYear() - 1);

    const range = parseDateRange(at(''));
    expect(range.to).toBe(today.toISOString().slice(0, 10));
    expect(range.toExclusive).toBe(tomorrow.toISOString().slice(0, 10));
    expect(range.from).toBe(lastYear.toISOString().slice(0, 10));
  });

  it('does not throw on a value that is not a date', () => {
    expect(() => parseDateRange(at('?to=yesterday'))).not.toThrow();
  });
});

// Every report bounds a full ISO timestamp column with a date-only `to`.
// SQLite compares TEXT lexicographically, so '2026-09-30T14:03:00.000Z' sorts
// AFTER '2026-09-30' and an inclusive `<=` on the bare date drops the whole
// last day of the window. That is only visible when rows are read back, so
// these run the real handlers over the real schema — a mocked env.DB would
// pass with either operator.
describe('reports over the real schema', () => {
  const FROM = '2026-09-01';
  const TO = '2026-09-30';
  const WINDOW = `?from=${FROM}&to=${TO}`;

  // Timestamps that pin the intent: first instant of `from`, an afternoon on
  // `to`, the last millisecond of `to`, and the first instant of the day after.
  const FROM_START = `${FROM}T00:00:00.000Z`;
  const TO_AFTERNOON = `${TO}T14:03:00.000Z`;
  const TO_LAST_MS = `${TO}T23:59:59.999Z`;
  const DAY_AFTER = '2026-10-01T00:00:00.000Z';
  // What SQLite's datetime('now') DEFAULT actually writes: no 'T', no zone.
  const TO_SQLITE_DEFAULT = `${TO} 09:15:00`;

  let d1: SqliteD1;
  let env: Env;

  async function get<T>(path: string): Promise<T> {
    const res = await reportsRouter.fetch(makeReq(path), env);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: T }).data;
  }

  beforeEach(() => {
    d1 = createSqliteD1({
      files: [SCHEMA],
      sql: [
        `INSERT INTO workspaces (id, name) VALUES ('ws-1', 'Acme Electric');`,
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
           VALUES ('u-1', 'ws-1', 'Ada', 'Owner', 'ada@acme.test', 'owner', 'x'),
                  ('u-2', 'ws-1', 'Bo', 'Tech', 'bo@acme.test', 'tech', 'x'),
                  ('u-3', 'ws-1', 'Cy', 'Office', 'cy@acme.test', 'office', 'x');`,
        `INSERT INTO customers (id, workspace_id, first_name, last_name, created_by)
           VALUES ('c-1', 'ws-1', 'Grace', 'Hopper', 'u-1');`,
        // Campaigns: one on the last day of the window, one the day after.
        `INSERT INTO campaigns (id, workspace_id, name, status, channel, spent, start_date, created_at, created_by)
           VALUES ('cmp-last-day', 'ws-1', 'September push', 'active', 'email', 20000, '${FROM}', '${TO_AFTERNOON}', 'u-1'),
                  ('cmp-day-after', 'ws-1', 'October push', 'draft', 'email', 0, '2026-10-01', '${DAY_AFTER}', 'u-1');`,
        // Leads: first instant of from, afternoon of to, last ms of to, and
        // the day after. The converted one is attributed to the campaign.
        `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, campaign_id, created_at, updated_at, created_by)
           VALUES ('l-from', 'ws-1', 'A', 'From', 'new', 'website', NULL, '${FROM_START}', '${FROM_START}', 'u-1'),
                  ('l-to', 'ws-1', 'B', 'To', 'converted', 'campaign', 'cmp-last-day', '${TO_AFTERNOON}', '${TO_AFTERNOON}', 'u-1'),
                  ('l-to-last-ms', 'ws-1', 'C', 'Edge', 'contacted', 'website', NULL, '${TO_LAST_MS}', '${TO_LAST_MS}', 'u-1'),
                  ('l-after', 'ws-1', 'D', 'After', 'new', 'website', NULL, '${DAY_AFTER}', '${DAY_AFTER}', 'u-1');`,
        `INSERT INTO opportunities (id, workspace_id, lead_id, customer_id, title, status, service_type, created_by)
           VALUES ('o-1', 'ws-1', 'l-to', 'c-1', 'Panel upgrade', 'won', 'electrical', 'u-1');`,
        // Jobs (totals in integer cents): paid on the first instant of from,
        // the afternoon of to, the last ms of to, a datetime('now')-shaped
        // stamp on to, and the day after. created_at mirrors paid_at so the
        // technicians report sees the same boundary. All typed in AND done
        // by u-1, so the boundary case below is about the date, not GP-034.
        `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, total, paid_at, created_at, created_by, assigned_to)
           VALUES ('j-from', 'ws-1', 'o-1', 'c-1', '#1', 'From', 'paid', '${FROM_START}', '${FROM_START}', 5000, '${FROM_START}', '${FROM_START}', 'u-1', 'u-1'),
                  ('j-to', 'ws-1', 'o-1', 'c-1', '#2', 'To', 'paid', '${TO_AFTERNOON}', '${TO_AFTERNOON}', 12500, '${TO_AFTERNOON}', '${TO_AFTERNOON}', 'u-1', 'u-1'),
                  ('j-to-last-ms', 'ws-1', 'o-1', 'c-1', '#3', 'Edge', 'paid', '${TO_LAST_MS}', '${TO_LAST_MS}', 700, '${TO_LAST_MS}', '${TO_LAST_MS}', 'u-1', 'u-1'),
                  ('j-to-sqlite', 'ws-1', 'o-1', 'c-1', '#4', 'Default stamp', 'paid', '${TO_SQLITE_DEFAULT}', '${TO_SQLITE_DEFAULT}', 300, '${TO_SQLITE_DEFAULT}', '${TO_SQLITE_DEFAULT}', 'u-1', 'u-1'),
                  ('j-after', 'ws-1', 'o-1', 'c-1', '#5', 'After', 'paid', '${DAY_AFTER}', '${DAY_AFTER}', 999999, '${DAY_AFTER}', '${DAY_AFTER}', 'u-1', 'u-1');`,
      ],
    });
    env = {
      DB: d1.db,
      SESSIONS: {} as Env['SESSIONS'],
      ENVIRONMENT: 'development',
    } as unknown as Env;
  });

  afterEach(() => d1.close());

  // 5000 + 12500 + 700 + 300: everything inside [from, to], nothing after.
  const IN_WINDOW_CENTS = 18500;
  const IN_WINDOW_JOBS = 4;

  describe('GET /api/reports/revenue', () => {
    it('counts jobs paid on the last day of the window and none after it', async () => {
      const data = await get<{
        from: string;
        to: string;
        summary: { totalRevenue: number; jobCount: number };
        byPeriod: Array<{ period: string; revenue: number; job_count: number }>;
      }>(`/revenue${WINDOW}`);

      expect(data.summary.totalRevenue).toBe(IN_WINDOW_CENTS);
      expect(data.summary.jobCount).toBe(IN_WINDOW_JOBS);
      expect(data.byPeriod).toEqual([
        {
          period: '2026-09',
          revenue: IN_WINDOW_CENTS,
          job_count: IN_WINDOW_JOBS,
        },
      ]);
      // The window is echoed as the caller sent it, not as the bound used.
      expect(data.from).toBe(FROM);
      expect(data.to).toBe(TO);
    });

    it('applies the same bound to service-type and top-customer breakdowns', async () => {
      const data = await get<{
        byServiceType: Array<{ service_type: string; revenue: number }>;
        topCustomers: Array<{ id: string; revenue: number; job_count: number }>;
      }>(`/revenue${WINDOW}`);

      expect(data.byServiceType).toEqual([
        {
          service_type: 'electrical',
          revenue: IN_WINDOW_CENTS,
          job_count: IN_WINDOW_JOBS,
        },
      ]);
      expect(data.topCustomers).toHaveLength(1);
      expect(data.topCustomers[0]).toMatchObject({
        id: 'c-1',
        revenue: IN_WINDOW_CENTS,
        job_count: IN_WINDOW_JOBS,
      });
    });

    it('excludes the day after to by the first instant, not just its afternoon', async () => {
      // Narrow the window to just the `to` day: the last-ms row is in, the
      // midnight-after row is out.
      const data = await get<{ summary: { totalRevenue: number } }>(
        `/revenue?from=${TO}&to=${TO}`,
      );
      expect(data.summary.totalRevenue).toBe(12500 + 700 + 300);
    });

    it('includes a job paid today when no range is given', async () => {
      const today = new Date().toISOString().slice(0, 10);
      // Seeded rows may or may not fall in "the last 12 months ending today"
      // depending on when this runs, so assert the delta from today's job.
      const before = await get<{ summary: { totalRevenue: number } }>(
        '/revenue',
      );
      d1.raw.exec(
        `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, total, paid_at, created_at, created_by)
           VALUES ('j-today', 'ws-1', 'o-1', 'c-1', '#6', 'Today', 'paid', '${today}T14:00:00.000Z', '${today}T14:00:00.000Z', 4200, '${today}T14:00:00.000Z', '${today}T14:00:00.000Z', 'u-1');`,
      );
      const after = await get<{ summary: { totalRevenue: number } }>(
        '/revenue',
      );
      expect(after.summary.totalRevenue - before.summary.totalRevenue).toBe(
        4200,
      );
    });
  });

  describe('GET /api/reports/pipeline', () => {
    it('counts leads created on the last day of the window and none after it', async () => {
      const data = await get<{
        byStatus: Array<{ status: string; count: number }>;
        bySource: Array<{ source: string; total: number; converted: number }>;
        conversionRates: { overallConversion: number };
        averageTimeInStage: Array<{ stage: string; avgDays: number | null }>;
      }>(`/pipeline${WINDOW}`);

      // l-from, l-to, l-to-last-ms — never l-after.
      expect(data.byStatus).toEqual([
        { status: 'new', count: 1 },
        { status: 'contacted', count: 1 },
        { status: 'converted', count: 1 },
      ]);
      expect(data.bySource).toEqual([
        expect.objectContaining({ source: 'website', total: 2, converted: 0 }),
        expect.objectContaining({ source: 'campaign', total: 1, converted: 1 }),
      ]);
      expect(data.conversionRates.overallConversion).toBe(33.33);
      // The three stage averages bind the same window; the converted lead on
      // the last day is what gives qualified_to_converted a value at all.
      expect(data.averageTimeInStage).toEqual([
        { stage: 'new_to_contacted', avgDays: 0 },
        { stage: 'contacted_to_qualified', avgDays: 0 },
        { stage: 'qualified_to_converted', avgDays: 0 },
      ]);
    });

    it('includes a lead created today when no range is given', async () => {
      const today = new Date().toISOString().slice(0, 10);
      d1.raw.exec(
        `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, created_at, updated_at, created_by)
           VALUES ('l-today', 'ws-1', 'E', 'Today', 'qualified', 'referral', '${today}T14:00:00.000Z', '${today}T14:00:00.000Z', 'u-1');`,
      );
      const data = await get<{
        byStatus: Array<{ status: string; count: number }>;
      }>('/pipeline');
      expect(data.byStatus).toContainEqual({ status: 'qualified', count: 1 });
    });
  });

  describe('GET /api/reports/campaigns', () => {
    it('lists a campaign created on the last day of the window and not one the day after', async () => {
      const data = await get<{
        campaigns: Array<{
          id: string;
          leadCount: number;
          convertedLeads: number;
          attributedRevenue: number;
        }>;
      }>(`/campaigns${WINDOW}`);

      expect(data.campaigns.map((c) => c.id)).toEqual(['cmp-last-day']);
      expect(data.campaigns[0]).toMatchObject({
        leadCount: 1,
        // One converted lead with five paid jobs is one converted lead. The
        // jobs LEFT JOIN fans the lead row out once per job, and a SUM over
        // those copies reported 5 here (GP-034).
        convertedLeads: 1,
        // Every paid job hangs off the campaign's converted lead; attribution
        // is not windowed, so all five totals sum here.
        attributedRevenue: 5000 + 12500 + 700 + 300 + 999999,
      });
    });

    it('includes a campaign created today when no range is given', async () => {
      const today = new Date().toISOString().slice(0, 10);
      d1.raw.exec(
        `INSERT INTO campaigns (id, workspace_id, name, channel, start_date, created_at, created_by)
           VALUES ('cmp-today', 'ws-1', 'Today', 'sms', '${today}', '${today}T14:00:00.000Z', 'u-1');`,
      );
      const data = await get<{ campaigns: Array<{ id: string }> }>(
        '/campaigns',
      );
      expect(data.campaigns.map((c) => c.id)).toContain('cmp-today');
    });
  });

  describe('GET /api/reports/technicians', () => {
    type TechRow = { id: string; jobCount: number; revenue: number };
    const techRows = async (query = WINDOW) =>
      (await get<{ technicians: TechRow[] }>(`/technicians${query}`))
        .technicians;

    it('counts jobs created on the last day of the window and none after it', async () => {
      const rows = await techRows();
      expect(rows.find((t) => t.id === 'u-1')).toMatchObject({
        jobCount: IN_WINDOW_JOBS,
        revenue: IN_WINDOW_CENTS,
      });
    });

    /* GP-034. The report joined jobs.created_by, so a job the owner typed in
       and a tech did was the owner's revenue. It joins assigned_to now: user
       A creates the job, user B is assigned it, and B is the one credited. */
    it('credits a job to the technician it is assigned to, not to whoever typed it in', async () => {
      d1.raw.exec(
        `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, total, paid_at, created_at, created_by, assigned_to)
           VALUES ('j-by-a-for-b', 'ws-1', 'o-1', 'c-1', '#7', 'Generator', 'paid', '${TO_AFTERNOON}', '${TO_AFTERNOON}', 40000, '${TO_AFTERNOON}', '${TO_AFTERNOON}', 'u-1', 'u-2');`,
      );
      const rows = await techRows();
      // B: only the job assigned to them.
      expect(rows.find((t) => t.id === 'u-2')).toMatchObject({
        jobCount: 1,
        revenue: 40000,
      });
      // A: unchanged by a job they only typed in.
      expect(rows.find((t) => t.id === 'u-1')).toMatchObject({
        jobCount: IN_WINDOW_JOBS,
        revenue: IN_WINDOW_CENTS,
      });
    });

    it('credits an unassigned job to nobody, and never lists office staff', async () => {
      d1.raw.exec(
        `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, total, paid_at, created_at, created_by)
           VALUES ('j-unassigned', 'ws-1', 'o-1', 'c-1', '#8', 'Nobody yet', 'paid', '${TO_AFTERNOON}', '${TO_AFTERNOON}', 999, '${TO_AFTERNOON}', '${TO_AFTERNOON}', 'u-1');`,
      );
      const rows = await techRows();
      expect(rows.map((t) => t.id).sort()).toEqual(['u-1', 'u-2']);
      expect(rows.reduce((sum, t) => sum + t.revenue, 0)).toBe(IN_WINDOW_CENTS);
    });
  });
});
