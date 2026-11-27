import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { publicRouter } from './public';
import { createDepositForBooking, type DepositRow } from '../lib/deposits';

/**
 * WS-0 (PRD v1.5, FR-0.2): the homeowner deposit-confirmation endpoints
 * are REMOVED.
 *
 *   GET  /api/public/deposits/:token         — was: status for the poll
 *   POST /api/public/deposits/:token/session — was: client_secret hand-off
 *
 * The booking-deposit model was revoked on 2026-10-20 (canonical
 * model: "No deposit at booking. Ever."). No public surface may report
 * a deposit's status or hand out an intent's client_secret — and the
 * session endpoint's retry path must not be able to re-open a deposit
 * either. These tests pin the removal: even a token belonging to a
 * REAL deposit row (created here through the dormant engine, the way
 * a pre-revocation row would exist) gets the router's plain 404 on
 * both paths, and nothing about the deposit leaks in the response.
 *
 * A fake Stripe API sits behind the fetch seam with test-key-shaped
 * credentials, purely so the dormant engine can build the setup row;
 * the endpoints under test must never reach it.
 */

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000d1';
const OWNER = '00000000-0000-4000-8000-0000000000d2';
const LEAD = '00000000-0000-4000-8000-0000000000d3';
const CUSTOMER = '00000000-0000-4000-8000-0000000000d4';
const OPP = '00000000-0000-4000-8000-0000000000d5';
const JOB = '00000000-0000-4000-8000-0000000000d6';
const ACCT = 'acct_test_123';

class FakeStripe {
  intents = new Map<
    string,
    { id: string; status: string; amount: number; client_secret: string }
  >();
  private seq = 0;

  handler = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith('https://api.stripe.com/v1')) {
      throw new Error(`unexpected fetch in test: ${url}`);
    }
    const path = url.slice('https://api.stripe.com/v1'.length);
    const body = new URLSearchParams(
      typeof init?.body === 'string' ? init.body : '',
    );
    const method = init?.method ?? 'GET';
    const reply = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (method === 'POST' && path === '/payment_intents') {
      const id = `pi_test_${++this.seq}`;
      const intent = {
        id,
        status: 'requires_payment_method',
        amount: Number(body.get('amount')),
        client_secret: `${id}_secret_test`,
      };
      this.intents.set(id, intent);
      return reply(200, { ...intent, currency: 'usd' });
    }
    const get = /^\/payment_intents\/([^/]+)$/.exec(path);
    if (method === 'GET' && get) {
      const intent = this.intents.get(get[1]!);
      if (!intent) return reply(404, { error: { message: 'No such intent' } });
      return reply(200, { ...intent, currency: 'usd' });
    }
    throw new Error(`unhandled Stripe call in test: ${method} ${path}`);
  };
}

let stripe: FakeStripe;
let sqlite: SqliteD1;

function seed(): string {
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, timezone, stripe_account_id, created_at)
VALUES ('${WS}', 'Hi Power Electric', 'hi-power', 'electrical', '9495550100',
        'shop@hipower.example', '1 Main St', 'Irvine', 'CA', '92620', 'America/Los_Angeles', '${ACCT}', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${OWNER}', '${WS}', 'Sheen', 'Oshin', 'sheen@hipower.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO customers (id, workspace_id, first_name, last_name, email, phone, preferred_contact, street, city, state, zip, notes, total_job_value, job_count, created_at, updated_at, created_by)
VALUES ('${CUSTOMER}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '+19495550100', 'phone',
        '2 Oak Ave', 'Irvine', 'CA', '92620', '', 0, 0,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '${OWNER}');

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, status, source, service_type, qualified_at, accepted_at, created_at, updated_at, created_by)
VALUES ('${LEAD}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '+19495550100', 'accepted', 'website', 'ev-charger-install',
        '2026-10-16T08:00:00.000Z', '2026-10-16T09:00:00.000Z',
        '2026-10-16T08:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}');

INSERT INTO opportunities (id, workspace_id, lead_id, customer_id, title, status, value, service_type, notes, closed_at, converted_to_job_id, created_at, updated_at, created_by)
VALUES ('${OPP}', '${WS}', '${LEAD}', '${CUSTOMER}', 'EV charger — Jane Doe', 'won', 0, 'ev-charger-install', '',
        '2026-10-16T09:00:00.000Z', '${JOB}',
        '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}');

INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, street, city, state, zip, scheduled_start, scheduled_end, total, notes, created_at, updated_at, created_by, assigned_to)
VALUES ('${JOB}', '${WS}', '${OPP}', '${CUSTOMER}', '#1001', 'EV charger — Jane Doe', 'scheduled',
        '2 Oak Ave', 'Irvine', 'CA', '92620',
        '2026-10-20T17:00:00.000Z', '2026-10-20T19:00:00.000Z', 0, '',
        '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}', '${OWNER}');

INSERT INTO lead_meter_events (id, workspace_id, lead_id, vertical, service_type, price_usd, status, created_at)
VALUES ('meter-1', '${WS}', '${LEAD}', 'ev_charger', 'ev-charger-install', 60, 'pending', '2026-10-16T09:00:00.000Z');
`;
}

function env(extra: Record<string, unknown> = {}): never {
  return {
    DB: sqlite.db,
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_fake',
    ...extra,
  } as never;
}

async function call(
  path: string,
  method: string,
): Promise<{ status: number; text: string }> {
  const res = await publicRouter.fetch(
    new Request(`https://api.greenput.com${path}`, { method }),
    env(),
  );
  // itty-router returns undefined when NO route matches — the precise
  // unit-level fact WS-0 wants (the route is not registered). Through
  // the real worker that fall-through lands on the auth catch-all and
  // answers an unauthenticated caller 401, like every other unknown
  // /api/public/* path; the cors-deposit spec pins that end-to-end.
  if (!res) return { status: 404, text: '' };
  return { status: res.status, text: await res.text() };
}

async function createdDeposit(): Promise<DepositRow> {
  const outcome = await createDepositForBooking(env(), {
    workspaceId: WS,
    jobId: JOB,
  });
  if (!outcome.created) throw new Error('setup failed');
  return outcome.deposit;
}

beforeEach(() => {
  stripe = new FakeStripe();
  vi.stubGlobal('fetch', stripe.handler);
  sqlite = createSqliteD1({
    files: [resolve(ROOT, 'schema.sql')],
    sql: [seed()],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  sqlite?.close();
});

describe('public deposit confirmation endpoints (removed by WS-0)', () => {
  it('404s the status endpoint even for a real deposit token', async () => {
    const deposit = await createdDeposit();
    const res = await call(
      `/api/public/deposits/${deposit.confirmation_token}`,
      'GET',
    );
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('pending');
    expect(res.text).not.toContain('12000');
  });

  it('404s the session endpoint and hands out no client_secret', async () => {
    const deposit = await createdDeposit();
    const res = await call(
      `/api/public/deposits/${deposit.confirmation_token}/session`,
      'POST',
    );
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('_secret');
    expect(res.text).not.toContain('pk_test_fake');
  });

  it('404s an unknown token on both endpoints, indistinguishably', async () => {
    const token = '123e4567-e89b-42d3-a456-426614174000';
    const get = await call(`/api/public/deposits/${token}`, 'GET');
    expect(get.status).toBe(404);
    const post = await call(`/api/public/deposits/${token}/session`, 'POST');
    expect(post.status).toBe(404);
  });

  it('the session endpoint cannot re-open a failed deposit', async () => {
    const deposit = await createdDeposit();
    await sqlite.db
      .prepare(`UPDATE deposits SET status = 'failed' WHERE id = ?`)
      .bind(deposit.id)
      .run();
    const intentsBefore = stripe.intents.size;
    const res = await call(
      `/api/public/deposits/${deposit.confirmation_token}/session`,
      'POST',
    );
    expect(res.status).toBe(404);
    // The old retry path went back through createDepositForBooking and
    // minted a fresh intent. Gone: no new intent, row untouched.
    expect(stripe.intents.size).toBe(intentsBefore);
    const row = await sqlite.db
      .prepare(`SELECT status FROM deposits WHERE id = ?`)
      .bind(deposit.id)
      .first<{ status: string }>();
    expect(row!.status).toBe('failed');
  });
});
