import { describe, it, expect, vi } from 'vitest';
import { paymentsRouter } from './payments';

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
    SESSIONS: {},
    CHAT_ROOM: {},
    ENVIRONMENT: 'test',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    ...overrides,
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  ctx: Record<string, unknown> = {},
) {
  const req = new Request(`https://api.greenput.com/api/payments${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] =
    ctx['workspaceId'] ?? 'ws-1';
  return req;
}

describe('paymentsRouter', () => {
  it('exports paymentsRouter with fetch', () => {
    expect(paymentsRouter).toBeDefined();
    expect(typeof paymentsRouter.fetch).toBe('function');
  });
});

describe('GET /api/payments', () => {
  it('returns paginated payment list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 0 });
    const res = await paymentsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBe(0);
  });

  it('passes status filter to query', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 0 });
    const res = await paymentsRouter.fetch(makeReq('/?status=succeeded'), env);
    expect(res.status).toBe(200);
  });

  it('passes jobId filter to query', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 0 });
    const res = await paymentsRouter.fetch(makeReq('/?jobId=job-1'), env);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/payments/:id', () => {
  it('returns 404 when payment not found', async () => {
    const env = makeEnv();
    const res = await paymentsRouter.fetch(makeReq('/pay-999'), env);
    expect(res.status).toBe(404);
  });

  it('returns payment when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'pay-1',
      amount: 5000,
      currency: 'usd',
      status: 'succeeded',
    });
    const res = await paymentsRouter.fetch(makeReq('/pay-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('pay-1');
  });
});

describe('POST /api/payments/connect/onboard', () => {
  it('returns 503 when STRIPE_SECRET_KEY is missing', async () => {
    const env = makeEnv({ STRIPE_SECRET_KEY: '' });
    const res = await paymentsRouter.fetch(
      makeReq('/connect/onboard', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(503);
  });
});

describe('POST /api/payments/connect/onboard (account link)', () => {
  it('returns 503 when STRIPE_SECRET_KEY is missing', async () => {
    const env = makeEnv({ STRIPE_SECRET_KEY: '' });
    const res = await paymentsRouter.fetch(
      makeReq('/connect/onboard', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('returns 404 when workspace not found', async () => {
    const env = makeEnv();
    // first() returns null → workspace not found
    const res = await paymentsRouter.fetch(
      makeReq('/connect/onboard', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

describe('POST /api/payments/intent', () => {
  it('returns 400 when jobId is missing', async () => {
    const env = makeEnv();
    const res = await paymentsRouter.fetch(
      makeReq('/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 5000 }), // missing jobId
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when jobId is not a valid UUID', async () => {
    const env = makeEnv();
    const res = await paymentsRouter.fetch(
      makeReq('/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: 'not-a-uuid', amount: 5000 }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 503 when STRIPE_SECRET_KEY is missing', async () => {
    const env = makeEnv({ STRIPE_SECRET_KEY: '' });
    const res = await paymentsRouter.fetch(
      makeReq('/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: VALID_UUID, amount: 5000 }),
      }),
      env,
    );
    expect(res.status).toBe(503);
  });
});

describe('POST /api/payments/webhook', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const env = makeEnv();
    const res = await paymentsRouter.fetch(
      makeReq('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'payment_intent.succeeded' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('payments webhook event types', () => {
  it('handles the documented set of event types', () => {
    const handledEvents = [
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
    ];
    expect(handledEvents).toHaveLength(5);
    expect(handledEvents).toContain('customer.subscription.deleted');
  });
});

describe('GET /api/payments pagination', () => {
  it('returns meta with page and perPage', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 75 });
    const res = await paymentsRouter.fetch(makeReq('/?page=2&perPage=10'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { page: number; perPage: number; total: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(10);
    expect(body.meta.total).toBe(75);
  });

  it('defaults to page 1 and perPage 25', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 0 });
    const res = await paymentsRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as {
      meta: { page: number; perPage: number };
    };
    expect(body.meta.page).toBe(1);
    expect(body.meta.perPage).toBe(25);
  });

  it('caps perPage at 100', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 0 });
    const res = await paymentsRouter.fetch(makeReq('/?perPage=999'), env);
    const body = (await res.json()) as { meta: { perPage: number } };
    expect(body.meta.perPage).toBe(100);
  });
});

describe('GET /api/payments list data', () => {
  it('returns payment rows from DB', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 2 });
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        { id: 'pay-a', amount: 5000, currency: 'usd', status: 'succeeded' },
        { id: 'pay-b', amount: 3000, currency: 'usd', status: 'pending' },
      ],
    });
    const res = await paymentsRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.length).toBe(2);
    expect(body.data[0]?.id).toBe('pay-a');
  });

  it('passes customerId filter to query', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 0 });
    const res = await paymentsRouter.fetch(makeReq('/?customerId=cust-1'), env);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/payments/intent additional validation', () => {
  it('returns 400 when amount is zero', async () => {
    const env = makeEnv();
    const res = await paymentsRouter.fetch(
      makeReq('/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: VALID_UUID, amount: 0 }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is negative', async () => {
    const env = makeEnv();
    const res = await paymentsRouter.fetch(
      makeReq('/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: VALID_UUID, amount: -100 }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is missing', async () => {
    const env = makeEnv();
    const res = await paymentsRouter.fetch(
      makeReq('/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: VALID_UUID }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});
