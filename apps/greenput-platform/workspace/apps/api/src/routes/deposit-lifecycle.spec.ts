import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { leadsRouter } from './leads';
import { jobsRouter } from './jobs';
import { paymentsRouter } from './payments';
import { scheduleRouter } from './schedule';
import type { DepositRow } from '../lib/deposits';

/**
 * The deposit money leg, end to end in Stripe TEST mode: a fake Stripe
 * API behind the fetch seam (test-key-shaped credentials, fixture
 * intents), signed webhook fixtures against a test webhook secret, and
 * the real routers over the real schema. No live key is ever used.
 *
 * booking → deposit intent → authorization → confirm (meter) →
 * completion captures in full; booking → cancel outside the window →
 * full release; booking → cancel inside the window → forfeit, fee
 * first; no-show → forfeit; pilot $1 fee → $2 deposit.
 *
 * The deposit model was revoked on 2026-10-20 (Warren): delivery no
 * longer opens a deposit. One test below pins that; the lifecycle
 * tests open the deposit explicitly through POST /api/payments/deposits
 * — the dormant engine's remaining route — so the settlement legs
 * (apply / release / forfeit) stay covered.
 */

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000f1';
const OWNER = '00000000-0000-4000-8000-0000000000f2';
const LEAD = '00000000-0000-4000-8000-0000000000f3';
const ACCT = 'acct_test_123';
const WEBHOOK_SECRET = 'whsec_test_fixture';

class FakeStripe {
  intents = new Map<
    string,
    {
      id: string;
      status: string;
      amount: number;
      application_fee_amount?: number;
    }
  >();
  calls: Array<{ path: string; body: URLSearchParams }> = [];
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
    this.calls.push({ path, body });
    const reply = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (method === 'GET' && /^\/customers\/[^/]+$/.test(path)) {
      return reply(200, {
        id: path.slice(path.lastIndexOf('/') + 1),
        invoice_settings: { default_payment_method: 'pm_test_card' },
      });
    }
    if (method === 'GET' && path.includes('/payment_methods')) {
      return reply(200, { data: [{ id: 'pm_test_card' }] });
    }
    if (method === 'POST' && path === '/payment_intents') {
      const id = `pi_test_${++this.seq}`;
      const intent = {
        id,
        status: 'requires_payment_method',
        amount: Number(body.get('amount')),
      };
      this.intents.set(id, intent);
      return reply(200, {
        id,
        client_secret: `${id}_secret`,
        status: intent.status,
        amount: intent.amount,
        currency: 'usd',
      });
    }
    const capture = /^\/payment_intents\/([^/]+)\/capture$/.exec(path);
    if (method === 'POST' && capture) {
      const intent = this.intents.get(capture[1]!)!;
      const fee = body.get('application_fee_amount');
      if (fee != null) intent.application_fee_amount = Number(fee);
      intent.status = 'succeeded';
      return reply(200, { ...intent, currency: 'usd' });
    }
    const cancel = /^\/payment_intents\/([^/]+)\/cancel$/.exec(path);
    if (method === 'POST' && cancel) {
      const intent = this.intents.get(cancel[1]!)!;
      intent.status = 'canceled';
      return reply(200, { ...intent, currency: 'usd' });
    }
    const get = /^\/payment_intents\/([^/]+)$/.exec(path);
    if (method === 'GET' && get) {
      return reply(200, { ...this.intents.get(get[1]!)!, currency: 'usd' });
    }
    if (method === 'POST' && path === '/refunds') {
      return reply(200, { id: 're_test_1', status: 'succeeded' });
    }
    throw new Error(`unhandled Stripe call in test: ${method} ${path}`);
  };

  callsTo(suffix: string) {
    return this.calls.filter((c) => c.path.endsWith(suffix));
  }

  /** Connect destination charges. A lead-fee intent has neither. */
  destinationCharges() {
    return this.callsTo('/payment_intents').filter(
      (c) => c.body.get('capture_method') === 'manual',
    );
  }
}

let stripe: FakeStripe;
let sqlite: SqliteD1;

