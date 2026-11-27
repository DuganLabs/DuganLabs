import type { ApiClient } from '@basenative/fetch';
import type { Subscription } from '@greenput/shared/models';

/**
 * Settings → Billing.
 *
 * `status()` is the workspace's newest `subscriptions` row as the API
 * serializes it through WIRE_SUBSCRIPTION — the shared `Subscription` model,
 * not a local copy of it (the local copy is how `currentPeriodEnd` was read
 * off a row that only ever carried `current_period_end`). `null` means the
 * workspace has no subscription at all; the panel says so rather than
 * inventing one. There is deliberately no `subscribe()` here: starting a
 * subscription is staff-assisted today.
 *
 * `portal()` rejects with an `ApiError` carrying the API's own message —
 * 503 `BILLING_UNAVAILABLE` when Stripe is not configured, 400 `NO_CUSTOMER`
 * when the workspace has no Stripe customer — and the panel shows that text.
 */
export interface BillingApi {
  status(): Promise<{ data: Subscription | null }>;
  portal(returnUrl?: string): Promise<{ data: { url: string } }>;
  /** Pending and invoiced lead fees for this workspace. */
  meter(): Promise<{ data: LeadFeeMeter }>;
  /**
   * Customer Portal session for the lead-fee card. Creates the Stripe
   * customer when the workspace does not have one yet.
   */
  paymentMethod(returnUrl?: string): Promise<{ data: { url: string } }>;
  /**
   * Charge still-pending lead fees to the saved card. Not a schedule —
   * the Billing screen offers it when something is still pending.
   */
  collectLeadFees(): Promise<{
    data: { attempted: number; paid: number; stillPending: number };
  }>;
  /** Prepaid SMS balance, top-up settings, and recent ledger rows. */
  usage(): Promise<{ data: UsageBalance }>;
  /** Saves the top-up amount and threshold. Does not charge the card. */
  updateUsage(body: {
    topupCents: number;
    thresholdCents: number;
  }): Promise<{ data: UsageBalance }>;
  /** Stripe Connect Express state. `not_started` means no account yet. */
  connectStatus(): Promise<{ data: ConnectStatus }>;
  connectOnboard(returnUrl: string): Promise<{ data: { url: string } }>;
  connectLogin(): Promise<{ data: { url: string } }>;
}

export interface LeadFeeSummary {
  readonly pendingCount: number;
  readonly pendingUsd: number;
  readonly invoicedCount: number;
  readonly invoicedUsd: number;
}

export interface LeadFeeCharge {
  readonly id: string;
  readonly leadId: string;
  readonly serviceType: string;
  readonly priceUsd: number;
  readonly status: string;
  readonly paymentStatus: string | null;
  readonly createdAt: string;
}

export interface LeadFeeMeter {
  readonly summary: LeadFeeSummary;
  readonly perLeadRates: Readonly<Record<string, number>>;
  readonly leadFeeOverrideUsd: number | null;
  readonly charges: readonly LeadFeeCharge[];
  /**
   * Whether a card is on file and whether delivery is paused. Absent
   * when an older response did not carry it.
   */
  readonly receive?: {
    readonly billingConfigured: boolean;
    readonly cardOnFile: boolean | null;
    readonly deliveryPaused: boolean;
    readonly message: string | null;
  };
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

export interface UsageBalance {
  readonly balanceMicroUsd: number;
  readonly topupCents: number;
  readonly thresholdCents: number;
  readonly entries: readonly UsageLedgerEntry[];
}

export interface ConnectStatus {
  readonly status: 'not_started' | 'pending' | 'complete';
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
}

export function createBillingApi(api: ApiClient): BillingApi {
  return {
    status: () => api.get('/api/billing/subscription'),
    portal: (returnUrl) =>
      api.post('/api/billing/portal', returnUrl ? { returnUrl } : {}),
    meter: () => api.get('/api/billing/meter'),
    paymentMethod: (returnUrl) =>
      api.post('/api/billing/payment-method', returnUrl ? { returnUrl } : {}),
    collectLeadFees: () => api.post('/api/billing/lead-fees/collect', {}),
    usage: () => api.get('/api/billing/usage'),
    updateUsage: (body) => api.patch('/api/billing/usage', body),
    connectStatus: () => api.get('/api/payments/connect'),
    connectOnboard: (returnUrl) =>
      api.post('/api/payments/connect/onboard', {
        returnUrl,
        refreshUrl: returnUrl,
      }),
    connectLogin: () => api.post('/api/payments/connect/login', {}),
  };
}
