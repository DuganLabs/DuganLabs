import type { Env } from '../env';
import {
  confirmOffSessionCharge,
  createOffSessionCharge,
  createStripeCustomer,
  defaultPaymentMethodId,
  getPaymentIntent,
  listCustomerCards,
  refundPaymentIntent,
  retrieveStripeCustomer,
  StripeError,
  type StripePaymentIntent,
} from './stripe';
import { retryFailedUsageTopUpForCustomer } from './usage-balance';
import { isDemoWorkspaceSlug } from '@greenput/shared/models';

/**
 * Immediate lead-fee charges.
 *
 * The billable event is BOOKING (WS-1, canonical model v14): a booking
 * commit — today schedule-aware delivery — inserts one pending
 * lead_meter_events row (recordLeadMeter) and then calls
 * chargeBookedLeadFee. A staff accept click and a pool accept are state
 * transitions, not bookings, and never reach this file. Nothing is
 * billed before that insert. The call is a no-op when the row was not
 * newly inserted — on conflict recordLeadMeter returns a fresh id that
 * was never written.
 *
 * One Stripe PaymentIntent per meter row, on the platform Customer
 * (GreenPut billing the contractor), not a Connect destination charge.
 * Amount is price_usd converted to cents — the fee only; infrastructure
 * pass-through (usage-balance.ts) is metered and charged on its own
 * rails and is never netted against this amount (FR-1.5). off_session +
 * confirm. Idempotency key `lead-fee-${meterEventId}`
 * (UNIQUE(lead_id, workspace_id) makes that one charge per lead per
 * shop). receipt_email is never set, and this path never creates or
 * sends an invoice.
 *
 * Collected (PaymentIntent succeeded) → status invoiced, payment_status paid.
 * Declines, cancels and no-shows leave the fee standing: the ONLY way a
 * collected fee comes back is refundLeadFee, for proven fraud or
 * platform fault, with the reason recorded (FR-1.4).
 *
 * Not collected → status stays pending:
 *   - no STRIPE_SECRET_KEY → payment_status unconfigured, no Stripe call
 *   - under 50 cents (Stripe's minimum; a $0 override included) → below_minimum
 *   - no saved card → no_payment_method, no PaymentIntent
 *   - declined or authentication_required → failed, PaymentIntent id kept
 * The booking write is not rolled back when a charge that was allowed to
 * start then fails. The gate in lead-billing-gate.ts runs first: with
 * Stripe configured, no saved card means nothing is booked. A decline
 * after that gate leaves the fee pending and pauses further delivery
 * until this charge, or a later chargePendingLeadFees, collects it.
 *
 * A declined create is replayed by Stripe for 24 hours under the same
 * idempotency key, so a later attempt confirms the existing PaymentIntent
 * (`lead-fee-confirm-${id}-${paymentMethodId}`) instead of creating another.
 * A canceled intent may be replaced with `lead-fee-${id}-${paymentMethodId}`.
 *
 * Race: the row is re-read immediately before the PaymentIntent is created.
 * If the row leaves 'pending' after Stripe has captured, the status
 * update is conditional on status = pending, so the row keeps its new
 * status and the capture is not refunded by this path. A
 * payment_intent.succeeded webhook does the same: it marks a pending
 * row paid and does not un-waive. See docs/billing-lead-fees.md.
 *
 * There is no cron. POST /api/billing/lead-fees/collect charges whatever is
 * still pending. payment_method.attached, customer.updated, and
 * setup_intent.succeeded call retryLeadFeesForStripeCustomer, which is the
 * same collect for the workspace that owns that Stripe customer, and which
 * also retries a failed SMS usage top-up.
 */

