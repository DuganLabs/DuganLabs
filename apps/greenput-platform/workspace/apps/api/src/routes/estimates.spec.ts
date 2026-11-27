import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { estimatesRouter } from './estimates';

function makeEnv() {
  const firstMock = vi.fn().mockResolvedValue(null);
  const allMock = vi.fn().mockResolvedValue({ results: [] });
  const runMock = vi.fn().mockResolvedValue({});
  const bindMock = vi
    .fn()
    .mockReturnValue({ first: firstMock, all: allMock, run: runMock });
  const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
  return {
    env: {
      DB: { prepare: prepareMock },
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

function makeReq(path: string, init: RequestInit = {}, role = 'owner') {
  const req = new Request(
    `https://api.greenput.com/api/estimates${path}`,
    init,
  );
  (req as unknown as Record<string, unknown>)['workspaceId'] = 'ws-1';
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

describe('estimatesRouter', () => {
  it('exports estimatesRouter with fetch', () => {
    expect(estimatesRouter).toBeDefined();
    expect(typeof estimatesRouter.fetch).toBe('function');
  });
});

describe('GET /api/estimates', () => {
  it('returns 200 with empty list', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns estimates list', async () => {
    const { env, allMock } = makeEnv();
    allMock.mockResolvedValueOnce({
      results: [
        {
          id: 'e1',
          estimate_number: 'E-1001',
          title: 'Panel Upgrade',
          status: 'draft',
        },
      ],
    });
    const res = await estimatesRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports status filter', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(makeReq('/?status=sent'), env);
    expect(res.status).toBe(200);
  });

  it('supports search filter', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(makeReq('/?q=panel'), env);
    expect(res.status).toBe(200);
  });

  it('returns pagination meta', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({ total: 30 });
    const res = await estimatesRouter.fetch(
      makeReq('/?page=2&perPage=10'),
      env,
    );
    const body = (await res.json()) as {
      meta: { page: number; perPage: number; total: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(10);
    expect(body.meta.total).toBe(30);
  });
});

describe('GET /api/estimates/:id', () => {
  it('returns 404 when estimate not found', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(makeReq('/nonexistent'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with estimate when found', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'e1',
      estimate_number: 'E-1001',
      title: 'HVAC',
      status: 'draft',
    });
    const res = await estimatesRouter.fetch(makeReq('/e1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { estimateNumber: string } };
    expect(body.data.estimateNumber).toBe('E-1001');
  });
});

describe('POST /api/estimates', () => {
  it('returns 400 when required fields missing', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(postReq('/', {}), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is missing', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(
      postReq('/', { opportunityId: '550e8400-e29b-41d4-a716-446655440000' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when opportunity not found', async () => {
    const { env } = makeEnv();
    // firstMock returns null = opp not found
    const res = await estimatesRouter.fetch(
      postReq('/', {
        title: 'Panel Estimate',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('creates estimate and returns 201', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'opp-1' }) // opportunity check
      .mockResolvedValueOnce(null) // last estimate number
      .mockResolvedValueOnce({
        id: 'e-new',
        estimate_number: 'E-1001',
        status: 'draft',
      }); // re-fetch
    const res = await estimatesRouter.fetch(
      postReq('/', {
        title: 'Panel Upgrade Estimate',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('generates E-1001 when no prior estimates exist', async () => {
    const { env, firstMock, bindMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'opp-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'e-new',
        estimate_number: 'E-1001',
        status: 'draft',
      });
    await estimatesRouter.fetch(
      postReq('/', {
        title: 'Estimate',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
      }),
      env,
    );
    const allCalls = bindMock.mock.calls.flat();
    expect(allCalls).toContain('E-1001');
  });

  it('calculates total from line items with tax rate', async () => {
    const { env, firstMock, bindMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'opp-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'e-new', status: 'draft' });
    await estimatesRouter.fetch(
      postReq('/', {
        title: 'Estimate',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        lineItems: [{ description: 'Labor', quantity: 4, unitPrice: 100 }],
        taxRate: 10,
      }),
      env,
    );
    // subtotal=400, taxAmount=40, total=440 — verify 440 in bind args
    const allCalls = bindMock.mock.calls.flat();
    expect(allCalls).toContain(440);
  });
});

describe('PATCH /api/estimates/:id', () => {
  it('returns 404 when estimate not found', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(
      patchReq('/nonexistent', { title: 'New Title' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when body is empty', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(patchReq('/e1', {}), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(
      patchReq('/e1', { status: 'INVALID' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 when updating title', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({
        id: 'e1',
        status: 'draft',
        line_items: '[]',
        tax_rate: 0,
      })
      .mockResolvedValueOnce({ id: 'e1', title: 'New Title' });
    const res = await estimatesRouter.fetch(
      patchReq('/e1', { title: 'New Title' }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/estimates/:id', () => {
  it('returns 404 when estimate not found', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(
      makeReq('/nonexistent', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when trying to delete non-draft estimate', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({ id: 'e1', status: 'sent' });
    const res = await estimatesRouter.fetch(
      makeReq('/e1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 with deleted:true for draft estimate', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({ id: 'e1', status: 'draft' });
    const res = await estimatesRouter.fetch(
      makeReq('/e1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it('cannot delete accepted estimate', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({ id: 'e1', status: 'accepted' });
    const res = await estimatesRouter.fetch(
      makeReq('/e1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/estimates/:id/send', () => {
  it('returns 404 when estimate not found', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(
      postReq('/nonexistent/send', {}),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when estimate is not draft', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'e1',
      status: 'sent',
      opportunity_id: 'opp-1',
    });
    const res = await estimatesRouter.fetch(postReq('/e1/send', {}), env);
    expect(res.status).toBe(400);
  });

  it('marks estimate as sent and updates opportunity', async () => {
    const { env, firstMock, runMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({
        id: 'e1',
        status: 'draft',
        opportunity_id: 'opp-1',
      })
      .mockResolvedValueOnce({ id: 'e1', status: 'sent' });
    const res = await estimatesRouter.fetch(postReq('/e1/send', {}), env);
    expect(res.status).toBe(200);
    // UPDATE estimates + UPDATE opportunities + INSERT activity_log
    expect(runMock).toHaveBeenCalledTimes(3);
  });
});

describe('POST /api/estimates/:id/accept', () => {
  it('returns 404 when estimate not found', async () => {
    const { env } = makeEnv();
    const res = await estimatesRouter.fetch(
      postReq('/nonexistent/accept', {}),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when estimate is not sent', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'e1',
      status: 'draft',
      opportunity_id: 'opp-1',
    });
    const res = await estimatesRouter.fetch(postReq('/e1/accept', {}), env);
    expect(res.status).toBe(400);
  });

  it('marks estimate as accepted and updates opportunity to won', async () => {
    const { env, firstMock, runMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({
        id: 'e1',
        status: 'sent',
        opportunity_id: 'opp-1',
      })
      .mockResolvedValueOnce({ id: 'e1', status: 'accepted' });
    const res = await estimatesRouter.fetch(postReq('/e1/accept', {}), env);
    expect(res.status).toBe(200);
    // UPDATE estimates + UPDATE opportunities + INSERT activity_log
    expect(runMock).toHaveBeenCalledTimes(3);
  });
});

// ── GP-038: the labor/material split is a field on the stored line item ────
//
// Over the real schema.sql (CLAUDE.md §10.0 rule 1): the JSON column is
// written by POST and read back by GET through the wire table, so this is the
// test that fails if `type` is stripped by the validator, dropped by
// storedLineItems, or lost by the serializer — rename it anywhere and this
// breaks, which is what rule 2 asks for.
describe('estimate line item types over the real schema', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-0000000000b1';
  const USER = '00000000-0000-4000-8000-0000000000b2';
  const OPP = '00000000-0000-4000-8000-0000000000b3';
  const SEED = `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, license_num, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'demo', 'electrical', '5125550142', 'hello@rivertown.example',
        '100 Example Way', 'Rivertown', 'TX', '78701', 'TECL-9001', '2026-01-01T00:00:00.000Z');
INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${USER}', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact,
                   street, city, state, zip, status, source, service_type, estimated_value, notes,
                   created_at, updated_at, created_by)
VALUES ('lead-1', '${WS}', 'Alex', 'Rivera', 'alex.rivera@example.com', '5125550101', 'email',
        '1 Oak St', 'Rivertown', 'TX', '78701', 'qualified', 'website', 'Panel Upgrade', 265213, '',
        '2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z', '${USER}');
INSERT INTO opportunities (id, workspace_id, lead_id, title, status, value, service_type,
                           notes, created_at, updated_at, created_by)
VALUES ('${OPP}', '${WS}', 'lead-1', '200A Panel Upgrade', 'open', 265213, 'Panel Upgrade',
        '', '2026-04-05T00:00:00.000Z', '2026-04-06T00:00:00.000Z', '${USER}');
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

  function authed(path: string, init: RequestInit = {}): Request {
    const req = new Request(`https://api.greenput.com/api/estimates${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    return req;
  }

  type Item = {
    id: string;
    type: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  };

  // GP-008. `send` used to be a status flip; the public proposal page at
  // <slug>.greenput.com/proposal/<id> existed and nothing linked to it.
  it('send answers with the public proposal URL for the contractor to pass on', async () => {
    const created = (await (
      await estimatesRouter.fetch(
        authed('/', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Service upgrade',
            opportunityId: OPP,
            lineItems: [
              {
                type: 'labor',
                description: 'Labor',
                quantity: 1,
                unitPrice: 1000,
              },
            ],
          }),
        }),
        env,
      )
    ).json()) as { data: { id: string } };

    const res = await estimatesRouter.fetch(
      authed(`/${created.data.id}/send`, { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string };
      share?: { url: string; message: string };
    };
    expect(body.data.status).toBe('sent');
    // The seed's workspace slug is `demo`; the id is the capability, no token.
    expect(body.share?.url).toBe(
      `https://demo.greenput.com/proposal/${created.data.id}`,
    );
    expect(body.share?.message).toContain(body.share?.url);
    expect(body.share?.message).toContain('Service upgrade');
    expect(body.share?.message).not.toMatch(/\bsent\b/i);
  });

  it('stores each line item type and hands it back on GET', async () => {
    const created = await estimatesRouter.fetch(
      authed('/', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Panel upgrade',
          opportunityId: OPP,
          lineItems: [
            {
              type: 'labor',
              description: 'Replace service panel',
              quantity: 4,
              unitPrice: 17500,
            },
            {
              type: 'material',
              description: '200A breaker',
              quantity: 1,
              unitPrice: 45000,
            },
            { description: 'Permit', quantity: 1, unitPrice: 25000 },
          ],
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as {
      data: { id: string; lineItems: Item[] };
    };
    expect(data.lineItems.map((li) => [li.type, li.description])).toEqual([
      ['labor', 'Replace service panel'],
      ['material', '200A breaker'],
      ['labor', 'Permit'], // the validator's default
    ]);

    // What is actually in the column: a field, not a prefix.
    const [row] = sqlite.rows<{ line_items: string }>('estimates');
    expect(row?.line_items).toContain('"type":"material"');
    expect(row?.line_items).not.toContain('[labor]');

    const fetched = await estimatesRouter.fetch(authed(`/${data.id}`), env);
    expect(fetched.status).toBe(200);
    const again = (await fetched.json()) as { data: { lineItems: Item[] } };
    expect(again.data.lineItems[0]?.type).toBe('labor');
    expect(again.data.lineItems[1]?.type).toBe('material');
    expect(again.data.lineItems[1]?.description).toBe('200A breaker');
  });

  it('reads a row stored with the legacy "[labor] " prefix as a typed item', async () => {
    sqlite.raw.exec(`
INSERT INTO estimates (id, workspace_id, opportunity_id, estimate_number, title, status, line_items,
                       subtotal, tax_rate, tax_amount, total, notes, created_at, updated_at, created_by)
VALUES ('est-old', '${WS}', '${OPP}', 'E-1001', 'Old quote', 'sent',
        '[{"id":"li-a","description":"[labor] Replace service panel","quantity":4,"unitPrice":17500,"total":70000},
          {"id":"li-b","description":"[material] 200A breaker","quantity":1,"unitPrice":45000,"total":45000}]',
        115000, 0, 0, 115000, '', '2026-04-05T00:00:00.000Z', '2026-04-05T00:00:00.000Z', '${USER}');
`);
    const res = await estimatesRouter.fetch(authed('/est-old'), env);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { lineItems: Item[] } };
    expect(data.lineItems).toEqual([
      {
        id: 'li-a',
        type: 'labor',
        description: 'Replace service panel',
        quantity: 4,
        unitPrice: 17500,
        total: 70000,
      },
      {
        id: 'li-b',
        type: 'material',
        description: '200A breaker',
        quantity: 1,
        unitPrice: 45000,
        total: 45000,
      },
    ]);
    // …without rewriting what the customer already saw.
    expect(
      sqlite.raw
        .prepare("SELECT line_items FROM estimates WHERE id = 'est-old'")
        .get(),
    ).toMatchObject({ line_items: expect.stringContaining('[labor] ') });
    // The list endpoint goes through the same table.
    const list = await estimatesRouter.fetch(authed('/'), env);
    const listed = (await list.json()) as { data: { lineItems: Item[] }[] };
    expect(listed.data[0]?.lineItems[1]?.type).toBe('material');
  });

  it('is the schema.sql on disk, not a copy', () => {
    expect(readFileSync(resolve(ROOT, 'schema.sql'), 'utf8')).toContain(
      'line_items',
    );
  });
});
