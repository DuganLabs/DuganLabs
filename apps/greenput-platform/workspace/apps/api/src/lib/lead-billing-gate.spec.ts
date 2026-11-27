import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { paymentsRouter } from '../routes/payments';
import { leadsRouter } from '../routes/leads';
import {
  assertCanReceiveLeads,
  CARD_REQUIRED_MESSAGE,
  DELIVERY_PAUSED_MESSAGE,
  leadReceiveReadiness,
} from './lead-billing-gate';

const SCHEMA = resolve(__dirname, '../../../../schema.sql');
const WEBHOOK_SECRET = 'whsec_test_gate';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('assertCanReceiveLeads', () => {
  let sqlite: SqliteD1;
  const calls: string[] = [];

  function env(stripe = false): Env {
    return {
      DB: sqlite.db,
      STRIPE_SECRET_KEY: stripe ? 'sk_test_gate' : undefined,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    } as Env;
  }

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA] });
    calls.length = 0;
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  function seedWorkspace(customerId: string | null = null): string {
    const id = crypto.randomUUID();
    sqlite.raw
      .prepare(
        `INSERT INTO workspaces (id, name, slug, email, stripe_customer_id)
         VALUES (?, 'Shop', ?, ?, ?)`,
      )
      .run(id, `shop-${id.slice(0, 8)}`, `${id}@example.com`, customerId);
    return id;
  }

  function insertFee(
    workspaceId: string,
    paymentStatus: string,
    status = 'pending',
  ): void {
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    sqlite.raw
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
         VALUES (?, ?, 'A', 'B', ?, 'owner', '', ?, ?)`,
      )
      .run(userId, workspaceId, `${userId}@example.com`, now, now);
    const leadId = crypto.randomUUID();
    sqlite.raw
      .prepare(
        `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, service_type, created_at, updated_at, created_by)
         VALUES (?, ?, 'Ada', 'Home', 'accepted', 'manual', 'electrical', ?, ?, ?)`,
      )
      .run(leadId, workspaceId, now, now, userId);
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events
           (id, workspace_id, lead_id, vertical, service_type, price_usd, status, payment_status, created_at)
         VALUES (?, ?, ?, 'electrical', 'electrical', 35, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        workspaceId,
        leadId,
        status,
        paymentStatus,
        now,
      );
  }

  function stubStripe(opts?: {
    defaultPm?: string | null;
    card?: string | null;
    throwOnGet?: boolean;
  }): void {
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push(`${method} ${url}`);
        if (opts?.throwOnGet) {
          return jsonResponse({ error: { message: 'down' } }, 500);
        }
        if (
          method === 'GET' &&
          /\/customers\/cus_/.test(url) &&
          !url.includes('/payment_methods')
        ) {
          return jsonResponse({
            id: 'cus_shop',
            invoice_settings: {
              default_payment_method: opts?.defaultPm ?? null,
            },
          });
        }
        if (method === 'GET' && url.includes('/payment_methods')) {
          const card = opts?.card;
          return jsonResponse({
            data: card ? [{ id: card }] : [],
          });
        }
        return jsonResponse({ id: 'unused' });
      },
    );
  }

  it('allows a receive when Stripe is not configured and nothing is outstanding', async () => {
    const id = seedWorkspace();
    expect(await assertCanReceiveLeads(env(false), id)).toEqual({ ok: true });
    const ready = await leadReceiveReadiness(env(false), id);
    expect(ready).toEqual({
      billingConfigured: false,
      cardOnFile: null,
      deliveryPaused: false,
      message: null,
    });
  });

  it('does not treat an unconfigured or below-minimum fee as outstanding', async () => {
    const id = seedWorkspace();
    insertFee(id, 'unconfigured');
    insertFee(id, 'below_minimum');
    insertFee(id, 'no_payment_method');
    expect(await assertCanReceiveLeads(env(false), id)).toEqual({ ok: true });
  });

  it('pauses while a charge is failed or processing, even with no Stripe key', async () => {
    const failed = seedWorkspace();
    insertFee(failed, 'failed');
    expect(await assertCanReceiveLeads(env(false), failed)).toEqual({
      ok: false,
      code: 'DELIVERY_PAUSED',
      message: DELIVERY_PAUSED_MESSAGE,
    });

    const processing = seedWorkspace();
    insertFee(processing, 'processing');
    const ready = await leadReceiveReadiness(env(false), processing);
    expect(ready.deliveryPaused).toBe(true);
    expect(ready.message).toBe(DELIVERY_PAUSED_MESSAGE);
  });

  it('lifts the pause once the outstanding row is no longer pending', async () => {
    const id = seedWorkspace();
    insertFee(id, 'failed', 'waived');
    expect(await assertCanReceiveLeads(env(false), id)).toEqual({ ok: true });
  });

  it('requires a saved card when Stripe is configured', async () => {
    const bare = seedWorkspace(null);
    stubStripe();
    expect(await assertCanReceiveLeads(env(true), bare)).toEqual({
      ok: false,
      code: 'CARD_REQUIRED',
      message: CARD_REQUIRED_MESSAGE,
    });
    expect(calls).toHaveLength(0);

    const noCard = seedWorkspace('cus_nocard');
    calls.length = 0;
    stubStripe({ defaultPm: null, card: null });
    expect(await assertCanReceiveLeads(env(true), noCard)).toEqual({
      ok: false,
      code: 'CARD_REQUIRED',
      message: CARD_REQUIRED_MESSAGE,
    });
    const ready = await leadReceiveReadiness(env(true), noCard);
    expect(ready.cardOnFile).toBe(false);
    expect(ready.billingConfigured).toBe(true);
    expect(ready.message).toBe(CARD_REQUIRED_MESSAGE);
  });

  it('accepts a default payment method, or the first saved card', async () => {
    const preferred = seedWorkspace('cus_preferred');
    stubStripe({ defaultPm: 'pm_default' });
    expect(await assertCanReceiveLeads(env(true), preferred)).toEqual({
      ok: true,
    });

    const fallback = seedWorkspace('cus_fallback');
    calls.length = 0;
    stubStripe({ defaultPm: null, card: 'pm_card' });
    expect(await assertCanReceiveLeads(env(true), fallback)).toEqual({
      ok: true,
    });
    expect(calls.some((c) => c.includes('/payment_methods'))).toBe(true);
  });

  it('refuses when Stripe cannot be asked whether a card exists', async () => {
    const id = seedWorkspace('cus_down');
    stubStripe({ throwOnGet: true });
    expect(await assertCanReceiveLeads(env(true), id)).toEqual({
      ok: false,
      code: 'CARD_REQUIRED',
      message: CARD_REQUIRED_MESSAGE,
    });
  });

  it('pauses before it looks up the card', async () => {
    const id = seedWorkspace('cus_paused');
    insertFee(id, 'failed');
    stubStripe({ defaultPm: 'pm_default' });
    expect((await assertCanReceiveLeads(env(true), id)).ok).toBe(false);
    expect(calls).toHaveLength(0);
    const ready = await leadReceiveReadiness(env(true), id);
    expect(ready.deliveryPaused).toBe(true);
    expect(ready.cardOnFile).toBe(true);
    expect(ready.message).toBe(DELIVERY_PAUSED_MESSAGE);
  });
});

describe('accept is gated before any write', () => {
  let sqlite: SqliteD1;

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA] });
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  function seedLead(): { workspaceId: string; leadId: string; userId: string } {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const leadId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.raw
      .prepare(
        `INSERT INTO workspaces (id, name, slug, email) VALUES (?, 'Shop', ?, 'shop@example.com')`,
      )
      .run(workspaceId, `s-${workspaceId.slice(0, 8)}`);
    sqlite.raw
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
         VALUES (?, ?, 'A', 'B', 'a@example.com', 'owner', '', ?, ?)`,
      )
      .run(userId, workspaceId, now, now);
    sqlite.raw
      .prepare(
        `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, service_type, qualified_at, created_at, updated_at, created_by)
         VALUES (?, ?, 'Ada', 'Home', 'qualified', 'manual', 'electrical', ?, ?, ?, ?)`,
      )
      .run(leadId, workspaceId, now, now, now, userId);
    return { workspaceId, leadId, userId };
  }

  async function accept(
    workspaceId: string,
    userId: string,
    leadId: string,
    stripe: boolean,
  ): Promise<Response> {
    const req = new Request(
      `https://api.greenput.com/api/leads/${leadId}/accept`,
      { method: 'POST' },
    );
    (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
    (req as unknown as Record<string, unknown>)['user'] = {
      id: userId,
      role: 'owner',
    };
    return leadsRouter.fetch(req, {
      DB: sqlite.db,
      STRIPE_SECRET_KEY: stripe ? 'sk_test_gate' : undefined,
    } as Env);
  }

  it('refuses accept when Stripe is on and there is no card, and writes nothing', async () => {
    const { workspaceId, leadId, userId } = seedLead();
    const res = await accept(workspaceId, userId, leadId, true);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CARD_REQUIRED');
    const lead = sqlite.raw
      .prepare('SELECT accepted_at FROM leads WHERE id = ?')
      .get(leadId) as { accepted_at: string | null };
    expect(lead.accepted_at).toBeNull();
    const meters = sqlite.raw
      .prepare('SELECT COUNT(*) AS n FROM lead_meter_events')
      .get() as { n: number };
    expect(meters.n).toBe(0);
  });

  it('quotes the block on GET /fee and still quotes the price', async () => {
    const { workspaceId, leadId } = seedLead();
    const req = new Request(`https://api.greenput.com/api/leads/${leadId}/fee`);
    (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
    const res = await leadsRouter.fetch(req, {
      DB: sqlite.db,
      STRIPE_SECRET_KEY: 'sk_test_gate',
    } as Env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        priceUsd: number;
        receive: { ok: boolean; code?: string; message?: string };
      };
    };
    expect(body.data.priceUsd).toBe(35);
    expect(body.data.receive).toEqual({
      ok: false,
      code: 'CARD_REQUIRED',
      message: CARD_REQUIRED_MESSAGE,
    });
    const meters = sqlite.raw
      .prepare('SELECT COUNT(*) AS n FROM lead_meter_events')
      .get() as { n: number };
    expect(meters.n).toBe(0);
  });
});

