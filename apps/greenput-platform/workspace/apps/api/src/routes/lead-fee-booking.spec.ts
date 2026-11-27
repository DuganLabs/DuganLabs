import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import {
  chargeBookedLeadFee,
  chargePendingLeadFees,
  LeadFeeRefundError,
  refundLeadFee,
  type LeadFeeRefundReason,
} from '../lib/lead-fee-billing';
import { recordLeadMeter } from '../lib/lead-meter';
import { jobsRouter } from './jobs';
import { leadsRouter } from './leads';
import { paymentsRouter } from './payments';
import { poolRouter } from './pool';
import { scheduleRouter } from './schedule';

/**
 * WS-1 / FR-1.6 — the permanent fee-at-booking regression suite.
 *
 * Scripted Stripe TEST-MODE end-to-end (the repo harness: a real
 * sqlite D1 from schema.sql, the real routers, and fetch stubbed the
 * way lib/lead-fee-billing.spec.ts stubs it — every Stripe call is
 * recorded, none leaves the process). The road under test:
 *
 *   quote → book → fee
 *
 * Assertions, mapped to the PRD:
 *   FR-1.1  exactly one charge, at booking commit, at the rate-card
 *           amount per service (EV $60 and plumbing $45 exercised).
 *   FR-1.2  no fee event on: range display / quote completion (the
 *           GET /fee read), manual accept, pool accept, confirmation
 *           or reschedule (the job PATCH re-slots; delivery re-entry
 *           conflicts), or a pre-booking exit (withdraw). A booking
 *           at a DIFFERENT shop bills that shop; a same-shop rebook
 *           never bills twice.
 *   FR-1.3  a priority booking bills 50% and is marked priority.
 *   FR-1.4  refunds exist only via refundLeadFee, only for 'fraud' /
 *           'platform_fault', with the reason recorded; undo of a
 *           delivery leaves the collected fee standing.
 *   FR-1.5  the charge is the fee and only the fee — no application
 *           fee, no usage-ledger netting.
 *   FR-1.6  signed-webhook fixtures: a validly signed fee event
 *           processes; a tampered signature is rejected 401.
 */

const ROOT = resolve(__dirname, '../../../..');
const WEBHOOK_SECRET = 'whsec_test_ws1';

const WS_A = '00000000-0000-4000-8000-0000000000a1';
const OWNER_A = '00000000-0000-4000-8000-0000000000a2';
const WS_B = '00000000-0000-4000-8000-0000000000b1';
const OWNER_B = '00000000-0000-4000-8000-0000000000b2';

let sqlite: SqliteD1;
let piSeq = 0;

interface StripeCall {
  url: string;
  method: string;
  body: URLSearchParams;
}

const stripeCalls: StripeCall[] = [];

function installStripeStub(): void {
  stripeCalls.length = 0;
  piSeq = 0;
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = new URLSearchParams(
        typeof init?.body === 'string' ? init.body : '',
      );
      stripeCalls.push({ url, method, body });
      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (method === 'GET' && /\/customers\/cus_[ab]$/.test(url)) {
        return json({
          id: url.split('/').pop(),
          invoice_settings: { default_payment_method: 'pm_card' },
        });
      }
      if (method === 'GET' && url.includes('/payment_methods')) {
        return json({ data: [{ id: 'pm_card' }] });
      }
      if (method === 'GET' && url.includes('/charges/')) {
        return json({
          id: 'ch_test',
          receipt_url: 'https://pay.stripe.com/receipts/ch_test',
        });
      }
      if (method === 'POST' && url.endsWith('/payment_intents')) {
        piSeq += 1;
        return json({
          id: `pi_${piSeq}`,
          status: 'succeeded',
          amount: Number(body.get('amount') ?? 0),
          currency: 'usd',
        });
      }
      if (method === 'POST' && url.endsWith('/refunds')) {
        return json({ id: 're_1', status: 'succeeded' });
      }
      return json(
        { error: { message: `unexpected ${method} ${url}`, code: 'test' } },
        500,
      );
    },
  );
}

function paymentIntentCalls(): StripeCall[] {
  return stripeCalls.filter(
    (c) => c.method === 'POST' && c.url.endsWith('/payment_intents'),
  );
}

function refundCalls(): StripeCall[] {
  return stripeCalls.filter(
    (c) => c.method === 'POST' && c.url.endsWith('/refunds'),
  );
}

