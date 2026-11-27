import { describe, expect, it, vi } from 'vitest';
import { requireBillingActive } from './billing-gate';

interface BillingRow {
  billing_status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
}

function envWithRow(row: BillingRow | null) {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(row),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
  } as never;
}

function makeReq(
  method: string,
  path: string,
  workspaceId: string | undefined = 'ws-1',
): never {
  const req = new Request(`https://api.greenput.com${path}`, { method });
  if (workspaceId !== undefined) {
    (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  }
  return req as never;
}

const FAR_FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2020-01-01T00:00:00Z';

describe('requireBillingActive', () => {
  it('passes through GET requests on any tier', async () => {
    const env = envWithRow({
      billing_status: 'trial_expired',
      trial_started_at: PAST,
      trial_ends_at: PAST,
    });
    const result = await requireBillingActive(
      makeReq('GET', '/api/leads'),
      env,
    );
    expect(result).toBeUndefined();
  });

  it('passes through HEAD/OPTIONS requests', async () => {
    const env = envWithRow({
      billing_status: 'canceled',
      trial_started_at: null,
      trial_ends_at: null,
    });
    expect(
      await requireBillingActive(makeReq('HEAD', '/api/leads'), env),
    ).toBeUndefined();
    expect(
      await requireBillingActive(makeReq('OPTIONS', '/api/leads'), env),
    ).toBeUndefined();
  });

  it('passes through POST on /api/billing/* even if expired', async () => {
    const env = envWithRow({
      billing_status: 'trial_expired',
      trial_started_at: PAST,
      trial_ends_at: PAST,
    });
    const result = await requireBillingActive(
      makeReq('POST', '/api/billing/subscribe'),
      env,
    );
    expect(result).toBeUndefined();
  });

  it('passes through PATCH on /api/workspace even if expired', async () => {
    const env = envWithRow({
      billing_status: 'canceled',
      trial_started_at: null,
      trial_ends_at: null,
    });
    const result = await requireBillingActive(
      makeReq('PATCH', '/api/workspace'),
      env,
    );
    expect(result).toBeUndefined();
  });

  it('passes through POST /api/leads on trialing workspace', async () => {
    const env = envWithRow({
      billing_status: 'trialing',
      trial_started_at: PAST,
      trial_ends_at: FAR_FUTURE,
    });
    const result = await requireBillingActive(
      makeReq('POST', '/api/leads'),
      env,
    );
    expect(result).toBeUndefined();
  });

  it('passes through POST /api/leads on active workspace', async () => {
    const env = envWithRow({
      billing_status: 'active',
      trial_started_at: null,
      trial_ends_at: null,
    });
    const result = await requireBillingActive(
      makeReq('POST', '/api/leads'),
      env,
    );
    expect(result).toBeUndefined();
  });

  it('blocks POST /api/leads with 402 when trial_expired', async () => {
    const env = envWithRow({
      billing_status: 'trial_expired',
      trial_started_at: PAST,
      trial_ends_at: PAST,
    });
    const result = (await requireBillingActive(
      makeReq('POST', '/api/leads'),
      env,
    )) as Response;
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(402);
    const body = (await result.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BILLING_TRIAL_EXPIRED');
  });

  it('blocks DELETE /api/jobs/123 with 402 when past_due', async () => {
    const env = envWithRow({
      billing_status: 'past_due',
      trial_started_at: null,
      trial_ends_at: null,
    });
    const result = (await requireBillingActive(
      makeReq('DELETE', '/api/jobs/abc'),
      env,
    )) as Response;
    expect(result.status).toBe(402);
    const body = (await result.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BILLING_PAST_DUE');
  });

  it('auto-flips trialing → trial_expired on detection', async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({
      run,
      first: vi.fn().mockResolvedValue({
        billing_status: 'trialing',
        trial_started_at: PAST,
        trial_ends_at: PAST, // expired
      }),
    });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare } } as never;
    const result = (await requireBillingActive(
      makeReq('POST', '/api/leads'),
      env,
    )) as Response;
    expect(result.status).toBe(402);
    // Was the markTrialExpired UPDATE issued?
    const updateCalls = prepare.mock.calls.filter((c) =>
      String(c[0]).includes('UPDATE workspaces'),
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });
});
