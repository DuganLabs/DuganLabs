import type { Env } from '../env';
import { newId } from './response';
import { sendSms } from '@greenput/shared/notifications';
import {
  DEFAULT_USAGE_THRESHOLD_CENTS,
  DEFAULT_USAGE_TOPUP_CENTS,
  MICRO_USD_PER_CENT,
  TWILIO_US_SMS_SEGMENT_MICRO_USD,
} from '@greenput/shared/notifications';
import {
  confirmOffSessionCharge,
  createOffSessionCharge,
  defaultPaymentMethodId,
  getPaymentIntent,
  listCustomerCards,
  retrieveStripeCustomer,
  StripeError,
  type StripePaymentIntent,
} from './stripe';

/**
 * Prepaid outbound-SMS balance.
 *
 * A US long-code segment is $0.0083, under Stripe's $0.50 minimum, so it
 * cannot be its own PaymentIntent. The workspace holds a balance in
 * micro-USD (1 USD = 1_000_000). Sending reserves Twilio's published list
 * price, then a status callback adjusts that reserve to Twilio's Price.
 *
 * When the balance is below the threshold (default $2) or cannot cover
 * the message, one off-session charge tops it up (default $10). The
 * charge is idempotent: one pending top-up row per workspace, and the
 * Stripe idempotency key is the ledger id. A failed or processing top-up
 * blocks further contractor SMS and pauses lead delivery the same way a
 * failed lead fee does (lead-billing-gate.ts).
 *
 * With no STRIPE_SECRET_KEY nothing is debited, topped up, or blocked.
 * With a Stripe key but no Twilio sender (account, token, or from-number
 * missing), the send is refused before any top-up or debit, so a paused
 * Twilio registration cannot charge a card for a message that will not
 * go out. Callers that inject this function then fall back to email.
 * Account-recovery OTP does not call this module.
 */

export {
  DEFAULT_USAGE_THRESHOLD_CENTS,
  DEFAULT_USAGE_TOPUP_CENTS,
  MICRO_USD_PER_CENT,
  TWILIO_US_SMS_SEGMENT_MICRO_USD,
};

const STRIPE_MIN_CENTS = 50;

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** Characters Twilio encodes as ESC + char, so each counts as two GSM units. */
const GSM7_EXT = '^{}\\[~]|€\f';

/**
 * Segment count the way Twilio bills a US long-code: GSM-7 is 160 units
 * for one segment and 153 thereafter; UCS-2 is 70 / 67. An extension
 * character counts as two GSM units. An empty body still reserves one
 * segment.
 */