function env(): Env {
  return {
    DB: sqlite.db,
    STRIPE_SECRET_KEY: 'sk_test_ws1',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  } as Env;
}

function shopSql(
  ws: string,
  owner: string,
  slug: string,
  customerId: string,
): string {
  const windows = Array.from({ length: 7 }, (_, day) => day)
    .map(
      (day) =>
        `INSERT INTO availability_windows (id, workspace_id, user_id, day_of_week, start_minute, end_minute, active)
         VALUES ('win-${ws.slice(-2)}-${day}', '${ws}', '${owner}', ${day}, 360, 1320, 1);`,
    )
    .join('\n');
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, timezone, stripe_customer_id, created_at)
VALUES ('${ws}', 'Shop ${slug}', '${slug}', 'electrical', '5125550142',
        'hello@${slug}.example', '100 Example Way', 'Rivertown', 'TX', '78701', 'America/Los_Angeles', '${customerId}', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${owner}', '${ws}', 'Dana', 'Ortiz', 'dana@${slug}.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO user_workspaces (id, user_id, workspace_id, role)
VALUES ('uw-${ws.slice(-2)}', '${owner}', '${ws}', 'owner');

INSERT INTO schedule_settings (workspace_id, timezone, travel_buffer_minutes, min_notice_hours, max_lead_time_days)
VALUES ('${ws}', 'America/Los_Angeles', 0, 0, NULL);

${windows}
`;
}

let leadSeq = 0;
function insertLead(ws: string, owner: string, serviceType: string): string {
  leadSeq += 1;
  const leadId = `00000000-0000-4000-8000-${String(leadSeq).padStart(12, '0')}`;
  sqlite.raw.exec(`
INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, status, source, service_type, qualified_at, created_at, updated_at, created_by)
VALUES ('${leadId}', '${ws}', 'Jane', 'Doe', 'jane${leadSeq}@example.com', '+194955501${String(leadSeq).padStart(2, '0')}', 'qualified', 'website', '${serviceType}',
        '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '${owner}');
`);
  return leadId;
}

type AnyRouter = {
  fetch: (req: Request, env: unknown) => Promise<Response>;
};

async function call(
  router: AnyRouter,
  ws: string,
  userId: string,
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<{ status: number; body: any }> {
  const req = new Request(`https://api.greenput.com${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const mutable = req as unknown as Record<string, unknown>;
  mutable['user'] = { id: userId, workspaceId: ws, role: 'owner' };
  mutable['workspaceId'] = ws;
  const res = await router.fetch(req, env());
  return { status: res.status, body: await res.json() };
}

async function enroll(
  ws: string,
  owner: string,
  serviceType: string,
): Promise<void> {
  const res = await call(
    scheduleRouter as AnyRouter,
    ws,
    owner,
    '/api/schedule/enrollments',
    {
      userId: owner,
      serviceType,
    },
  );
  expect(res.status).toBe(201);
}

async function deliver(
  ws: string,
  owner: string,
  leadId: string,
): Promise<{ status: number; body: any }> {
  return call(
    leadsRouter as AnyRouter,
    ws,
    owner,
    `/api/leads/${leadId}/deliver`,
    {
      durationMinutes: 60,
    },
  );
}

interface MeterRow {
  id: string;
  workspace_id: string;
  lead_id: string;
  price_usd: number;
  status: string;
  payment_status: string | null;
  job_id: string | null;
  delivery_id: string | null;
  priority: number;
  refund_reason: string | null;
}

function meterRows(leadId?: string): MeterRow[] {
  const rows = sqlite.rows<MeterRow>('lead_meter_events');
  return leadId ? rows.filter((r) => r.lead_id === leadId) : rows;
}

beforeEach(() => {
  leadSeq = 0;
  sqlite = createSqliteD1({
    files: [resolve(ROOT, 'schema.sql')],
    sql: [
      shopSql(WS_A, OWNER_A, 'rivertown-ws1', 'cus_a'),
      shopSql(WS_B, OWNER_B, 'hill-country-ws1', 'cus_b'),
    ],
  });
  installStripeStub();
});

afterEach(() => {
  sqlite.close();
  vi.unstubAllGlobals();
});

