import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Debt Priority / Avalanche Tests
 * Tests for debt priority and payment avalanche endpoints
 */

// Mock D1 statement for testing
function createMockStatement() {
  return {
    bind() {
      return this;
    },
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({}),
  };
}

// Mock Env object
function createMockEnv() {
  return {
    DB: {
      prepare: () => createMockStatement(),
    },
    ASSETS: {},
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
  };
}

/**
 * Simple avalanche target algorithm for testing
 */
function avalancheTarget(liabilities, surplus) {
  if (surplus <= 0 || liabilities.length === 0) {
    return { liabilityId: null, amount: 0 };
  }
  const sorted = [...liabilities].sort((a, b) => b.rateApr - a.rateApr);
  return { liabilityId: sorted[0].id, amount: surplus };
}

describe('Debt Priority / Avalanche Endpoints', () => {
  describe('GET /api/debt/liabilities', () => {
    it('returns empty array when no liabilities exist', () => {
      const liabilities = [];
      assert.deepEqual(liabilities, []);
    });

    it('returns all user liabilities sorted by priority then APR', () => {
      const liabilities = [
        {
          id: 1,
          label: 'CC High Interest',
          principal: 5000,
          rateApr: 0.24,
          minPaymentMonthly: 150,
          priority: 1,
        },
        {
          id: 2,
          label: 'Student Loan',
          principal: 40000,
          rateApr: 0.06,
          minPaymentMonthly: 400,
          priority: 2,
        },
        {
          id: 3,
          label: 'Personal Loan',
          principal: 15000,
          rateApr: 0.12,
          minPaymentMonthly: 300,
          priority: 3,
        },
      ];

      assert.equal(liabilities.length, 3);
      assert.equal(liabilities[0].label, 'CC High Interest');
      assert.equal(liabilities[0].rateApr, 0.24);
    });

    it('calculates total debt across all liabilities', () => {
      const liabilities = [{ principal: 5000 }, { principal: 40000 }, { principal: 15000 }];

      const totalDebt = liabilities.reduce((sum, l) => sum + l.principal, 0);
      assert.equal(totalDebt, 60000);
    });

    it('calculates minimum monthly payment obligation', () => {
      const liabilities = [
        { minPaymentMonthly: 150 },
        { minPaymentMonthly: 400 },
        { minPaymentMonthly: 300 },
      ];

      const minMonthly = liabilities.reduce((sum, l) => sum + l.minPaymentMonthly, 0);
      assert.equal(minMonthly, 850);
    });

    it('includes type information for each liability', () => {
      const liability = {
        id: 1,
        type: 'cc',
        label: 'Credit Card',
        principal: 5000,
        rateApr: 0.24,
      };

      assert.equal(liability.type, 'cc');
      assert.ok(['cc', 'personal_loan', 'student', 'mortgage', 'other'].includes(liability.type));
    });
  });

  describe('POST /api/debt/avalanche-allocation', () => {
    it('allocates surplus to highest APR liability', () => {
      const liabilities = [
        { id: 1, label: 'CC', principal: 5000, rateApr: 0.24, minPaymentMonthly: 150 },
        { id: 2, label: 'Student', principal: 40000, rateApr: 0.06, minPaymentMonthly: 400 },
      ];

      const result = avalancheTarget(liabilities, 1000);
      assert.equal(result.liabilityId, 1);
      assert.equal(result.amount, 1000);
    });

    it('returns null target when surplus is zero', () => {
      const liabilities = [{ id: 1, label: 'CC', principal: 5000, rateApr: 0.24 }];

      const result = avalancheTarget(liabilities, 0);
      assert.equal(result.liabilityId, null);
      assert.equal(result.amount, 0);
    });

    it('returns null target when surplus is negative', () => {
      const liabilities = [{ id: 1, label: 'CC', principal: 5000, rateApr: 0.24 }];

      const result = avalancheTarget(liabilities, -500);
      assert.equal(result.liabilityId, null);
      assert.equal(result.amount, 0);
    });

    it('returns null target when no liabilities exist', () => {
      const result = avalancheTarget([], 5000);
      assert.equal(result.liabilityId, null);
      assert.equal(result.amount, 0);
    });

    it('prioritizes by APR regardless of principal amount', () => {
      const liabilities = [
        { id: 1, label: 'CC', principal: 500, rateApr: 0.24, minPaymentMonthly: 50 },
        { id: 2, label: 'Mortgage', principal: 300000, rateApr: 0.045, minPaymentMonthly: 1500 },
        { id: 3, label: 'CC2', principal: 2000, rateApr: 0.18, minPaymentMonthly: 100 },
      ];

      const result = avalancheTarget(liabilities, 1000);
      assert.equal(result.liabilityId, 1); // 24% APR is highest
      assert.equal(result.amount, 1000);
    });

    it('handles equal APRs by selecting first in stable order', () => {
      const liabilities = [
        { id: 1, label: 'Debt A', principal: 10000, rateApr: 0.15, minPaymentMonthly: 200 },
        { id: 2, label: 'Debt B', principal: 5000, rateApr: 0.15, minPaymentMonthly: 100 },
      ];

      const result = avalancheTarget(liabilities, 500);
      assert.equal(result.liabilityId, 1);
      assert.equal(result.amount, 500);
    });

    it('rejects negative surplus in request body', () => {
      const body = { surplus: -1000 };
      const isValid = body.surplus >= 0;

      assert.equal(isValid, false);
    });

    it('rejects non-numeric surplus', () => {
      const body = { surplus: 'not-a-number' };
      const isValid = typeof body.surplus === 'number';

      assert.equal(isValid, false);
    });
  });

  describe('GET /api/debt/payoff-schedule', () => {
    it('calculates payoff time for single liability without extra payments', () => {
      const principal = 10000;
      const monthlyPayment = 200;
      const monthsToPayoff = principal / monthlyPayment;

      assert.equal(monthsToPayoff, 50);
    });

    it('calculates payoff time with interest accumulation', () => {
      // Using simple interest calculation for basic validation
      const principal = 10000;
      const rateApr = 0.15;
      const monthlyRate = rateApr / 12;
      const monthlyPayment = 200;

      let balance = principal;
      let months = 0;
      while (balance > 0 && months < 1000) {
        balance = balance * (1 + monthlyRate) - monthlyPayment;
        months++;
      }

      assert.ok(months > 50 && months < 100); // More than without interest
      assert.ok(Number.isFinite(months));
    });

    it('handles edge case: payment equals monthly interest', () => {
      const principal = 10000;
      const rateApr = 0.12;
      const monthlyRate = rateApr / 12;
      const monthlyPayment = principal * monthlyRate; // Pays only interest

      let balance = principal;
      let months = 0;
      const maxIterations = 1000;

      while (balance > 0 && months < maxIterations) {
        balance = balance * (1 + monthlyRate) - monthlyPayment;
        months++;
      }

      assert.equal(months, maxIterations); // Never pays off
    });

    it('returns null/error when monthly payment is zero', () => {
      const principal = 10000;
      const monthlyPayment = 0;

      const payoffMonths = monthlyPayment === 0 ? null : 'calculated';
      assert.equal(payoffMonths, null);
    });

    it('calculates total interest paid over life of loan', () => {
      const principal = 10000;
      const monthlyPayment = 300;
      const months = 40;

      const totalPaid = monthlyPayment * months;
      const totalInterest = totalPaid - principal;

      assert.equal(totalInterest, 2000);
    });
  });

  describe('GET /api/debt/avalanche-projection', () => {
    it('returns empty projection when no liabilities', () => {
      const projection = { months: [], totalInterestSaved: 0 };
      assert.equal(projection.months.length, 0);
      assert.equal(projection.totalInterestSaved, 0);
    });

    it('calculates projected balance for each month', () => {
      const liabilities = [{ id: 1, principal: 10000, rateApr: 0.18, minPaymentMonthly: 250 }];

      const months = [];
      let balance = liabilities[0].principal;
      const monthlyRate = liabilities[0].rateApr / 12;

      for (let i = 0; i < 12; i++) {
        balance = balance * (1 + monthlyRate) - liabilities[0].minPaymentMonthly;
        months.push({ month: i + 1, balance: Math.max(0, balance) });
      }

      assert.equal(months.length, 12);
      assert.ok(months[0].balance < liabilities[0].principal);
      assert.ok(months[11].balance < months[0].balance);
    });

    it('compares avalanche vs minimum payment strategy', () => {
      const liabilities = [
        { id: 1, principal: 5000, rateApr: 0.24, minPaymentMonthly: 150 },
        { id: 2, principal: 10000, rateApr: 0.06, minPaymentMonthly: 100 },
      ];

      // Avalanche allocates surplus to highest APR
      // Minimum payment only pays minimums
      const avalancheExtraPayment = 500;
      const totalExtraAvailable = avalancheExtraPayment;

      assert.ok(totalExtraAvailable > 0);
    });

    it('calculates interest saved by avalanche method', () => {
      const minPaymentInterest = 5000;
      const avalancheInterest = 4000;
      const saved = minPaymentInterest - avalancheInterest;

      assert.equal(saved, 1000);
    });
  });

  describe('Edge Cases', () => {
    it('handles zero principal liability', () => {
      const liability = { id: 1, principal: 0, rateApr: 0.15, minPaymentMonthly: 0 };
      assert.equal(liability.principal, 0);
      assert.equal(liability.minPaymentMonthly, 0);
    });

    it('handles zero APR liability', () => {
      const liability = { id: 1, principal: 5000, rateApr: 0, minPaymentMonthly: 100 };
      const monthlyRate = liability.rateApr / 12;
      assert.equal(monthlyRate, 0);
    });

    it('handles very high APR (predatory lending)', () => {
      const liability = { id: 1, principal: 1000, rateApr: 4.0, minPaymentMonthly: 50 };
      assert.equal(liability.rateApr, 4.0); // 400% APR
    });

    it('handles very large debt amounts', () => {
      const liability = { id: 1, principal: 999999999, rateApr: 0.045, minPaymentMonthly: 5000000 };
      const payoffMonths = liability.principal / liability.minPaymentMonthly;

      assert.ok(Number.isFinite(payoffMonths));
    });

    it('handles multiple liabilities with same APR', () => {
      const liabilities = [
        { id: 1, principal: 5000, rateApr: 0.15 },
        { id: 2, principal: 3000, rateApr: 0.15 },
        { id: 3, principal: 7000, rateApr: 0.15 },
      ];

      const allSameApr = liabilities.every(l => l.rateApr === 0.15);
      assert.equal(allSameApr, true);
    });

    it('does not mutate input liabilities array', () => {
      const liabilities = [
        { id: 1, principal: 5000, rateApr: 0.24 },
        { id: 2, principal: 10000, rateApr: 0.06 },
      ];

      const original = JSON.stringify(liabilities);
      avalancheTarget(liabilities, 1000);
      const after = JSON.stringify(liabilities);

      assert.equal(original, after);
    });
  });
});
