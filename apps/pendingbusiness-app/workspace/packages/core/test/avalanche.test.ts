import { describe, it, expect } from 'vitest';
import { avalancheTarget } from '../src/debt/avalanche.js';
import type { Liability } from '../src/types.js';

const LOANS: Liability[] = [
  {
    id: 1,
    userId: 1,
    label: 'Personal',
    principal: 80_000,
    rateApr: 0.12,
    minPaymentMonthly: 1_800,
    type: 'personal_loan',
    priority: 1,
  },
  {
    id: 2,
    userId: 1,
    label: 'Student',
    principal: 10_000,
    rateApr: 0.06,
    minPaymentMonthly: 200,
    type: 'student',
    priority: 2,
  },
];

describe('avalancheTarget', () => {
  it('sends the full surplus to the highest-APR liability', () => {
    const alloc = avalancheTarget(LOANS, 2_000);
    expect(alloc.liabilityId).toBe(1);
    expect(alloc.amount).toBe(2_000);
  });

  it('returns a null target when surplus is zero', () => {
    const alloc = avalancheTarget(LOANS, 0);
    expect(alloc.liabilityId).toBeNull();
    expect(alloc.amount).toBe(0);
  });

  it('returns a null target when surplus is negative', () => {
    const alloc = avalancheTarget(LOANS, -100);
    expect(alloc.liabilityId).toBeNull();
    expect(alloc.amount).toBe(0);
  });

  it('returns a null target when liabilities array is empty', () => {
    const alloc = avalancheTarget([], 5_000);
    expect(alloc.liabilityId).toBeNull();
    expect(alloc.amount).toBe(0);
  });

  it('correctly prioritizes by APR even when principal amounts vary wildly', () => {
    const mixed: Liability[] = [
      {
        id: 10,
        userId: 1,
        label: 'CC 1',
        principal: 500,
        rateApr: 0.24,
        minPaymentMonthly: 50,
        type: 'cc',
        priority: 1,
      },
      {
        id: 20,
        userId: 1,
        label: 'Mortgage',
        principal: 300_000,
        rateApr: 0.045,
        minPaymentMonthly: 1_500,
        type: 'mortgage',
        priority: 2,
      },
      {
        id: 30,
        userId: 1,
        label: 'CC 2',
        principal: 2_000,
        rateApr: 0.18,
        minPaymentMonthly: 100,
        type: 'cc',
        priority: 3,
      },
    ];
    const alloc = avalancheTarget(mixed, 1_000);
    expect(alloc.liabilityId).toBe(10); // 24% APR is highest
    expect(alloc.amount).toBe(1_000);
  });

  it('handles equal APRs by selecting the first (stable ordering)', () => {
    const equal: Liability[] = [
      {
        id: 1,
        userId: 1,
        label: 'Debt A',
        principal: 10_000,
        rateApr: 0.15,
        minPaymentMonthly: 200,
        type: 'cc',
        priority: 1,
      },
      {
        id: 2,
        userId: 1,
        label: 'Debt B',
        principal: 5_000,
        rateApr: 0.15,
        minPaymentMonthly: 100,
        type: 'personal_loan',
        priority: 2,
      },
    ];
    const alloc = avalancheTarget(equal, 500);
    expect(alloc.liabilityId).toBe(1); // First in sort order (stable)
    expect(alloc.amount).toBe(500);
  });

  it('correctly allocates a tiny surplus', () => {
    const alloc = avalancheTarget(LOANS, 0.01);
    expect(alloc.liabilityId).toBe(1);
    expect(alloc.amount).toBe(0.01);
  });

  it('correctly allocates a large surplus', () => {
    const alloc = avalancheTarget(LOANS, 100_000);
    expect(alloc.liabilityId).toBe(1);
    expect(alloc.amount).toBe(100_000);
  });

  it('does not mutate the original liabilities array', () => {
    const original = [...LOANS];
    avalancheTarget(LOANS, 2_000);
    expect(LOANS).toEqual(original);
  });
});
