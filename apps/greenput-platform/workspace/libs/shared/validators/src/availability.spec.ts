import { describe, it, expect } from 'vitest';
import {
  AvailabilityDaySchema,
  AvailabilityExceptionSchema,
  LocalDateSchema,
  LocalTimeSchema,
  TimeZoneSchema,
  UpdateAvailabilitySchema,
  isIanaTimeZone,
} from './availability';

const WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isOpen: weekday !== 0 && weekday !== 6,
  opensAt: '08:00',
  closesAt: '17:00',
}));

const VALID = {
  timezone: 'America/Chicago',
  bookingLeadHours: 24,
  bookingHorizonDays: 30,
  travelBufferMinutes: 30,
  concurrentJobs: 1,
  week: WEEK,
  exceptions: [{ date: '2026-12-25', isOpen: false, reason: 'Christmas' }],
};

describe('LocalTimeSchema', () => {
  it.each(['00:00', '08:30', '23:59'])('accepts %s', (value) => {
    expect(LocalTimeSchema.safeParse(value).success).toBe(true);
  });
  it.each(['8:00', '24:00', '08:60', '0800', '08:00:00', ''])(
    'rejects %s',
    (value) => {
      expect(LocalTimeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('LocalDateSchema', () => {
  it('accepts a real date', () => {
    expect(LocalDateSchema.safeParse('2026-02-28').success).toBe(true);
  });
  it('rejects a date that only looks like one', () => {
    // new Date() would roll this forward to March 2 instead of refusing it.
    expect(LocalDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(LocalDateSchema.safeParse('2026-13-01').success).toBe(false);
  });
  it('rejects other shapes', () => {
    expect(LocalDateSchema.safeParse('25/12/2026').success).toBe(false);
    expect(LocalDateSchema.safeParse('2026-12-25T00:00:00Z').success).toBe(
      false,
    );
  });
});

describe('TimeZoneSchema', () => {
  it('accepts an IANA zone', () => {
    expect(isIanaTimeZone('America/Chicago')).toBe(true);
    expect(TimeZoneSchema.safeParse('Europe/London').success).toBe(true);
  });
  it('rejects a zone the runtime cannot resolve', () => {
    expect(isIanaTimeZone('Mars/Olympus_Mons')).toBe(false);
    // ICU resolves legacy abbreviations such as 'CST'; a display name is
    // not a zone under any alias.
    expect(TimeZoneSchema.safeParse('Central Time').success).toBe(false);
    expect(TimeZoneSchema.safeParse('').success).toBe(false);
  });
});

describe('AvailabilityDaySchema', () => {
  it('accepts an open day with hours in order', () => {
    expect(
      AvailabilityDaySchema.safeParse({
        weekday: 1,
        isOpen: true,
        opensAt: '08:00',
        closesAt: '17:00',
      }).success,
    ).toBe(true);
  });
  it('accepts a closed day with no hours at all', () => {
    expect(
      AvailabilityDaySchema.safeParse({ weekday: 0, isOpen: false }).success,
    ).toBe(true);
  });
  it('accepts a closed day that still carries hours', () => {
    expect(
      AvailabilityDaySchema.safeParse({
        weekday: 0,
        isOpen: false,
        opensAt: '08:00',
        closesAt: '17:00',
      }).success,
    ).toBe(true);
  });
  it('refuses an open day with no hours', () => {
    const result = AvailabilityDaySchema.safeParse({
      weekday: 1,
      isOpen: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toEqual([
        'opensAt',
        'closesAt',
      ]);
    }
  });
  it('refuses an open day that closes before it opens', () => {
    const result = AvailabilityDaySchema.safeParse({
      weekday: 1,
      isOpen: true,
      opensAt: '17:00',
      closesAt: '08:00',
    });
    expect(result.success).toBe(false);
  });
  it('refuses a weekday outside 0–6', () => {
    expect(
      AvailabilityDaySchema.safeParse({ weekday: 7, isOpen: false }).success,
    ).toBe(false);
    expect(
      AvailabilityDaySchema.safeParse({ weekday: 1.5, isOpen: false }).success,
    ).toBe(false);
  });
});

describe('AvailabilityExceptionSchema', () => {
  it('accepts a closed date with a reason', () => {
    expect(
      AvailabilityExceptionSchema.safeParse({
        date: '2026-12-25',
        isOpen: false,
        reason: 'Christmas',
      }).success,
    ).toBe(true);
  });
  it('accepts an open date — a normally closed day being opened', () => {
    expect(
      AvailabilityExceptionSchema.safeParse({
        date: '2026-12-26',
        isOpen: true,
        opensAt: '09:00',
        closesAt: '12:00',
      }).success,
    ).toBe(true);
  });
  it('trims and caps the reason', () => {
    const result = AvailabilityExceptionSchema.safeParse({
      date: '2026-12-25',
      isOpen: false,
      reason: '  Christmas  ',
    });
    expect(result.success && result.data.reason).toBe('Christmas');
    expect(
      AvailabilityExceptionSchema.safeParse({
        date: '2026-12-25',
        isOpen: false,
        reason: 'x'.repeat(201),
      }).success,
    ).toBe(false);
  });
});

describe('UpdateAvailabilitySchema', () => {
  it('accepts a full replacement', () => {
    const result = UpdateAvailabilitySchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it('accepts no timezone yet (explicit null), which is what makes a workspace not bookable', () => {
    expect(
      UpdateAvailabilitySchema.safeParse({ ...VALID, timezone: null }).success,
    ).toBe(true);
  });

  it('accepts no exceptions', () => {
    expect(
      UpdateAvailabilitySchema.safeParse({ ...VALID, exceptions: [] }).success,
    ).toBe(true);
  });

  it('refuses a partial week — six days is not a meaningful state', () => {
    const result = UpdateAvailabilitySchema.safeParse({
      ...VALID,
      week: WEEK.slice(0, 6),
    });
    expect(result.success).toBe(false);
  });

  it('refuses a week that names a weekday twice', () => {
    const week = WEEK.map((d, i) => (i === 6 ? { ...d, weekday: 5 } : d));
    expect(UpdateAvailabilitySchema.safeParse({ ...VALID, week }).success).toBe(
      false,
    );
  });

  it('refuses two exceptions on the same date', () => {
    expect(
      UpdateAvailabilitySchema.safeParse({
        ...VALID,
        exceptions: [
          { date: '2026-12-25', isOpen: false },
          {
            date: '2026-12-25',
            isOpen: true,
            opensAt: '09:00',
            closesAt: '12:00',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses every field missing — this is a PUT, not a PATCH', () => {
    expect(UpdateAvailabilitySchema.safeParse({ week: WEEK }).success).toBe(
      false,
    );
  });

  it.each([
    ['bookingLeadHours', -1],
    ['bookingLeadHours', 1.5],
    ['bookingHorizonDays', 0],
    ['bookingHorizonDays', 366],
    ['travelBufferMinutes', -5],
    ['concurrentJobs', 0],
    ['concurrentJobs', 51],
  ])('refuses %s = %s', (field, value) => {
    expect(
      UpdateAvailabilitySchema.safeParse({ ...VALID, [field]: value }).success,
    ).toBe(false);
  });
});