describe('FR-1.6: quote → book → fee (Stripe test mode)', () => {
  it('FR-1.1/1.2: exactly one charge, at booking, at the EV rate — and nothing before it', async () => {
    await enroll(WS_A, OWNER_A, 'ev-charger-install');
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');

    // Range display / quote completion: the fee read quotes $60 and
    // bills nothing.
    const fee = await call(
      leadsRouter as AnyRouter,
      WS_A,
      OWNER_A,
      `/api/leads/${leadId}/fee`,
      undefined,
      'GET',
    );
    expect(fee.status).toBe(200);
    expect(fee.body.data.priceUsd).toBe(60);
    expect(paymentIntentCalls()).toHaveLength(0);
    expect(meterRows()).toHaveLength(0);

    // The booking commit.
    const booked = await deliver(WS_A, OWNER_A, leadId);
    expect(booked.status).toBe(200);
    expect(booked.body.delivered).toBe(true);

    // Exactly one charge, for the fee alone (FR-1.5: no application
    // fee, nothing netted), to shop A's platform customer.
    const charges = paymentIntentCalls();
    expect(charges).toHaveLength(1);
    expect(charges[0]?.body.get('amount')).toBe('6000');
    expect(charges[0]?.body.get('customer')).toBe('cus_a');
    expect(charges[0]?.body.get('metadata[kind]')).toBe('lead_fee');
    expect(charges[0]?.body.get('application_fee_amount')).toBeNull();
    expect(sqlite.rows('workspace_usage_ledger')).toHaveLength(0);

    // One meter row, collected, linked to the booking it came from.
    const rows = meterRows(leadId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: WS_A,
      price_usd: 60,
      status: 'invoiced',
      payment_status: 'paid',
      job_id: booked.body.jobId,
      delivery_id: booked.body.deliveryId,
      priority: 0,
    });
  });

  it('FR-1.1: a second vertical bills its own rate (plumbing $45)', async () => {
    await enroll(WS_A, OWNER_A, 'plumbing');
    const leadId = insertLead(WS_A, OWNER_A, 'plumbing');

    const fee = await call(
      leadsRouter as AnyRouter,
      WS_A,
      OWNER_A,
      `/api/leads/${leadId}/fee`,
      undefined,
      'GET',
    );
    expect(fee.body.data.priceUsd).toBe(45);

    const booked = await deliver(WS_A, OWNER_A, leadId);
    expect(booked.body.delivered).toBe(true);
    const charges = paymentIntentCalls();
    expect(charges).toHaveLength(1);
    expect(charges[0]?.body.get('amount')).toBe('4500');
    expect(meterRows(leadId)[0]?.price_usd).toBe(45);
  });

  it('FR-1.2: no charge on a manual accept', async () => {
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    const res = await call(
      leadsRouter as AnyRouter,
      WS_A,
      OWNER_A,
      `/api/leads/${leadId}/accept`,
      {},
    );
    expect(res.status).toBe(200);
    expect(res.body.data.alreadyAccepted).toBe(false);
    expect(res.body.data.meterEvent).toBeNull();
    expect(res.body.data.charge).toBeNull();
    expect(paymentIntentCalls()).toHaveLength(0);
    expect(meterRows()).toHaveLength(0);
  });

  it('FR-1.2: no charge on a pool accept', async () => {
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    sqlite.raw.exec(`
INSERT INTO consent_records (id, workspace_id, lead_id, consumer_phone, consumer_email, fields, purpose, allow_network_reroute, source, consent_text, granted_at, created_at)
VALUES ('grant-ws1', '${WS_A}', '${leadId}', '+19495550101', 'jane1@example.com', '["name","phone","email","job_details"]', 'quote-and-schedule', 1, 'public_form', 'form text', '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z');
`);
    const offered = await call(
      poolRouter as AnyRouter,
      WS_A,
      OWNER_A,
      '/api/pool/offers',
      { leadId, toWorkspaceId: WS_B },
    );
    expect(offered.status).toBe(201);
    const offerId = offered.body.data.offerId as string;

    const accepted = await call(
      poolRouter as AnyRouter,
      WS_B,
      OWNER_B,
      `/api/pool/offers/${offerId}/accept`,
      {},
    );
    expect(accepted.status).toBe(200);
    // The transfer happened — the lead is shop B's now — but a pool
    // accept creates no job, no slot and no booking, so no fee. (The
    // receiver's booking of a transferred lead is pinned at the meter
    // layer below and in lead-meter.spec.ts: deliverLead currently
    // refuses already-accepted leads, which pool accept stamps — the
    // receiver booking path is a WS-2 gap, flagged in the WS-1 report.)
    const lead = sqlite.raw
      .prepare('SELECT workspace_id FROM leads WHERE id = ?')
      .get(leadId) as { workspace_id: string };
    expect(lead.workspace_id).toBe(WS_B);
    expect(paymentIntentCalls()).toHaveLength(0);
    expect(meterRows()).toHaveLength(0);
  });

  it('FR-1.2: a booking at a different shop bills that shop', async () => {
    await enroll(WS_A, OWNER_A, 'ev-charger-install');
    await enroll(WS_B, OWNER_B, 'ev-charger-install');
    const leadA = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    const leadB = insertLead(WS_B, OWNER_B, 'ev-charger-install');

    await deliver(WS_A, OWNER_A, leadA);
    await deliver(WS_B, OWNER_B, leadB);

    const charges = paymentIntentCalls();
    expect(charges).toHaveLength(2);
    expect(charges[0]?.body.get('customer')).toBe('cus_a');
    expect(charges[1]?.body.get('customer')).toBe('cus_b');
    expect(meterRows(leadA)[0]?.workspace_id).toBe(WS_A);
    expect(meterRows(leadB)[0]?.workspace_id).toBe(WS_B);
    // The (lead, workspace) keying that lets an eject-and-rebook at a
    // different shop bill that shop — while a same-shop rebook no-ops —
    // is pinned against the real constraint in lead-meter.spec.ts.
  });

  it('FR-1.2: no charge on a pre-booking exit (withdraw before booking)', async () => {
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    const res = await call(
      leadsRouter as AnyRouter,
      WS_A,
      OWNER_A,
      `/api/leads/${leadId}/withdraw`,
      {},
    );
    expect(res.status).toBe(200);
    expect(paymentIntentCalls()).toHaveLength(0);
    expect(meterRows()).toHaveLength(0);
  });

  it('FR-1.2: reschedule, re-delivery and undo never create a second charge — and undo leaves the fee standing (FR-1.4)', async () => {
    await enroll(WS_A, OWNER_A, 'ev-charger-install');
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    const booked = await deliver(WS_A, OWNER_A, leadId);
    expect(booked.body.delivered).toBe(true);
    expect(paymentIntentCalls()).toHaveLength(1);

    // Reschedule: the job PATCH moves the booking through the lane
    // guard. One booking, one fee, however many times it moves.
    const start = new Date(booked.body.slotStart as string);
    const end = new Date(booked.body.slotEnd as string);
    const shifted = (d: Date) =>
      new Date(d.getTime() + 7 * 24 * 3_600_000).toISOString();
    const moved = await call(
      jobsRouter as AnyRouter,
      WS_A,
      OWNER_A,
      `/api/jobs/${booked.body.jobId}`,
      { scheduledStart: shifted(start), scheduledEnd: shifted(end) },
      'PATCH',
    );
    expect(moved.status).toBe(200);
    expect(paymentIntentCalls()).toHaveLength(1);
    expect(meterRows(leadId)).toHaveLength(1);

    // A second delivery attempt conflicts — a same-shop rebook cannot
    // bill twice, and the pending-fee collector finds nothing to do.
    const again = await deliver(WS_A, OWNER_A, leadId);
    expect(again.status).toBe(409);
    const collect = await chargePendingLeadFees(env(), WS_A);
    expect(collect).toEqual({ attempted: 0, paid: 0, stillPending: 0 });
    expect(paymentIntentCalls()).toHaveLength(1);
    expect(meterRows(leadId)).toHaveLength(1);

    // Undo cancels the booking; the collected fee stands.
    const undone = await call(
      leadsRouter as AnyRouter,
      WS_A,
      OWNER_A,
      `/api/leads/${leadId}/delivery/undo`,
      {},
    );
    expect(undone.status).toBe(200);
    expect(paymentIntentCalls()).toHaveLength(1);
    expect(refundCalls()).toHaveLength(0);
    expect(meterRows(leadId)[0]?.status).toBe('invoiced');
  });

  it('FR-1.3: a priority booking bills 50% of the resolved rate and is marked priority', async () => {
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    // No rescue flow exists yet (WS-3) — this is the meter-layer
    // capability the rescue booking will call, driven end to end
    // through the real charge path.
    const meter = await recordLeadMeter(env(), {
      workspaceId: WS_A,
      leadId,
      serviceType: 'ev-charger-install',
      jobId: 'job-priority',
      deliveryId: 'delivery-priority',
      priority: true,
    });
    expect(meter.inserted).toBe(true);
    expect(meter.priceUsd).toBe(30);

    const charged = await chargeBookedLeadFee(env(), meter.id);
    expect(charged.outcome).toBe('paid');
    const charges = paymentIntentCalls();
    expect(charges).toHaveLength(1);
    expect(charges[0]?.body.get('amount')).toBe('3000');
    expect(meterRows(leadId)[0]).toMatchObject({
      price_usd: 30,
      priority: 1,
      status: 'invoiced',
      job_id: 'job-priority',
      delivery_id: 'delivery-priority',
    });
  });
});