/** Stripe customer id on a webhook object, string or expanded. */
function stripeCustomerIdFrom(
  eventType: string,
  object: Record<string, unknown>,
): string | null {
  const raw =
    eventType === 'customer.updated' ? object['id'] : object['customer'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (raw && typeof raw === 'object' && 'id' in raw) {
    const id = (raw as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

/**
 * A card was added or the customer changed. Charge whatever lead fees are
 * still pending for that customer. No matching workspace is a no-op.
 */
export async function retryLeadFeesForStripeCustomer(
  env: Env,
  eventType: string,
  object: Record<string, unknown>,
): Promise<void> {
  const customerId = stripeCustomerIdFrom(eventType, object);
  if (!customerId) return;
  const workspace = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE stripe_customer_id = ?',
  )
    .bind(customerId)
    .first<{ id: string }>();
  if (!workspace) return;
  await chargePendingLeadFees(env, workspace.id);
  await retryFailedUsageTopUpForCustomer(env, workspace.id);
}

/** Stripe's minimum charge, in cents. A $1 pilot fee is 100 cents. */
const STRIPE_MIN_CENTS = 50;

export type LeadFeeChargeOutcome =
  | 'paid'
  | 'processing'
  | 'failed'
  | 'no_payment_method'
  | 'below_minimum'
  | 'unconfigured'
  | 'skipped_not_pending'
  /** The public demo workspace (slug `demo`) is never charged. */
  | 'demo_exempt';

export interface LeadFeeChargeResult {
  readonly meterEventId: string;
  readonly status: 'pending' | 'invoiced' | 'refunded' | 'waived';
  readonly paymentStatus: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly outcome: LeadFeeChargeOutcome;
}

export interface LeadFeeCollectReport {
  readonly attempted: number;
  readonly paid: number;
  readonly stillPending: number;
}

interface ChargeRow {
  id: string;
  workspace_id: string;
  lead_id: string;
  service_type: string;
  price_usd: number;
  status: string;
  stripe_payment_intent_id: string | null;
  payment_status: string | null;
  workspace_name: string;
  workspace_email: string;
  workspace_slug: string | null;
  stripe_customer_id: string | null;
}

const METER_STATUSES = ['pending', 'invoiced', 'refunded', 'waived'] as const;
type MeterStatus = (typeof METER_STATUSES)[number];

export async function chargeBookedLeadFee(
  env: Env,
  meterEventId: string,
): Promise<LeadFeeChargeResult> {
  try {
    return await chargeOne(env, meterEventId);
  } catch (err) {
    // The booking write has already committed. A Stripe failure records
    // the miss and must not fail that request.
    const paymentIntentId =
      err instanceof StripeError ? err.paymentIntentId : null;
    try {
      await setPendingPayment(env, meterEventId, 'failed', paymentIntentId);
    } catch {
      // The row may already be gone or no longer pending.
    }
    const row = await loadRow(env, meterEventId).catch(() => null);
    if (row && row.status !== 'pending') {
      return resultFrom(row, 'skipped_not_pending');
    }
    return {
      meterEventId,
      status: 'pending',
      paymentStatus: 'failed',
      stripePaymentIntentId: row?.stripe_payment_intent_id ?? paymentIntentId,
      outcome: 'failed',
    };
  }
}

/** Charge every still-pending positive fee for one workspace. Not a schedule. */
export async function chargePendingLeadFees(
  env: Env,
  workspaceId: string,
): Promise<LeadFeeCollectReport> {
  const rows =
    (
      await env.DB.prepare(
        `SELECT id FROM lead_meter_events
          WHERE workspace_id = ? AND status = 'pending' AND price_usd > 0
          ORDER BY created_at`,
      )
        .bind(workspaceId)
        .all<{ id: string }>()
    ).results ?? [];

  let paid = 0;
  for (const row of rows) {
    const charged = await chargeBookedLeadFee(env, row.id);
    if (charged.outcome === 'paid') paid += 1;
  }

  const left = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM lead_meter_events
      WHERE workspace_id = ? AND status = 'pending' AND price_usd > 0`,
  )
    .bind(workspaceId)
    .first<{ n: number }>();

  return {
    attempted: rows.length,
    paid,
    stillPending: Number(left?.n ?? 0),
  };
}

/**
 * The ONLY refund cases for a lead fee (FR-1.4, canonical model v14):
 * proven fraud, and platform fault. Every other unhappy ending —
 * declines, cancels, no-shows — leaves the fee standing, because the
 * deliverable, a real verified booked job, existed.
 */
export type LeadFeeRefundReason = 'fraud' | 'platform_fault';

export const LEAD_FEE_REFUND_REASONS: readonly LeadFeeRefundReason[] =
  Object.freeze(['fraud', 'platform_fault']);

/** A refund was asked for outside the two cases FR-1.4 allows. */
export class LeadFeeRefundError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LeadFeeRefundError';
    this.code = code;
  }
}

export interface LeadFeeRefundResult {
  readonly meterEventId: string;
  readonly status: 'refunded';
  readonly reason: LeadFeeRefundReason;
  /** The Stripe refund id, or null when nothing had been collected. */
  readonly stripeRefundId: string | null;
}

/**
 * Refund one lead fee, with its reason recorded on the row
 * (refund_reason + notes). The reason is validated FIRST and loudly:
 * anything other than 'fraud' or 'platform_fault' throws
 * LeadFeeRefundError and nothing is written — there is no third case.
 *
 * An 'invoiced' (collected) row is refunded through Stripe against its
 * PaymentIntent, then marked 'refunded'. A still-'pending' row was
 * never collected, so it is marked 'refunded' with no Stripe call —
 * the fee will never be collected. Any other status (already refunded,
 * waived) is not refundable and throws. A Stripe failure propagates
 * and the row is left exactly as it was, so the refund can be retried.
 */
export async function refundLeadFee(
  env: Env,
  meterEventId: string,
  reason: LeadFeeRefundReason,
): Promise<LeadFeeRefundResult> {
  if (!LEAD_FEE_REFUND_REASONS.includes(reason)) {
    throw new LeadFeeRefundError(
      'INVALID_REFUND_REASON',
      `A lead fee can only be refunded for 'fraud' or 'platform_fault' — got "${String(reason)}". Declines, cancels and no-shows leave the fee standing.`,
    );
  }
  const row = await loadRow(env, meterEventId);
  if (!row) {
    throw new LeadFeeRefundError(
      'METER_EVENT_NOT_FOUND',
      `No lead meter event ${meterEventId} to refund.`,
    );
  }
  if (row.status !== 'invoiced' && row.status !== 'pending') {
    throw new LeadFeeRefundError(
      'NOT_REFUNDABLE',
      `Lead fee ${meterEventId} is '${row.status}' — only a pending or invoiced fee can be refunded.`,
    );
  }

  let stripeRefundId: string | null = null;
  if (row.status === 'invoiced' && row.stripe_payment_intent_id) {
    const refund = await refundPaymentIntent(env, row.stripe_payment_intent_id);
    stripeRefundId = refund.id;
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE lead_meter_events
        SET status = 'refunded',
            refund_reason = ?,
            notes = ?
      WHERE id = ? AND status IN ('pending', 'invoiced')`,
  )
    .bind(
      reason,
      `Refunded (${reason}) on ${now}: the only refund cases are proven fraud and platform fault (FR-1.4).`,
      meterEventId,
    )
    .run();

  return { meterEventId, status: 'refunded', reason, stripeRefundId };
}

/**
 * Webhook half. payment_intent.succeeded marks a still-pending lead-fee
 * row invoiced/paid. payment_intent.payment_failed records failed and
 * leaves it pending. Anything that is not
 * metadata.kind = lead_fee is ignored, so a job payment or a deposit
 * intent is not a lead fee. A waived row is not flipped back and is
 * not refunded.
 */
export async function reconcileLeadFeeCharge(
  env: Env,
  outcome: 'succeeded' | 'failed',
  pi: Record<string, unknown>,
  nowIso: string,
): Promise<void> {
  const metadata = pi['metadata'];
  if (!metadata || typeof metadata !== 'object') return;
  if ((metadata as Record<string, unknown>)['kind'] !== 'lead_fee') return;
  const piId = pi['id'];
  if (typeof piId !== 'string' || piId.length === 0) return;
  const meterRaw = (metadata as Record<string, unknown>)['meter_event_id'];
  const meterEventId = typeof meterRaw === 'string' ? meterRaw : '';

  if (outcome === 'succeeded') {
    await env.DB.prepare(
      `UPDATE lead_meter_events
          SET status = 'invoiced',
              payment_status = 'paid',
              stripe_payment_intent_id = ?,
              invoiced_at = COALESCE(invoiced_at, ?)
        WHERE status = 'pending'
          AND (
            stripe_payment_intent_id = ?
            OR (
              id = ?
              AND (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = ?)
            )
          )`,
    )
      .bind(piId, nowIso, piId, meterEventId, piId)
      .run();
    return;
  }

  await env.DB.prepare(
    `UPDATE lead_meter_events
        SET payment_status = 'failed',
            stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?)
      WHERE status = 'pending'
        AND (
          stripe_payment_intent_id = ?
          OR (
            id = ?
            AND (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = ?)
          )
        )`,
  )
    .bind(piId, piId, meterEventId, piId)
    .run();
}

async function chargeOne(
  env: Env,
  meterEventId: string,
): Promise<LeadFeeChargeResult> {
  const row = await loadRow(env, meterEventId);
  if (!row || row.status !== 'pending') {
    return resultFrom(row, 'skipped_not_pending', meterEventId);
  }
  // The public demo shop is never charged: no Stripe call, no row change.
  if (isDemoWorkspaceSlug(row.workspace_slug)) {
    return resultFrom(row, 'demo_exempt');
  }

  if (!env.STRIPE_SECRET_KEY) {
    await setPendingPayment(env, row.id, 'unconfigured', null);
    return {
      ...resultFrom(row, 'unconfigured'),
      paymentStatus: 'unconfigured',
    };
  }

  const cents = Math.round(Number(row.price_usd) * 100);
  if (cents < STRIPE_MIN_CENTS) {
    await setPendingPayment(env, row.id, 'below_minimum', null);
    return {
      ...resultFrom(row, 'below_minimum'),
      paymentStatus: 'below_minimum',
    };
  }

  const customerId = await ensureCustomer(env, row);
  // A withdrawal between the insert and the charge leaves the fee waived.
  // Do not open a PaymentIntent for a row that is no longer pending.
  if (!(await isPending(env, row.id))) {
    const current = await loadRow(env, row.id);
    return resultFrom(current, 'skipped_not_pending', row.id);
  }

  const paymentMethodId = await savedCardId(env, customerId);
  if (!paymentMethodId) {
    await setPendingPayment(env, row.id, 'no_payment_method', null);
    return {
      ...resultFrom(row, 'no_payment_method'),
      paymentStatus: 'no_payment_method',
    };
  }

  if (!(await isPending(env, row.id))) {
    const current = await loadRow(env, row.id);
    return resultFrom(current, 'skipped_not_pending', row.id);
  }

  let intent: StripePaymentIntent;
  try {
    intent = await chargeOrConfirm(
      env,
      row,
      customerId,
      paymentMethodId,
      cents,
    );
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    await setPendingPayment(env, row.id, 'failed', err.paymentIntentId);
    const current = await loadRow(env, row.id);
    return {
      meterEventId: row.id,
      status: asStatus(current?.status ?? 'pending'),
      paymentStatus:
        current?.status === 'pending'
          ? 'failed'
          : (current?.payment_status ?? null),
      stripePaymentIntentId:
        current?.stripe_payment_intent_id ?? err.paymentIntentId,
      outcome: current?.status === 'pending' ? 'failed' : 'skipped_not_pending',
    };
  }

  return applyIntent(env, row.id, intent);
}

async function chargeOrConfirm(
  env: Env,
  row: ChargeRow,
  customerId: string,
  paymentMethodId: string,
  cents: number,
): Promise<StripePaymentIntent> {
  const metadata = {
    workspace_id: row.workspace_id,
    lead_id: row.lead_id,
    meter_event_id: row.id,
    kind: 'lead_fee',
  };
  const description = `GreenPut lead fee — ${row.service_type || row.lead_id}`;

  if (row.stripe_payment_intent_id) {
    const existing = await getPaymentIntent(env, row.stripe_payment_intent_id);
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
        idempotencyKey: `lead-fee-${row.id}-${paymentMethodId}`,
      });
    }
    return confirmOffSessionCharge(
      env,
      row.stripe_payment_intent_id,
      paymentMethodId,
      `lead-fee-confirm-${row.id}-${paymentMethodId}`,
    );
  }

  return createOffSessionCharge(env, {
    customerId,
    paymentMethodId,
    amountCents: cents,
    description,
    metadata,
    idempotencyKey: `lead-fee-${row.id}`,
  });
}

