import type { Env } from '../env';

/**
 * Stripe API client for Cloudflare Workers.
 * Uses fetch() directly against the Stripe REST API — no SDK needed.
 * This keeps the Worker bundle small and avoids Node.js dependencies.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * Pinned to the version the sandbox webhook endpoint
 * `we_1UTAZ8RrRXN2HLsDqQ6ZIZms` sends. Outbound calls and inbound events
 * then share one object shape. Basil (2025-03-31) moved
 * subscription.current_period_* onto the item and removed
 * invoice.subscription; readers below accept both shapes so a later
 * endpoint bump does not write Invalid Date. PaymentIntent.charges was
 * already gone by acacia (removed 2022-11-15) — read latest_charge.
 */
export const STRIPE_API_VERSION = '2025-02-24.acacia';

interface StripeRequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  env: Env;
  /** Stripe idempotency key. Retries within 24h return the original object. */
  idempotencyKey?: string;
}

async function stripeRequest<T>(opts: StripeRequestOptions): Promise<T> {
  const { method, path, body, env } = opts;

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }

  const options: RequestInit = { method, headers };

  if (body && method === 'POST') {
    const encoded = encodeFormData(body);
    if (encoded) options.body = encoded;
  }

  const response = await fetch(`${STRIPE_API}${path}`, options);
  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const error = data['error'] as Record<string, unknown> | undefined;
    throw new StripeError(
      (error?.['message'] as string) ?? 'Stripe API error',
      (error?.['code'] as string) ?? 'stripe_error',
      response.status,
      paymentIntentIdFromError(error),
    );
  }

  return data as T;
}

function encodeFormData(obj: Record<string, unknown>, prefix?: string): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;

    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(encodeFormData(value as Record<string, unknown>, fullKey));
    } else {
      parts.push(
        `${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`,
      );
    }
  }

  return parts.filter(Boolean).join('&');
}

export class StripeError extends Error {
  code: string;
  status: number;
  /** Set when a card decline returns the PaymentIntent it failed to confirm. */
  paymentIntentId: string | null;

  constructor(
    message: string,
    code: string,
    status: number,
    paymentIntentId: string | null = null,
  ) {
    super(message);
    this.name = 'StripeError';
    this.code = code;
    this.status = status;
    this.paymentIntentId = paymentIntentId;
  }
}

function paymentIntentIdFromError(
  error: Record<string, unknown> | undefined,
): string | null {
  const pi = error?.['payment_intent'];
  if (typeof pi === 'string' && pi.length > 0) return pi;
  if (pi && typeof pi === 'object') {
    const id = (pi as Record<string, unknown>)['id'];
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

// ── Customers ────────────────────────────────────────────────

export interface StripeCustomer {
  id: string;
  email: string;
  name: string;
  metadata: Record<string, string>;
  invoice_settings?: {
    default_payment_method?: string | { id: string } | null;
  };
}

export async function createStripeCustomer(
  env: Env,
  params: {
    email: string;
    name: string;
    workspaceId: string;
    idempotencyKey?: string;
  },
): Promise<StripeCustomer> {
  const email = params.email.trim();
  return stripeRequest<StripeCustomer>({
    method: 'POST',
    path: '/customers',
    body: {
      email: email.length > 0 ? email : undefined,
      name: params.name,
      metadata: { workspace_id: params.workspaceId },
    },
    env,
    idempotencyKey: params.idempotencyKey,
  });
}

export async function retrieveStripeCustomer(
  env: Env,
  customerId: string,
): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>({
    method: 'GET',
    path: `/customers/${customerId}`,
    env,
  });
}

/** The id of a saved card, if the customer has one. Default first. */
export function defaultPaymentMethodId(
  customer: StripeCustomer,
): string | null {
  const raw = customer.invoice_settings?.default_payment_method;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (raw && typeof raw === 'object' && typeof raw.id === 'string')
    return raw.id;
  return null;
}

export async function listCustomerCards(
  env: Env,
  customerId: string,
): Promise<readonly { id: string }[]> {
  const page = await stripeRequest<{ data?: { id: string }[] }>({
    method: 'GET',
    path: `/customers/${customerId}/payment_methods?type=card&limit=1`,
    env,
  });
  return page.data ?? [];
}

/**
 * Charge a platform customer off-session. Not a Connect destination
 * charge: this is GreenPut billing the contractor for a lead fee.
 * confirm + off_session does not email an invoice. receipt_email is
 * omitted so this call does not ask Stripe to mail a receipt.
 */
export async function createOffSessionCharge(
  env: Env,
  params: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  },
): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>({
    method: 'POST',
    path: '/payment_intents',
    body: {
      amount: params.amountCents,
      currency: 'usd',
      customer: params.customerId,
      payment_method: params.paymentMethodId,
      off_session: 'true',
      confirm: 'true',
      description: params.description,
      metadata: params.metadata,
    },
    env,
    idempotencyKey: params.idempotencyKey,
  });
}

