import type { Env } from '../env';
import { newId } from './response';
import {
  StripeError,
  cancelPaymentIntent,
  capturePaymentIntent,
  createPaymentIntent,
  getPaymentIntent,
  refundPaymentIntent,
} from './stripe';

/**
 * DORMANT — DO NOT REWIRE (WS-0, PRD v1.5; canonical model v14).
 *
 * The booking-deposit model described below was REVOKED on 2026-10-20
 * (Warren): "No deposit at booking. Ever." A booking's legitimacy comes
 * from bilateral confirmation, not a card hold. Schedule delivery
 * creates no deposit, no outbound SMS or delivery surface links to a
 * deposit, the homeowner confirmation page and the public deposit
 * endpoints are removed, and this module stays in place ONLY so rows
 * that already exist can still settle (release / apply / forfeit on
 * job, lead and undo transitions) and reconcile against Stripe
 * webhooks. The schema (migrations/040) is likewise dormant and
 * documented, not dropped.
 *
 * The one remaining creation entry point is the authenticated
 * POST /api/payments/deposits route — an operator action on an
 * existing job, never invoked by delivery or any homeowner-facing
 * path. Do not add another caller, and do not surface a deposit link
 * or deposit copy to a homeowner, without a new settled model that
 * supersedes the revocation.
 *
 * ── Historical design (fee paper v2 §3, 2026-10-16) ──────────────
 *
 * A deposit was collected at booking for AUTO-BOOKED jobs only
 * (schedule-aware delivery — the launch scope, §4.5). It was the
 * customer's down payment toward the job price, never a GreenPut
 * charge to the customer.
 *
 * Shape of the money: a Stripe Connect destination charge on the shop's
 * connected account (the existing payments architecture) with MANUAL
 * capture. Creating the intent authorizes the amount; nothing settles
 * until the booking's outcome is known —
 *
 *   pending ──authorization lands──▶ held ──job completes──▶ applied
 *     │                               │
 *     │                               ├── any non-forfeit exit ──▶ refunded
 *     │                               │
 *     │                               └── confirmed + inside-window
 *     │                                   cancel, or no-show ──▶ forfeited
 *     └── card declined / Stripe error ──▶ failed
 *
 * The rules, exactly as settled:
 * - Size: target 2× the delivered-lead fee actually charged (the lead's
 *   meter price), hard-capped at the lesser of 10% of the quote's low
 *   end or $1,000 (CA Bus. & Prof. Code §7159). At the pilot's $1 fee
 *   the deposit is $2 — a mechanics test, by design.
 * - Refund (the authorization is voided; if it was somehow captured, a
 *   refund with the transfer reversed): the customer exits before the
 *   shop confirms; the shop cancels or cannot perform; the customer
 *   cancels outside the window; the delivery is undone. No fee is taken
 *   on any of these paths.
 * - Forfeit is the ONLY other settlement: a CONFIRMED booking the
 *   customer cancels inside the 24-hour window, or a no-show. The
 *   capture sets Stripe's application fee to GreenPut's fee, so the
 *   forfeit pays the fee first and the remainder transfers to the shop
 *   for the held slot. If the deposit is smaller than the fee (the cap
 *   binding on a small job), GreenPut absorbs the shortfall — the
 *   lead's pending meter event is waived either way, so no second bill
 *   ever lands on the shop for a ghosted booking.
 * - Applied: on completion the intent is captured in full to the shop;
 *   the deposit is credited against the final invoice (the customer
 *   never pays it twice) and the fee bills through the meter as usual.
 *
 * Every public function here is TOTAL: it returns a typed outcome and
 * never throws for a Stripe or configuration failure, because deposits
 * ride on booking lifecycle calls (deliver, undo, job PATCH, withdraw)
 * that must not fail because the money leg hiccuped. A failure is
 * recorded on the deposit row (`last_error`) and in the activity log,
 * and creation can be retried via POST /api/payments/deposits.
 *
 * The customer used to confirm the authorization in their own browser,
 * on the shop's tenant site at /deposit/<confirmation_token> — the
 * token is still minted at creation (migrations/040, NOT NULL column).
 * That page, the public session endpoint, and the engine functions
 * behind them (getDepositConfirmationSession,
 * loadDepositByConfirmationToken) were removed: WS-0 took the routes,
 * and the unreachable engine surface followed (2026-11-01).
 *
 * Authorization lifetime: Stripe voids an uncaptured authorization
 * after ~7 days. A booking whose appointment sits beyond that can see
 * its hold expire before the outcome; the webhook then lands the row
 * in 'refunded' (the customer was never charged). Re-authorization
 * before expiry is pilot-follow-up work, not silently pretended here.
 */

