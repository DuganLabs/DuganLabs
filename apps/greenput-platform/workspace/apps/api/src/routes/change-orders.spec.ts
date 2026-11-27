import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { changeOrdersRouter } from './change-orders';
import { jobsRouter } from './jobs';
import { estimatesRouter } from './estimates';

/**
 * Change orders: the only way a job's (or a sent estimate's) price changes
 * once it exists. Proposed → approved | rejected, exactly once, with a signed
 * price delta in cents and an append-only event trail. Approving applies the
 * lines; rejecting changes nothing.
 *
 * Over the real schema.sql, like every route test that writes money.
 */

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000c1';
const OTHER_WS = '00000000-0000-4000-8000-0000000000c9';
const OWNER = '00000000-0000-4000-8000-0000000000c2';
const TECH = '00000000-0000-4000-8000-0000000000c3';
const OPP = '00000000-0000-4000-8000-0000000000c4';
const CUST = '00000000-0000-4000-8000-0000000000c5';
const JOB = '00000000-0000-4000-8000-0000000000c6';
const PAID_JOB = '00000000-0000-4000-8000-0000000000c7';
const EST_SENT = '00000000-0000-4000-8000-0000000000d1';
const EST_DRAFT = '00000000-0000-4000-8000-0000000000d2';
const OTHER_JOB = '00000000-0000-4000-8000-0000000000d3';

const T = '2026-10-20T09:00:00.000Z';
const SEED = `
INSERT INTO workspaces (id, name, slug) VALUES ('${WS}', 'Rivertown Electric', 'demo'), ('${OTHER_WS}', 'Other', 'other');
INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
VALUES ('${OWNER}', '${WS}', 'Olive', 'Owner', 'o@rivertown.example', 'owner', ''),
       ('${TECH}', '${WS}', 'Theo', 'Tech', 't@rivertown.example', 'tech', '');
INSERT INTO customers (id, workspace_id, first_name, last_name, email, phone, preferred_contact, created_at, updated_at, created_by)
VALUES ('${CUST}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '5125550143', 'phone', '${T}', '${T}', '${OWNER}');
INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact, street, city, state, zip, status, source, service_type, estimated_value, notes, created_at, updated_at, created_by)
VALUES ('lead-1', '${WS}', 'Jane', 'Doe', 'jane@example.com', '5125550143', 'email', '1 Oak St', 'Rivertown', 'TX', '78701', 'qualified', 'website', 'Panel Upgrade', 0, '', '${T}', '${T}', '${OWNER}'),
       ('lead-x', '${OTHER_WS}', 'X', 'Y', 'x@example.com', '5125550199', 'email', '1 Oak St', 'Rivertown', 'TX', '78701', 'qualified', 'website', 'Panel Upgrade', 0, '', '${T}', '${T}', '${OWNER}');
INSERT INTO opportunities (id, workspace_id, lead_id, title, status, value, created_by)
VALUES ('${OPP}', '${WS}', 'lead-1', 'Panel upgrade', 'won', 0, '${OWNER}');
INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, total, notes, created_at, updated_at, created_by)
VALUES ('${JOB}', '${WS}', '${OPP}', '${CUST}', '#1001', 'Panel upgrade', 'in_progress', '${T}', '2026-10-20T13:00:00.000Z', 245000, '', '${T}', '${T}', '${OWNER}'),
       ('${PAID_JOB}', '${WS}', '${OPP}', '${CUST}', '#1002', 'Old job', 'paid', '${T}', '2026-10-20T13:00:00.000Z', 10000, '', '${T}', '${T}', '${OWNER}');
INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
VALUES ('li-1', '${JOB}', '200A panel replacement', 1, 220000, 220000),
       ('li-2', '${JOB}', 'Permit', 1, 25000, 25000);
INSERT INTO estimates (id, workspace_id, opportunity_id, estimate_number, title, status, line_items, subtotal, tax_rate, tax_amount, total, created_by)
VALUES ('${EST_SENT}', '${WS}', '${OPP}', 'E-1001', 'Panel upgrade', 'sent',
        '[{"id":"e1","type":"labor","description":"Labor","quantity":4,"unitPrice":12500,"total":50000}]', 50000, 10, 5000, 55000, '${OWNER}'),
       ('${EST_DRAFT}', '${WS}', '${OPP}', 'E-1002', 'Draft', 'draft', '[]', 0, 0, 0, 0, '${OWNER}');
INSERT INTO customers (id, workspace_id, first_name, last_name, email, phone, preferred_contact, created_at, updated_at, created_by)
VALUES ('cust-x', '${OTHER_WS}', 'X', 'Y', 'x@example.com', '5125550199', 'phone', '${T}', '${T}', '${OWNER}');
INSERT INTO opportunities (id, workspace_id, lead_id, title, status, value, created_by) VALUES ('opp-x', '${OTHER_WS}', 'lead-x', 'X', 'won', 0, '${OWNER}');
INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, total, created_by)
VALUES ('${OTHER_JOB}', '${OTHER_WS}', 'opp-x', 'cust-x', '#1', 'X', 'scheduled', '${T}', '${T}', 0, '${OWNER}');
`;

