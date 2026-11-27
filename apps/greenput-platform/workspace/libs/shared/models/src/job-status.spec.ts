import { describe, expect, it } from 'vitest';
import {
  JOB_STATUSES,
  JOB_STATUS_TRANSITIONS,
  ROUTE_ONLY_JOB_STATUSES,
  canPatchJobStatus,
  canTransitionJobStatus,
} from './index';

describe('job status transitions', () => {
  it('declares an explicit row for every status', () => {
    expect(Object.keys(JOB_STATUS_TRANSITIONS).sort()).toEqual(
      [...JOB_STATUSES].sort(),
    );
  });

  it('is exactly the settled table', () => {
    expect(JOB_STATUS_TRANSITIONS).toEqual({
      scheduled: ['in_progress', 'completed', 'cancelled'],
      in_progress: ['scheduled', 'completed', 'cancelled'],
      completed: ['in_progress', 'invoiced'],
      invoiced: ['paid'],
      paid: [],
      cancelled: ['scheduled'],
    });
  });

  it('never lets money states move backwards', () => {
    for (const to of JOB_STATUSES) {
      if (to !== 'paid') expect(canTransitionJobStatus('paid', to)).toBe(false);
    }
    expect(canTransitionJobStatus('paid', 'scheduled')).toBe(false);
    expect(canTransitionJobStatus('invoiced', 'completed')).toBe(false);
    expect(canTransitionJobStatus('invoiced', 'cancelled')).toBe(false);
  });

  it('a same-status write is a no-op, always allowed', () => {
    for (const s of JOB_STATUSES) {
      expect(canTransitionJobStatus(s, s)).toBe(true);
      expect(canPatchJobStatus(s, s)).toBe(true);
    }
  });

  it('invoiced and paid are reached only through their own routes, never a PATCH', () => {
    expect([...ROUTE_ONLY_JOB_STATUSES].sort()).toEqual(['invoiced', 'paid']);
    expect(canTransitionJobStatus('completed', 'invoiced')).toBe(true);
    expect(canPatchJobStatus('completed', 'invoiced')).toBe(false);
    expect(canTransitionJobStatus('invoiced', 'paid')).toBe(true);
    expect(canPatchJobStatus('invoiced', 'paid')).toBe(false);
  });

  it('rejects an unknown current status', () => {
    expect(canTransitionJobStatus('bogus', 'scheduled')).toBe(false);
    expect(canPatchJobStatus('bogus', 'scheduled')).toBe(false);
  });
});