/** Confirm an existing lead-fee intent with a (possibly new) card. */
export async function confirmOffSessionCharge(
  env: Env,
  paymentIntentId: string,
  paymentMethodId: string,
  idempotencyKey: string,
): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>({
    method: 'POST',
    path: `/payment_intents/${paymentIntentId}/confirm`,
    body: {
      payment_method: paymentMethodId,
      off_session: 'true',
    },
    env,
    idempotencyKey,
  });
}

// ── Subscriptions ────────────────────────────────────────────

export interface StripeSubscription {
  id: string;
  status: string;
  /**
   * Present on API version 2025-02-24.acacia. Basil moved these onto
   * items.data[]. Read them through subscriptionPeriodUnix.
   */
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{
      price: { id: string; product: string };
      current_period_start?: number;
      current_period_end?: number;
    }>;
  };
}

/**
 * Billing period in unix seconds. Acacia puts it on the subscription;
 * Basil (2025-03-31) puts it on the first item and removes the parent
 * fields. Null when neither shape is present — callers must not invent
 * a date from NaN.
 */
export function subscriptionPeriodUnix(sub: Record<string, unknown>): {
  start: number;
  end: number;
} | null {
  const start = sub['current_period_start'];
  const end = sub['current_period_end'];
  if (typeof start === 'number' && typeof end === 'number') {
    return { start, end };
  }
  const items = sub['items'];
  if (!items || typeof items !== 'object') return null;
  const data = (items as { data?: unknown }).data;
  const item = Array.isArray(data) ? data[0] : undefined;
  if (!item || typeof item !== 'object') return null;
  const itemStart = (item as Record<string, unknown>)['current_period_start'];
  const itemEnd = (item as Record<string, unknown>)['current_period_end'];
  if (typeof itemStart === 'number' && typeof itemEnd === 'number') {
    return { start: itemStart, end: itemEnd };
  }
  return null;
}

/**
 * Subscription id on an invoice. Acacia: invoice.subscription (string or
 * expanded object). Basil removed that field; the id lives at
 * invoice.parent.subscription_details.subscription.
 */
export function invoiceSubscriptionId(
  invoice: Record<string, unknown>,
): string | null {
  const direct = stripeId(invoice['subscription']);
  if (direct) return direct;
  const parent = invoice['parent'];
  if (!parent || typeof parent !== 'object') return null;
  const details = (parent as Record<string, unknown>)['subscription_details'];
  if (!details || typeof details !== 'object') return null;
  return stripeId((details as Record<string, unknown>)['subscription']);
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

export async function createSubscription(
  env: Env,
  params: { customerId: string; priceId: string },
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>({
    method: 'POST',
    path: '/subscriptions',
    body: {
      customer: params.customerId,
      'items[0][price]': params.priceId,
      payment_behavior: 'default_incomplete',
      'payment_settings[save_default_payment_method]': 'on_subscription',
      expand: 'latest_invoice.payment_intent',
    },
    env,
  });
}

export async function cancelSubscription(
  env: Env,
  subscriptionId: string,
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>({
    method: 'POST',
    path: `/subscriptions/${subscriptionId}`,
    body: { cancel_at_period_end: 'true' },
    env,
  });
}

// ── Billing Portal ───────────────────────────────────────────

export interface StripeBillingPortalSession {
  id: string;
  url: string;
}

export async function createPortalSession(
  env: Env,
  params: { customerId: string; returnUrl: string },
): Promise<StripeBillingPortalSession> {
  return stripeRequest<StripeBillingPortalSession>({
    method: 'POST',
    path: '/billing_portal/sessions',
    body: {
      customer: params.customerId,
      return_url: params.returnUrl,
    },
    env,
  });
}

// ── Connect (Payment Processing for Contractors) ─────────────

export interface StripeAccountLink {
  url: string;
}

export async function createConnectAccount(
  env: Env,
  params: { email: string; workspaceId: string },
): Promise<{ id: string }> {
  return stripeRequest<{ id: string }>({
    method: 'POST',
    path: '/accounts',
    body: {
      type: 'express',
      email: params.email,
      metadata: { workspace_id: params.workspaceId },
      capabilities: {
        card_payments: { requested: 'true' },
        transfers: { requested: 'true' },
      },
    },
    env,
  });
}

export async function createAccountLink(
  env: Env,
  params: { accountId: string; refreshUrl: string; returnUrl: string },
): Promise<StripeAccountLink> {
  return stripeRequest<StripeAccountLink>({
    method: 'POST',
    path: '/account_links',
    body: {
      account: params.accountId,
      refresh_url: params.refreshUrl,
      return_url: params.returnUrl,
      type: 'account_onboarding',
    },
    env,
  });
}

// ── Payment Intents ──────────────────────────────────────────

export interface StripePaymentIntent {
  id: string;
  client_secret: string;
  status: string;
  amount: number;
  currency: string;
  amount_received?: number;
  application_fee_amount?: number | null;
  last_payment_error?: { message?: string; code?: string } | null;
}

export async function createPaymentIntent(
  env: Env,
  params: {
    amount: number;
    currency?: string;
    connectedAccountId: string;
    description?: string;
    metadata?: Record<string, string>;
    /**
     * 'manual' leaves the intent authorized-but-uncaptured
     * (status 'requires_capture') until capturePaymentIntent is called —
     * the booking-deposit shape (lib/deposits.ts). Omitted = Stripe's
     * default automatic capture, the job-payment shape.
     */
    captureMethod?: 'manual' | 'automatic';
    /** Platform fee taken out of the charge, in cents, when set. */
    applicationFeeAmount?: number;
  },
): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>({
    method: 'POST',
    path: '/payment_intents',
    body: {
      amount: params.amount,
      currency: params.currency ?? 'usd',
      description: params.description,
      metadata: params.metadata,
      'transfer_data[destination]': params.connectedAccountId,
      capture_method: params.captureMethod,
      application_fee_amount: params.applicationFeeAmount,
    },
    env,
  });
}