describe('a card update retries the outstanding fee', () => {
  let sqlite: SqliteD1;

  function sign(payload: string): string {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${t}.${payload}`)
      .digest('hex');
    return `t=${t},v1=${v1}`;
  }

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA] });
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  it('confirms the existing PaymentIntent when a card is attached', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const leadId = crypto.randomUUID();
    const meterId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.raw
      .prepare(
        `INSERT INTO workspaces (id, name, slug, email, stripe_customer_id)
         VALUES (?, 'Shop', 'shop-retry', 'shop@example.com', 'cus_retry')`,
      )
      .run(workspaceId);
    sqlite.raw
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
         VALUES (?, ?, 'A', 'B', 'a@example.com', 'owner', '', ?, ?)`,
      )
      .run(userId, workspaceId, now, now);
    sqlite.raw
      .prepare(
        `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, service_type, created_at, updated_at, created_by)
         VALUES (?, ?, 'Ada', 'Home', 'accepted', 'manual', 'electrical', ?, ?, ?)`,
      )
      .run(leadId, workspaceId, now, now, userId);
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events
           (id, workspace_id, lead_id, vertical, service_type, price_usd, status,
            stripe_payment_intent_id, payment_status, created_at)
         VALUES (?, ?, ?, 'electrical', 'electrical', 35, 'pending', 'pi_owed', 'failed', ?)`,
      )
      .run(meterId, workspaceId, leadId, now);

    const confirms: string[] = [];
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.endsWith('/customers/cus_retry')) {
          return jsonResponse({
            id: 'cus_retry',
            invoice_settings: { default_payment_method: 'pm_new' },
          });
        }
        if (method === 'GET' && url.endsWith('/payment_intents/pi_owed')) {
          return jsonResponse({
            id: 'pi_owed',
            status: 'requires_payment_method',
            amount: 3500,
            currency: 'usd',
          });
        }
        if (
          method === 'POST' &&
          url.endsWith('/payment_intents/pi_owed/confirm')
        ) {
          confirms.push(typeof init?.body === 'string' ? init.body : '');
          return jsonResponse({
            id: 'pi_owed',
            status: 'succeeded',
            amount: 3500,
            currency: 'usd',
          });
        }
        return jsonResponse(
          { error: { message: `unexpected ${method} ${url}` } },
          500,
        );
      },
    );

    const payload = JSON.stringify({
      type: 'payment_method.attached',
      data: { object: { id: 'pm_new', customer: 'cus_retry' } },
    });
    const res = await paymentsRouter.fetch(
      new Request('https://api.greenput.com/api/payments/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': sign(payload),
        },
        body: payload,
      }),
      {
        DB: sqlite.db,
        STRIPE_SECRET_KEY: 'sk_test_gate',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      } as Env,
    );
    expect(res.status).toBe(200);
    expect(confirms[0]).toContain('pm_new');
    const row = sqlite.raw
      .prepare(
        'SELECT status, payment_status FROM lead_meter_events WHERE id = ?',
      )
      .get(meterId) as { status: string; payment_status: string };
    expect(row).toEqual({ status: 'invoiced', payment_status: 'paid' });
    expect(
      (
        await assertCanReceiveLeads(
          { DB: sqlite.db, STRIPE_SECRET_KEY: 'sk_test_gate' } as Env,
          workspaceId,
        )
      ).ok,
    ).toBe(true);
  });
});
