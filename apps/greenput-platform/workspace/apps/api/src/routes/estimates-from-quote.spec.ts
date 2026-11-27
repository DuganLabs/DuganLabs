import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  completeSession,
  createSession,
  evaluate,
  loadFlow,
  loadSession,
  type D1Like,
  type LoadedFlow,
  type Machine,
  type QuoteSessionRow,
} from '@greenput/shared/pricing';
import {
  loadFlattenedSeed,
  readFixture,
} from '../../../../libs/shared/pricing/src/seed-loader';
import type { Env } from '../env';
import { estimatesRouter } from './estimates';

/**
 * H1's last step, from the contractor's side: drafting the estimate FROM the
 * homeowner's quote confirms the work order, collapses the quote to one exact
 * number when nothing is left to guess, and links the estimate to the quote
 * so the two can never drift apart unnoticed.
 */

const ROOT = resolve(__dirname, '../../../..');
const SEED_DIR = join(ROOT, 'seeds', 'pricing');
const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const byslug = (s: string) => machines.find((m) => m.slug === s) as Machine;
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const WS = 'ws1';
const USER = 'u-owner';

let sqlite: SqliteD1;
let env: Env;
let db: D1Like;

async function completedSession(
  slug: string,
  file: string,
  opts: { id: string; leadId?: string; workspaceId?: string },
): Promise<QuoteSessionRow> {
  const flow = (await loadFlow(db, WS, slug)) as LoadedFlow;
  const s = await createSession(db, {
    id: opts.id,
    workspaceId: opts.workspaceId ?? WS,
    flow,
    sourceUrl: null,
  });
  const f = readFixture(join(SEED_DIR, 'fixtures', file));
  sqlite.raw
    .prepare(
      'UPDATE pricing_quote_sessions SET answers = ?, env = ?, lead_id = ? WHERE id = ?',
    )
    .run(
      JSON.stringify(f.answers),
      JSON.stringify(f.env ?? {}),
      opts.leadId ?? null,
      s.id,
    );
  const fresh = (await loadSession(db, s.id)) as QuoteSessionRow;
  return completeSession(
    db,
    fresh,
    evaluate(byslug(slug), rateCard, f.answers, f.env ?? {}),
  );
}

function post(path: string, body: unknown = {}): Request {
  const req = new Request(`https://api.greenput.com/api/estimates${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const m = req as unknown as Record<string, unknown>;
  m['workspaceId'] = WS;
  m['user'] = { id: USER, role: 'owner' };
  return req;
}

type Body = {
  data: {
    id: string;
    quoteSessionId: string | null;
    total: number;
    status: string;
    lineItems: Array<{ unitPrice: number; quantity: number; total: number }>;
    notes: string;
    quote: {
      stage: string;
      exact: number | null;
      low: number | null;
      high: number | null;
      blockers: string[];
      omitted: string[];
    };
  };
  error?: { code: string };
};

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [join(ROOT, 'schema.sql')],
    sql: [
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme Electric', 'acme');`,
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws2', 'Other Electric', 'other');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u-owner', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, status, source, created_by)
         VALUES ('lead-1', 'ws1', 'Dana', 'Ortiz', 'dana@example.com', '5125550134', 'qualified', 'website', 'u-owner');`,
      `INSERT INTO opportunities (id, workspace_id, lead_id, title, status, value, created_by)
         VALUES ('opp-1', 'ws1', 'lead-1', 'EV charger', 'open', 0, 'u-owner');`,
      `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Default');`,
      `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
         VALUES ('rcv', 'rc', 1, ${q(JSON.stringify(rateCard))}, 'published');`,
      ...['ev-charger-install', 'panel-service-upgrade'].map((slug) => {
        const m = byslug(slug);
        return `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, current_version_id)
             VALUES ('fsm-${slug}', NULL, '${slug}', 'x', ${q(m.name)}, 'v-${slug}');
           INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
             VALUES ('v-${slug}', 'fsm-${slug}', 1, ${q(JSON.stringify(m))}, 'published');`;
      }),
    ],
  });
  db = sqlite.db as unknown as D1Like;
  env = { DB: sqlite.db } as unknown as Env;
});
afterEach(() => sqlite.close());