let sqlite: SqliteD1;
let env: Env;

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [resolve(ROOT, 'schema.sql')],
    sql: [SEED],
  });
  env = { DB: sqlite.db } as unknown as Env;
});
afterEach(() => sqlite.close());

function req(
  base: string,
  path: string,
  init: { method?: string; body?: unknown; as?: string; role?: string } = {},
): Request {
  const r = new Request(`https://api.greenput.com${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const m = r as unknown as Record<string, unknown>;
  m['workspaceId'] = WS;
  m['user'] = { id: init.as ?? OWNER, role: init.role ?? 'owner' };
  return r;
}
const co = (path: string, init?: Parameters<typeof req>[2]) =>
  changeOrdersRouter.fetch(req('/api/change-orders', path, init), env);

type CO = {
  id: string;
  number: string;
  jobId?: string;
  estimateId?: string;
  status: 'proposed' | 'approved' | 'rejected';
  priceDelta: number;
  totalBefore: number;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote: string;
  events?: Array<{ action: string; actorUserId?: string; note: string }>;
};
type Body<T> = { data: T; error?: { code: string; message: string } };

const ADD_SUBPANEL = {
  title: 'Add a subpanel in the garage',
  reason: 'Homeowner asked on site for garage circuits.',
  lineItems: [
    {
      type: 'material',
      description: '100A subpanel',
      quantity: 1,
      unitPrice: 42000,
    },
    { type: 'labor', description: 'Labor', quantity: 3, unitPrice: 12500 },
  ],
};

async function propose(
  body: Record<string, unknown>,
  as = OWNER,
  role = 'owner',
) {
  const res = await co('/', { method: 'POST', body, as, role });
  return { res, json: (await res.json()) as Body<CO> };
}

const jobTotal = () =>
  (
    sqlite.raw.prepare('SELECT total FROM jobs WHERE id = ?').get(JOB) as {
      total: number;
    }
  ).total;

describe('POST /api/change-orders (propose)', () => {
  it('records a proposal on a job with a signed delta and changes nothing yet', async () => {
    const { res, json } = await propose(
      { jobId: JOB, ...ADD_SUBPANEL },
      TECH,
      'tech',
    );
    expect(res.status).toBe(201);
    expect(json.data).toMatchObject({
      number: 'CO-1001',
      jobId: JOB,
      status: 'proposed',
      priceDelta: 79500,
      totalBefore: 245000,
    });
    expect(json.data.estimateId).toBeUndefined();
    expect(json.data.decidedAt).toBeUndefined();
    expect(json.data.lineItems.map((l) => l.total)).toEqual([42000, 37500]);
    expect(jobTotal()).toBe(245000);
    expect(json.data.events).toEqual([
      expect.objectContaining({ action: 'proposed', actorUserId: TECH }),
    ]);
  });

  it('takes a credit: a negative line lowers the price', async () => {
    const { json } = await propose({
      jobId: JOB,
      title: 'Homeowner pulls the permit',
      lineItems: [
        { description: 'Permit credit', quantity: 1, unitPrice: -25000 },
      ],
    });
    expect(json.data.priceDelta).toBe(-25000);
  });

  it('numbers change orders per workspace', async () => {
    await propose({ jobId: JOB, ...ADD_SUBPANEL });
    const second = await propose({ jobId: JOB, ...ADD_SUBPANEL });
    expect(second.json.data.number).toBe('CO-1002');
  });

  it('needs exactly one of jobId or estimateId', async () => {
    expect((await propose(ADD_SUBPANEL)).res.status).toBe(400);
    expect(
      (await propose({ jobId: JOB, estimateId: EST_SENT, ...ADD_SUBPANEL })).res
        .status,
    ).toBe(400);
  });

  it('needs at least one line', async () => {
    expect(
      (await propose({ jobId: JOB, title: 'x', lineItems: [] })).res.status,
    ).toBe(400);
  });

  it('will not take the price below zero', async () => {
    const { res, json } = await propose({
      jobId: JOB,
      title: 'Too much credit',
      lineItems: [{ description: 'Credit', quantity: 1, unitPrice: -300000 }],
    });
    expect(res.status).toBe(422);
    expect(json.error?.code).toBe('NEGATIVE_TOTAL');
  });

  it('refuses a job that is already invoiced or paid', async () => {
    const { res, json } = await propose({ jobId: PAID_JOB, ...ADD_SUBPANEL });
    expect(res.status).toBe(409);
    expect(json.error?.code).toBe('JOB_CLOSED');
  });

  it('sends a draft estimate back to its editor', async () => {
    const { res, json } = await propose({
      estimateId: EST_DRAFT,
      ...ADD_SUBPANEL,
    });
    expect(res.status).toBe(409);
    expect(json.error?.code).toBe('EDIT_THE_DRAFT');
  });

  it('cannot reach another workspace’s job', async () => {
    const { res } = await propose({ jobId: OTHER_JOB, ...ADD_SUBPANEL });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/change-orders/:id/approve', () => {
  it('applies the lines to the job and moves its total by exactly the delta', async () => {
    const { json: p } = await propose(
      { jobId: JOB, ...ADD_SUBPANEL },
      TECH,
      'tech',
    );
    const res = await co(`/${p.data.id}/approve`, {
      method: 'POST',
      body: { note: 'Jane approved by phone at 10:12.' },
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as Body<CO>;
    expect(data).toMatchObject({
      status: 'approved',
      decidedBy: OWNER,
      decisionNote: 'Jane approved by phone at 10:12.',
    });
    expect(data.decidedAt).toBeTruthy();
    expect(jobTotal()).toBe(245000 + 79500);
    const lines = sqlite.raw
      .prepare(
        'SELECT description, total FROM job_line_items WHERE job_id = ? ORDER BY rowid',
      )
      .all(JOB) as Array<{ description: string; total: number }>;
    expect(lines.map((l) => l.description)).toEqual([
      '200A panel replacement',
      'Permit',
      'CO-1001: 100A subpanel',
      'CO-1001: Labor',
    ]);
    expect(data.events?.map((e) => e.action)).toEqual(['proposed', 'approved']);
  });

  it('applies to a sent estimate, recomputing tax', async () => {
    const { json: p } = await propose({
      estimateId: EST_SENT,
      ...ADD_SUBPANEL,
    });
    expect(p.data.totalBefore).toBe(55000);
    await co(`/${p.data.id}/approve`, { method: 'POST', body: {} });
    const row = sqlite.raw
      .prepare(
        'SELECT line_items, subtotal, tax_amount, total FROM estimates WHERE id = ?',
      )
      .get(EST_SENT) as {
      line_items: string;
      subtotal: number;
      tax_amount: number;
      total: number;
    };
    expect(row.subtotal).toBe(50000 + 79500);
    expect(row.tax_amount).toBe(12950);
    expect(row.total).toBe(129500 + 12950);
    expect(JSON.parse(row.line_items)).toHaveLength(3);
  });

  it('decides exactly once', async () => {
    const { json: p } = await propose({ jobId: JOB, ...ADD_SUBPANEL });
    await co(`/${p.data.id}/approve`, { method: 'POST', body: {} });
    const again = await co(`/${p.data.id}/approve`, {
      method: 'POST',
      body: {},
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as Body<CO>).error?.code).toBe(
      'ALREADY_DECIDED',
    );
    const reject = await co(`/${p.data.id}/reject`, {
      method: 'POST',
      body: {},
    });
    expect(reject.status).toBe(409);
    expect(jobTotal()).toBe(245000 + 79500);
  });

  it('is recorded by the office, not the tech who proposed it', async () => {
    const { json: p } = await propose(
      { jobId: JOB, ...ADD_SUBPANEL },
      TECH,
      'tech',
    );
    const res = await co(`/${p.data.id}/approve`, {
      method: 'POST',
      body: {},
      as: TECH,
      role: 'tech',
    });
    expect(res.status).toBe(403);
    expect(jobTotal()).toBe(245000);
  });

  it('refuses once the job has been invoiced since it was proposed', async () => {
    const { json: p } = await propose({ jobId: JOB, ...ADD_SUBPANEL });
    sqlite.raw
      .prepare("UPDATE jobs SET status = 'invoiced' WHERE id = ?")
      .run(JOB);
    const res = await co(`/${p.data.id}/approve`, { method: 'POST', body: {} });
    expect(res.status).toBe(409);
    expect(jobTotal()).toBe(245000);
  });
});

describe('POST /api/change-orders/:id/reject', () => {
  it('records the decision and changes nothing', async () => {
    const { json: p } = await propose({ jobId: JOB, ...ADD_SUBPANEL });
    const res = await co(`/${p.data.id}/reject`, {
      method: 'POST',
      body: { note: 'Too expensive, maybe next year.' },
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as Body<CO>;
    expect(data.status).toBe('rejected');
    expect(data.events?.map((e) => e.action)).toEqual(['proposed', 'rejected']);
    expect(jobTotal()).toBe(245000);
  });
});

describe('GET /api/change-orders', () => {
  it('lists a job’s change orders, newest first', async () => {
    await propose({ jobId: JOB, ...ADD_SUBPANEL });
    await propose({ estimateId: EST_SENT, ...ADD_SUBPANEL });
    const res = await co(`/?jobId=${JOB}`);
    const { data } = (await res.json()) as Body<CO[]>;
    expect(data).toHaveLength(1);
    expect(data[0]?.jobId).toBe(JOB);
  });

  it('reads one with its trail and keeps other workspaces out', async () => {
    const { json: p } = await propose({ jobId: JOB, ...ADD_SUBPANEL });
    const one = (await (await co(`/${p.data.id}`)).json()) as Body<CO>;
    expect(one.data.events).toHaveLength(1);
    const r = req('/api/change-orders', `/${p.data.id}`);
    (r as unknown as Record<string, unknown>)['workspaceId'] = OTHER_WS;
    expect((await changeOrdersRouter.fetch(r, env)).status).toBe(404);
  });
});

describe('editing prices directly is replaced by change orders', () => {
  it('PATCH /api/jobs/:id refuses lineItems', async () => {
    const res = await jobsRouter.fetch(
      req('/api/jobs', `/${JOB}`, {
        method: 'PATCH',
        body: {
          lineItems: [{ description: 'Labor', quantity: 1, unitPrice: 1 }],
        },
      }),
      env,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as Body<unknown>).error?.code).toBe(
      'CHANGE_ORDER_REQUIRED',
    );
    expect(jobTotal()).toBe(245000);
  });

  it('PATCH /api/jobs/:id refuses a bare total', async () => {
    const res = await jobsRouter.fetch(
      req('/api/jobs', `/${JOB}`, { method: 'PATCH', body: { total: 1 } }),
      env,
    );
    expect(res.status).toBe(409);
    expect(jobTotal()).toBe(245000);
  });

  it('PATCH /api/estimates/:id refuses lineItems once sent, but a draft is still edited directly', async () => {
    const sent = await estimatesRouter.fetch(
      req('/api/estimates', `/${EST_SENT}`, {
        method: 'PATCH',
        body: {
          lineItems: [{ description: 'Labor', quantity: 1, unitPrice: 1 }],
        },
      }),
      env,
    );
    expect(sent.status).toBe(409);
    expect(((await sent.json()) as Body<unknown>).error?.code).toBe(
      'CHANGE_ORDER_REQUIRED',
    );
    const tax = await estimatesRouter.fetch(
      req('/api/estimates', `/${EST_SENT}`, {
        method: 'PATCH',
        body: { taxRate: 0 },
      }),
      env,
    );
    expect(tax.status).toBe(409);
    const draft = await estimatesRouter.fetch(
      req('/api/estimates', `/${EST_DRAFT}`, {
        method: 'PATCH',
        body: {
          lineItems: [{ description: 'Labor', quantity: 1, unitPrice: 100 }],
        },
      }),
      env,
    );
    expect(draft.status).toBe(200);
  });
});