describe('FR-1.4: refunds — fraud and platform fault only', () => {
  async function bookedAndPaid(): Promise<{ leadId: string; eventId: string }> {
    await enroll(WS_A, OWNER_A, 'ev-charger-install');
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    const booked = await deliver(WS_A, OWNER_A, leadId);
    expect(booked.body.delivered).toBe(true);
    const row = meterRows(leadId)[0];
    expect(row?.status).toBe('invoiced');
    return { leadId, eventId: row!.id };
  }

  it('a proven-fraud refund goes through Stripe and records the reason', async () => {
    const { leadId, eventId } = await bookedAndPaid();
    const result = await refundLeadFee(env(), eventId, 'fraud');
    expect(result).toMatchObject({
      status: 'refunded',
      reason: 'fraud',
      stripeRefundId: 're_1',
    });
    expect(refundCalls()).toHaveLength(1);
    expect(refundCalls()[0]?.body.get('payment_intent')).toBe('pi_1');
    expect(meterRows(leadId)[0]).toMatchObject({
      status: 'refunded',
      refund_reason: 'fraud',
    });
  });

  it('any other reason is rejected loudly and nothing moves', async () => {
    const { leadId, eventId } = await bookedAndPaid();
    await expect(
      refundLeadFee(
        env(),
        eventId,
        'customer_cancelled' as LeadFeeRefundReason,
      ),
    ).rejects.toBeInstanceOf(LeadFeeRefundError);
    await expect(
      refundLeadFee(env(), eventId, '' as LeadFeeRefundReason),
    ).rejects.toMatchObject({ code: 'INVALID_REFUND_REASON' });
    expect(refundCalls()).toHaveLength(0);
    expect(meterRows(leadId)[0]).toMatchObject({
      status: 'invoiced',
      refund_reason: null,
    });
  });

  it('a platform-fault refund of a still-pending fee collects nothing and calls no refund', async () => {
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    const meter = await recordLeadMeter(env(), {
      workspaceId: WS_A,
      leadId,
      serviceType: 'ev-charger-install',
    });
    const result = await refundLeadFee(env(), meter.id, 'platform_fault');
    expect(result.stripeRefundId).toBeNull();
    expect(refundCalls()).toHaveLength(0);
    expect(paymentIntentCalls()).toHaveLength(0);
    expect(meterRows(leadId)[0]).toMatchObject({
      status: 'refunded',
      refund_reason: 'platform_fault',
    });

    // And a refunded fee cannot be refunded (or charged) again.
    await expect(refundLeadFee(env(), meter.id, 'fraud')).rejects.toMatchObject(
      { code: 'NOT_REFUNDABLE' },
    );
    const collect = await chargePendingLeadFees(env(), WS_A);
    expect(collect.attempted).toBe(0);
  });
});

