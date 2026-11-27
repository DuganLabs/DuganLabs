import { describe, expect, it, vi } from 'vitest';
import {
  computeTrialEndsAt,
  getWorkspaceBillingState,
  markTrialExpired,
  TRIAL_DAYS,
} from './billing';

interface Row {
  billing_status: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
}

function envWithRow(row: Row | null) {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(row),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
  };
}

describe('computeTrialEndsAt', () => {
  it('adds TRIAL_DAYS days to the start date', () => {
    const start = new Date('2026-04-26T00:00:00Z');
    const end = computeTrialEndsAt(start);
    expect(end).toBe('2026-05-10T00:00:00.000Z');
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe('getWorkspaceBillingState', () => {
  const now = new Date('2026-04-26T12:00:00Z');

  it('returns trialing + days-left within window', async () => {
    const env = envWithRow({
      billing_status: 'trialing',
      trial_started_at: '2026-04-26T00:00:00Z',
      trial_ends_at: '2026-05-10T00:00:00Z',
    });
    const state = await getWorkspaceBillingState(env as never, 'ws-1', now);
    expect(state.billingStatus).toBe('trialing');
    expect(state.daysLeftInTrial).toBe(14);
    expect(state.canMutate).toBe(true);
  });

  it('auto-flips trialing → trial_expired when past end date', async () => {
    const env = envWithRow({
      billing_status: 'trialing',
      trial_started_at: '2026-04-01T00:00:00Z',
      trial_ends_at: '2026-04-15T00:00:00Z',
    });
    const state = await getWorkspaceBillingState(env as never, 'ws-1', now);
    expect(state.billingStatus).toBe('trial_expired');
    expect(state.daysLeftInTrial).toBe(0);
    expect(state.canMutate).toBe(false);
  });

  it('treats active subscription as canMutate even with past trial_ends_at', async () => {
    const env = envWithRow({
      billing_status: 'active',
      trial_started_at: '2026-04-01T00:00:00Z',
      trial_ends_at: '2026-04-15T00:00:00Z',
    });
    const state = await getWorkspaceBillingState(env as never, 'ws-1', now);
    expect(state.billingStatus).toBe('active');
    expect(state.canMutate).toBe(true);
  });

  it('past_due blocks mutations', async () => {
    const env = envWithRow({
      billing_status: 'past_due',
      trial_started_at: null,
      trial_ends_at: null,
    });
    const state = await getWorkspaceBillingState(env as never, 'ws-1', now);
    expect(state.billingStatus).toBe('past_due');
    expect(state.canMutate).toBe(false);
  });

  it('canceled blocks mutations', async () => {
    const env = envWithRow({
      billing_status: 'canceled',
      trial_started_at: null,
      trial_ends_at: null,
    });
    const state = await getWorkspaceBillingState(env as never, 'ws-1', now);
    expect(state.canMutate).toBe(false);
  });

  it('missing workspace returns canceled / cannot mutate', async () => {
    const env = envWithRow(null);
    const state = await getWorkspaceBillingState(
      env as never,
      'ws-missing',
      now,
    );
    expect(state.billingStatus).toBe('canceled');
    expect(state.canMutate).toBe(false);
  });

  it('null billing_status falls back to trialing semantics', async () => {
    const env = envWithRow({
      billing_status: null,
      trial_started_at: null,
      trial_ends_at: null,
    });
    const state = await getWorkspaceBillingState(env as never, 'ws-1', now);
    expect(state.billingStatus).toBe('trialing');
    expect(state.canMutate).toBe(true);
  });
});

describe('markTrialExpired', () => {
  it('issues an UPDATE scoped to trialing rows', async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    await markTrialExpired({ DB: { prepare } } as never, 'ws-1');
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("billing_status = 'trial_expired'"),
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("billing_status = 'trialing'"),
    );
    expect(bind).toHaveBeenCalledWith('ws-1');
  });
});
