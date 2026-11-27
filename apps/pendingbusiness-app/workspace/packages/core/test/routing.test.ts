import { describe, it, expect } from 'vitest';
import { routeCash } from '../src/routing/waterfall.js';
import type { Situation } from '../src/types.js';

const WARREN_SPARSE: Situation = {
  userId: 1,
  filingStatus: 'mfj',
  state: 'CA',
  incomeSources: [
    {
      id: 1,
      userId: 1,
      label: 'Example Employer',
      type: 'w2',
      grossAnnual: 210_000,
      employer: 'Example Employer',
      has401kMatch: false,
    },
    {
      id: 2,
      userId: 1,
      label: 'Example School District',
      type: 'w2',
      grossAnnual: 92_000,
      employer: 'Example School District',
      has401kMatch: false,
    },
    {
      id: 3,
      userId: 1,
      label: 'Greenput',
      type: 'se',
      grossAnnual: 0,
      employer: null,
      has401kMatch: false,
    },
  ],
  liabilities: [
    {
      id: 10,
      userId: 1,
      label: 'Personal loan',
      principal: 80_000,
      rateApr: 0.12,
      minPaymentMonthly: 1_800,
      type: 'personal_loan',
      priority: 1,
    },
    {
      id: 11,
      userId: 1,
      label: 'Student',
      principal: 10_000,
      rateApr: 0.06,
      minPaymentMonthly: 200,
      type: 'student',
      priority: 2,
    },
  ],
  fixedObligationsMonthly: 3_000,
  liquidityFloorMonthly: 200,
  kidsCount: 3,
  augustaDays: 14,
  augustaDailyRate: 350,
  scorpSalarySplit: 0.5,
};

