import {
  isDemoWorkspaceSlug,
  OUTSTANDING_LEAD_FEES_SQL,
  WORKSPACE_SLUG_SQL,
  WORKSPACE_STRIPE_CUSTOMER_SQL,
  type ReceiveBlockCode,
} from '@greenput/shared/models';
import type { Env } from '../env';
import {
  defaultPaymentMethodId,
  listCustomerCards,
  retrieveStripeCustomer,
} from './stripe';

/**
 * A workspace may receive a lead only when GreenPut will not be left
 * holding the contractor's cost.
 *
 * When `STRIPE_SECRET_KEY` is set, accept, schedule-aware delivery, and
 * pool accept all call `assertCanReceiveLeads` before they write. The
 * workspace needs a Stripe customer with a default payment method, or a
 * saved card. No card, or a Stripe error we cannot see past, is
 * `CARD_REQUIRED` and nothing is accepted or booked.
 *
 * A pending lead fee whose charge failed or is still processing is
 * `DELIVERY_PAUSED`, with or without a Stripe key. So is a usage top-up
 * (prepaid SMS balance) whose charge failed or is still processing.
 * `unconfigured`, `no_payment_method`, and `below_minimum` are not
 * outstanding: a development accept that never talked to Stripe must not
 * lock the next one. Withdrawing the lead does NOT waive the pending
 * row either (WS-1), and neither does undoing a delivery — the fee
 * stands until it is collected or a fraud / platform-fault refund is
 * recorded, and only then does the pause lift. A captured fee is not
 * refunded outside those two cases. A paid top-up is not refunded either.
 *
 * The check is live. There is no stored payment-method column. The D1
 * queries live in @greenput/shared/models (lead-receive-gate.ts) so the
 * tenant site's homeowner self-booking applies the same rows.
 */

export const CARD_REQUIRED_MESSAGE =
  'A card on file is required before this workspace can accept or auto-book a lead.';

export const DELIVERY_PAUSED_MESSAGE =
  'Lead delivery is paused until the card is updated and the outstanding fee is collected.';

export type { ReceiveBlockCode };

export type ReceiveBlock =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: ReceiveBlockCode;
      readonly message: string;
    };

export interface LeadReceiveReadiness {
  /** False when this Worker has no `STRIPE_SECRET_KEY`. */
  readonly billingConfigured: boolean;
  /** Null when billing is not configured and the card was not looked up. */
  readonly cardOnFile: boolean | null;
  readonly deliveryPaused: boolean;
  readonly message: string | null;
}

export async function assertCanReceiveLeads(
  env: Env,
  workspaceId: string,
): Promise<ReceiveBlock> {
  // The public demo shop is never billed, so never gated on billing.
  if (await isDemoWorkspace(env, workspaceId)) return { ok: true };
  if ((await outstandingFeeCount(env, workspaceId)) > 0) {
    return {
      ok: false,
      code: 'DELIVERY_PAUSED',
      message: DELIVERY_PAUSED_MESSAGE,
    };
  }
  if (!env.STRIPE_SECRET_KEY) return { ok: true };
  if (await savedCardOnFile(env, workspaceId)) return { ok: true };
  return {
    ok: false,
    code: 'CARD_REQUIRED',
    message: CARD_REQUIRED_MESSAGE,
  };
}

/** Settings → Billing. Does not charge. */
export async function leadReceiveReadiness(
  env: Env,
  workspaceId: string,
): Promise<LeadReceiveReadiness> {
  const deliveryPaused = (await outstandingFeeCount(env, workspaceId)) > 0;
  if (!env.STRIPE_SECRET_KEY) {
    return {
      billingConfigured: false,
      cardOnFile: null,
      deliveryPaused,
      message: deliveryPaused ? DELIVERY_PAUSED_MESSAGE : null,
    };
  }
  const cardOnFile = await savedCardOnFile(env, workspaceId);
  let message: string | null = null;
  if (deliveryPaused && !cardOnFile) {
    message = `${DELIVERY_PAUSED_MESSAGE} ${CARD_REQUIRED_MESSAGE}`;
  } else if (deliveryPaused) {
    message = DELIVERY_PAUSED_MESSAGE;
  } else if (!cardOnFile) {
    message = CARD_REQUIRED_MESSAGE;
  }
  return {
    billingConfigured: true,
    cardOnFile,
    deliveryPaused,
    message,
  };
}

/** The public demo shop (slug `demo`), which is never billed. */
export async function isDemoWorkspace(
  env: Env,
  workspaceId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(WORKSPACE_SLUG_SQL)
    .bind(workspaceId)
    .first<{ slug: string | null }>();
  return isDemoWorkspaceSlug(row?.slug);
}

/**
 * Pending fees GreenPut has tried to collect and has not. A row that
 * was never sent to Stripe is not this.
 */
async function outstandingFeeCount(
  env: Env,
  workspaceId: string,
): Promise<number> {
  const row = await env.DB.prepare(OUTSTANDING_LEAD_FEES_SQL)
    .bind(workspaceId, workspaceId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function savedCardOnFile(
  env: Env,
  workspaceId: string,
): Promise<boolean> {
  const workspace = await env.DB.prepare(WORKSPACE_STRIPE_CUSTOMER_SQL)
    .bind(workspaceId)
    .first<{ stripe_customer_id: string | null }>();
  const customerId = workspace?.stripe_customer_id;
  if (!customerId) return false;
  try {
    const customer = await retrieveStripeCustomer(env, customerId);
    if (defaultPaymentMethodId(customer)) return true;
    const cards = await listCustomerCards(env, customerId);
    return Boolean(cards[0]?.id);
  } catch {
    // Cannot prove a card is on file. Do not accept the lead.
    return false;
  }
}