async function applyIntent(
  env: Env,
  meterEventId: string,
  intent: StripePaymentIntent,
): Promise<LeadFeeChargeResult> {
  if (intent.status === 'succeeded') {
    const now = new Date().toISOString();
    const updated = await env.DB.prepare(
      `UPDATE lead_meter_events
          SET status = 'invoiced',
              payment_status = 'paid',
              stripe_payment_intent_id = ?,
              invoiced_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
      .bind(intent.id, now, meterEventId)
      .run();
    if ((updated.meta?.changes ?? 0) === 0) {
      // Waived (or otherwise no longer pending) while Stripe captured.
      // Record the intent. Do not refund and do not un-waive.
      await env.DB.prepare(
        `UPDATE lead_meter_events
            SET stripe_payment_intent_id = ?
          WHERE id = ? AND stripe_payment_intent_id IS NULL`,
      )
        .bind(intent.id, meterEventId)
        .run();
      const current = await loadRow(env, meterEventId);
      return resultFrom(current, 'skipped_not_pending', meterEventId);
    }
    return {
      meterEventId,
      status: 'invoiced',
      paymentStatus: 'paid',
      stripePaymentIntentId: intent.id,
      outcome: 'paid',
    };
  }

  if (intent.status === 'processing') {
    await setPendingPayment(env, meterEventId, 'processing', intent.id);
    return {
      meterEventId,
      status: 'pending',
      paymentStatus: 'processing',
      stripePaymentIntentId: intent.id,
      outcome: 'processing',
    };
  }

  // requires_action / requires_payment_method: off-session could not
  // finish. Keep the intent so the next attempt confirms it.
  await setPendingPayment(env, meterEventId, 'failed', intent.id);
  return {
    meterEventId,
    status: 'pending',
    paymentStatus: 'failed',
    stripePaymentIntentId: intent.id,
    outcome: 'failed',
  };
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

async function ensureCustomer(env: Env, row: ChargeRow): Promise<string> {
  if (row.stripe_customer_id) return row.stripe_customer_id;
  const customer = await createStripeCustomer(env, {
    email: row.workspace_email,
    name: row.workspace_name,
    workspaceId: row.workspace_id,
    idempotencyKey: `lead-fee-customer-${row.workspace_id}`,
  });
  await env.DB.prepare(
    `UPDATE workspaces
        SET stripe_customer_id = ?
      WHERE id = ? AND stripe_customer_id IS NULL`,
  )
    .bind(customer.id, row.workspace_id)
    .run();
  const stored = await env.DB.prepare(
    'SELECT stripe_customer_id FROM workspaces WHERE id = ?',
  )
    .bind(row.workspace_id)
    .first<{ stripe_customer_id: string | null }>();
  return stored?.stripe_customer_id ?? customer.id;
}

async function loadRow(env: Env, id: string): Promise<ChargeRow | null> {
  return env.DB.prepare(
    `SELECT e.id, e.workspace_id, e.lead_id, e.service_type, e.price_usd,
            e.status, e.stripe_payment_intent_id, e.payment_status,
            w.name AS workspace_name, w.email AS workspace_email,
            w.slug AS workspace_slug, w.stripe_customer_id
       FROM lead_meter_events e
       JOIN workspaces w ON w.id = e.workspace_id
      WHERE e.id = ?`,
  )
    .bind(id)
    .first<ChargeRow>();
}

async function isPending(env: Env, id: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT status FROM lead_meter_events WHERE id = ?',
  )
    .bind(id)
    .first<{ status: string }>();
  return row?.status === 'pending';
}

async function setPendingPayment(
  env: Env,
  id: string,
  paymentStatus: string,
  paymentIntentId: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE lead_meter_events
        SET payment_status = ?,
            stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id)
      WHERE id = ? AND status = 'pending'`,
  )
    .bind(paymentStatus, paymentIntentId, id)
    .run();
}

function asStatus(status: string): MeterStatus {
  return (METER_STATUSES as readonly string[]).includes(status)
    ? (status as MeterStatus)
    : 'pending';
}

function resultFrom(
  row: ChargeRow | null,
  outcome: LeadFeeChargeOutcome,
  fallbackId = '',
): LeadFeeChargeResult {
  return {
    meterEventId: row?.id ?? fallbackId,
    status: asStatus(row?.status ?? 'pending'),
    paymentStatus: row?.payment_status ?? null,
    stripePaymentIntentId: row?.stripe_payment_intent_id ?? null,
    outcome,
  };
}