describe('routeCash', () => {
  it('reserves 33% of SE net for taxes', () => {
    const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000 });
    expect(result.waterfall.taxReserve).toBe(3_300);
  });

  it('honors $200 liquidity floor even when it trims the avalanche', () => {
    const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000 });
    expect(result.waterfall.liquidityReserve).toBe(200);
    const expectedSurplus =
      result.waterfall.grossIn -
      result.waterfall.taxReserve -
      result.waterfall.fixedObligations -
      result.waterfall.liquidityReserve;
    expect(result.waterfall.debtAvalanche.amount).toBeCloseTo(expectedSurplus, 2);
  });

  it('targets the highest-APR liability (the 12% personal loan)', () => {
    const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000 });
    expect(result.waterfall.debtAvalanche.liabilityId).toBe(10);
    expect(result.waterfall.debtAvalanche.amount).toBeGreaterThan(0);
  });

  it('surfaces discretionary as zero when all surplus goes to avalanche', () => {
    const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000 });
    expect(result.waterfall.discretionary).toBe(0);
  });

  it('projects MAGI and surfaces the next upcoming tax threshold', () => {
    const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 0 });
    expect(result.magiProjection).toBe(302_000);
    expect(result.nextThreshold.name).toBe('CTC phaseout');
    expect(result.nextThreshold.distance).toBe(98_000);
  });

  it('rolls one-time income into the gross intake', () => {
    const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 5_000, oneTimeIncome: 2_000 });
    expect(result.waterfall.grossIn).toBe(7_000);
  });

  describe('edge cases: zero and negative amounts', () => {
    it('handles zero greenput income gracefully', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 0 });
      expect(result.waterfall.grossIn).toBe(0);
      expect(result.waterfall.taxReserve).toBe(0);
      expect(result.waterfall.debtAvalanche.amount).toBe(0);
      expect(result.waterfall.discretionary).toBe(0);
    });

    it('handles zero liabilities (no debt)', () => {
      const situationNoDent: Situation = {
        ...WARREN_SPARSE,
        liabilities: [],
      };
      const result = routeCash(situationNoDent, { greenputMonthlyNet: 10_000 });
      expect(result.waterfall.debtAvalanche.liabilityId).toBe(null);
      expect(result.waterfall.debtAvalanche.amount).toBe(0);
      // All remaining should be discretionary when no debt
      const expectedDiscretionary =
        result.waterfall.grossIn -
        result.waterfall.taxReserve -
        result.waterfall.fixedObligations -
        result.waterfall.liquidityReserve;
      expect(result.waterfall.discretionary).toBe(expectedDiscretionary);
    });

    it('handles single liability', () => {
      const situationSingleLiability: Situation = {
        ...WARREN_SPARSE,
        liabilities: [WARREN_SPARSE.liabilities[0]],
      };
      const result = routeCash(situationSingleLiability, { greenputMonthlyNet: 10_000 });
      expect(result.waterfall.debtAvalanche.liabilityId).toBe(10);
      expect(result.waterfall.debtAvalanche.amount).toBeGreaterThan(0);
    });

    it('handles income insufficient to cover reserves and obligations', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 100 });
      // Should still allocate tax reserve (33 * 100/100 = 33)
      expect(result.waterfall.taxReserve).toBe(33);
      // Fixed obligations and liquidity floor should be allocated first
      expect(result.waterfall.fixedObligations).toBe(3_000);
      expect(result.waterfall.liquidityReserve).toBe(200);
      // After reserves (33), fixed obligations (3000), and liquidity (200),
      // the residual is 100 - 33 - 3000 - 200 = -3133. Nothing is allocated
      // downstream, and the hole itself is surfaced rather than discarded.
      expect(result.waterfall.debtAvalanche.amount).toBe(0);
      expect(result.waterfall.discretionary).toBe(0);
      expect(result.waterfall.shortfall).toBe(3_133);
    });

    it('reports a zero shortfall when the month covers itself', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000 });
      expect(result.waterfall.shortfall).toBe(0);
    });
  });

  describe('edge cases: multiple accounts with different priorities', () => {
    it('routes to highest APR liability regardless of priority field', () => {
      const situationMultiple: Situation = {
        ...WARREN_SPARSE,
        liabilities: [
          {
            id: 20,
            userId: 1,
            label: 'CC 1',
            principal: 5_000,
            rateApr: 0.2,
            minPaymentMonthly: 150,
            type: 'cc',
            priority: 3,
          },
          {
            id: 21,
            userId: 1,
            label: 'CC 2',
            principal: 3_000,
            rateApr: 0.18,
            minPaymentMonthly: 100,
            type: 'cc',
            priority: 1,
          },
          {
            id: 22,
            userId: 1,
            label: 'Personal',
            principal: 50_000,
            rateApr: 0.08,
            minPaymentMonthly: 500,
            type: 'personal_loan',
            priority: 2,
          },
        ],
      };
      const result = routeCash(situationMultiple, { greenputMonthlyNet: 10_000 });
      // Highest APR is 0.20 (ID 20), not by priority
      expect(result.waterfall.debtAvalanche.liabilityId).toBe(20);
    });

    it('allocates full surplus to highest-APR debt when abundant', () => {
      const situationAbundant: Situation = {
        ...WARREN_SPARSE,
        fixedObligationsMonthly: 1_000,
        liquidityFloorMonthly: 100,
        liabilities: [
          {
            id: 30,
            userId: 1,
            label: 'Loan A',
            principal: 100_000,
            rateApr: 0.05,
            minPaymentMonthly: 500,
            type: 'personal_loan',
            priority: 1,
          },
        ],
      };
      const result = routeCash(situationAbundant, { greenputMonthlyNet: 50_000 });
      // 50_000 - (33% * 50_000) - 1_000 - 100 = 50_000 - 16_500 - 1_000 - 100 = 32_400
      const expectedRemaining = 50_000 - 16_500 - 1_000 - 100;
      expect(result.waterfall.debtAvalanche.amount).toBe(expectedRemaining);
      expect(result.waterfall.discretionary).toBe(0);
    });
  });

  describe('edge cases: partial payment and rounding', () => {
    it('maintains currency precision through waterfall with rounding', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000 });
      // Check sum of waterfall components matches input
      const sum =
        result.waterfall.taxReserve +
        result.waterfall.fixedObligations +
        result.waterfall.liquidityReserve +
        result.waterfall.debtAvalanche.amount +
        result.waterfall.discretionary;
      expect(sum).toBeCloseTo(result.waterfall.grossIn, 2);
    });

    it('handles fractional cents properly', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 1_234.56 });
      expect(result.waterfall.grossIn).toBe(1_234.56);
      // Tax reserve: 33% of 1_234.56 = 407.4048, rounded to 407.40
      expect(result.waterfall.taxReserve).toBe(407.4);
    });

    it('ensures discretionary and shortfall are never negative', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000 });
      expect(result.waterfall.discretionary).toBeGreaterThanOrEqual(0);
      expect(result.waterfall.shortfall).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge cases: grace period and tax interactions', () => {
    it('includes SE income in MAGI calculation for tax threshold distance', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000, oneTimeIncome: 0 });
      // W2: 210k + 92k = 302k, SE: 10k * 12 = 120k, Total MAGI = 422k
      expect(result.magiProjection).toBe(422_000);
      // Next threshold after 302k is CTC at 400k
      expect(result.nextThreshold.name).toBe('SALT phaseout');
      expect(result.nextThreshold.distance).toBe(83_000); // 505_000 - 422_000
    });

    it('includes one-time income in MAGI', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 5_000, oneTimeIncome: 50_000 });
      // W2: 302k, SE: 5k * 12 + 50k = 110k, Total = 412k
      expect(result.magiProjection).toBe(412_000);
    });

    it('computes tax reserve before obligations (order matters)', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 5_000 });
      // Verify tax reserve is calculated on monthly SE net, not on remaining
      const expectedTaxReserve = Math.round(5_000 * 0.33 * 100) / 100;
      expect(result.waterfall.taxReserve).toBe(expectedTaxReserve);
    });
  });

  describe('edge cases: idempotency and consistency', () => {
    it('produces identical results when called multiple times', () => {
      const inputs = { greenputMonthlyNet: 10_000 };
      const result1 = routeCash(WARREN_SPARSE, inputs);
      const result2 = routeCash(WARREN_SPARSE, inputs);
      expect(result1).toEqual(result2);
    });

    /*
     * Conservation: every dollar in is accounted for on the way out, and a
     * dollar the month does not have is accounted for as shortfall — so the
     * identity holds on both sides of zero. Before the shortfall existed the
     * components of a deficit month summed to more than gross in by exactly
     * the amount that had been discarded.
     */
    function routedTotal(result: ReturnType<typeof routeCash>): number {
      const w = result.waterfall;
      return (
        w.taxReserve +
        w.fixedObligations +
        w.liquidityReserve +
        w.debtAvalanche.amount +
        w.discretionary -
        w.shortfall
      );
    }

    it('waterfall amounts sum to gross input', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 10_000 });
      expect(result.waterfall.shortfall).toBe(0);
      expect(routedTotal(result)).toBeCloseTo(result.waterfall.grossIn, 2);
    });

    it('waterfall amounts still sum to gross input when the month falls short', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 1_000 });
      // 1_000 - 330 - 3_000 - 200 = -2_530
      expect(result.waterfall.shortfall).toBe(2_530);
      expect(routedTotal(result)).toBeCloseTo(result.waterfall.grossIn, 2);
    });

    it('maintains invariants with varying income levels', () => {
      for (const income of [0, 1_000, 5_000, 10_000, 50_000]) {
        const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: income });
        // Tax reserve should always be 33% of net
        const expectedTaxReserve = Math.round(income * 0.33 * 100) / 100;
        expect(result.waterfall.taxReserve).toBe(expectedTaxReserve);
        // No component should be negative
        expect(result.waterfall.grossIn).toBeGreaterThanOrEqual(0);
        expect(result.waterfall.taxReserve).toBeGreaterThanOrEqual(0);
        expect(result.waterfall.fixedObligations).toBeGreaterThanOrEqual(0);
        expect(result.waterfall.liquidityReserve).toBeGreaterThanOrEqual(0);
        expect(result.waterfall.debtAvalanche.amount).toBeGreaterThanOrEqual(0);
        expect(result.waterfall.discretionary).toBeGreaterThanOrEqual(0);
        expect(result.waterfall.shortfall).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('edge cases: mixed income sources', () => {
    it('correctly aggregates multiple W2 income sources', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 0 });
      // W2 total: 210k + 92k = 302k
      // SE annual: 0
      // MAGI = 302k
      expect(result.magiProjection).toBe(302_000);
    });

    it('ignores SE income with zero greenput monthly net', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 0 });
      // No SE contribution with greenputMonthlyNet = 0
      // MAGI should only include W2
      expect(result.magiProjection).toBe(302_000);
    });
  });

  describe('edge cases: avalanche with zero surplus', () => {
    it('allocates zero to avalanche when all income goes to reserves', () => {
      const result = routeCash(WARREN_SPARSE, { greenputMonthlyNet: 3_100 });
      // 3_100 * 0.33 = 1_023, so: 3_100 - 1_023 - 3_000 - 200 = -1_123 (negative)
      // Nothing reaches the avalanche, and the 1_123 is reported, not dropped.
      expect(result.waterfall.debtAvalanche.amount).toBe(0);
      expect(result.waterfall.discretionary).toBe(0);
      expect(result.waterfall.shortfall).toBe(1_123);
    });
  });
});