export function smsSegmentCount(body: string): number {
  let units = 0;
  for (const ch of body) {
    if (GSM7_BASIC.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else {
      const ucs2 = body.length;
      if (ucs2 <= 70) return 1;
      return Math.ceil(ucs2 / 67);
    }
  }
  if (units <= 160) return 1;
  return Math.ceil(units / 153);
}

export function smsEstimateMicroUsd(body: string): number {
  return smsSegmentCount(body) * TWILIO_US_SMS_SEGMENT_MICRO_USD;
}

/** Production and staging are the only hosts whose callback URL we can sign. */
export function twilioSmsStatusCallbackUrl(env: Env): string | null {
  if (env.ENVIRONMENT === 'production') {
    return 'https://api.greenput.com/api/webhooks/twilio/sms';
  }
  if (env.ENVIRONMENT === 'staging') {
    return 'https://api.greenput.site/api/webhooks/twilio/sms';
  }
  return null;
}

export type ContractorSmsResult =
  | { readonly ok: true; readonly sid: string | null }
  | {
      readonly ok: false;
      readonly reason: 'USAGE_EXHAUSTED' | 'SEND_FAILED';
      readonly error?: string;
    };

interface UsageWorkspace {
  usage_balance_micro_usd: number;
  usage_topup_cents: number;
  usage_topup_threshold_cents: number;
  stripe_customer_id: string | null;
}

interface TopUpRow {
  id: string;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  amount_micro_usd: number;
}

type TopUpOutcome =
  | 'paid'
  | 'processing'
  | 'failed'
  | 'no_card'
  | 'in_progress'
  | 'below_minimum';

export async function sendContractorSms(
  env: Env,
  params: { workspaceId: string; to: string; body: string },
): Promise<ContractorSmsResult> {
  if (!env.STRIPE_SECRET_KEY) {
    const result = await sendSms(env, { to: params.to, body: params.body });
    if (!result.success) {
      return { ok: false, reason: 'SEND_FAILED', error: result.error };
    }
    return { ok: true, sid: result.sid ?? null };
  }

  // Stripe is on. Do not reserve balance or open a top-up PaymentIntent
  // unless a message can actually be handed to Twilio. An empty
  // TWILIO_FROM_NUMBER makes sendSms report success without a request.
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_FROM_NUMBER
  ) {
    return {
      ok: false,
      reason: 'SEND_FAILED',
      error: 'SMS is not configured.',
    };
  }

  if (await hasBlockingTopUp(env, params.workspaceId)) {
    return { ok: false, reason: 'USAGE_EXHAUSTED' };
  }

  const cost = smsEstimateMicroUsd(params.body);
  const workspace = await loadWorkspace(env, params.workspaceId);
  if (!workspace) return { ok: false, reason: 'USAGE_EXHAUSTED' };

  const threshold = workspace.usage_topup_threshold_cents * MICRO_USD_PER_CENT;
  if (
    workspace.usage_balance_micro_usd < threshold ||
    workspace.usage_balance_micro_usd < cost
  ) {
    await startTopUp(env, params.workspaceId);
  }

  const debited = await debitBalance(env, params.workspaceId, cost);
  if (debited === null) return { ok: false, reason: 'USAGE_EXHAUSTED' };

  const estimateId = newId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_usage_ledger
       (id, workspace_id, kind, amount_micro_usd, balance_after_micro_usd,
        segments, description, created_at)
     VALUES (?, ?, 'sms_estimate', ?, ?, ?, 'SMS', ?)`,
  )
    .bind(
      estimateId,
      params.workspaceId,
      -cost,
      debited,
      smsSegmentCount(params.body),
      now,
    )
    .run();

  const callback = twilioSmsStatusCallbackUrl(env);
  const sent = await sendSms(env, {
    to: params.to,
    body: params.body,
    statusCallback: callback ?? undefined,
  });
  if (!sent.success) {
    await reverseEstimate(env, params.workspaceId, cost);
    return { ok: false, reason: 'SEND_FAILED', error: sent.error };
  }
  if (sent.sid) {
    await env.DB.prepare(
      `UPDATE workspace_usage_ledger
          SET twilio_message_sid = ?
        WHERE id = ? AND twilio_message_sid IS NULL`,
    )
      .bind(sent.sid, estimateId)
      .run();
  }

  const after = await readBalance(env, params.workspaceId);
  if (after < threshold && !(await hasBlockingTopUp(env, params.workspaceId))) {
    await startTopUp(env, params.workspaceId).catch(() => undefined);
  }
  return { ok: true, sid: sent.sid ?? null };
}

/**
 * Adjust an sms_estimate to Twilio's reported Price. Price is a negative
 * USD decimal and is often null until the message is delivered. A second
 * callback for the same MessageSid does nothing. Unknown SIDs (including
 * any message this module did not reserve) are ignored.
 */
export async function reconcileSmsPrice(
  env: Env,
  params: {
    messageSid: string;
    price: string | null;
    priceUnit: string | null;
  },
): Promise<'noop' | 'reconciled'> {
  if (!params.messageSid || !params.price || params.price === 'null') {
    return 'noop';
  }
  const actual = priceToMicroUsd(params.price, params.priceUnit);
  if (actual === null) return 'noop';

  const estimate = await env.DB.prepare(
    `SELECT workspace_id, amount_micro_usd
       FROM workspace_usage_ledger
      WHERE kind = 'sms_estimate' AND twilio_message_sid = ?`,
  )
    .bind(params.messageSid)
    .first<{ workspace_id: string; amount_micro_usd: number }>();
  if (!estimate) return 'noop';

  const reserved = Math.abs(Number(estimate.amount_micro_usd));
  const delta = reserved - actual;
  const id = newId();
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO workspace_usage_ledger
         (id, workspace_id, kind, amount_micro_usd, balance_after_micro_usd,
          twilio_message_sid, description, created_at)
       VALUES (?, ?, 'sms_reconcile', ?, 0, ?, 'Twilio price adjustment', ?)`,
    )
      .bind(
        id,
        estimate.workspace_id,
        delta,
        params.messageSid,
        new Date().toISOString(),
      )
      .run();
    if ((inserted.meta?.changes ?? 0) === 0) return 'noop';
  } catch (err) {
    if (isUniqueError(err)) return 'noop';
    throw err;
  }

  const after = await addBalance(env, estimate.workspace_id, delta);
  await env.DB.prepare(
    `UPDATE workspace_usage_ledger SET balance_after_micro_usd = ? WHERE id = ?`,
  )
    .bind(after, id)
    .run();
  return 'reconciled';
}