function seed(): string {
  const windows = Array.from({ length: 7 }, (_, day) => day)
    .map(
      (day) =>
        `INSERT INTO availability_windows (id, workspace_id, user_id, day_of_week, start_minute, end_minute, active)
         VALUES ('win-${day}', '${WS}', '${OWNER}', ${day}, 360, 1320, 1);`,
    )
    .join('\n');
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, timezone, stripe_account_id, stripe_customer_id, created_at)
VALUES ('${WS}', 'Hi Power Electric', 'hi-power-e2e', 'electrical', '9495550100',
        'shop@hipower.example', '1 Main St', 'Irvine', 'CA', '92620', 'America/Los_Angeles', '${ACCT}', 'cus_test_shop', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${OWNER}', '${WS}', 'Sheen', 'Oshin', 'sheen@hipower.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO user_workspaces (id, user_id, workspace_id, role)
VALUES ('uw-1', '${OWNER}', '${WS}', 'owner');

INSERT INTO schedule_settings (workspace_id, timezone, travel_buffer_minutes, min_notice_hours, max_lead_time_days)
VALUES ('${WS}', 'America/Los_Angeles', 0, 0, NULL);

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, status, source, service_type, qualified_at, created_at, updated_at, created_by)
VALUES ('${LEAD}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '+19495550100', 'qualified', 'website', 'ev-charger-install',
        '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '${OWNER}');

${windows}
`;
}

function env(): never {
  return {
    DB: sqlite.db,
    STRIPE_SECRET_KEY: 'sk_test_fixture',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  } as never;
}

function as(req: Request): Request {
  const mutable = req as unknown as Record<string, unknown>;
  mutable['user'] = {
    id: OWNER,
    workspaceId: WS,
    firstName: 'Sheen',
    lastName: 'Oshin',
    email: 'sheen@hipower.example',
    role: 'owner',
  };
  mutable['workspaceId'] = WS;
  return req;
}

type AnyRouter =
  | typeof leadsRouter
  | typeof jobsRouter
  | typeof paymentsRouter
  | typeof scheduleRouter;

function call(
  router: AnyRouter,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return router.fetch(
    as(
      new Request(`https://api.greenput.com${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    ),
    env(),
  );
}

