import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  checkWire,
  describeWireProblems,
  WIRE_SUBSCRIPTION,
  type Subscription,
} from '@greenput/shared/models';
import type { Env } from '../env';
import { billingRouter } from './billing';

const SCHEMA = resolve(__dirname, '../../../../schema.sql');
const WS1 = '00000000-0000-4000-8000-0000000000b1';
const WS2 = '00000000-0000-4000-8000-0000000000b2';

function makeEnv(stripeKey = '') {
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
    ENVIRONMENT: 'development',
    ...(stripeKey ? { STRIPE_SECRET_KEY: stripeKey } : {}),
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  workspaceId = 'ws-1',
  userId = 'user-1',
  role = 'owner',
) {
  const req = new Request(`https://api.greenput.com/api/billing${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = { id: userId, role };
  return req;
}

describe('billingRouter', () => {
  it('exports billingRouter with fetch', () => {
    expect(billingRouter).toBeDefined();
    expect(typeof billingRouter.fetch).toBe('function');
  });
});

describe('GET /api/billing/subscription', () => {
  it('returns 200 with null data when no subscription exists', async () => {
    const env = makeEnv();
    const res = await billingRouter.fetch(
      makeReq('/subscription', {}, 'ws-1', 'user-1', 'admin'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: null };
    expect(body.data).toBeNull();
  });

  it('returns 403 for non-admin role (tech)', async () => {
    const env = makeEnv();
    const res = await billingRouter.fetch(
      makeReq('/subscription', {}, 'ws-1', 'user-1', 'tech'),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('allows admin role', async () => {
    const env = makeEnv();
    const res = await billingRouter.fetch(
      makeReq('/subscription', {}, 'ws-1', 'user-1', 'admin'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('allows owner role', async () => {
    const env = makeEnv();
    const res = await billingRouter.fetch(
      makeReq('/subscription', {}, 'ws-1', 'user-1', 'owner'),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/billing/subscribe', () => {
  it('returns 400 when priceId is missing', async () => {
    const env = makeEnv('sk_test_abc');
    const res = await billingRouter.fetch(
      makeReq('/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-owner role', async () => {
    const env = makeEnv('sk_test_abc');
    const res = await billingRouter.fetch(
      makeReq(
        '/subscribe',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priceId: 'price_123' }),
        },
        'ws-1',
        'user-1',
        'admin',
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 503 when STRIPE_SECRET_KEY is not configured', async () => {
    const env = makeEnv(''); // no stripe key
    const res = await billingRouter.fetch(
      makeReq('/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: 'price_123' }),
      }),
      env,
    );
    expect(res.status).toBe(503);
  });
});

describe('POST /api/billing/cancel', () => {
  it('returns 403 for non-owner role', async () => {
    const env = makeEnv('sk_test_abc');
    const res = await billingRouter.fetch(
      makeReq('/cancel', { method: 'POST' }, 'ws-1', 'user-1', 'admin'),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 503 when STRIPE_SECRET_KEY is not configured', async () => {
    const env = makeEnv('');
    const res = await billingRouter.fetch(
      makeReq('/cancel', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('returns 404 when no active subscription exists', async () => {
    const env = makeEnv('sk_test_abc');
    const res = await billingRouter.fetch(
      makeReq('/cancel', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/billing/portal', () => {
  it('returns 403 for non-admin role (tech)', async () => {
    const env = makeEnv('sk_test_abc');
    const res = await billingRouter.fetch(
      makeReq(
        '/portal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        'ws-1',
        'user-1',
        'tech',
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 503 when STRIPE_SECRET_KEY is not configured', async () => {
    const env = makeEnv('');
    const res = await billingRouter.fetch(
      makeReq(
        '/portal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        'ws-1',
        'user-1',
        'admin',
      ),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('returns 400 when no Stripe customer exists for workspace', async () => {
    const env = makeEnv('sk_test_abc');
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      stripe_customer_id: null,
    });
    const res = await billingRouter.fetch(
      makeReq(
        '/portal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        'ws-1',
        'user-1',
        'admin',
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when returnUrl is invalid', async () => {
    const env = makeEnv('sk_test_abc');
    const res = await billingRouter.fetch(
      makeReq(
        '/portal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnUrl: 'not-a-url' }),
        },
        'ws-1',
        'user-1',
        'admin',
      ),
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ── The read, over the real schema ──────────────────────────
//
// A vi.fn() database answers whatever shape the test hands it, which is how
// this endpoint shipped snake_case rows to a panel that reads camelCase and
// nobody noticed. These run the handler over schema.sql so the row is the
// row D1 would produce, and assert on the bytes.

describe('GET /api/billing/subscription over the real schema', () => {
  let sqlite: SqliteD1;
  let env: Env;

  const SEED = `
INSERT INTO workspaces (id, name, slug, stripe_customer_id, created_at)
VALUES ('${WS1}', 'Rivertown Electric', 'rivertown', 'cus_secret_1', '2026-01-01T00:00:00.000Z');
INSERT INTO workspaces (id, name, slug, created_at)
VALUES ('${WS2}', 'Other Plumbing', 'other', '2026-01-01T00:00:00.000Z');
INSERT INTO subscriptions (id, workspace_id, stripe_subscription_id, stripe_customer_id,
                           plan, status, current_period_start, current_period_end,
                           cancel_at_period_end, created_at, updated_at)
VALUES ('sub-old', '${WS1}', 'sub_stripe_old', 'cus_secret_1',
        'starter', 'canceled', '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
        0, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
INSERT INTO subscriptions (id, workspace_id, stripe_subscription_id, stripe_customer_id,
                           plan, status, current_period_start, current_period_end,
                           cancel_at_period_end, created_at, updated_at)
VALUES ('sub-1', '${WS1}', 'sub_stripe_1', 'cus_secret_1',
        'pro', 'active', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
        1, '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
`;

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA], sql: [SEED] });
    env = { DB: sqlite.db } as unknown as Env;
  });
  afterEach(() => sqlite.close());

  it('answers the declared Subscription — camelCase, no Stripe id on the wire', async () => {
    const res = await billingRouter.fetch(
      makeReq('/subscription', {}, WS1, 'user-1', 'admin'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };

    expect(describeWireProblems(checkWire(WIRE_SUBSCRIPTION, body.data))).toBe(
      '',
    );
    expect(body.data).toEqual({
      id: 'sub-1',
      plan: 'pro',
      status: 'active',
      currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    } satisfies Subscription);

    // The snake_case columns and the Stripe ids must not ride along.
    expect(body.data).not.toHaveProperty('current_period_end');
    expect(body.data).not.toHaveProperty('cancel_at_period_end');
    expect(body.data).not.toHaveProperty('stripe_customer_id');
    expect(body.data).not.toHaveProperty('stripe_subscription_id');
    expect(body.data).not.toHaveProperty('workspace_id');
    expect(JSON.stringify(body)).not.toContain('cus_secret_1');
    expect(JSON.stringify(body)).not.toContain('sub_stripe_1');
  });

  it('answers null for a workspace with no subscription row', async () => {
    const res = await billingRouter.fetch(
      makeReq('/subscription', {}, WS2, 'user-1', 'admin'),
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toBeNull();
  });
});