/**
 * payment_intent.succeeded / payment_failed for metadata.kind usage_topup.
 * A paid row is not credited twice and is not flipped back to failed.
 * Anything that is not a usage top-up is ignored.
 */
export async function reconcileUsageTopUp(
  env: Env,
  outcome: 'succeeded' | 'failed',
  pi: Record<string, unknown>,
): Promise<void> {
  const metadata = pi['metadata'];
  if (!metadata || typeof metadata !== 'object') return;
  if ((metadata as Record<string, unknown>)['kind'] !== 'usage_topup') return;
  const ledgerRaw = (metadata as Record<string, unknown>)['ledger_id'];
  const ledgerId = typeof ledgerRaw === 'string' ? ledgerRaw : '';
  const piId = pi['id'];
  if (!ledgerId || typeof piId !== 'string') return;

  if (outcome === 'failed') {
    await env.DB.prepare(
      `UPDATE workspace_usage_ledger
          SET payment_status = 'failed',
              stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?)
        WHERE id = ?
          AND kind = 'topup'
          AND payment_status IN ('pending', 'processing')`,
    )
      .bind(piId, ledgerId)
      .run();
    return;
  }

  const cents = typeof pi['amount'] === 'number' ? pi['amount'] : 0;
  await creditTopUpIfOpen(env, ledgerId, piId, cents * MICRO_USD_PER_CENT);
}

/**
 * A card was added or replaced. Collect a failed usage top-up for that
 * customer. No matching workspace, and no failed top-up, are no-ops.
 */