export type DepositStatus =
  'pending' | 'held' | 'refunded' | 'forfeited' | 'applied' | 'failed';

export type DepositSettleReason =
  | 'job_completed'
  | 'delivery_undone'
  | 'shop_cancel'
  | 'lead_withdrawn'
  | 'customer_cancel_inside_window'
  | 'no_show'
  | 'authorization_released';

export interface DepositRow {
  id: string;
  workspace_id: string;
  job_id: string;
  lead_id: string | null;
  customer_id: string | null;
  stripe_payment_intent_id: string | null;
  connected_account_id: string | null;
  amount_cents: number;
  currency: string;
  fee_cents: number;
  quote_low_cents: number | null;
  status: DepositStatus;
  stripe_status: string | null;
  fee_portion_cents: number | null;
  shop_portion_cents: number | null;
  shortfall_cents: number | null;
  confirmed_at: string | null;
  settled_at: string | null;
  settle_reason: string | null;
  last_error: string | null;
  /** Capability for the homeowner's confirmation page (migrations/040). */
  confirmation_token: string | null;
  created_at: string;
  updated_at: string;
}

const FINAL_STATUSES: ReadonlySet<DepositStatus> = new Set([
  'refunded',
  'forfeited',
  'applied',
]);

export const CANCEL_WINDOW_HOURS = 24;
const HARD_CAP_CENTS = 100_000; // $1,000 — CA §7159's dollar prong.

// ── Pure money math (unit-tested without a database) ─────────

/**
 * The deposit for a booking, in cents: 2× the fee actually charged,
 * capped at the lesser of 10% of the quote's low end or $1,000. The
 * quote prong only binds when a quote exists — with no quote on file
 * the $1,000 prong is the only cap that can be computed.
 */
export function computeDepositAmountCents(args: {
  /** The delivered-lead fee actually charged, whole dollars (meter price_usd). */
  feeUsd: number;
  /** The quote band's low end, dollars, when a quote exists. */
  quoteLowDollars?: number | null;
}): number {
  const targetCents = Math.round(args.feeUsd * 100) * 2;
  let capCents = HARD_CAP_CENTS;
  if (args.quoteLowDollars != null && args.quoteLowDollars > 0) {
    const quoteLowCents = Math.round(args.quoteLowDollars * 100);
    capCents = Math.min(capCents, Math.floor(quoteLowCents / 10));
  }
  return Math.max(0, Math.min(targetCents, capCents));
}

export interface ForfeitSplit {
  /** What GreenPut recovers of its fee from the forfeit. */
  feePortionCents: number;
  /** What reaches the shop for the held slot. */
  shopPortionCents: number;
  /** fee − feePortion when the cap shrank the deposit below the fee. Absorbed. */
  shortfallCents: number;
}

/** The forfeit split: GreenPut's fee first, the remainder to the shop. */
export function splitForfeit(args: {
  amountCents: number;
  feeCents: number;
}): ForfeitSplit {
  const feePortionCents = Math.min(args.feeCents, args.amountCents);
  return {
    feePortionCents,
    shopPortionCents: args.amountCents - feePortionCents,
    shortfallCents: args.feeCents - feePortionCents,
  };
}

/** True when `now` is inside the free-cancellation window's far side:
 * fewer than CANCEL_WINDOW_HOURS remain before the appointment. */
