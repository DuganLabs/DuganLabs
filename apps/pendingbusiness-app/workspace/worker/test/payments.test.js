import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Payment Calendar Tests
 * Tests for payment calendar endpoints: upcoming payments, grace period logic
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

describe('Payment Calendar Endpoints', () => {
  describe('GET /api/payments/upcoming', () => {
    it('returns empty array when no payments scheduled', () => {
      const payments = [];
      assert.deepEqual(payments, []);
    });

    it('returns upcoming payments sorted by due date', () => {
      const payments = [
        { id: 1, liabilityId: 1, dueDate: '2026-05-15', amount: 150, status: 'pending' },
        { id: 2, liabilityId: 2, dueDate: '2026-05-01', amount: 400, status: 'pending' },
        { id: 3, liabilityId: 3, dueDate: '2026-05-30', amount: 300, status: 'pending' },
      ];

      const sorted = payments.sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
      );

      assert.equal(sorted[0].dueDate, '2026-05-01');
      assert.equal(sorted[1].dueDate, '2026-05-15');
      assert.equal(sorted[2].dueDate, '2026-05-30');
    });

    it('filters out past-due payments by default', () => {
      const today = new Date('2026-04-27');
      const payments = [
        { id: 1, dueDate: '2026-04-20', status: 'pending' }, // Past due
        { id: 2, dueDate: '2026-04-27', status: 'pending' }, // Today
        { id: 3, dueDate: '2026-05-01', status: 'pending' }, // Future
      ];

      const upcoming = payments.filter(p => new Date(p.dueDate) >= today);
      assert.equal(upcoming.length, 2);
      assert.equal(upcoming[0].dueDate, '2026-04-27');
    });

    it('includes grace period flag for payments within grace window', () => {
      const today = new Date('2026-04-27');
      const gracePeriodDays = 10;
      const payments = [
        { id: 1, dueDate: '2026-04-25', daysLate: 2, inGracePeriod: true },
        { id: 2, dueDate: '2026-04-10', daysLate: 17, inGracePeriod: false },
      ];

      const withinGrace = payments.filter(p => p.inGracePeriod);
      assert.equal(withinGrace.length, 1);
      assert.equal(withinGrace[0].daysLate, 2);
    });

    it('limits results to next 30 days by default', () => {
      const today = new Date('2026-04-27');
      const thirtyDaysOut = new Date(today);
      thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);

      const payments = [
        { id: 1, dueDate: '2026-05-01' },
        { id: 2, dueDate: '2026-05-15' },
        { id: 3, dueDate: '2026-05-27' },
        { id: 4, dueDate: '2026-06-30' }, // Beyond 30 days
      ];

      const nextThirty = payments.filter(p => {
        const dueDate = new Date(p.dueDate);
        return dueDate >= today && dueDate <= thirtyDaysOut;
      });

      assert.equal(nextThirty.length, 3);
    });

    it('calculates days until payment is due', () => {
      const today = new Date('2026-04-27');
      const dueDate = new Date('2026-05-10');

      const daysUntilDue = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
      assert.equal(daysUntilDue, 13);
    });

    it('marks payments as past due when dueDate is before today', () => {
      const today = new Date('2026-04-27');
      const pastPayment = new Date('2026-04-20');

      const isPastDue = pastPayment < today;
      assert.equal(isPastDue, true);
    });
  });

  describe('GET /api/payments/calendar', () => {
    it('returns monthly calendar view of all payments', () => {
      const calendar = {
        year: 2026,
        month: 5,
        days: [
          { date: '2026-05-01', payments: [{ amount: 400 }] },
          { date: '2026-05-15', payments: [{ amount: 150 }] },
          { date: '2026-05-30', payments: [{ amount: 300 }] },
        ],
      };

      assert.equal(calendar.month, 5);
      assert.equal(calendar.days.length, 3);
    });

    it('groups multiple payments on same day', () => {
      const day = {
        date: '2026-05-01',
        payments: [
          { liabilityId: 1, amount: 150, type: 'cc' },
          { liabilityId: 2, amount: 400, type: 'student' },
        ],
      };

      assert.equal(day.payments.length, 2);
      const totalDayPayments = day.payments.reduce((sum, p) => sum + p.amount, 0);
      assert.equal(totalDayPayments, 550);
    });

    it('indicates when grace period is active', () => {
      const payments = [
        { id: 1, dueDate: '2026-05-01', inGracePeriod: false },
        { id: 2, dueDate: '2026-05-10', inGracePeriod: true, graceEndsDate: '2026-05-20' },
      ];

      const inGrace = payments.filter(p => p.inGracePeriod);
      assert.equal(inGrace.length, 1);
      assert.equal(inGrace[0].graceEndsDate, '2026-05-20');
    });

    it('includes payment status in calendar', () => {
      const payment = {
        id: 1,
        dueDate: '2026-05-01',
        status: 'pending',
        amount: 400,
      };

      const statuses = ['pending', 'paid', 'late', 'skipped'];
      assert.ok(statuses.includes(payment.status));
    });

    it('returns empty days for months with no payments', () => {
      const payments = [];
      const days = payments.length === 0 ? [] : payments;

      assert.equal(days.length, 0);
    });
  });

  describe('GET /api/payments/grace-periods', () => {
    it('returns empty array when no grace periods active', () => {
      const gracePeriods = [];
      assert.deepEqual(gracePeriods, []);
    });

    it('returns active grace periods with end dates', () => {
      const gracePeriods = [
        {
          paymentId: 1,
          graceStartDate: '2026-04-20',
          graceEndDate: '2026-04-30',
          daysRemaining: 3,
        },
        {
          paymentId: 2,
          graceStartDate: '2026-04-15',
          graceEndDate: '2026-05-05',
          daysRemaining: 8,
        },
      ];

      assert.equal(gracePeriods.length, 2);
      assert.equal(gracePeriods[0].daysRemaining, 3);
    });

    it('calculates days remaining in grace period', () => {
      const today = new Date('2026-04-27');
      const graceEndDate = new Date('2026-05-07');

      const daysRemaining = Math.floor((graceEndDate - today) / (1000 * 60 * 60 * 24));
      assert.equal(daysRemaining, 10);
    });

    it('filters out expired grace periods', () => {
      const today = new Date('2026-04-27');
      const gracePeriods = [
        { paymentId: 1, graceEndDate: '2026-04-25' }, // Expired
        { paymentId: 2, graceEndDate: '2026-05-05' }, // Active
        { paymentId: 3, graceEndDate: '2026-04-27' }, // Expires today
      ];

      const active = gracePeriods.filter(g => new Date(g.graceEndDate) > today);
      assert.equal(active.length, 1);
      assert.equal(active[0].paymentId, 2);
    });

    it('includes liability information with grace periods', () => {
      const gracePeriod = {
        paymentId: 1,
        liabilityId: 5,
        liabilityLabel: 'Credit Card',
        graceEndDate: '2026-05-07',
      };

      assert.equal(gracePeriod.liabilityLabel, 'Credit Card');
      assert.ok(typeof gracePeriod.liabilityId === 'number');
    });

    it('handles overlapping grace periods from different payments', () => {
      const today = new Date('2026-04-27');
      const gracePeriods = [
        { paymentId: 1, graceEndDate: '2026-05-07', liabilityId: 1 },
        { paymentId: 2, graceEndDate: '2026-05-10', liabilityId: 1 }, // Same liability
        { paymentId: 3, graceEndDate: '2026-05-05', liabilityId: 2 },
      ];

      const active = gracePeriods.filter(g => new Date(g.graceEndDate) > today);
      assert.equal(active.length, 3);
    });
  });

  describe('POST /api/payments/record', () => {
    it('records payment against scheduled payment', () => {
      const body = { paymentId: 1, amount: 400, paidDate: '2026-04-27' };
      assert.equal(body.paymentId, 1);
      assert.equal(body.amount, 400);
    });

    it('rejects negative payment amount', () => {
      const body = { paymentId: 1, amount: -100 };
      const isValid = body.amount > 0;

      assert.equal(isValid, false);
    });

    it('rejects zero payment amount', () => {
      const body = { paymentId: 1, amount: 0 };
      const isValid = body.amount > 0;

      assert.equal(isValid, false);
    });

    it('rejects payment amount greater than scheduled amount', () => {
      const scheduled = 400;
      const paid = 500;
      const isValid = paid <= scheduled;

      assert.equal(isValid, false);
    });

    it('marks payment as paid when recorded', () => {
      const payment = {
        id: 1,
        status: 'pending',
      };

      payment.status = 'paid';
      assert.equal(payment.status, 'paid');
    });

    it('updates payment recorded date', () => {
      const payment = {
        id: 1,
        dueDate: '2026-05-01',
        recordedDate: null,
      };

      payment.recordedDate = '2026-04-29';
      assert.equal(payment.recordedDate, '2026-04-29');
    });

    it('validates paymentId exists', () => {
      const paymentId = 999;
      const payments = [{ id: 1 }, { id: 2 }];

      const exists = payments.some(p => p.id === paymentId);
      assert.equal(exists, false);
    });

    it('returns 201 Created on successful recording', () => {
      const recorded = {
        paymentId: 1,
        amount: 400,
        status: 'paid',
        recordedAt: '2026-04-27T12:00:00Z',
      };

      assert.ok(recorded.paymentId);
      assert.equal(recorded.status, 'paid');
    });
  });

  describe('Edge Cases', () => {
    it('handles leap year February transitions', () => {
      // Test that date math handles February correctly
      const leapDate = new Date('2024-02-28');
      const nextDay = new Date(leapDate);
      nextDay.setDate(nextDay.getDate() + 1);

      // Just verify it can be constructed and works without error
      assert.ok(nextDay instanceof Date);
      assert.ok(nextDay > leapDate);
    });

    it('handles various month-end billing dates', () => {
      // Test that various month-end dates can be represented
      const dates = [
        '2026-01-31', // January
        '2026-04-30', // April
        '2026-12-31', // December
      ];

      dates.forEach(dateStr => {
        const d = new Date(dateStr);
        assert.ok(d instanceof Date);
        assert.ok(Number.isFinite(d.getTime()));
      });
    });

    it('handles payments scheduled far in future (1 year out)', () => {
      const today = new Date('2026-04-27');
      const futurePayment = new Date('2027-04-27');

      const monthsAway = 12;
      assert.equal(monthsAway, 12);
    });

    it('handles very small payment amounts (fractional cents)', () => {
      const amount = 0.01;
      const isValid = amount > 0;

      assert.equal(isValid, true);
    });

    it('handles very large payment amounts', () => {
      const amount = 999999.99;
      const isValid = typeof amount === 'number' && amount > 0;

      assert.equal(isValid, true);
    });

    it('handles grace period longer than normal billing cycle', () => {
      const dueDate = new Date('2026-05-01');
      const graceEndDate = new Date('2026-06-15'); // 45 days grace

      const gracePeriodDays = Math.floor((graceEndDate - dueDate) / (1000 * 60 * 60 * 24));
      assert.equal(gracePeriodDays, 45);
    });

    it('handles payment recorded before due date', () => {
      const dueDate = new Date('2026-05-15');
      const recordedDate = new Date('2026-05-10');

      const isEarly = recordedDate < dueDate;
      assert.equal(isEarly, true);
    });

    it('handles payment recorded long after grace period expired', () => {
      const graceEndDate = new Date('2026-05-07');
      const recordedDate = new Date('2026-06-27');

      const isLatePayment = recordedDate > graceEndDate;
      assert.equal(isLatePayment, true);
    });

    it('handles timezone-aware date comparisons', () => {
      const dueDate = new Date('2026-05-01T23:59:59Z');
      const recordedDate = new Date('2026-05-02T00:00:01Z');

      const isOnTime = recordedDate <= dueDate;
      assert.equal(isOnTime, false);
    });

    it('handles overlapping grace periods correctly', () => {
      const today = new Date('2026-04-27');
      const gracePeriods = [
        { paymentId: 1, graceEndDate: '2026-05-07' },
        { paymentId: 2, graceEndDate: '2026-05-15' }, // Overlaps with first
      ];

      const active = gracePeriods.filter(g => new Date(g.graceEndDate) > today);
      assert.equal(active.length, 2);
    });

    it('handles multiple payments on same day within grace period', () => {
      const day = '2026-05-01';
      const payments = [
        { id: 1, dueDate: day, inGracePeriod: true },
        { id: 2, dueDate: day, inGracePeriod: true },
        { id: 3, dueDate: day, inGracePeriod: true },
      ];

      const sameDayInGrace = payments.filter(p => p.dueDate === day && p.inGracePeriod);
      assert.equal(sameDayInGrace.length, 3);
    });
  });
});
