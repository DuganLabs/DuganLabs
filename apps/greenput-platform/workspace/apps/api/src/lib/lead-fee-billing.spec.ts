import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { withdrawLead } from '@greenput/shared/pricing';
import type { Env } from '../env';
import { paymentsRouter } from '../routes/payments';
import { chargeBookedLeadFee, chargePendingLeadFees } from './lead-fee-billing';
import { STRIPE_API_VERSION } from './stripe';

const SCHEMA = resolve(__dirname, '../../../../schema.sql');
const WEBHOOK_SECRET = 'whsec_test_lead_fees';

interface StripeCall {
  url: string;
  method: string;
  body: string;
  idempotencyKey: string | null;
  version: string | null;
}

function signWebhook(payload: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${t}.${payload}`)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('chargeBookedLeadFee', () => {
  let sqlite: SqliteD1;
  const calls: StripeCall[] = [];

  function env(): Env {
    return {
      DB: sqlite.db,
      STRIPE_SECRET_KEY: 'sk_test_lead_fees',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    } as Env;
  }

  function installFetch(opts?: {
    card?: string | null;
    decline?: boolean;
    processing?: boolean;
    confirmSucceeds?: boolean;
    waiveOnCreate?: (eventId: string) => void;
  }): void {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? init.body : '';
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method,
          body,
          idempotencyKey: headers.get('Idempotency-Key'),
          version: headers.get('Stripe-Version'),
        });
        const card = opts?.card === undefined ? 'pm_card' : opts.card;
        if (method === 'GET' && /\/customers\/cus_test$/.test(url)) {
          return jsonResponse({
            id: 'cus_test',
            invoice_settings: {
              default_payment_method: card,
            },
          });
        }
        if (url.includes('/payment_methods')) {
          return jsonResponse({
            data: card ? [{ id: card }] : [],
          });
        }
        if (method === 'GET' && url.includes('/payment_intents/pi_fail')) {
          return jsonResponse({
            id: 'pi_fail',
            status: 'requires_payment_method',
            amount: 100,
            currency: 'usd',
          });
        }
        if (
          method === 'POST' &&
          url.includes('/payment_intents/pi_fail/confirm')
        ) {
          return jsonResponse({
            id: 'pi_fail',
            status:
              opts?.confirmSucceeds === false ? 'requires_action' : 'succeeded',
            amount: 100,
            currency: 'usd',
          });
        }
        if (method === 'POST' && url.endsWith('/payment_intents')) {
          const params = new URLSearchParams(body);
          const eventId = params.get('metadata[meter_event_id]');
          if (eventId) opts?.waiveOnCreate?.(eventId);
          if (opts?.decline) {
            return jsonResponse(
              {
                error: {
                  message: 'Your card was declined.',
                  code: 'card_declined',
                  payment_intent: { id: 'pi_fail' },
                },
              },
              402,
            );
          }
          if (opts?.processing) {
            return jsonResponse({
              id: 'pi_proc',
              status: 'processing',
              amount: 100,
              currency: 'usd',
            });
          }
          return jsonResponse({
            id: 'pi_ok',
            status: 'succeeded',
            amount: 100,
            currency: 'usd',
          });
        }
        return jsonResponse(
          { error: { message: `unexpected ${method} ${url}`, code: 'test' } },
          500,
        );
      },
    );
  }

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA] });
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  function seed(opts?: {
    price?: number;
    status?: string;
    stripeCustomer?: string | null;
    paymentIntent?: string | null;
    paymentStatus?: string | null;
    accepted?: boolean;
  }): { workspaceId: string; eventId: string; leadId: string; userId: string } {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const leadId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.raw
      .prepare(
        `INSERT INTO workspaces (id, name, slug, email, stripe_customer_id)
         VALUES (?, 'Hi Power Electric', 'hi-power', 'pilot@example.com', ?)`,
      )
      .run(
        workspaceId,
        opts?.stripeCustomer === undefined ? 'cus_test' : opts.stripeCustomer,
      );
    sqlite.raw
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
         VALUES (?, ?, 'Sheen', 'Pilot', 'pilot@example.com', 'owner', '', ?, ?)`,
      )
      .run(userId, workspaceId, now, now);
    sqlite.raw
      .prepare(
        `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, service_type, accepted_at, created_at, updated_at, created_by)
         VALUES (?, ?, 'Ada', 'Home', 'accepted', 'manual', 'electrical', ?, ?, ?, ?)`,
      )
      .run(
        leadId,
        workspaceId,
        opts?.accepted === false ? null : now,
        now,
        now,
        userId,
      );
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events
           (id, workspace_id, lead_id, vertical, service_type, price_usd, status,
            stripe_payment_intent_id, payment_status, created_at)
         VALUES (?, ?, ?, 'electrical', 'electrical', ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        workspaceId,
        leadId,
        opts?.price ?? 1,
        opts?.status ?? 'pending',
        opts?.paymentIntent ?? null,
        opts?.paymentStatus ?? null,
        now,
      );
    return { workspaceId, eventId, leadId, userId };
  }

  it('does not call Stripe when the secret is unset and leaves the fee pending', async () => {
    installFetch();
    const { eventId } = seed();
    const bare = { DB: sqlite.db } as Env;
    const result = await chargeBookedLeadFee(bare, eventId);
    expect(result.outcome).toBe('unconfigured');
    expect(calls).toHaveLength(0);
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'pending',
      payment_status: 'unconfigured',
    });
  });

  it('charges $1 off-session once, with no receipt email and no invoice', async () => {
    installFetch();
    const { workspaceId, eventId, leadId } = seed();

    const result = await chargeBookedLeadFee(env(), eventId);

    expect(result).toMatchObject({
      outcome: 'paid',
      status: 'invoiced',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_ok',
    });
    const charge = calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/payment_intents'),
    );
    expect(charge?.version).toBe(STRIPE_API_VERSION);
    expect(charge?.idempotencyKey).toBe(`lead-fee-${eventId}`);
    expect(charge?.body).toContain('amount=100');
    expect(charge?.body).toContain('currency=usd');
    expect(charge?.body).toContain('customer=cus_test');
    expect(charge?.body).toContain('payment_method=pm_card');
    expect(charge?.body).toContain('off_session=true');
    expect(charge?.body).toContain('confirm=true');
    expect(charge?.body).not.toContain('receipt_email');
    expect(charge?.body).not.toContain('send_invoice');
    expect(charge?.body).toContain(
      `metadata%5Bworkspace_id%5D=${encodeURIComponent(workspaceId)}`,
    );
    expect(charge?.body).toContain(
      `metadata%5Blead_id%5D=${encodeURIComponent(leadId)}`,
    );
    expect(charge?.body).toContain(
      `metadata%5Bmeter_event_id%5D=${encodeURIComponent(eventId)}`,
    );
    expect(charge?.body).toContain('metadata%5Bkind%5D=lead_fee');
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'invoiced',
      payment_status: 'paid',
      stripe_payment_intent_id: 'pi_ok',
    });

    calls.length = 0;
    const again = await chargeBookedLeadFee(env(), eventId);
    expect(again.outcome).toBe('skipped_not_pending');
    expect(calls).toHaveLength(0);
  });

  it('leaves the fee pending when the customer has no saved card', async () => {
    installFetch({ card: null });
    const { eventId } = seed();
    const result = await chargeBookedLeadFee(env(), eventId);
    expect(result.outcome).toBe('no_payment_method');
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' && call.url.includes('/payment_intents'),
      ),
    ).toBe(false);
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'pending',
      payment_status: 'no_payment_method',
      stripe_payment_intent_id: null,
    });
  });

  it('records a decline on the pending row and confirms that intent on retry', async () => {
    installFetch({ decline: true });
    const { eventId } = seed();
    const declined = await chargeBookedLeadFee(env(), eventId);
    expect(declined.outcome).toBe('failed');
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'pending',
      payment_status: 'failed',
      stripe_payment_intent_id: 'pi_fail',
    });

    calls.length = 0;
    installFetch({ confirmSucceeds: true });
    const retried = await chargeBookedLeadFee(env(), eventId);
    expect(retried.outcome).toBe('paid');
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' && call.url.endsWith('/payment_intents'),
      ),
    ).toBe(false);
    const confirm = calls.find((call) => call.url.includes('/confirm'));
    expect(confirm?.method).toBe('POST');
    expect(confirm?.idempotencyKey).toBe(`lead-fee-confirm-${eventId}-pm_card`);
    expect(confirm?.body).toContain('off_session=true');
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'invoiced',
      payment_status: 'paid',
      stripe_payment_intent_id: 'pi_fail',
    });
  });

  it('keeps a processing charge pending until the webhook says it succeeded', async () => {
    installFetch({ processing: true });
    const { eventId } = seed();
    const result = await chargeBookedLeadFee(env(), eventId);
    expect(result.outcome).toBe('processing');
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'pending',
      payment_status: 'processing',
      stripe_payment_intent_id: 'pi_proc',
    });
  });

  it('does not call Stripe for a fee under the card minimum', async () => {
    installFetch();
    const { eventId } = seed({ price: 0 });
    const result = await chargeBookedLeadFee(env(), eventId);
    expect(result.outcome).toBe('below_minimum');
    expect(calls).toHaveLength(0);
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'pending',
      payment_status: 'below_minimum',
    });
  });

  it('does not refund when the row is waived as the charge captures', async () => {
    const { eventId } = seed();
    installFetch({
      waiveOnCreate: (id) => {
        sqlite.raw
          .prepare(
            `UPDATE lead_meter_events SET status = 'waived', notes = 'withdrawn' WHERE id = ?`,
          )
          .run(id);
      },
    });
    const result = await chargeBookedLeadFee(env(), eventId);
    expect(result.outcome).toBe('skipped_not_pending');
    expect(result.status).toBe('waived');
    expect(calls.some((call) => call.url.includes('/refunds'))).toBe(false);
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'waived',
      stripe_payment_intent_id: 'pi_ok',
    });
  });

  it('leaves an already-collected fee invoiced when the lead is withdrawn', async () => {
    installFetch();
    const { workspaceId, eventId, leadId, userId } = seed();
    await chargeBookedLeadFee(env(), eventId);
    const outcome = await withdrawLead(sqlite.db, {
      workspaceId,
      leadId,
      now: new Date().toISOString(),
      actorUserId: userId,
      newId: () => crypto.randomUUID(),
    });
    expect(outcome.meterEventAdjustment).toBe('left_unchanged');
    expect(sqlite.rows('lead_meter_events')[0]).toMatchObject({
      status: 'invoiced',
      payment_status: 'paid',
    });
  });

  it('collects a still-pending fee and does not charge it twice', async () => {
    installFetch();
    const { workspaceId } = seed();
    const first = await chargePendingLeadFees(env(), workspaceId);
    expect(first).toEqual({ attempted: 1, paid: 1, stillPending: 0 });
    calls.length = 0;
    const second = await chargePendingLeadFees(env(), workspaceId);
    expect(second).toEqual({ attempted: 0, paid: 0, stillPending: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('lead-fee and subscription webhooks', () => {
  let sqlite: SqliteD1;

  function env(): Env {
    return {
      DB: sqlite.db,
      STRIPE_SECRET_KEY: 'sk_test_lead_fees',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    } as Env;
  }

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA] });
    vi.stubGlobal('fetch', async () =>
      jsonResponse({
        id: 'ch_test',
        receipt_url: 'https://pay.stripe.com/receipts/ch_test',
      }),
    );
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  async function post(event: Record<string, unknown>): Promise<Response> {
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

  function seedLedger(): {
    workspaceId: string;
    pendingId: string;
    waivedId: string;
  } {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.raw
      .prepare(
        `INSERT INTO workspaces (id, name, slug, email, stripe_customer_id)
         VALUES (?, 'Hi Power Electric', 'hi-power', 'pilot@example.com', 'cus_test')`,
      )
      .run(workspaceId);
    sqlite.raw
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
         VALUES (?, ?, 'Sheen', 'Pilot', 'pilot@example.com', 'owner', '', ?, ?)`,
      )
      .run(userId, workspaceId, now, now);

    const pendingLead = crypto.randomUUID();
    const waivedLead = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    const waivedId = crypto.randomUUID();
    for (const leadId of [pendingLead, waivedLead]) {
      sqlite.raw
        .prepare(
          `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, service_type, created_at, updated_at, created_by)
           VALUES (?, ?, 'Ada', 'Home', 'accepted', 'manual', 'electrical', ?, ?, ?)`,
        )
        .run(leadId, workspaceId, now, now, userId);
    }
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events
           (id, workspace_id, lead_id, vertical, service_type, price_usd, status,
            stripe_payment_intent_id, payment_status, created_at)
         VALUES (?, ?, ?, 'electrical', 'electrical', 1, 'pending', 'pi_fee', 'processing', ?)`,
      )
      .run(pendingId, workspaceId, pendingLead, now);
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events
           (id, workspace_id, lead_id, vertical, service_type, price_usd, status,
            stripe_payment_intent_id, payment_status, created_at)
         VALUES (?, ?, ?, 'electrical', 'electrical', 1, 'waived', 'pi_waived', NULL, ?)`,
      )
      .run(waivedId, workspaceId, waivedLead, now);
    sqlite.raw
      .prepare(
        `INSERT INTO subscriptions
           (id, workspace_id, stripe_subscription_id, stripe_customer_id, plan, status,
            current_period_start, current_period_end, created_at, updated_at)
         VALUES (?, ?, 'sub_123', 'cus_test', 'starter', 'active', ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), workspaceId, now, now, now, now);
    sqlite.raw
      .prepare(
        `INSERT INTO payments
           (id, workspace_id, stripe_payment_intent_id, amount, currency, status, created_at, updated_at)
         VALUES (?, ?, 'pi_123', 200, 'usd', 'pending', ?, ?)`,
      )
      .run(crypto.randomUUID(), workspaceId, now, now);
    return { workspaceId, pendingId, waivedId };
  }

  it('marks a pending lead-fee charge paid and does not un-waive', async () => {
    const { pendingId } = seedLedger();
    const paid = await post({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_fee',
          metadata: { kind: 'lead_fee', meter_event_id: pendingId },
        },
      },
    });
    expect(paid.status).toBe(200);
    const pending = sqlite.raw
      .prepare(
        'SELECT status, payment_status FROM lead_meter_events WHERE id = ?',
      )
      .get(pendingId) as { status: string; payment_status: string };
    expect(pending).toEqual({ status: 'invoiced', payment_status: 'paid' });

    const waived = await post({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_waived',
          metadata: { kind: 'lead_fee', meter_event_id: 'ignored' },
        },
      },
    });
    expect(waived.status).toBe(200);
    const waivedRow = sqlite.raw
      .prepare(
        'SELECT status, payment_status FROM lead_meter_events WHERE stripe_payment_intent_id = ?',
      )
      .get('pi_waived') as { status: string; payment_status: string | null };
    expect(waivedRow).toEqual({ status: 'waived', payment_status: null });
  });

  it('records a failed lead-fee charge without invoicing it', async () => {
    const { pendingId } = seedLedger();
    const res = await post({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_fee',
          metadata: { kind: 'lead_fee', meter_event_id: pendingId },
        },
      },
    });
    expect(res.status).toBe(200);
    const row = sqlite.raw
      .prepare(
        'SELECT status, payment_status FROM lead_meter_events WHERE id = ?',
      )
      .get(pendingId) as { status: string; payment_status: string };
    expect(row).toEqual({ status: 'pending', payment_status: 'failed' });
  });

  it('marks a subscription invoice past_due from either API shape and ignores invoice.paid with no subscription', async () => {
    seedLedger();
    const acacia = await post({
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_sub', subscription: 'sub_123' } },
    });
    expect(acacia.status).toBe(200);
    expect(sqlite.rows('subscriptions')[0]).toMatchObject({
      status: 'past_due',
    });

    sqlite.raw
      .prepare(
        `UPDATE subscriptions SET status = 'active' WHERE stripe_subscription_id = 'sub_123'`,
      )
      .run();
    const basil = await post({
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_basil',
          parent: { subscription_details: { subscription: 'sub_123' } },
        },
      },
    });
    expect(basil.status).toBe(200);
    expect(sqlite.rows('subscriptions')[0]).toMatchObject({
      status: 'past_due',
    });

    const paid = await post({
      type: 'invoice.paid',
      data: { object: { id: 'in_plain', metadata: { kind: 'lead_fees' } } },
    });
    expect(paid.status).toBe(200);
    const meter = sqlite.raw
      .prepare(
        `SELECT status FROM lead_meter_events WHERE stripe_payment_intent_id = 'pi_fee'`,
      )
      .get() as { status: string };
    expect(meter.status).toBe('pending');
  });

  it('reads the subscription period from the item when the parent fields are gone', async () => {
    seedLedger();
    const start = 1_700_000_000;
    const end = 1_702_592_000;
    const res = await post({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [{ current_period_start: start, current_period_end: end }],
          },
        },
      },
    });
    expect(res.status).toBe(200);
    const row = sqlite.rows<Record<string, unknown>>('subscriptions')[0];
    expect(row?.['current_period_start']).toBe(
      new Date(start * 1000).toISOString(),
    );
    expect(row?.['current_period_end']).toBe(
      new Date(end * 1000).toISOString(),
    );
  });

  it('stores receipt_url from latest_charge and does not treat a job payment as a lead fee', async () => {
    seedLedger();
    const res = await post({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          latest_charge: 'ch_test',
          payment_method_types: ['card'],
        },
      },
    });
    expect(res.status).toBe(200);
    expect(sqlite.rows('payments')[0]).toMatchObject({
      status: 'succeeded',
      receipt_url: 'https://pay.stripe.com/receipts/ch_test',
    });
    const meter = sqlite.raw
      .prepare(
        `SELECT status, payment_status FROM lead_meter_events WHERE stripe_payment_intent_id = 'pi_fee'`,
      )
      .get() as { status: string; payment_status: string };
    expect(meter).toEqual({ status: 'pending', payment_status: 'processing' });
  });
});
