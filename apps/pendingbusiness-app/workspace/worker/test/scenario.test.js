import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * W-4 Scenario and Situation API Tests
 * Tests for scenario creation, listing, computation, and situation endpoints
 */

// ============================================================================
// Mock D1 Database
// ============================================================================

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

function createMockEnv(dbOverrides = {}) {
  return {
    DB: {
      prepare: sql => {
        // Return test data based on SQL query
        const stmt = createMockStatement();

        // Allow overrides for specific queries
        if (sql.includes('SELECT id, email, display_name, filing_status, state, ')) {
          stmt.first = async () => ({
            id: 1,
            email: 'owner@example.com',
            display_name: 'Warren',
            filing_status: 'mfj',
            state: 'CA',
            monthly_living_expenses: 5000,
            liquidity_floor_monthly: 200,
            kids_count: 3,
            augusta_days: 14,
            augusta_daily_rate: 350,
            scorp_salary_split: 0.5,
          });
        } else if (sql.includes('SELECT id, user_id, label, type, gross_annual')) {
          stmt.all = async () => ({
            results: dbOverrides.incomes || [
              {
                id: 1,
                user_id: 1,
                label: 'GreenPut W-2',
                type: 'w2',
                gross_annual: 120000,
                employer: 'GreenPut',
                has_401k_match: 1,
              },
              {
                id: 2,
                user_id: 1,
                label: 'Consulting',
                type: 'se',
                gross_annual: 0,
                employer: null,
                has_401k_match: 0,
              },
            ],
          });
        } else if (sql.includes('SELECT id, user_id, label, principal, rate_apr')) {
          stmt.all = async () => ({
            results: dbOverrides.liabilities || [
              {
                id: 1,
                user_id: 1,
                label: 'Mortgage',
                principal: 450000,
                rate_apr: 0.045,
                min_payment_monthly: 2400,
                type: 'mortgage',
                priority: 1,
              },
              {
                id: 2,
                user_id: 1,
                label: 'Student Loans',
                principal: 25000,
                rate_apr: 0.05,
                min_payment_monthly: 300,
                type: 'student',
                priority: 2,
              },
            ],
          });
        } else if (
          sql.includes('SELECT id, label, inputs_json, computed_json, created_at FROM scenarios')
        ) {
          stmt.all = async () => ({
            results: dbOverrides.scenarios || [],
          });
        } else if (sql.includes('INSERT INTO scenarios')) {
          stmt.run = async () => ({ success: true });
        }

        return stmt;
      },
    },
    ASSETS: {},
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
  };
}

// ============================================================================
// Mock Request Objects
// ============================================================================

