import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  applyDeposit,
  computeDepositAmountCents,
  createDepositForBooking,
  forfeitDeposit,
  handleDepositWebhookEvent,
  isInsideCancelWindow,
  releaseDeposit,
  splitForfeit,
  type DepositRow,
} from './deposits';

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000e1';
const OWNER = '00000000-0000-4000-8000-0000000000e2';
const LEAD = '00000000-0000-4000-8000-0000000000e3';
const CUSTOMER = '00000000-0000-4000-8000-0000000000e4';
const OPP = '00000000-0000-4000-8000-0000000000e5';
const JOB = '00000000-0000-4000-8000-0000000000e6';
const ACCT = 'acct_test_123';

// ── A fake Stripe API behind the global fetch seam ───────────

interface FakeIntent {
  id: string;
  status: string;
  amount: number;
  client_secret?: string;
  application_fee_amount?: number;
}

class FakeStripe {
  intents = new Map<string, FakeIntent>();
  calls: Array<{ path: string; body: URLSearchParams }> = [];
  failCreate = false;
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

    if (method === 'POST' && path === '/payment_intents') {
      if (this.failCreate) {
        return reply(402, {
          error: {
            message: 'Your card was declined.',
            code: 'card_declined',
          },
        });
      }
      const id = `pi_test_${++this.seq}`;
      const intent: FakeIntent = {
        id,
        status: 'requires_payment_method',
        amount: Number(body.get('amount')),
        client_secret: `${id}_secret_test`,
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

    const captureMatch = /^\/payment_intents\/([^/]+)\/capture$/.exec(path);
    if (method === 'POST' && captureMatch) {
      const intent = this.intents.get(captureMatch[1]!);
      if (!intent) return reply(404, { error: { message: 'No such intent' } });
      const fee = body.get('application_fee_amount');
      if (fee != null) intent.application_fee_amount = Number(fee);
      intent.status = 'succeeded';
      return reply(200, { ...intent, currency: 'usd' });
    }

    const cancelMatch = /^\/payment_intents\/([^/]+)\/cancel$/.exec(path);
    if (method === 'POST' && cancelMatch) {
      const intent = this.intents.get(cancelMatch[1]!);
      if (!intent) return reply(404, { error: { message: 'No such intent' } });
      intent.status = 'canceled';
      return reply(200, { ...intent, currency: 'usd' });
    }

    const getMatch = /^\/payment_intents\/([^/]+)$/.exec(path);
    if (method === 'GET' && getMatch) {
      const intent = this.intents.get(getMatch[1]!);
      if (!intent) return reply(404, { error: { message: 'No such intent' } });
      return reply(200, { ...intent, currency: 'usd' });
    }

    if (method === 'POST' && path === '/refunds') {
      return reply(200, { id: 're_test_1', status: 'succeeded' });
    }

    throw new Error(`unhandled Stripe call in test: ${method} ${path}`);
  };

  callsTo(pathSuffix: string): Array<{ path: string; body: URLSearchParams }> {
    return this.calls.filter((c) => c.path.endsWith(pathSuffix));
  }
}

let stripe: FakeStripe;
let sqlite: SqliteD1;

function seed(feeUsd: number): string {
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
VALUES ('meter-1', '${WS}', '${LEAD}', 'ev_charger', 'ev-charger-install', ${feeUsd}, 'pending', '2026-10-16T09:00:00.000Z');
`;
}

function env(): never {
  return {
    DB: sqlite.db,
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
  } as never;
}

/** A completed quote session for the lead, with its FK parents. */
function quoteSessionSql(low: number, high: number): string {
  return `
INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name)
VALUES ('fsm-1', '${WS}', 'ev-charger-install', 'ev_charger', 'EV Charger Install');
INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
VALUES ('fsmv-1', 'fsm-1', 1, '{}', 'published');
INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc-1', '${WS}', 'Default');
INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
VALUES ('rcv-1', 'rc-1', 1, '{}', 'published');
INSERT INTO pricing_quote_sessions (id, workspace_id, fsm_id, fsm_version_id, rate_card_version_id, lead_id, status, quote_low, quote_high, updated_at)
VALUES ('qs-1', '${WS}', 'fsm-1', 'fsmv-1', 'rcv-1', '${LEAD}', 'completed', ${low}, ${high}, '2026-10-16T08:30:00.000Z');
`;
}

async function depositRow(): Promise<DepositRow | null> {
  return sqlite.db
    .prepare('SELECT * FROM deposits WHERE job_id = ?')
    .bind(JOB)
    .first<DepositRow>();
}

async function createHeldDeposit(feeUsd = 60): Promise<DepositRow> {
  const outcome = await createDepositForBooking(env(), {
    workspaceId: WS,
    jobId: JOB,
  });
  if (!outcome.created) throw new Error('creation failed in test setup');
  // The customer's authorization lands (webhook in production).
  stripe.intents.get(outcome.deposit.stripe_payment_intent_id!)!.status =
    'requires_capture';
  await handleDepositWebhookEvent(env(), {
    type: 'payment_intent.amount_capturable_updated',
    data: {
      object: {
        id: outcome.deposit.stripe_payment_intent_id,
        status: 'requires_capture',
      },
    },
  });
  const row = await depositRow();
  if (!row || row.status !== 'held') throw new Error('deposit not held');
  return row;
}

beforeEach(() => {
  stripe = new FakeStripe();
  vi.stubGlobal('fetch', stripe.handler);
});

afterEach(() => {
  vi.unstubAllGlobals();
  sqlite?.close();
});

describe('computeDepositAmountCents', () => {
  it('pilot: a $1 fee carries a $2 deposit', () => {
    expect(computeDepositAmountCents({ feeUsd: 1 })).toBe(200);
  });

  it('targets 2× the fee when no cap binds', () => {
    expect(
      computeDepositAmountCents({ feeUsd: 35, quoteLowDollars: 5275 }),
    ).toBe(7000);
    expect(computeDepositAmountCents({ feeUsd: 60 })).toBe(12000);
  });

  it('caps at 10% of the quote low end', () => {
    // EV charger at the fixture low-end quote of $1,000 (fee paper §3).
    expect(
      computeDepositAmountCents({ feeUsd: 60, quoteLowDollars: 1000 }),
    ).toBe(10000);
    // Minimum-size circuit job: $285 quote, $35 fee → $28.50.
    expect(
      computeDepositAmountCents({ feeUsd: 35, quoteLowDollars: 285 }),
    ).toBe(2850);
  });

  it('caps at $1,000 when the quote is large', () => {
    expect(
      computeDepositAmountCents({ feeUsd: 600, quoteLowDollars: 20000 }),
    ).toBe(100_000);
  });
});

describe('splitForfeit', () => {
  it('splits the target-size forfeit evenly: fee first, equal rest to the shop', () => {
    expect(splitForfeit({ amountCents: 200, feeCents: 100 })).toEqual({
      feePortionCents: 100,
      shopPortionCents: 100,
      shortfallCents: 0,
    });
    expect(splitForfeit({ amountCents: 12000, feeCents: 6000 })).toEqual({
      feePortionCents: 6000,
      shopPortionCents: 6000,
      shortfallCents: 0,
    });
  });

  it('records the absorbed shortfall when the cap shrank the deposit below the fee', () => {
    // The fee paper's known case: $28.50 deposit against a $35 fee.
    expect(splitForfeit({ amountCents: 2850, feeCents: 3500 })).toEqual({
      feePortionCents: 2850,
      shopPortionCents: 0,
      shortfallCents: 650,
    });
  });
});

describe('isInsideCancelWindow', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');
  it('is inside with 2 hours to go, outside with 72', () => {
    expect(isInsideCancelWindow('2026-10-19T14:00:00.000Z', now)).toBe(true);
    expect(isInsideCancelWindow('2026-10-22T12:00:00.000Z', now)).toBe(false);
  });
  it('is inside once the appointment has passed', () => {
    expect(isInsideCancelWindow('2026-10-19T10:00:00.000Z', now)).toBe(true);
  });
});

describe('createDepositForBooking', () => {
  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(60)],
    });
  });

  it('opens a manual-capture destination charge and records a pending deposit', async () => {
    const outcome = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    expect(outcome.created).toBe(true);
    if (!outcome.created) return;
    expect(outcome.deposit.status).toBe('pending');
    expect(outcome.deposit.amount_cents).toBe(12000);
    expect(outcome.deposit.fee_cents).toBe(6000);
    expect(outcome.deposit.connected_account_id).toBe(ACCT);
    expect(outcome.deposit.confirmed_at).toBe('2026-10-16T09:00:00.000Z');
    expect(outcome.clientSecret).toContain('_secret');

    const create = stripe.callsTo('/payment_intents')[0]!;
    expect(create.body.get('capture_method')).toBe('manual');
    expect(create.body.get('transfer_data[destination]')).toBe(ACCT);
    expect(create.body.get('amount')).toBe('12000');
    expect(create.body.get('metadata[kind]')).toBe('booking_deposit');
  });

  it('sizes from the quote low end when a quote session exists', async () => {
    await sqlite.db.exec(quoteSessionSql(1000, 1275));
    const outcome = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    expect(outcome.created).toBe(true);
    if (!outcome.created) return;
    expect(outcome.deposit.amount_cents).toBe(10000);
    expect(outcome.deposit.quote_low_cents).toBe(100000);
  });

  it('is idempotent per job', async () => {
    const first = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    const second = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    expect(first.created && second.created).toBe(true);
    if (first.created && second.created) {
      expect(second.alreadyExisted).toBe(true);
      expect(second.deposit.id).toBe(first.deposit.id);
    }
    expect(stripe.callsTo('/payment_intents')).toHaveLength(1);
  });

  it('mints a confirmation token at creation and keeps it across a retry', async () => {
    stripe.failCreate = true;
    await createDepositForBooking(env(), { workspaceId: WS, jobId: JOB });
    const failedRow = await depositRow();
    expect(failedRow?.status).toBe('failed');
    expect(failedRow?.confirmation_token).toMatch(/^[a-f0-9-]{36}$/);

    stripe.failCreate = false;
    const retried = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    expect(retried.created).toBe(true);
    const row = await depositRow();
    // A re-issued intent never rotates the row's token.
    expect(row?.confirmation_token).toBe(failedRow?.confirmation_token);
  });

  it('refuses without a Connect account and writes nothing', async () => {
    await sqlite.db
      .prepare('UPDATE workspaces SET stripe_account_id = NULL WHERE id = ?')
      .bind(WS)
      .run();
    const outcome = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    expect(outcome).toEqual({ created: false, reason: 'no_connect_account' });
    expect(await depositRow()).toBeNull();
    expect(stripe.calls).toHaveLength(0);
  });

  it('records a failed row when Stripe declines, and a retry repairs it', async () => {
    stripe.failCreate = true;
    const failed = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    expect(failed).toEqual({ created: false, reason: 'stripe_error' });
    const failedRow = await depositRow();
    expect(failedRow?.status).toBe('failed');
    expect(failedRow?.last_error).toContain('declined');

    stripe.failCreate = false;
    const retried = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    expect(retried.created).toBe(true);
    const row = await depositRow();
    expect(row?.status).toBe('pending');
    expect(row?.id).toBe(failedRow?.id);
    expect(row?.stripe_payment_intent_id).toBeTruthy();
  });
});

describe('webhook reconciliation', () => {
  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(60)],
    });
  });

  it('moves pending → held when the authorization lands, ignores foreign intents', async () => {
    const created = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    if (!created.created) throw new Error('setup failed');
    const pi = created.deposit.stripe_payment_intent_id!;

    const foreign = await handleDepositWebhookEvent(env(), {
      type: 'payment_intent.amount_capturable_updated',
      data: { object: { id: 'pi_someone_else', status: 'requires_capture' } },
    });
    expect(foreign).toBe(false);

    const handled = await handleDepositWebhookEvent(env(), {
      type: 'payment_intent.amount_capturable_updated',
      data: { object: { id: pi, status: 'requires_capture' } },
    });
    expect(handled).toBe(true);
    expect((await depositRow())?.status).toBe('held');
  });

  it('marks a declined authorization failed with the Stripe message', async () => {
    const created = await createDepositForBooking(env(), {
      workspaceId: WS,
      jobId: JOB,
    });
    if (!created.created) throw new Error('setup failed');
    await handleDepositWebhookEvent(env(), {
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: created.deposit.stripe_payment_intent_id,
          status: 'requires_payment_method',
          last_payment_error: { message: 'Your card was declined.' },
        },
      },
    });
    const row = await depositRow();
    expect(row?.status).toBe('failed');
    expect(row?.last_error).toBe('Your card was declined.');
  });

  it('lands an out-of-band voided authorization in refunded', async () => {
    await createHeldDeposit();
    const row = await depositRow();
    await handleDepositWebhookEvent(env(), {
      type: 'payment_intent.canceled',
      data: {
        object: { id: row!.stripe_payment_intent_id, status: 'canceled' },
      },
    });
    const after = await depositRow();
    expect(after?.status).toBe('refunded');
    expect(after?.settle_reason).toBe('authorization_released');
  });
});

describe('settlement', () => {
  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(60)],
    });
  });

  it('release voids the authorization and refunds in full', async () => {
    const held = await createHeldDeposit();
    const outcome = await releaseDeposit(env(), {
      workspaceId: WS,
      jobId: JOB,
      reason: 'shop_cancel',
    });
    expect(outcome.settled).toBe(true);
    expect(outcome.deposit?.status).toBe('refunded');
    expect(outcome.deposit?.fee_portion_cents).toBe(0);
    expect(
      stripe.callsTo(
        `/payment_intents/${held.stripe_payment_intent_id}/cancel`,
      ),
    ).toHaveLength(1);
    // Settling again is a no-op — no second Stripe call.
    const again = await releaseDeposit(env(), {
      workspaceId: WS,
      jobId: JOB,
      reason: 'shop_cancel',
    });
    expect(again.reason).toBe('already_settled');
    expect(
      stripe.callsTo(
        `/payment_intents/${held.stripe_payment_intent_id}/cancel`,
      ),
    ).toHaveLength(1);
  });

  it('release refunds a captured intent with the transfer reversed', async () => {
    const held = await createHeldDeposit();
    stripe.intents.get(held.stripe_payment_intent_id!)!.status = 'succeeded';
    const outcome = await releaseDeposit(env(), {
      workspaceId: WS,
      jobId: JOB,
      reason: 'lead_withdrawn',
    });
    expect(outcome.settled).toBe(true);
    const refund = stripe.callsTo('/refunds')[0]!;
    expect(refund.body.get('reverse_transfer')).toBe('true');
  });

  it('apply captures in full with no fee taken out', async () => {
    const held = await createHeldDeposit();
    const outcome = await applyDeposit(env(), { workspaceId: WS, jobId: JOB });
    expect(outcome.settled).toBe(true);
    expect(outcome.deposit?.status).toBe('applied');
    expect(outcome.deposit?.shop_portion_cents).toBe(12000);
    const capture = stripe.callsTo(
      `/payment_intents/${held.stripe_payment_intent_id}/capture`,
    )[0]!;
    expect(capture.body.get('application_fee_amount')).toBeNull();
    // The fee still bills through the meter on completion.
    const meter = await sqlite.db
      .prepare('SELECT status FROM lead_meter_events WHERE lead_id = ?')
      .bind(LEAD)
      .first<{ status: string }>();
    expect(meter?.status).toBe('pending');
  });

  it('forfeit captures with the fee as the application fee and waives the meter', async () => {
    const held = await createHeldDeposit();
    const outcome = await forfeitDeposit(env(), {
      workspaceId: WS,
      jobId: JOB,
      reason: 'no_show',
    });
    expect(outcome.settled).toBe(true);
    expect(outcome.deposit?.status).toBe('forfeited');
    expect(outcome.deposit?.fee_portion_cents).toBe(6000);
    expect(outcome.deposit?.shop_portion_cents).toBe(6000);
    expect(outcome.deposit?.shortfall_cents).toBe(0);
    const capture = stripe.callsTo(
      `/payment_intents/${held.stripe_payment_intent_id}/capture`,
    )[0]!;
    expect(capture.body.get('application_fee_amount')).toBe('6000');
    // The fee was recovered from the forfeit — never invoiced twice.
    const meter = await sqlite.db
      .prepare('SELECT status, notes FROM lead_meter_events WHERE lead_id = ?')
      .bind(LEAD)
      .first<{ status: string; notes: string }>();
    expect(meter?.status).toBe('waived');
    expect(meter?.notes).toContain('settled from deposit forfeit');
  });

  it('forfeit absorbs the shortfall on a cap-shrunk deposit', async () => {
    // $35 fee, $285 quote → $28.50 deposit (seeded fee 35, quote via session).
    sqlite.close();
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(35)],
    });
    await sqlite.db.exec(quoteSessionSql(285, 400));
    const held = await createHeldDeposit(35);
    expect(held.amount_cents).toBe(2850);
    const outcome = await forfeitDeposit(env(), {
      workspaceId: WS,
      jobId: JOB,
      reason: 'customer_cancel_inside_window',
    });
    expect(outcome.deposit?.fee_portion_cents).toBe(2850);
    expect(outcome.deposit?.shop_portion_cents).toBe(0);
    expect(outcome.deposit?.shortfall_cents).toBe(650);
    const capture = stripe.callsTo(
      `/payment_intents/${held.stripe_payment_intent_id}/capture`,
    )[0]!;
    expect(capture.body.get('application_fee_amount')).toBe('2850');
  });
});