describe('POST /api/estimates/from-quote/:sessionId', () => {
  it('drafts an estimate at the one exact number, linked to the quote, on the lead’s opportunity', async () => {
    await completedSession('ev-charger-install', '01-ev-typical.json', {
      id: 'sess-1',
      leadId: 'lead-1',
    });
    const res = await estimatesRouter.fetch(
      post('/from-quote/sess-1', { title: 'EV charger install' }),
      env,
    );
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as Body;
    expect(data.status).toBe('draft');
    expect(data.quoteSessionId).toBe('sess-1');
    expect(data.total).toBe(112698);
    expect(data.lineItems.reduce((s, l) => s + l.total, 0)).toBe(112698);
    expect(data.quote).toMatchObject({ stage: 'exact', exact: 1126.98 });

    const row = sqlite.raw
      .prepare('SELECT opportunity_id, quote_session_id FROM estimates')
      .get();
    expect(row).toEqual({
      opportunity_id: 'opp-1',
      quote_session_id: 'sess-1',
    });
    const session = sqlite.raw
      .prepare(
        'SELECT quote_low, quote_high FROM pricing_quote_sessions WHERE id = ?',
      )
      .get('sess-1');
    expect(session).toEqual({ quote_low: 1126.98, quote_high: 1126.98 });
  });

  it('drafts at the point and keeps the range when a guess remains, saying why in the notes', async () => {
    await completedSession(
      'panel-service-upgrade',
      '06-panel-service-upgrade.json',
      {
        id: 'sess-2',
        leadId: 'lead-1',
      },
    );
    const res = await estimatesRouter.fetch(post('/from-quote/sess-2'), env);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as Body;
    expect(data.quote.stage).toBe('range');
    expect(data.quote.exact).toBeNull();
    expect(data.quote.blockers.join(' ')).toMatch(/utility/i);
    expect(data.total).toBe(582171);
    expect(data.notes).toMatch(/utility/i);
  });

  it('takes an explicit opportunity when the quote has no lead', async () => {
    await completedSession('ev-charger-install', '01-ev-typical.json', {
      id: 'sess-3',
    });
    const missing = await estimatesRouter.fetch(
      post('/from-quote/sess-3'),
      env,
    );
    expect(missing.status).toBe(422);
    expect(((await missing.json()) as Body).error?.code).toBe(
      'OPPORTUNITY_REQUIRED',
    );
    const ok = await estimatesRouter.fetch(
      post('/from-quote/sess-3', { opportunityId: 'opp-1' }),
      env,
    );
    expect(ok.status).toBe(201);
  });

  it('will not read another workspace’s quote', async () => {
    await completedSession('ev-charger-install', '01-ev-typical.json', {
      id: 'sess-other',
      workspaceId: 'ws2',
    });
    const res = await estimatesRouter.fetch(
      post('/from-quote/sess-other', { opportunityId: 'opp-1' }),
      env,
    );
    expect(res.status).toBe(404);
    expect(
      sqlite.raw.prepare('SELECT COUNT(*) AS n FROM estimates').get(),
    ).toEqual({ n: 0 });
  });

  it('refuses a quote that has not finished', async () => {
    const flow = (await loadFlow(db, WS, 'ev-charger-install')) as LoadedFlow;
    await createSession(db, {
      id: 'sess-open',
      workspaceId: WS,
      flow,
      sourceUrl: null,
    });
    const res = await estimatesRouter.fetch(
      post('/from-quote/sess-open', { opportunityId: 'opp-1' }),
      env,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as Body).error?.code).toBe('QUOTE_NOT_COMPLETE');
  });

  it('hands the link back on reads', async () => {
    await completedSession('ev-charger-install', '01-ev-typical.json', {
      id: 'sess-1',
      leadId: 'lead-1',
    });
    const created = (await (
      await estimatesRouter.fetch(post('/from-quote/sess-1'), env)
    ).json()) as Body;
    const get = new Request(
      `https://api.greenput.com/api/estimates/${created.data.id}`,
    );
    const m = get as unknown as Record<string, unknown>;
    m['workspaceId'] = WS;
    m['user'] = { id: USER, role: 'owner' };
    const read = (await (await estimatesRouter.fetch(get, env)).json()) as Body;
    expect(read.data.quoteSessionId).toBe('sess-1');
  });
});
