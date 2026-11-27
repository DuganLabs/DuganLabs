/**
 * The D1 half of "may this workspace receive a booked lead?" — shared by
 * the API's lead-billing gate (apps/api/src/lib/lead-billing-gate.ts:
 * accept, schedule-aware delivery, pool accept) and the tenant site's
 * homeowner self-booking (apps/tenant-site/src/booking.ts), so both read
 * the same rows the same way.
 *
 * - DELIVERY_PAUSED: a pending lead fee (or usage top-up) whose charge
 *   failed or is still processing. Fully decided by these rows.
 * - CARD_REQUIRED: the card-on-file source is `workspaces.
 *   stripe_customer_id`. With no Stripe customer there is no card. The
 *   API, which holds the Stripe key, then confirms a default payment
 *   method or saved card live; the tenant site holds no Stripe key, so it
 *   can only apply the D1 half (no customer ⇒ no card).
 */

export type ReceiveBlockCode = 'CARD_REQUIRED' | 'DELIVERY_PAUSED';

/** Binds: workspace id, workspace id. Answers `{ n }`. */
export const OUTSTANDING_LEAD_FEES_SQL = `SELECT
       (SELECT COUNT(*) FROM lead_meter_events
         WHERE workspace_id = ?
           AND status = 'pending'
           AND payment_status IN ('failed', 'processing'))
       +
       (SELECT COUNT(*) FROM workspace_usage_ledger
         WHERE workspace_id = ?
           AND kind = 'topup'
           AND payment_status IN ('failed', 'processing'))
       AS n`;

/** Binds: workspace id. Answers `{ stripe_customer_id }`. */
export const WORKSPACE_STRIPE_CUSTOMER_SQL =
  'SELECT stripe_customer_id FROM workspaces WHERE id = ?';