export function isInsideCancelWindow(
  scheduledStartIso: string,
  now: Date,
): boolean {
  const start = Date.parse(scheduledStartIso);
  if (!Number.isFinite(start)) return false;
  return start - now.getTime() < CANCEL_WINDOW_HOURS * 3_600_000;
}

// ── Row access ───────────────────────────────────────────────

async function loadDepositByJob(
  env: Env,
  workspaceId: string,
  jobId: string,
): Promise<DepositRow | null> {
  return env.DB.prepare(
    'SELECT * FROM deposits WHERE job_id = ? AND workspace_id = ?',
  )
    .bind(jobId, workspaceId)
    .first<DepositRow>();
}

export async function loadDepositById(
  env: Env,
  workspaceId: string,
  depositId: string,
): Promise<DepositRow | null> {
  return env.DB.prepare(
    'SELECT * FROM deposits WHERE id = ? AND workspace_id = ?',
  )
    .bind(depositId, workspaceId)
    .first<DepositRow>();
}

async function logDepositActivity(
  env: Env,
  args: {
    workspaceId: string;
    actorUserId?: string | null;
    deposit: DepositRow;
    action: string;
    nowIso: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
     VALUES (?, ?, ?, 'job', ?, ?, ?, ?)`,
  )
    .bind(
      newId(),
      args.workspaceId,
      args.actorUserId ?? null,
      args.deposit.job_id,
      args.action,
      JSON.stringify({ depositId: args.deposit.id, ...args.meta }),
      args.nowIso,
    )
    .run()
    .catch(() => undefined);
}

// ── Creation ─────────────────────────────────────────────────

export type CreateDepositOutcome =
  | {
      created: true;
      deposit: DepositRow;
      /** Present only when this call created the intent — never stored. */
      clientSecret: string | null;
      alreadyExisted: boolean;
    }
  | {
      created: false;
      reason:
        | 'job_not_found'
        | 'payments_unavailable'
        | 'no_connect_account'
        | 'no_fee'
        | 'stripe_error';
    };

/**
 * Create the deposit for an auto-booked job: compute the amount from
 * the fee the lead's meter actually charged and the quote's low end,
 * open a manual-capture destination charge on the shop's Connect
 * account, and record the row. Idempotent per job (UNIQUE(job_id)):
 * a live row is returned as-is; a 'failed' row is retried in place.
 */
export async function createDepositForBooking(
  env: Env,
  args: {
    workspaceId: string;
    jobId: string;
    actorUserId?: string | null;
    /** Defaults to the workspace's stripe_account_id; delivery passes its loaded row. */
    connectedAccountId?: string | null;
    now?: Date;
  },
): Promise<CreateDepositOutcome> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  const job = await env.DB.prepare(
    'SELECT id, customer_id, opportunity_id FROM jobs WHERE id = ? AND workspace_id = ?',
  )
    .bind(args.jobId, args.workspaceId)
    .first<{
      id: string;
      customer_id: string;
      opportunity_id: string;
    }>();
  if (!job) return { created: false, reason: 'job_not_found' };

  const existing = await loadDepositByJob(env, args.workspaceId, args.jobId);
  if (existing && existing.status !== 'failed') {
    return {
      created: true,
      deposit: existing,
      clientSecret: null,
      alreadyExisted: true,
    };
  }

  if (!env.STRIPE_SECRET_KEY) {
    return { created: false, reason: 'payments_unavailable' };
  }

  let connectedAccountId = args.connectedAccountId;
  if (connectedAccountId === undefined) {
    const workspace = await env.DB.prepare(
      'SELECT stripe_account_id FROM workspaces WHERE id = ?',
    )
      .bind(args.workspaceId)
      .first<{ stripe_account_id: string | null }>();
    connectedAccountId = workspace?.stripe_account_id ?? null;
  }
  if (!connectedAccountId) {
    return { created: false, reason: 'no_connect_account' };
  }

  // The lead behind the job (via its opportunity) carries the fee that
  // was actually charged and the quote the deposit caps against.
  const opportunity = await env.DB.prepare(
    'SELECT lead_id FROM opportunities WHERE id = ? AND workspace_id = ?',
  )
    .bind(job.opportunity_id, args.workspaceId)
    .first<{ lead_id: string | null }>();
  const leadId = opportunity?.lead_id ?? null;

  let feeUsd: number | null = null;
  let confirmedAt: string | null = null;
  if (leadId) {
    const meter = await env.DB.prepare(
      'SELECT price_usd FROM lead_meter_events WHERE lead_id = ? AND workspace_id = ?',
    )
      .bind(leadId, args.workspaceId)
      .first<{ price_usd: number }>();
    feeUsd = meter?.price_usd ?? null;
    const lead = await env.DB.prepare(
      'SELECT accepted_at FROM leads WHERE id = ? AND workspace_id = ?',
    )
      .bind(leadId, args.workspaceId)
      .first<{ accepted_at: string | null }>();
    confirmedAt = lead?.accepted_at ?? null;
  }
  if (feeUsd == null) return { created: false, reason: 'no_fee' };

  let quoteLowDollars: number | null = null;
  if (leadId) {
    const quote = await env.DB.prepare(
      `SELECT quote_low FROM pricing_quote_sessions
        WHERE lead_id = ? AND workspace_id = ? AND quote_low IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(leadId, args.workspaceId)
      .first<{ quote_low: number }>();
    quoteLowDollars = quote?.quote_low ?? null;
  }

  const amountCents = computeDepositAmountCents({ feeUsd, quoteLowDollars });
  const feeCents = Math.round(feeUsd * 100);
  const quoteLowCents =
    quoteLowDollars != null ? Math.round(quoteLowDollars * 100) : null;
  const depositId = existing?.id ?? newId();
  // The homeowner's confirmation-page capability: minted once, kept
  // across creation retries (a re-issued intent must not strand a link
  // already texted to the customer), backfilled for rows that predate
  // migrations/040 when a retry touches them.
  const confirmationToken = existing?.confirmation_token ?? newId();

  try {
    const intent = await createPaymentIntent(env, {
      amount: amountCents,
      currency: 'usd',
      connectedAccountId,
      captureMethod: 'manual',
      description: `Booking deposit for job ${args.jobId}`,
      metadata: {
        kind: 'booking_deposit',
        deposit_id: depositId,
        workspace_id: args.workspaceId,
        job_id: args.jobId,
        ...(leadId ? { lead_id: leadId } : {}),
      },
    });

    if (existing) {
      await env.DB.prepare(
        `UPDATE deposits SET stripe_payment_intent_id = ?, connected_account_id = ?,
           amount_cents = ?, fee_cents = ?, quote_low_cents = ?, status = 'pending',
           stripe_status = ?, confirmed_at = ?, last_error = NULL,
           confirmation_token = COALESCE(confirmation_token, ?), updated_at = ?
         WHERE id = ?`,
      )
        .bind(
          intent.id,
          connectedAccountId,
          amountCents,
          feeCents,
          quoteLowCents,
          intent.status,
          confirmedAt,
          confirmationToken,
          nowIso,
          depositId,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO deposits (
           id, workspace_id, job_id, lead_id, customer_id,
           stripe_payment_intent_id, connected_account_id, amount_cents,
           currency, fee_cents, quote_low_cents, status, stripe_status,
           confirmed_at, confirmation_token, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
        .bind(
          depositId,
          args.workspaceId,
          args.jobId,
          leadId,
          job.customer_id,
          intent.id,
          connectedAccountId,
          amountCents,
          feeCents,
          quoteLowCents,
          intent.status,
          confirmedAt,
          confirmationToken,
          nowIso,
          nowIso,
        )
        .run();
    }

    const deposit = await loadDepositById(env, args.workspaceId, depositId);
    if (deposit) {
      await logDepositActivity(env, {
        workspaceId: args.workspaceId,
        actorUserId: args.actorUserId,
        deposit,
        action: 'deposit_created',
        nowIso,
        meta: { amountCents, feeCents },
      });
      return {
        created: true,
        deposit,
        clientSecret: intent.client_secret,
        alreadyExisted: false,
      };
    }
    return { created: false, reason: 'stripe_error' };
  } catch (err) {
    const message =
      err instanceof StripeError || err instanceof Error
        ? err.message
        : 'Stripe request failed';
    // Record the failure on a row so the missing deposit is visible and
    // retryable, instead of a booking that silently has no money leg.
    if (existing) {
      await env.DB.prepare(
        'UPDATE deposits SET last_error = ?, updated_at = ? WHERE id = ?',
      )
        .bind(message, nowIso, depositId)
        .run()
        .catch(() => undefined);
    } else {
      await env.DB.prepare(
        `INSERT INTO deposits (
           id, workspace_id, job_id, lead_id, customer_id, connected_account_id,
           amount_cents, currency, fee_cents, quote_low_cents, status,
           confirmed_at, last_error, confirmation_token, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, 'failed', ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO NOTHING`,
      )
        .bind(
          depositId,
          args.workspaceId,
          args.jobId,
          leadId,
          job.customer_id,
          connectedAccountId,
          amountCents,
          feeCents,
          quoteLowCents,
          confirmedAt,
          message,
          confirmationToken,
          nowIso,
          nowIso,
        )
        .run()
        .catch(() => undefined);
    }
    return { created: false, reason: 'stripe_error' };
  }
}

// ── Settlement ───────────────────────────────────────────────

export interface SettleOutcome {
  settled: boolean;
  deposit: DepositRow | null;
  reason?: string;
}

async function markSettled(
  env: Env,
  deposit: DepositRow,
  args: {
    status: DepositStatus;
    reason: DepositSettleReason;
    stripeStatus: string | null;
    actorUserId?: string | null;
    split?: ForfeitSplit;
    nowIso: string;
  },
): Promise<DepositRow> {
  await env.DB.prepare(
    `UPDATE deposits SET status = ?, settle_reason = ?, settled_at = ?,
       stripe_status = ?, fee_portion_cents = ?, shop_portion_cents = ?,
       shortfall_cents = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      args.status,
      args.reason,
      args.nowIso,
      args.stripeStatus,
      args.split?.feePortionCents ?? deposit.fee_portion_cents,
      args.split?.shopPortionCents ?? deposit.shop_portion_cents,
      args.split?.shortfallCents ?? deposit.shortfall_cents,
      args.nowIso,
      deposit.id,
    )
    .run();
  const updated =
    (await loadDepositById(env, deposit.workspace_id, deposit.id)) ?? deposit;
  await logDepositActivity(env, {
    workspaceId: deposit.workspace_id,
    actorUserId: args.actorUserId,
    deposit: updated,
    action: `deposit_${args.status}`,
    nowIso: args.nowIso,
    meta: { reason: args.reason },
  });
  return updated;
}

async function markError(
  env: Env,
  deposit: DepositRow,
  message: string,
  nowIso: string,
): Promise<void> {
  await env.DB.prepare(
    'UPDATE deposits SET last_error = ?, updated_at = ? WHERE id = ?',
  )
    .bind(message, nowIso, deposit.id)
    .run()
    .catch(() => undefined);
}

/**
 * Release the deposit in full — every exit that is not a forfeit. The
 * authorization is voided (the customer was never charged); an intent
 * that was captured anyway is refunded with its transfer reversed.
 */
export async function releaseDeposit(
  env: Env,
  args: {
    workspaceId: string;
    jobId: string;
    reason: DepositSettleReason;
    actorUserId?: string | null;
    now?: Date;
  },
): Promise<SettleOutcome> {
  const deposit = await loadDepositByJob(env, args.workspaceId, args.jobId);
  if (!deposit) return { settled: false, deposit: null, reason: 'no_deposit' };
  if (FINAL_STATUSES.has(deposit.status)) {
    return { settled: false, deposit, reason: 'already_settled' };
  }
  const nowIso = (args.now ?? new Date()).toISOString();
  if (!deposit.stripe_payment_intent_id) {
    // A 'failed' creation holds nothing; there is nothing to release.
    return { settled: false, deposit, reason: 'nothing_held' };
  }
  try {
    const intent = await getPaymentIntent(
      env,
      deposit.stripe_payment_intent_id,
    );
    if (intent.status === 'succeeded') {
      await refundPaymentIntent(env, intent.id, { reverseTransfer: true });
    } else if (intent.status !== 'canceled') {
      await cancelPaymentIntent(env, intent.id);
    }
    const updated = await markSettled(env, deposit, {
      status: 'refunded',
      reason: args.reason,
      stripeStatus: 'canceled',
      actorUserId: args.actorUserId,
      split: {
        feePortionCents: 0,
        shopPortionCents: 0,
        shortfallCents: 0,
      },
      nowIso,
    });
    return { settled: true, deposit: updated };
  } catch (err) {
    await markError(
      env,
      deposit,
      err instanceof Error ? err.message : 'Stripe release failed',
      nowIso,
    );
    return { settled: false, deposit, reason: 'stripe_error' };
  }
}

/**
 * Apply the deposit to the job: capture in full to the shop on
 * completion. The fee bills through the lead meter as usual; nothing
 * is taken out of the deposit.
 */
export async function applyDeposit(
  env: Env,
  args: {
    workspaceId: string;
    jobId: string;
    actorUserId?: string | null;
    now?: Date;
  },
): Promise<SettleOutcome> {
  const deposit = await loadDepositByJob(env, args.workspaceId, args.jobId);
  if (!deposit) return { settled: false, deposit: null, reason: 'no_deposit' };
  if (FINAL_STATUSES.has(deposit.status)) {
    return { settled: false, deposit, reason: 'already_settled' };
  }
  const nowIso = (args.now ?? new Date()).toISOString();
  if (!deposit.stripe_payment_intent_id) {
    return { settled: false, deposit, reason: 'nothing_held' };
  }
  try {
    const intent = await capturePaymentIntent(
      env,
      deposit.stripe_payment_intent_id,
    );
    const updated = await markSettled(env, deposit, {
      status: 'applied',
      reason: 'job_completed',
      stripeStatus: intent.status,
      actorUserId: args.actorUserId,
      split: {
        feePortionCents: 0,
        shopPortionCents: deposit.amount_cents,
        shortfallCents: 0,
      },
      nowIso,
    });
    return { settled: true, deposit: updated };
  } catch (err) {
    await markError(
      env,
      deposit,
      err instanceof Error ? err.message : 'Stripe capture failed',
      nowIso,
    );
    return { settled: false, deposit, reason: 'stripe_error' };
  }
}

/**
 * Settle the deposit as a forfeit: capture with GreenPut's fee as the
 * application fee (fee first, remainder to the shop), record the
 * split, and waive the lead's pending meter event — the fee is
 * recovered here, so it is never invoiced as a second bill, and any
 * shortfall against it is absorbed (fee paper v2 §4.6).
 */
export async function forfeitDeposit(
  env: Env,
  args: {
    workspaceId: string;
    jobId: string;
    reason: Extract<
      DepositSettleReason,
      'customer_cancel_inside_window' | 'no_show'
    >;
    actorUserId?: string | null;
    now?: Date;
  },
): Promise<SettleOutcome> {
  const deposit = await loadDepositByJob(env, args.workspaceId, args.jobId);
  if (!deposit) return { settled: false, deposit: null, reason: 'no_deposit' };
  if (FINAL_STATUSES.has(deposit.status)) {
    return { settled: false, deposit, reason: 'already_settled' };
  }
  const nowIso = (args.now ?? new Date()).toISOString();
  if (!deposit.stripe_payment_intent_id) {
    return { settled: false, deposit, reason: 'nothing_held' };
  }
  const split = splitForfeit({
    amountCents: deposit.amount_cents,
    feeCents: deposit.fee_cents,
  });
  try {
    const intent = await capturePaymentIntent(
      env,
      deposit.stripe_payment_intent_id,
      split.feePortionCents > 0
        ? { applicationFeeAmount: split.feePortionCents }
        : {},
    );
    const updated = await markSettled(env, deposit, {
      status: 'forfeited',
      reason: args.reason,
      stripeStatus: intent.status,
      actorUserId: args.actorUserId,
      split,
      nowIso,
    });
    if (deposit.lead_id) {
      await env.DB.prepare(
        `UPDATE lead_meter_events SET status = 'waived', notes = ?
          WHERE lead_id = ? AND workspace_id = ? AND status = 'pending'`,
      )
        .bind(
          `Waived: fee settled from deposit forfeit on ${nowIso} ` +
            `(recovered ${split.feePortionCents} of ${deposit.fee_cents} cents` +
            (split.shortfallCents > 0
              ? `; shortfall of ${split.shortfallCents} cents absorbed by GreenPut`
              : '') +
            ')',
          deposit.lead_id,
          args.workspaceId,
        )
        .run();
    }
    return { settled: true, deposit: updated };
  } catch (err) {
    await markError(
      env,
      deposit,
      err instanceof Error ? err.message : 'Stripe capture failed',
      nowIso,
    );
    return { settled: false, deposit, reason: 'stripe_error' };
  }
}

// ── Webhook reconciliation ───────────────────────────────────

interface StripeEventLike {
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Keep deposit rows honest about what Stripe reports, for events the
 * lifecycle calls did not initiate: the customer's authorization
 * landing (pending → held), a declined authorization (failed), and an
 * authorization voided or expired out of band (the hold is gone, so
 * the customer-facing outcome is a full release). Settlement states
 * the lifecycle set are never overwritten — the webhook only mirrors
 * `stripe_status` for those.
 */
export async function handleDepositWebhookEvent(
  env: Env,
  event: StripeEventLike,
  now: Date = new Date(),
): Promise<boolean> {
  const pi = event.data.object;
  const piId = pi['id'];
  if (typeof piId !== 'string') return false;
  const deposit = await env.DB.prepare(
    'SELECT * FROM deposits WHERE stripe_payment_intent_id = ?',
  )
    .bind(piId)
    .first<DepositRow>();
  if (!deposit) return false;

  const nowIso = now.toISOString();
  const piStatus = typeof pi['status'] === 'string' ? pi['status'] : null;

  switch (event.type) {
    case 'payment_intent.amount_capturable_updated': {
      await env.DB.prepare(
        `UPDATE deposits SET status = CASE WHEN status = 'pending' THEN 'held' ELSE status END,
           stripe_status = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(piStatus ?? 'requires_capture', nowIso, deposit.id)
        .run();
      return true;
    }
    case 'payment_intent.succeeded': {
      await env.DB.prepare(
        'UPDATE deposits SET stripe_status = ?, updated_at = ? WHERE id = ?',
      )
        .bind(piStatus ?? 'succeeded', nowIso, deposit.id)
        .run();
      return true;
    }
    case 'payment_intent.payment_failed': {
      const failure =
        (pi['last_payment_error'] as { message?: string } | undefined)
          ?.message ?? 'Payment failed';
      await env.DB.prepare(
        `UPDATE deposits SET
           status = CASE WHEN status IN ('pending','held') THEN 'failed' ELSE status END,
           stripe_status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(piStatus, failure, nowIso, deposit.id)
        .run();
      return true;
    }
    case 'payment_intent.canceled': {
      await env.DB.prepare(
        `UPDATE deposits SET
           status = CASE WHEN status IN ('pending','held') THEN 'refunded' ELSE status END,
           settle_reason = CASE WHEN status IN ('pending','held') THEN 'authorization_released' ELSE settle_reason END,
           settled_at = CASE WHEN status IN ('pending','held') THEN ? ELSE settled_at END,
           stripe_status = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(nowIso, piStatus ?? 'canceled', nowIso, deposit.id)
        .run();
      return true;
    }
    default:
      return false;
  }
}
