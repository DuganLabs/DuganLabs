export interface BillingStatusFixture {
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export function createBillingStatus(
  overrides: Partial<BillingStatusFixture> = {},
): BillingStatusFixture {
  return {
    plan: 'starter',
    status: 'active',
    currentPeriodEnd: '2026-05-01T00:00:00Z',
    cancelAtPeriodEnd: false,
    stripeCustomerId: 'cus_test123',
    stripeSubscriptionId: 'sub_test123',
    ...overrides,
  };
}
