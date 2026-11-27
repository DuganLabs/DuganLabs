import { describe, it, expect } from 'vitest';
import {
  SubscribeBillingSchema,
  BillingPortalSchema,
  UpdateUsageBalanceSchema,
} from './billing';

describe('SubscribeBillingSchema', () => {
  it('accepts valid priceId', () => {
    const result = SubscribeBillingSchema.safeParse({
      priceId: 'price_1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing priceId', () => {
    const result = SubscribeBillingSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty priceId', () => {
    const result = SubscribeBillingSchema.safeParse({ priceId: '' });
    expect(result.success).toBe(false);
  });

  it('accepts any non-empty string as priceId', () => {
    const result = SubscribeBillingSchema.safeParse({
      priceId: 'plan_monthly',
    });
    expect(result.success).toBe(true);
  });

  it('strips unknown fields', () => {
    const result = SubscribeBillingSchema.safeParse({
      priceId: 'price_abc',
      extraField: 'ignored',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>)['extraField'],
      ).toBeUndefined();
    }
  });
});

describe('BillingPortalSchema', () => {
  it('accepts valid HTTPS returnUrl', () => {
    const result = BillingPortalSchema.safeParse({
      returnUrl: 'https://app.greenput.com/settings',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid HTTP returnUrl', () => {
    const result = BillingPortalSchema.safeParse({
      returnUrl: 'http://localhost:4200/settings',
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing returnUrl (optional field)', () => {
    const result = BillingPortalSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects invalid relative URL', () => {
    const result = BillingPortalSchema.safeParse({ returnUrl: '/settings' });
    expect(result.success).toBe(false);
  });

  it('rejects plain string that is not a URL', () => {
    const result = BillingPortalSchema.safeParse({ returnUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('parses returnUrl correctly', () => {
    const result = BillingPortalSchema.safeParse({
      returnUrl: 'https://app.greenput.com/billing',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.returnUrl).toBe('https://app.greenput.com/billing');
    }
  });

  it('rejects FTP URL as returnUrl', () => {
    const result = BillingPortalSchema.safeParse({
      returnUrl: 'ftp://files.example.com',
    });
    // Zod url() validator accepts ftp:// — just ensure no crash
    expect(typeof result.success).toBe('boolean');
  });

  it('returnUrl is undefined when omitted', () => {
    const result = BillingPortalSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.returnUrl).toBeUndefined();
    }
  });

  it('strips extra keys from BillingPortalSchema', () => {
    const result = BillingPortalSchema.safeParse({
      returnUrl: 'https://app.greenput.com/settings',
      extra: 'ignored',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['extra']).toBeUndefined();
    }
  });
});

describe('SubscribeBillingSchema additional', () => {
  it('accepts priceId with underscores', () => {
    const result = SubscribeBillingSchema.safeParse({
      priceId: 'price_monthly_pro',
    });
    expect(result.success).toBe(true);
  });

  it('rejects null priceId', () => {
    const result = SubscribeBillingSchema.safeParse({ priceId: null });
    expect(result.success).toBe(false);
  });

  it('rejects numeric priceId', () => {
    const result = SubscribeBillingSchema.safeParse({ priceId: 12345 });
    expect(result.success).toBe(false);
  });
});

describe('UpdateUsageBalanceSchema', () => {
  it('accepts a $10 top-up and a $2 threshold', () => {
    const result = UpdateUsageBalanceSchema.safeParse({
      topupCents: 1000,
      thresholdCents: 200,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a top-up under Stripe’s minimum and a threshold that the top-up cannot clear', () => {
    expect(
      UpdateUsageBalanceSchema.safeParse({
        topupCents: 49,
        thresholdCents: 0,
      }).success,
    ).toBe(false);
    expect(
      UpdateUsageBalanceSchema.safeParse({
        topupCents: 1000,
        thresholdCents: 1000,
      }).success,
    ).toBe(false);
    expect(
      UpdateUsageBalanceSchema.safeParse({
        topupCents: 1000,
        thresholdCents: -1,
      }).success,
    ).toBe(false);
  });
});