function signWebhook(payload: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${t}.${payload}`)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}

async function postWebhook(event: Record<string, unknown>): Promise<Response> {
  const payload = JSON.stringify(event);
  return paymentsRouter.fetch(
    new Request('https://api.greenput.com/api/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signWebhook(payload),
      },
      body: payload,
    }),
    env(),
  );
}

async function depositRow(): Promise<DepositRow | null> {
  return sqlite.db
    .prepare('SELECT * FROM deposits ORDER BY created_at DESC LIMIT 1')
    .first<DepositRow>();
}

/** Deliver the lead; returns the deliver body and the booked job id. */
async function deliverBooked(): Promise<{ jobId: string; body: any }> {
  const enrollRes = await call(scheduleRouter, '/api/schedule/enrollments', {
    body: { userId: OWNER, serviceType: 'ev-charger-install' },
  });
  expect(enrollRes.status).toBe(201);
  const res = await call(leadsRouter, `/api/leads/${LEAD}/deliver`, {
    body: { durationMinutes: 60 },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.delivered).toBe(true);
  return { jobId: body.jobId as string, body };
}

/**
 * Open a deposit for a booked job through the payments route — the
 * engine's explicit entry point, now that delivery opens none.
 */
async function openDeposit(jobId: string): Promise<DepositRow> {
  const res = await call(paymentsRouter, '/api/payments/deposits', {
    body: { jobId },
  });
  expect(res.status).toBe(201);
  const row = await depositRow();
  expect(row).not.toBeNull();
  return row!;
}

/** Simulate the customer's card authorization landing, via the signed webhook. */
async function authorizeDeposit(piId: string): Promise<void> {
  stripe.intents.get(piId)!.status = 'requires_capture';
  const res = await postWebhook({
    id: 'evt_auth',
    type: 'payment_intent.amount_capturable_updated',
    data: { object: { id: piId, status: 'requires_capture' } },
  });
  expect(res.status).toBe(200);
  expect((await depositRow())?.status).toBe('held');
}

async function setJobStart(jobId: string, iso: string): Promise<void> {
  await sqlite.db
    .prepare('UPDATE jobs SET scheduled_start = ? WHERE id = ?')
    .bind(iso, jobId)
    .run();
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

describe('deposit lifecycle — test mode end to end', () => {
  it('delivery opens no deposit — the deposit model is revoked', async () => {
    const { body } = await deliverBooked();
    expect(body.depositAmountCents).toBeUndefined();
    expect(body.depositStatus).toBeUndefined();
    expect(body.depositConfirmationUrl).toBeUndefined();
    expect(await depositRow()).toBeNull();
    expect(stripe.destinationCharges()).toHaveLength(0);
  });

  it('booking → deposit intent → authorization → completion captures in full, fee on the meter', async () => {
    const { jobId } = await deliverBooked();

    // The deposit, opened explicitly through the payments route:
    // $60 EV fee → $120, manual capture, destination = the shop's
    // Connect account.
    const created = await openDeposit(jobId);
    expect(created.amount_cents).toBe(12000);
    expect(created.status).toBe('pending');
    expect(created.fee_cents).toBe(6000);
    const createCall = stripe.destinationCharges()[0]!;
    expect(createCall.body.get('capture_method')).toBe('manual');
    expect(createCall.body.get('transfer_data[destination]')).toBe(ACCT);

    await authorizeDeposit(created!.stripe_payment_intent_id!);

    // The shop completes the job → the deposit applies in full.
    const patch = await call(jobsRouter, `/api/jobs/${jobId}`, {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    expect(patch.status).toBe(200);
    const after = await depositRow();
    expect(after?.status).toBe('applied');
    expect(after?.shop_portion_cents).toBe(12000);
    const capture = stripe.callsTo('/capture')[0]!;
    expect(capture.body.get('application_fee_amount')).toBeNull();

    // Fee remains a meter charge on completion (never netted from the deposit).
    const meter = await sqlite.db
      .prepare('SELECT status FROM lead_meter_events WHERE lead_id = ?')
      .bind(LEAD)
      .first<{ status: string }>();
    expect(meter?.status).toBe('pending');
  });

  it('booking → cancel outside the window → full refund, nothing captured', async () => {
    const { jobId } = await deliverBooked();
    const created = await openDeposit(jobId);
    await authorizeDeposit(created.stripe_payment_intent_id!);
    await setJobStart(
      jobId,
      new Date(Date.now() + 72 * 3_600_000).toISOString(),
    );

    const res = await call(leadsRouter, `/api/leads/${LEAD}/withdraw`, {
      body: {},
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.depositSettlement).toEqual({
      settled: true,
      status: 'refunded',
    });
    const after = await depositRow();
    expect(after?.status).toBe('refunded');
    expect(after?.settle_reason).toBe('lead_withdrawn');
    expect(stripe.callsTo('/capture')).toHaveLength(0);
    expect(stripe.callsTo('/cancel')).toHaveLength(1);
  });

  it('booking → cancel inside the window → forfeit: fee first, remainder to the shop', async () => {
    const { jobId } = await deliverBooked();
    const created = await openDeposit(jobId);
    await authorizeDeposit(created.stripe_payment_intent_id!);
    await setJobStart(
      jobId,
      new Date(Date.now() + 2 * 3_600_000).toISOString(),
    );

    const res = await call(leadsRouter, `/api/leads/${LEAD}/withdraw`, {
      body: { reason: 'schedule_no_longer_works' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.depositSettlement).toEqual({
      settled: true,
      status: 'forfeited',
    });
    const after = await depositRow();
    expect(after?.fee_portion_cents).toBe(6000);
    expect(after?.shop_portion_cents).toBe(6000);
    expect(after?.shortfall_cents).toBe(0);
    const capture = stripe.callsTo('/capture')[0]!;
    expect(capture.body.get('application_fee_amount')).toBe('6000');
    // Meter waived by the forfeit settlement itself — the fee is recovered
    // from the deposit; withdrawLead left the row pending — no double bill.
    const meter = await sqlite.db
      .prepare('SELECT status FROM lead_meter_events WHERE lead_id = ?')
      .bind(LEAD)
      .first<{ status: string }>();
    expect(meter?.status).toBe('waived');
  });

  it('booking → no-show → forfeit, job cancelled and slots freed', async () => {
    const { jobId } = await deliverBooked();
    const created = await openDeposit(jobId);
    await authorizeDeposit(created.stripe_payment_intent_id!);

    const res = await call(jobsRouter, `/api/jobs/${jobId}/no-show`, {
      body: {},
    });
    expect(res.status).toBe(200);
    const after = await depositRow();
    expect(after?.status).toBe('forfeited');
    expect(after?.settle_reason).toBe('no_show');
    const job = await sqlite.db
      .prepare('SELECT status FROM jobs WHERE id = ?')
      .bind(jobId)
      .first<{ status: string }>();
    expect(job?.status).toBe('cancelled');
    const slots = await sqlite.db
      .prepare('SELECT COUNT(*) AS n FROM job_slots WHERE job_id = ?')
      .bind(jobId)
      .first<{ n: number }>();
    expect(slots?.n).toBe(0);
  });

  it('booking → delivery undone → deposit released in full', async () => {
    const { jobId } = await deliverBooked();
    const created = await openDeposit(jobId);
    await authorizeDeposit(created.stripe_payment_intent_id!);

    const res = await call(leadsRouter, `/api/leads/${LEAD}/delivery/undo`, {
      body: {},
    });
    expect(res.status).toBe(200);
    const after = await depositRow();
    expect(after?.status).toBe('refunded');
    expect(after?.settle_reason).toBe('delivery_undone');
    expect(stripe.callsTo('/capture')).toHaveLength(0);
  });

  it('pilot scale: a $1 lead fee carries a $2 deposit', async () => {
    // Seed an accepted booking by hand, with the pilot's $1 meter event.
    const JOB2 = '00000000-0000-4000-8000-0000000000f4';
    const CUST = '00000000-0000-4000-8000-0000000000f5';
    const OPP2 = '00000000-0000-4000-8000-0000000000f6';
    await sqlite.db.exec(`
INSERT INTO customers (id, workspace_id, first_name, last_name, email, phone, preferred_contact, street, city, state, zip, notes, total_job_value, job_count, created_at, updated_at, created_by)
VALUES ('${CUST}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '+19495550100', 'phone', '2 Oak Ave', 'Irvine', 'CA', '92620', '', 0, 0, '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}');
UPDATE leads SET accepted_at = '2026-10-16T09:00:00.000Z', status = 'accepted' WHERE id = '${LEAD}';
INSERT INTO opportunities (id, workspace_id, lead_id, customer_id, title, status, value, service_type, notes, closed_at, converted_to_job_id, created_at, updated_at, created_by)
VALUES ('${OPP2}', '${WS}', '${LEAD}', '${CUST}', 'EV charger — Jane Doe', 'won', 0, 'ev-charger-install', '', '2026-10-16T09:00:00.000Z', '${JOB2}', '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}');
INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, street, city, state, zip, scheduled_start, scheduled_end, total, notes, created_at, updated_at, created_by, assigned_to)
VALUES ('${JOB2}', '${WS}', '${OPP2}', '${CUST}', '#1001', 'EV charger — Jane Doe', 'scheduled', '2 Oak Ave', 'Irvine', 'CA', '92620', '2026-10-25T17:00:00.000Z', '2026-10-25T19:00:00.000Z', 0, '', '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}', '${OWNER}');
INSERT INTO lead_meter_events (id, workspace_id, lead_id, vertical, service_type, price_usd, status, created_at)
VALUES ('meter-pilot', '${WS}', '${LEAD}', 'ev_charger', 'ev-charger-install', 1, 'pending', '2026-10-16T09:00:00.000Z');
`);

    const res = await call(paymentsRouter, '/api/payments/deposits', {
      body: { jobId: JOB2 },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.deposit.amount_cents).toBe(200);
    expect(body.data.deposit.fee_cents).toBe(100);
    expect(body.data.clientSecret).toContain('_secret');

    // Idempotent re-issue: same deposit, no second intent, no client secret.
    const again = await call(paymentsRouter, '/api/payments/deposits', {
      body: { jobId: JOB2 },
    });
    expect(again.status).toBe(200);
    const againBody = await again.json();
    expect(againBody.data.deposit.id).toBe(body.data.deposit.id);
    expect(againBody.data.clientSecret).toBeUndefined();
    expect(stripe.callsTo('/payment_intents')).toHaveLength(1);

    const list = await call(
      paymentsRouter,
      `/api/payments/deposits?jobId=${JOB2}`,
    );
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].amount_cents).toBe(200);
  });

  it('rejects a webhook with a bad signature and settles nothing', async () => {
    await deliverBooked();
    const payload = JSON.stringify({
      id: 'evt_bad',
      type: 'payment_intent.amount_capturable_updated',
      data: { object: { id: 'pi_test_1', status: 'requires_capture' } },
    });
    const res = await paymentsRouter.fetch(
      new Request('https://api.greenput.com/api/payments/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=1,v1=deadbeef',
        },
        body: payload,
      }),
      env(),
    );
    expect(res.status).toBe(401);
    // Nothing to settle: delivery opened no deposit, and the forged
    // webhook changed nothing.
    expect(await depositRow()).toBeNull();
  });
});