export async function retryFailedUsageTopUpForCustomer(
  env: Env,
  workspaceId: string,
): Promise<void> {
  if (!env.STRIPE_SECRET_KEY) return;
  const row = await env.DB.prepare(
    `SELECT id, payment_status, stripe_payment_intent_id, amount_micro_usd
       FROM workspace_usage_ledger
      WHERE workspace_id = ? AND kind = 'topup' AND payment_status = 'failed'
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(workspaceId)
    .first<TopUpRow>();
  if (!row) return;
  await chargeTopUpRow(env, workspaceId, row.id);
}

export interface UsageLedgerEntry {
  readonly id: string;
  readonly kind: string;
  readonly amountMicroUsd: number;
  readonly balanceAfterMicroUsd: number;
  readonly twilioMessageSid: string | null;
  readonly segments: number | null;
  readonly paymentStatus: string | null;
  readonly description: string;
  readonly createdAt: string;
}

export interface UsageBalanceView {
  readonly balanceMicroUsd: number;
  readonly topupCents: number;
  readonly thresholdCents: number;
  readonly entries: readonly UsageLedgerEntry[];
}

/** Settings → Billing. Does not charge. */
export async function readUsageBalance(
  env: Env,
  workspaceId: string,
): Promise<UsageBalanceView | null> {
  const workspace = await loadWorkspace(env, workspaceId);
  if (!workspace) return null;
  const rows = await env.DB.prepare(
    `SELECT id, kind, amount_micro_usd, balance_after_micro_usd,
            twilio_message_sid, segments, payment_status, description, created_at
       FROM workspace_usage_ledger
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 25`,
  )
    .bind(workspaceId)
    .all<{
      id: string;
      kind: string;
      amount_micro_usd: number;
      balance_after_micro_usd: number;
      twilio_message_sid: string | null;
      segments: number | null;
      payment_status: string | null;
      description: string;
      created_at: string;
    }>();
  return {
    balanceMicroUsd: Number(workspace.usage_balance_micro_usd),
    topupCents: Number(workspace.usage_topup_cents),
    thresholdCents: Number(workspace.usage_topup_threshold_cents),
    entries: (rows.results ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      amountMicroUsd: Number(row.amount_micro_usd),
      balanceAfterMicroUsd: Number(row.balance_after_micro_usd),
      twilioMessageSid: row.twilio_message_sid,
      segments: row.segments === null ? null : Number(row.segments),
      paymentStatus: row.payment_status,
      description: row.description,
      createdAt: row.created_at,
    })),
  };
}

export async function updateUsageSettings(
  env: Env,
  workspaceId: string,
  settings: { topupCents: number; thresholdCents: number },
): Promise<UsageBalanceView | null> {
  await env.DB.prepare(
    `UPDATE workspaces
        SET usage_topup_cents = ?, usage_topup_threshold_cents = ?
      WHERE id = ?`,
  )
    .bind(settings.topupCents, settings.thresholdCents, workspaceId)
    .run();
  return readUsageBalance(env, workspaceId);
}

/**
 * Twilio signs URL + sorted form params with HMAC-SHA1 of the auth token,
 * base64. Compared in constant time.
 */
export async function verifyTwilioSignature(
  url: string,
  params: URLSearchParams,
  signature: string,
  authToken: string,
): Promise<boolean> {
  const expected = await twilioSignature(url, params, authToken);
  return timingSafeEqual(expected, signature);
}

async function hasBlockingTopUp(
  env: Env,
  workspaceId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM workspace_usage_ledger
      WHERE workspace_id = ?
        AND kind = 'topup'
        AND payment_status IN ('failed', 'processing')
      LIMIT 1`,
  )
    .bind(workspaceId)
    .first<{ x: number }>();
  return Boolean(row);
}