describe('FR-1.6: signed-webhook fixtures', () => {
  function sign(payload: string): string {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${t}.${payload}`)
      .digest('hex');
    return `t=${t},v1=${v1}`;
  }

  function seedProcessingFee(): string {
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events
           (id, workspace_id, lead_id, vertical, service_type, price_usd, status,
            stripe_payment_intent_id, payment_status, created_at)
         VALUES (?, ?, ?, 'ev_charger', 'ev-charger-install', 60, 'pending', 'pi_hook', 'processing', ?)`,
      )
      .run(eventId, WS_A, leadId, now);
    return eventId;
  }

  async function postWebhook(
    payload: string,
    signature: string,
  ): Promise<Response> {
    return paymentsRouter.fetch(
      new Request('https://api.greenput.com/api/payments/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: payload,
      }),
      env(),
    );
  }

  it('a validly signed fee event processes', async () => {
    const eventId = seedProcessingFee();
    const payload = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_hook',
          metadata: { kind: 'lead_fee', meter_event_id: eventId },
        },
      },
    });
    const res = await postWebhook(payload, sign(payload));
    expect(res.status).toBe(200);
    const row = meterRows()[0];
    expect(row).toMatchObject({ status: 'invoiced', payment_status: 'paid' });
  });

  it('a tampered signature is rejected and nothing processes', async () => {
    const eventId = seedProcessingFee();
    const payload = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_hook',
          metadata: { kind: 'lead_fee', meter_event_id: eventId },
        },
      },
    });
    // Sign one payload, send another: the signature no longer matches.
    const tampered = payload.replace('pi_hook', 'pi_evil');
    const res = await postWebhook(tampered, sign(payload));
    expect(res.status).toBe(401);
    const row = meterRows()[0];
    expect(row).toMatchObject({
      status: 'pending',
      payment_status: 'processing',
    });
  });
});

