import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { billingRouter } from '../routes/billing';
import { twilioSmsWebhookRouter } from '../routes/twilio-sms';
import {
  assertCanReceiveLeads,
  DELIVERY_PAUSED_MESSAGE,
} from './lead-billing-gate';
import {
  reconcileSmsPrice,
  reconcileUsageTopUp,
  sendContractorSms,
  smsSegmentCount,
  TWILIO_US_SMS_SEGMENT_MICRO_USD,
} from './usage-balance';

const SCHEMA = resolve(__dirname, '../../../../schema.sql');
const CALLBACK = 'https://api.greenput.com/api/webhooks/twilio/sms';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('prepaid SMS balance', () => {
  let sqlite: SqliteD1;
  const urls: string[] = [];

  function env(overrides: Partial<Env> = {}): Env {
    return {
      DB: sqlite.db,
      ENVIRONMENT: 'test',
      ...overrides,
    } as Env;
  }

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA] });
    urls.length = 0;
    smsSid = 0;
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function seed(balance = 0, customer: string | null = 'cus_test'): string {
    const id = crypto.randomUUID();
    sqlite.raw
      .prepare(
        `INSERT INTO workspaces (id, name, slug, email, stripe_customer_id, usage_balance_micro_usd)
         VALUES (?, 'Shop', ?, ?, ?, ?)`,
      )
      .run(
        id,
        `shop-${id.slice(0, 8)}`,
        `${id}@example.com`,
        customer,
        balance,
      );
    return id;
  }

  function balanceOf(id: string): number {
    const row = sqlite.raw
      .prepare(
        'SELECT usage_balance_micro_usd AS n FROM workspaces WHERE id = ?',
      )
      .get(id) as { n: number };
    return Number(row.n);
  }

  function ledger(id: string): Array<Record<string, unknown>> {
    return sqlite.raw
      .prepare(
        `SELECT kind, amount_micro_usd, payment_status, twilio_message_sid
           FROM workspace_usage_ledger WHERE workspace_id = ? ORDER BY created_at`,
      )
      .all(id) as Array<Record<string, unknown>>;
  }

  let smsSid = 0;

  function stubFetch(opts?: {
    twilioStatus?: number;
    piStatus?: string;
    decline?: boolean;
  }): void {
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        urls.push(`${method} ${url}`);
        if (url.includes('api.twilio.com')) {
          if ((opts?.twilioStatus ?? 201) >= 400) {
            return new Response('no', { status: opts?.twilioStatus ?? 500 });
          }
          smsSid += 1;
          return new Response(JSON.stringify({ sid: `SM_test_${smsSid}` }), {
            status: 201,
          });
        }
        if (url.includes('/payment_intents') && method === 'POST') {
          if (opts?.decline) {
            return jsonResponse(
              {
                error: {
                  message: 'Your card was declined.',
                  code: 'card_declined',
                  payment_intent: { id: 'pi_declined' },
                },
              },
              402,
            );
          }
          return jsonResponse({
            id: 'pi_topup',
            status: opts?.piStatus ?? 'succeeded',
            amount: 1000,
            currency: 'usd',
            client_secret: 'cs_test',
          });
        }
        if (url.includes('/customers/') && url.includes('payment_methods')) {
          return jsonResponse({ data: [{ id: 'pm_card' }] });
        }
        if (url.includes('/customers/')) {
          return jsonResponse({
            id: 'cus_test',
            invoice_settings: { default_payment_method: 'pm_card' },
          });
        }
        throw new Error(`unhandled ${method} ${url}`);
      },
    );
  }

  const twilioEnv = {
    TWILIO_ACCOUNT_SID: 'AC_TEST',
    TWILIO_AUTH_TOKEN: 'token',
    TWILIO_FROM_NUMBER: '+15550001111',
  };

  it('counts GSM-7 and UCS-2 segments, with extension characters as two', () => {
    expect(smsSegmentCount('')).toBe(1);
    expect(smsSegmentCount('a'.repeat(160))).toBe(1);
    expect(smsSegmentCount('a'.repeat(161))).toBe(2);
    expect(smsSegmentCount('{'.repeat(80))).toBe(1);
    expect(smsSegmentCount('{'.repeat(81))).toBe(2);
    expect(smsSegmentCount('😀')).toBe(1);
    expect(smsSegmentCount(`😀${'a'.repeat(69)}`)).toBe(2);
  });

  it('does not debit, top up, or block when Stripe is not configured', async () => {
    const id = seed(0, null);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = await sendContractorSms(env(), {
      workspaceId: id,
      to: '+15551110000',
      body: 'Hello',
    });
    expect(result).toEqual({ ok: true, sid: null });
    expect(balanceOf(id)).toBe(0);
    expect(ledger(id)).toEqual([]);
    expect(log).toHaveBeenCalled();
    expect(await assertCanReceiveLeads(env(), id)).toEqual({ ok: true });
  });

  it('does not top up or debit when Stripe is configured and Twilio is not', async () => {
    const id = seed(0);
    stubFetch();
    const result = await sendContractorSms(
      env({
        STRIPE_SECRET_KEY: 'sk_test',
        TWILIO_ACCOUNT_SID: 'AC_TEST',
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_FROM_NUMBER: '',
      }),
      { workspaceId: id, to: '+15551110000', body: 'Hello' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'SEND_FAILED',
      error: 'SMS is not configured.',
    });
    expect(balanceOf(id)).toBe(0);
    expect(ledger(id)).toEqual([]);
    expect(urls).toEqual([]);
  });

  it('debits the list price and does not top up while the balance stays above the threshold', async () => {
    const id = seed(5_000_000);
    stubFetch();
    const result = await sendContractorSms(
      env({ STRIPE_SECRET_KEY: 'sk_test', ...twilioEnv }),
      { workspaceId: id, to: '+15551110000', body: 'Hello' },
    );
    expect(result).toEqual({ ok: true, sid: 'SM_test_1' });
    expect(balanceOf(id)).toBe(5_000_000 - TWILIO_US_SMS_SEGMENT_MICRO_USD);
    expect(ledger(id)).toEqual([
      {
        kind: 'sms_estimate',
        amount_micro_usd: -TWILIO_US_SMS_SEGMENT_MICRO_USD,
        payment_status: null,
        twilio_message_sid: 'SM_test_1',
      },
    ]);
    expect(urls.some((url) => url.includes('payment_intents'))).toBe(false);
  });

  it('tops up once, then a second send does not charge again', async () => {
    const id = seed(0);
    stubFetch();
    const stripe = env({ STRIPE_SECRET_KEY: 'sk_test', ...twilioEnv });
    const first = await sendContractorSms(stripe, {
      workspaceId: id,
      to: '+15551110000',
      body: 'Hello',
    });
    const second = await sendContractorSms(stripe, {
      workspaceId: id,
      to: '+15551110000',
      body: 'Hello',
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(balanceOf(id)).toBe(
      1_000 * 10_000 - 2 * TWILIO_US_SMS_SEGMENT_MICRO_USD,
    );
    const charges = urls.filter(
      (url) => url.startsWith('POST') && url.includes('/payment_intents'),
    );
    expect(charges).toHaveLength(1);
    const topups = ledger(id).filter((row) => row['kind'] === 'topup');
    expect(topups).toEqual([
      {
        kind: 'topup',
        amount_micro_usd: 1_000 * 10_000,
        payment_status: 'paid',
        twilio_message_sid: null,
      },
    ]);
  });

  it('a declined top-up blocks SMS and pauses lead delivery, and is not charged twice', async () => {
    const id = seed(0);
    stubFetch({ decline: true });
    const stripe = env({ STRIPE_SECRET_KEY: 'sk_test', ...twilioEnv });
    const first = await sendContractorSms(stripe, {
      workspaceId: id,
      to: '+15551110000',
      body: 'Hello',
    });
    expect(first).toEqual({ ok: false, reason: 'USAGE_EXHAUSTED' });
    expect(balanceOf(id)).toBe(0);
    expect(ledger(id).some((row) => row['kind'] === 'sms_estimate')).toBe(
      false,
    );
    expect(ledger(id)).toContainEqual(
      expect.objectContaining({ kind: 'topup', payment_status: 'failed' }),
    );
    const paused = await assertCanReceiveLeads(env(), id);
    expect(paused).toEqual({
      ok: false,
      code: 'DELIVERY_PAUSED',
      message: DELIVERY_PAUSED_MESSAGE,
    });
    const callsBefore = urls.filter((url) =>
      url.includes('/payment_intents'),
    ).length;
    const second = await sendContractorSms(stripe, {
      workspaceId: id,
      to: '+15551110000',
      body: 'Hello',
    });
    expect(second).toEqual({ ok: false, reason: 'USAGE_EXHAUSTED' });
    expect(urls.filter((url) => url.includes('/payment_intents')).length).toBe(
      callsBefore,
    );
  });

  it('reconciles the reserve to Twilio’s price, and a second callback is a no-op', async () => {
    const id = seed(5_000_000);
    stubFetch();
    const sent = await sendContractorSms(
      env({ STRIPE_SECRET_KEY: 'sk_test', ...twilioEnv }),
      { workspaceId: id, to: '+15551110000', body: 'Hello' },
    );
    expect(sent.ok).toBe(true);
    const sid = sent.ok ? sent.sid : null;
    const before = balanceOf(id);
    expect(
      await reconcileSmsPrice(env(), {
        messageSid: sid ?? '',
        price: '-0.00750',
        priceUnit: 'USD',
      }),
    ).toBe('reconciled');
    const adjusted = before + (TWILIO_US_SMS_SEGMENT_MICRO_USD - 7500);
    expect(balanceOf(id)).toBe(adjusted);
    expect(
      await reconcileSmsPrice(env(), {
        messageSid: sid ?? '',
        price: '-0.00750',
        priceUnit: 'USD',
      }),
    ).toBe('noop');
    expect(balanceOf(id)).toBe(adjusted);
  });

  it('credits the reserve back when Twilio rejects the send', async () => {
    const id = seed(5_000_000);
    stubFetch({ twilioStatus: 500 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await sendContractorSms(
      env({ STRIPE_SECRET_KEY: 'sk_test', ...twilioEnv }),
      { workspaceId: id, to: '+15551110000', body: 'Hello' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SEND_FAILED');
    expect(balanceOf(id)).toBe(5_000_000);
    const kinds = ledger(id).map((row) => row['kind']);
    expect(kinds).toEqual(['sms_estimate', 'sms_reversal']);
  });

  it('rejects a bad Twilio signature and reconciles a good one', async () => {
    const id = seed(5_000_000);
    stubFetch();
    const sent = await sendContractorSms(
      env({
        STRIPE_SECRET_KEY: 'sk_test',
        ENVIRONMENT: 'production',
        ...twilioEnv,
      }),
      { workspaceId: id, to: '+15551110000', body: 'Hello' },
    );
    expect(sent.ok).toBe(true);
    const sid = sent.ok ? (sent.sid ?? '') : '';
    const twilioCall = urls.find((url) => url.includes('api.twilio.com'));
    expect(twilioCall).toBeDefined();
    const params = new URLSearchParams({
      MessageSid: sid,
      MessageStatus: 'delivered',
      Price: '-0.00750',
      PriceUnit: 'USD',
    });
    const token = 'token';
    const bad = await twilioSmsWebhookRouter.fetch(
      new Request(CALLBACK, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'not-a-signature',
        },
        body: params.toString(),
      }),
      env({ TWILIO_AUTH_TOKEN: token, ENVIRONMENT: 'production' }),
    );
    expect(bad.status).toBe(403);
    expect(balanceOf(id)).toBe(5_000_000 - TWILIO_US_SMS_SEGMENT_MICRO_USD);

    const good = await twilioSmsWebhookRouter.fetch(
      new Request(CALLBACK, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': signTwilio(CALLBACK, params, token),
        },
        body: params.toString(),
      }),
      env({ TWILIO_AUTH_TOKEN: token, ENVIRONMENT: 'production' }),
    );
    expect(good.status).toBe(200);
    expect(balanceOf(id)).toBe(
      5_000_000 -
        TWILIO_US_SMS_SEGMENT_MICRO_USD +
        (TWILIO_US_SMS_SEGMENT_MICRO_USD - 7500),
    );
  });

  it('does not credit a top-up twice when the webhook repeats the success', async () => {
    const id = seed(0);
    stubFetch();
    await sendContractorSms(
      env({ STRIPE_SECRET_KEY: 'sk_test', ...twilioEnv }),
      { workspaceId: id, to: '+15551110000', body: 'Hello' },
    );
    const afterSend = balanceOf(id);
    const row = sqlite.raw
      .prepare(
        `SELECT id FROM workspace_usage_ledger
          WHERE workspace_id = ? AND kind = 'topup'`,
      )
      .get(id) as { id: string };
    await reconcileUsageTopUp(env(), 'succeeded', {
      id: 'pi_topup',
      amount: 1000,
      metadata: { kind: 'usage_topup', ledger_id: row.id },
    });
    expect(balanceOf(id)).toBe(afterSend);
    await reconcileUsageTopUp(env(), 'succeeded', {
      id: 'pi_job',
      amount: 5000,
      metadata: { kind: 'lead_fee', meter_event_id: 'nope' },
    });
    expect(balanceOf(id)).toBe(afterSend);
  });

  it('GET /usage does not charge, and PATCH rejects a threshold the top-up cannot clear', async () => {
    const id = seed(1234, null);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.raw
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
         VALUES (?, ?, 'A', 'B', ?, 'owner', '', ?, ?)`,
      )
      .run(userId, id, `${userId}@example.com`, now, now);
    vi.stubGlobal('fetch', () => {
      throw new Error('GET must not call Stripe');
    });

    const got = await billingRouter.fetch(
      authed(
        new Request('https://api.greenput.com/api/billing/usage'),
        id,
        userId,
      ),
      env(),
    );
    expect(got.status).toBe(200);
    const body = (await got.json()) as {
      data: {
        balanceMicroUsd: number;
        topupCents: number;
        thresholdCents: number;
      };
    };
    expect(body.data.balanceMicroUsd).toBe(1234);
    expect(body.data.topupCents).toBe(1000);
    expect(body.data.thresholdCents).toBe(200);

    const bad = await billingRouter.fetch(
      authed(
        new Request('https://api.greenput.com/api/billing/usage', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topupCents: 1000, thresholdCents: 1000 }),
        }),
        id,
        userId,
      ),
      env(),
    );
    expect(bad.status).toBe(400);

    const ok = await billingRouter.fetch(
      authed(
        new Request('https://api.greenput.com/api/billing/usage', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topupCents: 2000, thresholdCents: 500 }),
        }),
        id,
        userId,
      ),
      env(),
    );
    expect(ok.status).toBe(200);
    const saved = sqlite.raw
      .prepare(
        'SELECT usage_topup_cents AS topup, usage_topup_threshold_cents AS threshold FROM workspaces WHERE id = ?',
      )
      .get(id) as { topup: number; threshold: number };
    expect(saved).toEqual({ topup: 2000, threshold: 500 });
  });
});

function authed(req: Request, workspaceId: string, userId: string): Request {
  const mutable = req as unknown as Record<string, unknown>;
  mutable['workspaceId'] = workspaceId;
  mutable['user'] = { id: userId, role: 'owner' };
  return req;
}

function signTwilio(
  url: string,
  params: URLSearchParams,
  token: string,
): string {
  const keys = [...new Set(params.keys())].sort();
  let data = url;
  for (const key of keys) {
    for (const value of params.getAll(key)) data += key + value;
  }
  return createHmac('sha1', token).update(data).digest('base64');
}