async function startTopUp(
  env: Env,
  workspaceId: string,
): Promise<TopUpOutcome> {
  const open = await env.DB.prepare(
    `SELECT id, payment_status, stripe_payment_intent_id, amount_micro_usd
       FROM workspace_usage_ledger
      WHERE workspace_id = ?
        AND kind = 'topup'
        AND payment_status IN ('pending', 'processing', 'failed')
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(workspaceId)
    .first<TopUpRow>();
  if (open?.payment_status === 'failed') return 'failed';
  if (open?.payment_status === 'processing') return 'processing';
  if (open?.payment_status === 'pending') {
    return chargeTopUpRow(env, workspaceId, open.id);
  }

  const workspace = await loadWorkspace(env, workspaceId);
  if (!workspace) return 'failed';
  if (workspace.usage_topup_cents < STRIPE_MIN_CENTS) return 'below_minimum';
  if (!workspace.stripe_customer_id) return 'no_card';
  try {
    const card = await savedCardId(env, workspace.stripe_customer_id);
    if (!card) return 'no_card';
  } catch {
    return 'no_card';
  }

  const ledgerId = newId();
  try {
    await env.DB.prepare(
      `INSERT INTO workspace_usage_ledger
         (id, workspace_id, kind, amount_micro_usd, balance_after_micro_usd,
          payment_status, description, created_at)
       VALUES (?, ?, 'topup', 0, ?, 'pending', 'Usage top-up', ?)`,
    )
      .bind(
        ledgerId,
        workspaceId,
        workspace.usage_balance_micro_usd,
        new Date().toISOString(),
      )
      .run();
  } catch (err) {
    if (isUniqueError(err)) return 'in_progress';
    throw err;
  }
  return chargeTopUpRow(env, workspaceId, ledgerId);
}

async function chargeTopUpRow(
  env: Env,
  workspaceId: string,
  ledgerId: string,
): Promise<TopUpOutcome> {
  const workspace = await loadWorkspace(env, workspaceId);
  const row = await env.DB.prepare(
    `SELECT id, payment_status, stripe_payment_intent_id, amount_micro_usd
       FROM workspace_usage_ledger WHERE id = ?`,
  )
    .bind(ledgerId)
    .first<TopUpRow>();
  if (!workspace || !row) return 'failed';
  if (row.payment_status === 'paid') return 'paid';
  if (!workspace.stripe_customer_id) {
    await markTopUp(env, ledgerId, 'no_payment_method', null);
    return 'no_card';
  }

  let paymentMethodId: string | null;
  try {
    paymentMethodId = await savedCardId(env, workspace.stripe_customer_id);
  } catch {
    await markTopUp(env, ledgerId, 'no_payment_method', null);
    return 'no_card';
  }
  if (!paymentMethodId) {
    await markTopUp(env, ledgerId, 'no_payment_method', null);
    return 'no_card';
  }

  const cents = Number(workspace.usage_topup_cents);
  if (cents < STRIPE_MIN_CENTS) {
    await markTopUp(env, ledgerId, 'below_minimum', null);
    return 'below_minimum';
  }

  try {
    const intent = await chargeOrConfirm(
      env,
      workspaceId,
      ledgerId,
      row.stripe_payment_intent_id,
      workspace.stripe_customer_id,
      paymentMethodId,
      cents,
    );
    return applyTopUpIntent(env, ledgerId, intent);
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    await markTopUp(env, ledgerId, 'failed', err.paymentIntentId);
    return 'failed';
  }
}

async function chargeOrConfirm(
  env: Env,
  workspaceId: string,
  ledgerId: string,
  existingPi: string | null,
  customerId: string,
  paymentMethodId: string,
  cents: number,
): Promise<StripePaymentIntent> {
  const metadata = {
    workspace_id: workspaceId,
    ledger_id: ledgerId,
    kind: 'usage_topup',
  };
  const description = 'GreenPut SMS usage top-up';
  if (existingPi) {
    const existing = await getPaymentIntent(env, existingPi);
    if (existing.status === 'succeeded' || existing.status === 'processing') {
      return existing;
    }
    if (existing.status === 'canceled') {
      return createOffSessionCharge(env, {
        customerId,
        paymentMethodId,
        amountCents: cents,
        description,
        metadata,
        idempotencyKey: `usage-topup-${ledgerId}-${paymentMethodId}`,
      });
    }
    return confirmOffSessionCharge(
      env,
      existingPi,
      paymentMethodId,
      `usage-topup-${ledgerId}-${paymentMethodId}`,
    );
  }
  return createOffSessionCharge(env, {
    customerId,
    paymentMethodId,
    amountCents: cents,
    description,
    metadata,
    idempotencyKey: `usage-topup-${ledgerId}`,
  });
}

async function applyTopUpIntent(
  env: Env,
  ledgerId: string,
  intent: StripePaymentIntent,
): Promise<TopUpOutcome> {
  if (intent.status === 'succeeded') {
    await creditTopUpIfOpen(
      env,
      ledgerId,
      intent.id,
      intent.amount * MICRO_USD_PER_CENT,
    );
    return 'paid';
  }
  if (intent.status === 'processing') {
    await markTopUp(env, ledgerId, 'processing', intent.id);
    return 'processing';
  }
  await markTopUp(env, ledgerId, 'failed', intent.id);
  return 'failed';
}

/**
 * Credits the balance only when this call is the one that moves the row
 * to paid. A webhook and the request that created the charge both call
 * this; the second one finds the row already paid and does not credit.
 */
async function creditTopUpIfOpen(
  env: Env,
  ledgerId: string,
  paymentIntentId: string,
  amountMicro: number,
): Promise<boolean> {
  if (amountMicro <= 0) return false;
  const updated = await env.DB.prepare(
    `UPDATE workspace_usage_ledger
        SET payment_status = 'paid',
            stripe_payment_intent_id = ?,
            amount_micro_usd = ?
      WHERE id = ?
        AND kind = 'topup'
        AND payment_status IN ('pending', 'processing', 'failed')`,
  )
    .bind(paymentIntentId, amountMicro, ledgerId)
    .run();
  if ((updated.meta?.changes ?? 0) === 0) return false;
  const workspaceId = await env.DB.prepare(
    'SELECT workspace_id FROM workspace_usage_ledger WHERE id = ?',
  )
    .bind(ledgerId)
    .first<{ workspace_id: string }>();
  if (!workspaceId) return false;
  const after = await addBalance(env, workspaceId.workspace_id, amountMicro);
  await env.DB.prepare(
    `UPDATE workspace_usage_ledger SET balance_after_micro_usd = ? WHERE id = ?`,
  )
    .bind(after, ledgerId)
    .run();
  return true;
}

async function markTopUp(
  env: Env,
  ledgerId: string,
  paymentStatus: string,
  paymentIntentId: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE workspace_usage_ledger
        SET payment_status = ?,
            stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id)
      WHERE id = ?
        AND kind = 'topup'
        AND payment_status IN ('pending', 'processing', 'failed')`,
  )
    .bind(paymentStatus, paymentIntentId, ledgerId)
    .run();
}