describe('the public demo workspace (slug demo) is never billed', () => {
  const WS_D = '00000000-0000-4000-8000-0000000000d1';
  const OWNER_D = '00000000-0000-4000-8000-0000000000d2';

  beforeEach(() => {
    sqlite.raw.exec(shopSql(WS_D, OWNER_D, 'demo', 'cus_unused'));
    sqlite.raw.exec(
      `UPDATE workspaces SET stripe_customer_id = NULL WHERE id = '${WS_D}'`,
    );
  });

  it('/deliver books a demo lead with no card on file, records no fee and calls Stripe for nothing', async () => {
    await enroll(WS_D, OWNER_D, 'ev-charger-install');
    const leadId = insertLead(WS_D, OWNER_D, 'ev-charger-install');
    const booked = await deliver(WS_D, OWNER_D, leadId);
    expect(booked.status).toBe(200);
    expect(booked.body.delivered).toBe(true);
    expect(meterRows()).toHaveLength(0);
    expect(stripeCalls).toHaveLength(0);
  });

  it('recordLeadMeter writes no row for the demo workspace', async () => {
    const leadId = insertLead(WS_D, OWNER_D, 'ev-charger-install');
    const meter = await recordLeadMeter(env(), {
      workspaceId: WS_D,
      leadId,
      serviceType: 'ev-charger-install',
    });
    expect(meter.inserted).toBe(false);
    expect(meterRows()).toHaveLength(0);
  });

  it('a pending demo fee row is never charged — not by the collector, not by a booked-fee charge', async () => {
    const leadId = insertLead(WS_D, OWNER_D, 'ev-charger-install');
    sqlite.raw.exec(`
      UPDATE workspaces SET stripe_customer_id = 'cus_a' WHERE id = '${WS_D}';
      INSERT INTO lead_meter_events (id, workspace_id, lead_id, vertical, service_type, price_usd, status)
        VALUES ('m-demo', '${WS_D}', '${leadId}', 'ev_charger', 'ev-charger-install', 60, 'pending');
    `);
    const charged = await chargeBookedLeadFee(env(), 'm-demo');
    expect(charged.outcome).toBe('demo_exempt');
    const collect = await chargePendingLeadFees(env(), WS_D);
    expect(collect.paid).toBe(0);
    expect(paymentIntentCalls()).toHaveLength(0);
    expect(stripeCalls).toHaveLength(0);
    expect(meterRows(leadId)[0]).toMatchObject({
      status: 'pending',
      payment_status: null,
    });
  });

  it('a non-demo shop with no card on file is still refused (CARD_REQUIRED)', async () => {
    sqlite.raw.exec(
      `UPDATE workspaces SET stripe_customer_id = NULL WHERE id = '${WS_A}'`,
    );
    await enroll(WS_A, OWNER_A, 'ev-charger-install');
    const leadId = insertLead(WS_A, OWNER_A, 'ev-charger-install');
    const res = await deliver(WS_A, OWNER_A, leadId);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('CARD_REQUIRED');
    expect(meterRows()).toHaveLength(0);
  });
});
