import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  createStripeCustomer,
  invoiceSubscriptionId,
  STRIPE_API_VERSION,
  StripeError,
  subscriptionPeriodUnix,
  verifyWebhookSignature,
} from './stripe';

describe('StripeError', () => {
  it('creates error with code and status', () => {
    const err = new StripeError('Card declined', 'card_declined', 402);
    expect(err.message).toBe('Card declined');
    expect(err.code).toBe('card_declined');
    expect(err.status).toBe(402);
    expect(err.name).toBe('StripeError');
  });

  it('is an instance of Error', () => {
    const err = new StripeError('Oops', 'some_code', 500);
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of StripeError', () => {
    const err = new StripeError('Oops', 'some_code', 500);
    expect(err).toBeInstanceOf(StripeError);
  });

  it('preserves stack trace', () => {
    const err = new StripeError('Error', 'code', 400);
    expect(err.stack).toBeTruthy();
  });

  it('accepts 404 status for resource_missing', () => {
    const err = new StripeError('No such customer', 'resource_missing', 404);
    expect(err.status).toBe(404);
    expect(err.code).toBe('resource_missing');
  });

  it('accepts 429 status for rate_limit errors', () => {
    const err = new StripeError('Rate limit exceeded', 'rate_limit', 429);
    expect(err.status).toBe(429);
  });
});

describe('verifyWebhookSignature', () => {
  it('rejects missing timestamp', async () => {
    const result = await verifyWebhookSignature('payload', 'v1=abc', 'secret');
    expect(result).toBe(false);
  });

  it('rejects missing v1 signature', async () => {
    const result = await verifyWebhookSignature(
      'payload',
      't=1234567890',
      'secret',
    );
    expect(result).toBe(false);
  });

  it('rejects expired timestamp', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const result = await verifyWebhookSignature(
      'payload',
      `t=${oldTimestamp},v1=abc123`,
      'secret',
    );
    expect(result).toBe(false);
  });

  it('verifies a valid signature', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = '{"type":"test"}';
    const secret = 'whsec_test_secret';
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
    const sig = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = await verifyWebhookSignature(
      payload,
      `t=${timestamp},v1=${sig}`,
      secret,
    );
    expect(result).toBe(true);
  });

  it('rejects invalid signature', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const result = await verifyWebhookSignature(
      '{"type":"test"}',
      `t=${timestamp},v1=deadbeef`,
      'whsec_test_secret',
    );
    expect(result).toBe(false);
  });

  it('rejects empty signature header', async () => {
    const result = await verifyWebhookSignature('payload', '', 'secret');
    expect(result).toBe(false);
  });

  it('rejects when signature is for a different payload', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secret = 'whsec_test_secret';
    const wrongPayload = '{"type":"wrong"}';
    const signedPayload = `${timestamp}.${wrongPayload}`;

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
    const sig = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = await verifyWebhookSignature(
      '{"type":"real"}',
      `t=${timestamp},v1=${sig}`,
      secret,
    );
    expect(result).toBe(false);
  });

  it('accepts signature just within the 5-minute window', async () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 290).toString();
    const payload = 'data';
    const secret = 'secret';
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
    const sig = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = await verifyWebhookSignature(
      payload,
      `t=${timestamp},v1=${sig}`,
      secret,
    );
    expect(result).toBe(true);
  });
});

describe('Stripe API version and removed fields', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Stripe-Version 2025-02-24.acacia on every call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'cus_1', email: '', name: '', metadata: {} }),
        {
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await createStripeCustomer({ STRIPE_SECRET_KEY: 'sk_test' } as Env, {
      email: 'a@example.com',
      name: 'Ada',
      workspaceId: 'ws-1',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Stripe-Version']).toBe(STRIPE_API_VERSION);
    expect(STRIPE_API_VERSION).toBe('2025-02-24.acacia');
    expect(String(init.body)).toContain('metadata%5Bworkspace_id%5D=ws-1');
  });

  it('reads the billing period from the subscription or from the first item', () => {
    expect(
      subscriptionPeriodUnix({
        current_period_start: 10,
        current_period_end: 20,
      }),
    ).toEqual({ start: 10, end: 20 });
    expect(
      subscriptionPeriodUnix({
        items: { data: [{ current_period_start: 30, current_period_end: 40 }] },
      }),
    ).toEqual({ start: 30, end: 40 });
    expect(subscriptionPeriodUnix({ status: 'active' })).toBeNull();
  });

  it('reads invoice.subscription from the acacia field or the basil parent', () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_1' })).toBe('sub_1');
    expect(
      invoiceSubscriptionId({
        parent: { subscription_details: { subscription: 'sub_2' } },
      }),
    ).toBe('sub_2');
    expect(invoiceSubscriptionId({ id: 'in_1' })).toBeNull();
  });
});