async function reverseEstimate(
  env: Env,
  workspaceId: string,
  cost: number,
): Promise<void> {
  const after = await addBalance(env, workspaceId, cost);
  await env.DB.prepare(
    `INSERT INTO workspace_usage_ledger
       (id, workspace_id, kind, amount_micro_usd, balance_after_micro_usd,
        description, created_at)
     VALUES (?, ?, 'sms_reversal', ?, ?, 'SMS send failed', ?)`,
  )
    .bind(newId(), workspaceId, cost, after, new Date().toISOString())
    .run();
}

async function debitBalance(
  env: Env,
  workspaceId: string,
  micro: number,
): Promise<number | null> {
  const row = await env.DB.prepare(
    `UPDATE workspaces
        SET usage_balance_micro_usd = usage_balance_micro_usd - ?
      WHERE id = ? AND usage_balance_micro_usd >= ?
      RETURNING usage_balance_micro_usd`,
  )
    .bind(micro, workspaceId, micro)
    .first<{ usage_balance_micro_usd: number }>();
  return row ? Number(row.usage_balance_micro_usd) : null;
}

async function addBalance(
  env: Env,
  workspaceId: string,
  micro: number,
): Promise<number> {
  const row = await env.DB.prepare(
    `UPDATE workspaces
        SET usage_balance_micro_usd = usage_balance_micro_usd + ?
      WHERE id = ?
      RETURNING usage_balance_micro_usd`,
  )
    .bind(micro, workspaceId)
    .first<{ usage_balance_micro_usd: number }>();
  return Number(row?.usage_balance_micro_usd ?? 0);
}

async function readBalance(env: Env, workspaceId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT usage_balance_micro_usd FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<{ usage_balance_micro_usd: number }>();
  return Number(row?.usage_balance_micro_usd ?? 0);
}

async function loadWorkspace(
  env: Env,
  workspaceId: string,
): Promise<UsageWorkspace | null> {
  return env.DB.prepare(
    `SELECT usage_balance_micro_usd, usage_topup_cents,
            usage_topup_threshold_cents, stripe_customer_id
       FROM workspaces WHERE id = ?`,
  )
    .bind(workspaceId)
    .first<UsageWorkspace>();
}

async function savedCardId(
  env: Env,
  customerId: string,
): Promise<string | null> {
  const customer = await retrieveStripeCustomer(env, customerId);
  const preferred = defaultPaymentMethodId(customer);
  if (preferred) return preferred;
  const cards = await listCustomerCards(env, customerId);
  return cards[0]?.id ?? null;
}

function priceToMicroUsd(price: string, unit: string | null): number | null {
  if (unit && unit.toUpperCase() !== 'USD') return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n) * 1_000_000);
}

function isUniqueError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('UNIQUE');
}

async function twilioSignature(
  url: string,
  params: URLSearchParams,
  authToken: string,
): Promise<string> {
  const keys = [...new Set(params.keys())].sort();
  let data = url;
  for (const key of keys) {
    for (const value of params.getAll(key)) data += key + value;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data),
  );
  let binary = '';
  for (const byte of new Uint8Array(mac)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
