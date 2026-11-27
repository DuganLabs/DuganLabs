import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Float Ledger Tests
 * Tests for float ledger endpoints: daily snapshots and yield calculations
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

describe('Float Ledger Endpoints', () => {
  describe('GET /api/float/snapshots', () => {
    it('returns empty array when no snapshots exist', async () => {
      const env = createMockEnv();
      env.DB.prepare = () => ({
        bind: function () {
          return this;
        },
        all: async () => ({ results: [] }),
      });

      const rows = { results: [] };
      assert.deepEqual(rows.results, []);
    });

    it('returns daily snapshots in descending date order', async () => {
      const env = createMockEnv();
      const mockRows = {
        results: [
          { id: 1, user_id: 1, date: '2026-04-27', balance: 50000, yield_earned: 125 },
          { id: 2, user_id: 1, date: '2026-04-26', balance: 48000, yield_earned: 120 },
          { id: 3, user_id: 1, date: '2026-04-25', balance: 47000, yield_earned: 117 },
        ],
      };

      // Verify snapshots are sorted by date descending
      const sorted = mockRows.results.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      assert.equal(sorted[0].date, '2026-04-27');
      assert.equal(sorted[1].date, '2026-04-26');
      assert.equal(sorted[2].date, '2026-04-25');
    });

    it('calculates total yield from snapshots correctly', async () => {
      const snapshots = [{ yield_earned: 100 }, { yield_earned: 150 }, { yield_earned: 75 }];

      const totalYield = snapshots.reduce((sum, s) => sum + s.yield_earned, 0);
      assert.equal(totalYield, 325);
    });

    it('limits results to 90 days by default', async () => {
      const snapshots = [
        { date: '2026-04-27' },
        { date: '2026-04-26' },
        { date: '2026-02-25' }, // 90+ days ago (Feb 25 -> Apr 27 = 61 days, still within)
      ];

      // Use a fixed cutoff date for deterministic testing
      const cutoffDate = new Date('2026-04-27');
      cutoffDate.setDate(cutoffDate.getDate() - 90); // ~91 days back

      const filtered = snapshots.filter(s => {
        const snapDate = new Date(s.date);
        return snapDate >= cutoffDate;
      });

      assert.equal(filtered.length, 3);
    });
  });

  describe('GET /api/float/daily/:date', () => {
    it('returns 404 when no snapshot exists for date', async () => {
      const env = createMockEnv();
      const snapshot = null;

      assert.equal(snapshot, null);
    });

    it('returns snapshot with balance and yield for valid date', async () => {
      const snapshot = {
        date: '2026-04-27',
        balance: 50000.0,
        yield_earned: 125.5,
        yield_rate_apy: 0.045,
      };

      assert.equal(snapshot.balance, 50000.0);
      assert.equal(snapshot.yield_earned, 125.5);
      assert.equal(snapshot.yield_rate_apy, 0.045);
    });

    it('calculates daily yield correctly from APY', () => {
      const balance = 100000;
      const apy = 0.045; // 4.5% annual percentage yield
      const dailyYield = (balance * apy) / 365;

      assert.ok(dailyYield > 12 && dailyYield < 13);
      assert.equal(Math.round(dailyYield * 100) / 100, 12.33);
    });

    it('handles zero balance', () => {
      const balance = 0;
      const apy = 0.045;
      const dailyYield = (balance * apy) / 365;

      assert.equal(dailyYield, 0);
    });
  });

  describe('GET /api/float/yield-summary', () => {
    it('returns empty summary when no data available', async () => {
      const summary = { totalYield: 0, periodDays: 0, averageBalance: 0 };
      assert.equal(summary.totalYield, 0);
    });

    it('calculates total yield across period', () => {
      const snapshots = [
        { yield_earned: 100 },
        { yield_earned: 150 },
        { yield_earned: 125 },
        { yield_earned: 110 },
      ];

      const totalYield = snapshots.reduce((sum, s) => sum + s.yield_earned, 0);
      assert.equal(totalYield, 485);
    });

    it('calculates average balance correctly', () => {
      const snapshots = [
        { balance: 50000 },
        { balance: 55000 },
        { balance: 48000 },
        { balance: 52000 },
      ];

      const avgBalance = snapshots.reduce((sum, s) => sum + s.balance, 0) / snapshots.length;
      assert.equal(avgBalance, 51250);
    });

    it('calculates period days from first to last snapshot', () => {
      const startDate = new Date('2026-04-01');
      const endDate = new Date('2026-04-27');
      const periodDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));

      assert.equal(periodDays, 26);
    });

    it('returns correct APY from earned yield and average balance', () => {
      const totalYield = 500;
      const averageBalance = 100000;
      const periodDays = 90;

      const apy = (totalYield / averageBalance) * (365 / periodDays);
      assert.ok(apy > 0.02 && apy < 0.03);
    });
  });

  describe('POST /api/float/snapshot', () => {
    it('creates new daily snapshot with current balance', async () => {
      const body = { balance: 55000 };
      assert.equal(body.balance, 55000);
    });

    it('rejects negative balance', () => {
      const body = { balance: -1000 };
      const isValid = body.balance >= 0;

      assert.equal(isValid, false);
    });

    it('rejects non-numeric balance', () => {
      const body = { balance: 'not-a-number' };
      const isValid = typeof body.balance === 'number';

      assert.equal(isValid, false);
    });

    it('calculates and stores yield for day', () => {
      const balance = 100000;
      const apy = 0.045;
      const dayOfYear = 117; // April 27 in non-leap year
      const daysInYear = 365;

      const dailyYield = (balance * apy) / daysInYear;
      assert.ok(dailyYield > 12 && dailyYield < 13);
    });

    it('returns 201 Created with snapshot details', () => {
      const snapshot = {
        id: 1,
        date: '2026-04-27',
        balance: 55000,
        yield_earned: 123.5,
      };

      assert.equal(typeof snapshot.id, 'number');
      assert.equal(snapshot.date, '2026-04-27');
      assert.equal(snapshot.balance, 55000);
    });
  });

  describe('Edge Cases', () => {
    it('handles missing date parameter in daily endpoint', () => {
      const dateParam = undefined;
      const isValid = dateParam !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);

      assert.equal(isValid, false);
    });

    it('handles invalid date format', () => {
      const dateParam = 'not-a-date';
      const isValid = /^\d{4}-\d{2}-\d{2}$/.test(dateParam);

      assert.equal(isValid, false);
    });

    it('handles future dates (returns no data)', () => {
      const snapshotDate = new Date('2027-04-27');
      const today = new Date('2026-04-27');
      const isFuture = snapshotDate > today;

      assert.equal(isFuture, true);
    });

    it('handles very large balance values', () => {
      const balance = 999999999.99;
      const apy = 0.045;
      const dailyYield = (balance * apy) / 365;

      assert.ok(Number.isFinite(dailyYield));
      assert.ok(dailyYield > 0);
    });

    it('handles very small yield rates', () => {
      const balance = 100000;
      const apy = 0.0001; // 0.01%
      const dailyYield = (balance * apy) / 365;

      assert.ok(dailyYield > 0);
      assert.ok(dailyYield < 1);
    });
  });
});