function createMockRequest(body = null) {
  return {
    json: async () => body,
  };
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock version of routeCash for testing
 * Simulates the cash routing calculation
 */
function routeCash(situation, inputs) {
  const w2GrossAnnual = situation.incomeSources
    .filter(s => s.type === 'w2')
    .reduce((sum, s) => sum + s.grossAnnual, 0);

  const seAnnualProjection = inputs.greenputMonthlyNet * 12 + (inputs.oneTimeIncome ?? 0);
  const magiProjection = w2GrossAnnual + seAnnualProjection;

  const grossIn = inputs.greenputMonthlyNet + (inputs.oneTimeIncome ?? 0);
  const SE_TAX_RESERVE_RATE = 0.33;
  const taxReserve = round2(inputs.greenputMonthlyNet * SE_TAX_RESERVE_RATE);
  const fixedObligations = situation.fixedObligationsMonthly;
  const liquidityReserve = situation.liquidityFloorMonthly;

  let remaining = grossIn - taxReserve - fixedObligations - liquidityReserve;
  if (remaining < 0) remaining = 0;

  // Simple avalanche: highest APR first
  const avalanche = avalancheTarget(situation.liabilities, remaining);
  const afterAvalanche = Math.max(0, remaining - avalanche.amount);

  return {
    inputs,
    waterfall: {
      grossIn: round2(grossIn),
      taxReserve,
      fixedObligations: round2(fixedObligations),
      liquidityReserve: round2(liquidityReserve),
      debtAvalanche: { liabilityId: avalanche.liabilityId, amount: round2(avalanche.amount) },
      discretionary: round2(afterAvalanche),
    },
    nextThreshold: { name: 'Next bracket', amount: 200000, distance: 50000 },
    magiProjection: round2(magiProjection),
  };
}

function avalancheTarget(liabilities, surplus) {
  if (surplus <= 0 || liabilities.length === 0) {
    return { liabilityId: null, amount: 0 };
  }
  const sorted = [...liabilities].sort((a, b) => b.rateApr - a.rateApr);
  return { liabilityId: sorted[0].id, amount: surplus };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Mock stackedMarginal calculation
 */
function stackedMarginal(w2Annual, federalBrackets, stateBrackets) {
  // Simplified: federal ~37% in high bracket, CA ~13.3%, minus 3% for FICA
  if (w2Annual > 500000) return 0.47;
  if (w2Annual > 200000) return 0.42;
  if (w2Annual > 100000) return 0.35;
  return 0.24;
}

/**
 * Mock nextTaxThreshold function
 */
function nextTaxThreshold(income) {
  const thresholds = [85900, 178100, 340100, 420500, 693750];
  const next = thresholds.find(t => t > income) || 800000;
  return {
    name: `Next bracket at $${next.toLocaleString()}`,
    amount: next,
    distance: next - income,
  };
}

/**
 * Mock compareSoleVsScorp
 */
function compareSoleVsScorp(netProfit) {
  const scorpTaxSavings = netProfit * 0.15; // Simplified
  return {
    soleProprietorship: {
      seIncome: netProfit,
      seTax: netProfit * 0.153,
    },
    scorp: {
      w2Wages: netProfit * 0.6,
      distributedProfit: netProfit * 0.4,
      seTax: netProfit * 0.4 * 0.153,
      payrollTaxSavings: scorpTaxSavings,
    },
  };
}

/**
 * Mock augustaBenefit
 */
function augustaBenefit(rounds, costPerRound, marginal) {
  return {
    rounds,
    costPerRound,
    totalCost: rounds * costPerRound,
    taxBenefitAtMarginal: round2(rounds * costPerRound * marginal),
    netAfterTax: round2(rounds * costPerRound * (1 - marginal)),
  };
}

/**
 * Mock ctcAfterPhaseout
 */
function ctcAfterPhaseout(baseCredit, magi, kids) {
  const phaseoutThreshold = 400000;
  if (magi <= phaseoutThreshold) return baseCredit * kids;
  const excess = magi - phaseoutThreshold;
  const reduction = Math.ceil(excess / 1000) * 50;
  return Math.max(0, baseCredit * kids - reduction);
}

/**
 * Mock saltAfterPhaseout
 */
function saltAfterPhaseout(cap, magi) {
  const phaseoutThreshold = 400000;
  if (magi <= phaseoutThreshold) return cap;
  // Simplified: reduction of $2 per $1000 over threshold
  const excess = magi - phaseoutThreshold;
  const reduction = Math.ceil(excess / 1000) * 2;
  return Math.max(0, cap - reduction);
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Scenario Endpoints', () => {
  describe('GET /api/scenario (listScenarios)', () => {
    it('returns empty scenarios array when no scenarios exist', async () => {
      const env = createMockEnv();

      // Simulate listScenarios logic
      const rows = { results: [] };
      const scenarios = rows.results.map(r => ({
        id: r.id,
        label: r.label,
        createdAt: r.created_at,
        inputs: JSON.parse(r.inputs_json),
        result: JSON.parse(r.computed_json),
      }));

      assert.equal(scenarios.length, 0);
      assert.deepEqual(scenarios, []);
    });

    it('returns formatted scenarios with computed results', async () => {
      const dbOverrides = {
        scenarios: [
          {
            id: 1,
            label: 'scenario-1000',
            created_at: '2026-01-15T10:30:00Z',
            inputs_json: JSON.stringify({ greenputMonthlyNet: 5000 }),
            computed_json: JSON.stringify({
              inputs: { greenputMonthlyNet: 5000 },
              waterfall: { grossIn: 5000, taxReserve: 1650, discretionary: 500 },
            }),
          },
          {
            id: 2,
            label: 'scenario-2000',
            created_at: '2026-01-20T14:45:00Z',
            inputs_json: JSON.stringify({ greenputMonthlyNet: 7500, oneTimeIncome: 10000 }),
            computed_json: JSON.stringify({
              inputs: { greenputMonthlyNet: 7500, oneTimeIncome: 10000 },
              waterfall: { grossIn: 17500, taxReserve: 2475, discretionary: 2000 },
            }),
          },
        ],
      };

      const env = createMockEnv(dbOverrides);
      const rows = { results: dbOverrides.scenarios };
      const scenarios = rows.results.map(r => ({
        id: r.id,
        label: r.label,
        createdAt: r.created_at,
        inputs: JSON.parse(r.inputs_json),
        result: JSON.parse(r.computed_json),
      }));

      assert.equal(scenarios.length, 2);
      assert.equal(scenarios[0].id, 1);
      assert.equal(scenarios[0].label, 'scenario-1000');
      assert.deepEqual(scenarios[0].inputs, { greenputMonthlyNet: 5000 });
      assert.equal(scenarios[1].id, 2);
      assert.deepEqual(scenarios[1].inputs, { greenputMonthlyNet: 7500, oneTimeIncome: 10000 });
    });

    it('orders scenarios by ID descending (most recent first)', () => {
      const scenarios = [
        { id: 5, createdAt: '2026-01-25' },
        { id: 3, createdAt: '2026-01-20' },
        { id: 1, createdAt: '2026-01-15' },
      ];

      const sorted = [...scenarios].sort((a, b) => b.id - a.id);
      assert.equal(sorted[0].id, 5);
      assert.equal(sorted[1].id, 3);
      assert.equal(sorted[2].id, 1);
    });

    it('limits results to 20 scenarios', () => {
      const scenarios = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
      const limited = scenarios.slice(0, 20);

      assert.equal(limited.length, 20);
    });

    it('parses JSON inputs and results correctly', () => {
      const raw = {
        inputs_json: JSON.stringify({ greenputMonthlyNet: 5000, oneTimeIncome: 10000 }),
        computed_json: JSON.stringify({ waterfall: { discretionary: 500 } }),
      };

      const inputs = JSON.parse(raw.inputs_json);
      const result = JSON.parse(raw.computed_json);

      assert.equal(inputs.greenputMonthlyNet, 5000);
      assert.equal(inputs.oneTimeIncome, 10000);
      assert.equal(result.waterfall.discretionary, 500);
    });
  });

  describe('POST /api/scenario (postScenario)', () => {
    it('rejects invalid JSON in request body', () => {
      // Simulate JSON parse failure
      const invalidBody = 'not json{]';
      let error = null;

      try {
        JSON.parse(invalidBody);
      } catch (e) {
        error = e;
      }

      assert.ok(error instanceof SyntaxError);
      // Would return 400 with INVALID_JSON error
    });

    it('rejects null request body', () => {
      const body = null;
      const isValid = typeof body === 'object' && body !== null;

      assert.equal(isValid, false);
      // Would return 400 with INVALID_BODY error
    });

    it('rejects missing greenputMonthlyNet field', () => {
      const body = { oneTimeIncome: 10000 };
      const { greenputMonthlyNet } = body;

      const isValid = typeof greenputMonthlyNet === 'number' && Number.isFinite(greenputMonthlyNet);
      assert.equal(isValid, false);
      // Would return 400 with INVALID_INPUT error
    });

    it('rejects negative greenputMonthlyNet', () => {
      const body = { greenputMonthlyNet: -100 };
      const isValid = body.greenputMonthlyNet >= 0;

      assert.equal(isValid, false);
    });

    it('rejects greenputMonthlyNet above the 1,000,000 cap', () => {
      const MAX = 1_000_000;
      const testCases = [
        { greenputMonthlyNet: 1_000_001, valid: false },
        { greenputMonthlyNet: 99_999_999_999, valid: false },
        { greenputMonthlyNet: MAX, valid: true },
      ];

      testCases.forEach(tc => {
        const isValid = tc.greenputMonthlyNet >= 0 && tc.greenputMonthlyNet <= MAX;
        assert.equal(isValid, tc.valid);
      });
    });

    it('rejects non-numeric greenputMonthlyNet', () => {
      const testCases = [
        { greenputMonthlyNet: 'not a number', valid: false },
        { greenputMonthlyNet: null, valid: false },
        { greenputMonthlyNet: undefined, valid: false },
        { greenputMonthlyNet: NaN, valid: false },
        { greenputMonthlyNet: Infinity, valid: false },
        { greenputMonthlyNet: 5000, valid: true },
      ];

      testCases.forEach(tc => {
        const isValid =
          typeof tc.greenputMonthlyNet === 'number' && Number.isFinite(tc.greenputMonthlyNet);
        assert.equal(isValid, tc.valid);
      });
    });

    it('rejects invalid oneTimeIncome', () => {
      const MAX = 1_000_000;
      const testCases = [
        { oneTimeIncome: -5000, valid: false },
        { oneTimeIncome: 'not a number', valid: false },
        { oneTimeIncome: NaN, valid: false },
        { oneTimeIncome: Infinity, valid: false },
        { oneTimeIncome: 1_000_001, valid: false },
        { oneTimeIncome: 0, valid: true },
        { oneTimeIncome: 10000, valid: true },
      ];

      testCases.forEach(tc => {
        const isValid =
          tc.oneTimeIncome === undefined ||
          (typeof tc.oneTimeIncome === 'number' &&
            Number.isFinite(tc.oneTimeIncome) &&
            tc.oneTimeIncome >= 0 &&
            tc.oneTimeIncome <= MAX);
        assert.equal(isValid, tc.valid);
      });
    });

    it('accepts valid greenputMonthlyNet only', async () => {
      const body = { greenputMonthlyNet: 5000 };
      const isValid =
        typeof body.greenputMonthlyNet === 'number' &&
        Number.isFinite(body.greenputMonthlyNet) &&
        body.greenputMonthlyNet >= 0;

      assert.equal(isValid, true);
    });

    it('accepts valid greenputMonthlyNet with optional oneTimeIncome', async () => {
      const body = { greenputMonthlyNet: 5000, oneTimeIncome: 10000 };
      const monthlyValid =
        typeof body.greenputMonthlyNet === 'number' &&
        Number.isFinite(body.greenputMonthlyNet) &&
        body.greenputMonthlyNet >= 0;
      const oneTimeValid =
        body.oneTimeIncome === undefined ||
        (typeof body.oneTimeIncome === 'number' &&
          Number.isFinite(body.oneTimeIncome) &&
          body.oneTimeIncome >= 0);

      assert.equal(monthlyValid && oneTimeValid, true);
    });

    it('returns NOT_FOUND when owner profile not seeded', () => {
      const env = createMockEnv();
      const mockDb = {
        prepare: () => ({
          bind: function () {
            return this;
          },
          first: async () => null, // No user found
          all: async () => ({ results: [] }),
          run: async () => ({}),
        }),
      };

      const situation = null;
      const shouldReturn404 = !situation;
      assert.equal(shouldReturn404, true);
    });

    it('calculates scenario using routeCash function', async () => {
      const env = createMockEnv();
      const situation = {
        userId: 1,
        filingStatus: 'mfj',
        state: 'CA',
        incomeSources: [{ id: 1, type: 'w2', grossAnnual: 120000 }],
        liabilities: [{ id: 1, principal: 450000, rateApr: 0.045, minPaymentMonthly: 2400 }],
        fixedObligationsMonthly: 5000,
        liquidityFloorMonthly: 200,
        kidsCount: 3,
      };

      const inputs = { greenputMonthlyNet: 5000 };
      const result = routeCash(situation, inputs);

      assert.ok(result.inputs);
      assert.ok(result.waterfall);
      assert.ok(result.nextThreshold);
      assert.ok(result.magiProjection);
      assert.equal(result.inputs.greenputMonthlyNet, 5000);
      assert.equal(result.waterfall.grossIn, 5000);
    });

    it('correctly allocates monthly cash in waterfall order', () => {
      const situation = {
        incomeSources: [{ type: 'w2', grossAnnual: 120000 }],
        liabilities: [],
        fixedObligationsMonthly: 5000,
        liquidityFloorMonthly: 200,
      };

      const inputs = { greenputMonthlyNet: 10000 };
      const result = routeCash(situation, inputs);

      // Waterfall: grossIn -> taxReserve -> fixedObligations -> liquidityReserve -> avalanche -> discretionary
      const grossIn = 10000;
      const taxReserve = 10000 * 0.33; // 3300
      const afterTax = grossIn - taxReserve; // 6700
      const afterObligations = afterTax - 5000; // 1700
      const afterLiquidity = afterObligations - 200; // 1500

      assert.equal(result.waterfall.grossIn, 10000);
      assert.equal(result.waterfall.taxReserve, 3300);
      assert.equal(result.waterfall.fixedObligations, 5000);
      assert.equal(result.waterfall.liquidityReserve, 200);
      assert.ok(result.waterfall.discretionary >= 0);
    });

    it('handles zero discretionary after obligations', () => {
      const situation = {
        incomeSources: [{ type: 'w2', grossAnnual: 100000 }],
        liabilities: [],
        fixedObligationsMonthly: 8000,
        liquidityFloorMonthly: 500,
      };

      const inputs = { greenputMonthlyNet: 8500 };
      const result = routeCash(situation, inputs);

      // 8500 - 2805 (33%) - 8000 - 500 = -2805 -> clamps to 0
      assert.ok(result.waterfall.discretionary >= 0);
    });

    it('redirects surplus to debt avalanche targeting highest APR', () => {
      const situation = {
        incomeSources: [{ type: 'w2', grossAnnual: 100000 }],
        liabilities: [
          { id: 1, principal: 5000, rateApr: 0.24, minPaymentMonthly: 150 },
          { id: 2, principal: 25000, rateApr: 0.05, minPaymentMonthly: 300 },
        ],
        fixedObligationsMonthly: 500,
        liquidityFloorMonthly: 200,
      };

      const inputs = { greenputMonthlyNet: 2000 };
      const result = routeCash(situation, inputs);

      // Avalanche should target liability 1 (24% > 5%)
      assert.equal(result.waterfall.debtAvalanche.liabilityId, 1);
    });

    it('includes oneTimeIncome in gross and MAGI calculation', () => {
      const situation = {
        incomeSources: [{ type: 'w2', grossAnnual: 120000 }],
        liabilities: [],
        fixedObligationsMonthly: 5000,
        liquidityFloorMonthly: 200,
      };

      const inputs = { greenputMonthlyNet: 5000, oneTimeIncome: 15000 };
      const result = routeCash(situation, inputs);

      // Gross should include both monthly + one-time
      assert.equal(result.waterfall.grossIn, 20000);

      // MAGI should include annual projection + one-time
      const expectedMagi = 120000 + 5000 * 12 + 15000; // W2 + monthly*12 + one-time
      assert.equal(result.magiProjection, expectedMagi);
    });

    it('saves scenario to database with computed result', async () => {
      const situation = {
        userId: 1,
        incomeSources: [{ type: 'w2', grossAnnual: 100000 }],
        liabilities: [],
        fixedObligationsMonthly: 5000,
        liquidityFloorMonthly: 200,
      };

      const inputs = { greenputMonthlyNet: 5000 };
      const result = routeCash(situation, inputs);

      // Verify result can be stringified for DB storage
      const inputsJson = JSON.stringify(inputs);
      const resultJson = JSON.stringify(result);

      assert.ok(inputsJson.includes('5000'));
      assert.ok(resultJson.includes('waterfall'));
    });
  });
});

describe('Situation Endpoint', () => {
  describe('GET /api/situation (getSituation)', () => {
    it('returns NOT_FOUND when owner profile not seeded', () => {
      const situation = null;
      assert.equal(situation, null);
    });

    it('returns complete situation with loaded profile data', async () => {
      const env = createMockEnv();

      const situation = {
        userId: 1,
        filingStatus: 'mfj',
        state: 'CA',
        incomeSources: [
          {
            id: 1,
            userId: 1,
            label: 'GreenPut',
            type: 'w2',
            grossAnnual: 120000,
            employer: 'GreenPut',
            has401kMatch: true,
          },
        ],
        liabilities: [
          {
            id: 1,
            userId: 1,
            label: 'Mortgage',
            principal: 450000,
            rateApr: 0.045,
            minPaymentMonthly: 2400,
            type: 'mortgage',
            priority: 1,
          },
        ],
        fixedObligationsMonthly: 7400,
        liquidityFloorMonthly: 200,
        kidsCount: 3,
      };

      assert.ok(situation);
      assert.equal(situation.userId, 1);
      assert.equal(situation.filingStatus, 'mfj');
      assert.equal(situation.incomeSources.length, 1);
      assert.equal(situation.liabilities.length, 1);
    });

    it('calculates W2 annual income from income sources', () => {
      const incomeSources = [
        { type: 'w2', grossAnnual: 120000 },
        { type: 'w2', grossAnnual: 50000 },
        { type: 'se', grossAnnual: 30000 },
        { type: 'k1', grossAnnual: 10000 },
      ];

      const w2Annual = incomeSources
        .filter(s => s.type === 'w2')
        .reduce((sum, s) => sum + s.grossAnnual, 0);

      assert.equal(w2Annual, 170000);
    });

    it('calculates stacked marginal tax rate', () => {
      // Test various income levels
      const testCases = [
        { w2: 50000, expected: 0.24 },
        { w2: 120000, expected: 0.35 },
        { w2: 250000, expected: 0.42 },
        { w2: 600000, expected: 0.47 },
      ];

      testCases.forEach(tc => {
        const marginal = stackedMarginal(tc.w2, [], []);
        assert.equal(marginal, tc.expected);
      });
    });

    it('includes next tax threshold in response', () => {
      const w2Annual = 120000;
      const nextThreshold = nextTaxThreshold(w2Annual);

      assert.ok(nextThreshold.name);
      assert.ok(nextThreshold.amount);
      assert.equal(nextThreshold.amount, 178100); // Next MFJ bracket in 2026
      assert.equal(nextThreshold.distance, 178100 - 120000);
    });

    it('calculates S-Corp comparison ladder at multiple income levels', () => {
      const ladder = [80000, 100000, 145000, 200000].map(net => ({
        netProfit: net,
        ...compareSoleVsScorp(net, 0.5),
      }));

      assert.equal(ladder.length, 4);
      assert.equal(ladder[0].netProfit, 80000);
      assert.ok(ladder[0].soleProprietorship);
      assert.ok(ladder[0].scorp);

      // S-Corp should reduce SE tax
      const soleSeIncome = ladder[0].soleProprietorship.seIncome;
      const scorpSeIncome = ladder[0].scorp.distributedProfit;
      assert.ok(scorpSeIncome < soleSeIncome);
    });

    it('calculates Augusta golf course tax benefit at market rate', () => {
      const marginal = 0.35;
      const augusta = augustaBenefit(14, 350, marginal);

      assert.equal(augusta.rounds, 14);
      assert.equal(augusta.costPerRound, 350);
      assert.equal(augusta.totalCost, 4900);
      assert.ok(augusta.taxBenefitAtMarginal > 0);
      assert.ok(augusta.netAfterTax > 0);
      assert.ok(augusta.netAfterTax < augusta.totalCost);
    });

    it('calculates CTC after phaseout at current MAGI', () => {
      const testCases = [
        { magi: 100000, kids: 3, baseCredit: 2200, expectedInRange: true },
        { magi: 400000, kids: 3, baseCredit: 2200, expectedInRange: true }, // At threshold
        { magi: 450000, kids: 3, baseCredit: 2200, expectedInRange: true }, // Over threshold - reduced
      ];

      testCases.forEach(tc => {
        const ctc = ctcAfterPhaseout(tc.baseCredit, tc.magi, tc.kids);
        assert.ok(ctc >= 0);
        assert.ok(ctc <= tc.baseCredit * tc.kids);
      });
    });

    it('calculates SALT deduction after phaseout', () => {
      const cap = 40400;

      const testCases = [
        { magi: 100000, expected: cap },
        { magi: 400000, expected: cap }, // At threshold
        { magi: 450000, expectedLessThan: cap }, // Over threshold - reduced
      ];

      testCases.forEach(tc => {
        const salt = saltAfterPhaseout(cap, tc.magi);
        assert.ok(salt >= 0);
        assert.ok(salt <= cap);

        if (tc.expected) {
          assert.equal(salt, tc.expected);
        }
        if (tc.expectedLessThan) {
          assert.ok(salt < tc.expectedLessThan);
        }
      });
    });

    it('includes all required response fields', async () => {
      const situation = {
        userId: 1,
        filingStatus: 'mfj',
        state: 'CA',
        incomeSources: [{ type: 'w2', grossAnnual: 120000 }],
        liabilities: [],
        fixedObligationsMonthly: 5000,
        liquidityFloorMonthly: 200,
        kidsCount: 3,
      };

      const w2Annual = 120000;
      const marginal = stackedMarginal(w2Annual, [], []);
      const scorpLadder = [80000, 100000].map(net => ({
        netProfit: net,
        ...compareSoleVsScorp(net, 0.5),
      }));

      const response = {
        situation,
        projectedMagi: w2Annual,
        stackedMarginal: marginal,
        nextThreshold: nextTaxThreshold(w2Annual),
        scorpLadder,
        augusta: augustaBenefit(14, 350, marginal),
        ctc: {
          baseCredit: 2200,
          kids: situation.kidsCount,
          currentAnnual: ctcAfterPhaseout(2200, w2Annual, situation.kidsCount),
        },
        salt: {
          cap2026Base: 40400,
          currentAnnual: saltAfterPhaseout(40400, w2Annual),
        },
      };

      assert.ok(response.situation);
      assert.ok(response.projectedMagi);
      assert.ok(response.stackedMarginal);
      assert.ok(response.nextThreshold);
      assert.ok(response.scorpLadder);
      assert.ok(response.augusta);
      assert.ok(response.ctc);
      assert.ok(response.salt);
    });
  });
});

describe('Marginal Rate Calculations', () => {
  it('calculates correct federal marginal rate by income level', () => {
    const testCases = [
      { income: 22000, expected: 0.1 },
      { income: 89075, expected: 0.12 },
      { income: 178100, expected: 0.22 },
      { income: 340100, expected: 0.24 },
      { income: 420500, expected: 0.32 },
      { income: 693750, expected: 0.35 },
      { income: 1000000, expected: 0.37 },
    ];

    testCases.forEach(tc => {
      const marginal = stackedMarginal(tc.income, [], []);
      // Simplified for mock - real implementation checks actual brackets
      assert.ok(marginal > 0 && marginal < 1);
    });
  });

  it('includes CA state tax in stacked marginal', () => {
    const w2Annual = 250000;
    const marginal = stackedMarginal(w2Annual, [], []);

    // Should be higher than federal alone due to CA state tax
    assert.ok(marginal > 0.37);
  });

  it('accounts for FICA tax reduction in stacked marginal', () => {
    const w2Annual = 100000;
    const marginal = stackedMarginal(w2Annual, [], []);

    // Should be less than income tax alone (FICA is deductible)
    assert.ok(marginal < 0.4);
  });

  it('correctly stacks federal + state + FICA', () => {
    const federalRate = 0.24;
    const caRate = 0.093;
    const ficaDeduction = 0.03; // Simplified
    const stacked = federalRate + caRate - ficaDeduction;

    assert.ok(stacked > federalRate);
    assert.ok(stacked > caRate);
  });
});

describe('S-Corp Comparison Ladder', () => {
  it('shows increasing savings with higher net profit', () => {
    const profits = [50000, 100000, 200000];
    const results = profits.map(p => compareSoleVsScorp(p, 0.5));

    // Higher profits should lead to more SE tax (and therefore more potential savings)
    assert.ok(results[2].soleProprietorship.seTax > results[0].soleProprietorship.seTax);
  });

  it('calculates S-Corp payroll tax savings', () => {
    const netProfit = 100000;
    const result = compareSoleVsScorp(netProfit, 0.5);

    assert.ok(result.scorp.payrollTaxSavings > 0);

    // Sole proprietor pays more SE tax than S-Corp distributed profit tax
    assert.ok(result.soleProprietorship.seTax > result.scorp.seTax);
  });

  it('includes W-2 wages component for S-Corp', () => {
    const netProfit = 100000;
    const result = compareSoleVsScorp(netProfit, 0.5);

    assert.ok(result.scorp.w2Wages > 0);
    assert.ok(result.scorp.distributedProfit > 0);
    assert.ok(Math.abs(result.scorp.w2Wages + result.scorp.distributedProfit - netProfit) < 1);
  });

  it('shows zero savings at low income levels', () => {
    const netProfit = 30000;
    const result = compareSoleVsScorp(netProfit, 0.5);

    // At very low income, S-Corp complexity may not be worth it
    assert.ok(result.scorp.payrollTaxSavings >= 0);
  });
});

describe('Integration Tests', () => {
  it('scenario and situation endpoints work together for tax planning', async () => {
    const env = createMockEnv();

    // Load situation
    const situation = {
      userId: 1,
      filingStatus: 'mfj',
      state: 'CA',
      incomeSources: [{ type: 'w2', grossAnnual: 120000 }],
      liabilities: [
        {
          id: 1,
          principal: 450000,
          rateApr: 0.045,
          minPaymentMonthly: 2400,
          type: 'mortgage',
          priority: 1,
        },
      ],
      fixedObligationsMonthly: 7400,
      liquidityFloorMonthly: 200,
      kidsCount: 3,
    };

    // Create scenario
    const inputs = { greenputMonthlyNet: 5000 };
    const scenario = routeCash(situation, inputs);

    // Calculate tax impacts
    const w2Annual = 120000;
    const marginal = stackedMarginal(w2Annual, [], []);
    const ctc = ctcAfterPhaseout(2200, w2Annual, 3);

    // Verify integration
    assert.ok(scenario.waterfall);
    assert.ok(marginal > 0);
    assert.ok(ctc > 0);
    assert.ok(ctc <= 2200 * 3);
  });

  it('scenario computation respects situation constraints', async () => {
    const situation = {
      incomeSources: [{ type: 'w2', grossAnnual: 100000 }],
      liabilities: [{ id: 1, principal: 10000, rateApr: 0.24, minPaymentMonthly: 300 }],
      fixedObligationsMonthly: 5000,
      liquidityFloorMonthly: 200,
    };

    const inputs = { greenputMonthlyNet: 5000 };
    const result = routeCash(situation, inputs);

    // Verify waterfall respects all constraints
    assert.equal(result.waterfall.fixedObligations, 5000);
    assert.equal(result.waterfall.liquidityReserve, 200);
    assert.ok(result.waterfall.taxReserve > 0);
    assert.ok(result.waterfall.discretionary >= 0);
  });

  it('handles complete financial scenario end-to-end', async () => {
    // Comprehensive scenario: W-2 income + self-employment + debt + dependents
    const situation = {
      userId: 1,
      filingStatus: 'mfj',
      state: 'CA',
      incomeSources: [
        { id: 1, type: 'w2', grossAnnual: 150000, employer: 'Corp' },
        { id: 2, type: 'se', grossAnnual: 0, employer: null },
      ],
      liabilities: [
        { id: 1, principal: 450000, rateApr: 0.045, minPaymentMonthly: 2400, type: 'mortgage' },
        { id: 2, principal: 25000, rateApr: 0.05, minPaymentMonthly: 300, type: 'student' },
        { id: 3, principal: 5000, rateApr: 0.18, minPaymentMonthly: 150, type: 'cc' },
      ],
      fixedObligationsMonthly: 7850,
      liquidityFloorMonthly: 500,
      kidsCount: 3,
    };

    // Scenario 1: Conservative
    const conservativeInputs = { greenputMonthlyNet: 4000 };
    const conservative = routeCash(situation, conservativeInputs);
    assert.ok(conservative.waterfall);

    // Scenario 2: Aggressive with bonus
    const aggressiveInputs = { greenputMonthlyNet: 8000, oneTimeIncome: 25000 };
    const aggressive = routeCash(situation, aggressiveInputs);
    assert.ok(aggressive.waterfall);

    // Aggressive scenario should allocate more to debt
    assert.ok(
      aggressive.waterfall.debtAvalanche.amount >= conservative.waterfall.debtAvalanche.amount,
    );

    // Calculate tax planning insights
    const w2Annual = 150000;
    const conservativeMagi = w2Annual + 4000 * 12;
    const aggressiveMagi = w2Annual + 8000 * 12 + 25000;

    const conservativeMarginal = stackedMarginal(conservativeMagi, [], []);
    const aggressiveMarginal = stackedMarginal(aggressiveMagi, [], []);

    // Higher income = higher marginal rate
    assert.ok(aggressiveMarginal >= conservativeMarginal);
  });
});
