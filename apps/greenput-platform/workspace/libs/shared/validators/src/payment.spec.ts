import { describe, it, expect } from 'vitest';
import {
  StripeConnectLinkSchema,
  CreatePaymentIntentSchema,
  CreateDepositSchema,
  CustomerPortalMagicLinkSchema,
} from './payment';

const validUuid = '550e8400-e29b-41d4-a716-446655440001';

describe('StripeConnectLinkSchema', () => {
  it('accepts empty object (all optional)', () => {
    const result = StripeConnectLinkSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts valid URLs', () => {
    const result = StripeConnectLinkSchema.safeParse({
      refreshUrl: 'https://app.greenput.com/settings',
      returnUrl: 'https://app.greenput.com/settings',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid URL', () => {
    const result = StripeConnectLinkSchema.safeParse({
      refreshUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreatePaymentIntentSchema', () => {
  it('accepts valid input', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: validUuid,
      amount: 15000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('usd');
  });

  it('accepts with all fields', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: validUuid,
      amount: 25000,
      currency: 'cad',
      description: 'HVAC service',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing jobId', () => {
    const result = CreatePaymentIntentSchema.safeParse({ amount: 10000 });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID jobId', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: 'not-a-uuid',
      amount: 10000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: validUuid,
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: validUuid,
      amount: -100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing amount', () => {
    const result = CreatePaymentIntentSchema.safeParse({ jobId: validUuid });
    expect(result.success).toBe(false);
  });

  it('defaults currency to usd', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: validUuid,
      amount: 5000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('usd');
  });

  it('rejects currency with wrong length', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: validUuid,
      amount: 5000,
      currency: 'us',
    });
    expect(result.success).toBe(false);
  });

  it('rejects description exceeding 500 chars', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: validUuid,
      amount: 5000,
      description: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('accepts description at max length (500 chars)', () => {
    const result = CreatePaymentIntentSchema.safeParse({
      jobId: validUuid,
      amount: 5000,
      description: 'x'.repeat(500),
    });
    expect(result.success).toBe(true);
  });
});

describe('CustomerPortalMagicLinkSchema', () => {
  it('accepts valid email', () => {
    const result = CustomerPortalMagicLinkSchema.safeParse({
      email: 'customer@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing email', () => {
    const result = CustomerPortalMagicLinkSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = CustomerPortalMagicLinkSchema.safeParse({
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects email without TLD', () => {
    const result = CustomerPortalMagicLinkSchema.safeParse({
      email: 'user@domain',
    });
    expect(result.success).toBe(false);
  });
});

describe('StripeConnectLinkSchema additional', () => {
  it('accepts returnUrl only', () => {
    const result = StripeConnectLinkSchema.safeParse({
      returnUrl: 'https://app.greenput.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts refreshUrl only', () => {
    const result = StripeConnectLinkSchema.safeParse({
      refreshUrl: 'https://app.greenput.com/refresh',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid returnUrl', () => {
    const result = StripeConnectLinkSchema.safeParse({
      returnUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateDepositSchema', () => {
  it('accepts a valid job UUID', () => {
    const result = CreateDepositSchema.safeParse({ jobId: validUuid });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID jobId', () => {
    const result = CreateDepositSchema.safeParse({ jobId: 'job-1' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing jobId', () => {
    const result = CreateDepositSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