export async function getPaymentIntent(
  env: Env,
  paymentIntentId: string,
): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>({
    method: 'GET',
    path: `/payment_intents/${paymentIntentId}`,
    env,
  });
}

/**
 * Capture an authorized (manual-capture) intent. For a destination
 * charge, `applicationFeeAmount` is the platform's cut taken at capture
 * time; the remainder transfers to the connected account. That is the
 * deposit forfeit split: fee first, remainder to the shop.
 */
export async function capturePaymentIntent(
  env: Env,
  paymentIntentId: string,
  params: { applicationFeeAmount?: number } = {},
): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>({
    method: 'POST',
    path: `/payment_intents/${paymentIntentId}/capture`,
    body: {
      application_fee_amount: params.applicationFeeAmount,
    },
    env,
  });
}

/**
 * Cancel an intent that has not been captured. On an authorized intent
 * this voids the authorization — the customer's hold is released and
 * nothing was ever charged, which is the deposit "full refund" path for
 * every exit before settlement.
 */
export async function cancelPaymentIntent(
  env: Env,
  paymentIntentId: string,
): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>({
    method: 'POST',
    path: `/payment_intents/${paymentIntentId}/cancel`,
    body: {},
    env,
  });
}

/**
 * Refund a captured intent. `reverseTransfer` pulls the transferred
 * funds back out of the connected account (destination charges only) —
 * the deposit release path when an intent turns out to have been
 * captured already.
 */
export async function refundPaymentIntent(
  env: Env,
  paymentIntentId: string,
  params: { reverseTransfer?: boolean } = {},
): Promise<{ id: string; status: string }> {
  return stripeRequest<{ id: string; status: string }>({
    method: 'POST',
    path: '/refunds',
    body: {
      payment_intent: paymentIntentId,
      reverse_transfer: params.reverseTransfer ? 'true' : undefined,
      refund_application_fee: params.reverseTransfer ? 'true' : undefined,
    },
    env,
  });
}

export async function retrieveCharge(
  env: Env,
  chargeId: string,
): Promise<{ receipt_url: string | null }> {
  const charge = await stripeRequest<{ receipt_url?: string | null }>({
    method: 'GET',
    path: `/charges/${chargeId}`,
    env,
  });
  return {
    receipt_url:
      typeof charge.receipt_url === 'string' && charge.receipt_url.length > 0
        ? charge.receipt_url
        : null,
  };
}

/**
 * receipt_url lives on the Charge. Acacia PaymentIntents carry
 * latest_charge (an id, unless expanded) and do not carry `charges`.
 */
export async function receiptUrlForPaymentIntent(
  env: Env,
  pi: Record<string, unknown>,
): Promise<string | null> {
  const latest = pi['latest_charge'];
  if (latest && typeof latest === 'object') {
    const url = (latest as Record<string, unknown>)['receipt_url'];
    return typeof url === 'string' && url.length > 0 ? url : null;
  }
  if (
    typeof latest === 'string' &&
    latest.length > 0 &&
    env.STRIPE_SECRET_KEY
  ) {
    try {
      return (await retrieveCharge(env, latest)).receipt_url;
    } catch {
      return null;
    }
  }
  return null;
}

export interface StripeConnectAccount {
  id: string;
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
}

export async function retrieveConnectAccount(
  env: Env,
  accountId: string,
): Promise<StripeConnectAccount> {
  return stripeRequest<StripeConnectAccount>({
    method: 'GET',
    path: `/accounts/${accountId}`,
    env,
  });
}

export async function createLoginLink(
  env: Env,
  accountId: string,
): Promise<{ url: string }> {
  return stripeRequest<{ url: string }>({
    method: 'POST',
    path: `/accounts/${accountId}/login_links`,
    body: {},
    env,
  });
}

// ── Webhook Verification ─────────────────────────────────────

export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const parts = signature.split(',');
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1Sig = parts.find((p) => p.startsWith('v1='))?.slice(3);

  if (!timestamp || !v1Sig) return false;

  // Reject if timestamp is more than 5 minutes old
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload),
  );

  const expectedSig = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return expectedSig === v1Sig;
}
