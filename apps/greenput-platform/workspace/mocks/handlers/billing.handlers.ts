import { http, HttpResponse } from 'msw';
import { createBillingStatus } from '../data/billing.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getBillingStatusSuccess = http.get('*/api/billing', async () => {
  return HttpResponse.json({ data: createBillingStatus() });
});

export const subscribeBillingSuccess = http.post(
  '*/api/billing/subscribe',
  async () => {
    return HttpResponse.json({
      data: { sessionUrl: 'https://checkout.stripe.com/test' },
    });
  },
);

export const billingPortalSuccess = http.post(
  '*/api/billing/portal',
  async () => {
    return HttpResponse.json({
      data: { url: 'https://billing.stripe.com/test' },
    });
  },
);

export const cancelBillingSuccess = http.post(
  '*/api/billing/cancel',
  async () => {
    return HttpResponse.json({
      data: createBillingStatus({ cancelAtPeriodEnd: true }),
    });
  },
);

// ── Error handlers ──────────────────────────────────────────

export const getBillingStatusError500 = http.get('*/api/billing', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Default export ──────────────────────────────────────────

export const billingHandlers = [
  getBillingStatusSuccess,
  subscribeBillingSuccess,
  billingPortalSuccess,
  cancelBillingSuccess,
];
