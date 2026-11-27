import { describe, expect, it } from 'vitest';
import {
  isBookable,
  resolveAvailabilityForDate,
  weekdayOf,
  type AvailabilitySource,
} from './availability';

const WEEKDAYS_ONLY: AvailabilitySource = {
  timezone: 'America/Chicago',
  week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isOpen: weekday >= 1 && weekday <= 5,
    opensAt: '08:00',
    closesAt: '17:00',
  })),
  exceptions: [],
};

describe('weekdayOf', () => {
  it('reads a calendar date as a weekday without consulting the local clock', () => {
    expect(weekdayOf('2026-09-13')).toBe(0); // Sunday
    expect(weekdayOf('2026-09-14')).toBe(1); // Monday
    expect(weekdayOf('2026-12-25')).toBe(5); // Friday
  });
});

describe('resolveAvailabilityForDate', () => {
  it('answers from the weekday row when no exception names the date', () => {
    expect(resolveAvailabilityForDate(WEEKDAYS_ONLY, '2026-09-14')).toEqual({
      date: '2026-09-14',
      source: 'week',
      isOpen: true,
      opensAt: '08:00',
      closesAt: '17:00',
    });
    expect(resolveAvailabilityForDate(WEEKDAYS_ONLY, '2026-09-13')).toEqual({
      date: '2026-09-13',
      source: 'week',
      isOpen: false,
      opensAt: undefined,
      closesAt: undefined,
    });
  });

  it('an exception closing a normally-open day wins', () => {
    const source: AvailabilitySource = {
      ...WEEKDAYS_ONLY,
      exceptions: [{ date: '2026-12-25', isOpen: false }],
    };
    const day = resolveAvailabilityForDate(source, '2026-12-25');
    expect(day.source).toBe('exception');
    expect(day.isOpen).toBe(false);
    expect(day.opensAt).toBeUndefined();
  });

  it('an exception opening a normally-closed day wins too', () => {
    const source: AvailabilitySource = {
      ...WEEKDAYS_ONLY,
      exceptions: [
        {
          date: '2026-09-13',
          isOpen: true,
          opensAt: '10:00',
          closesAt: '14:00',
        },
      ],
    };
    expect(resolveAvailabilityForDate(source, '2026-09-13')).toEqual({
      date: '2026-09-13',
      source: 'exception',
      isOpen: true,
      opensAt: '10:00',
      closesAt: '14:00',
    });
  });

  it('a closed day never hands out hours, even if the row still carries them', () => {
    const source: AvailabilitySource = {
      ...WEEKDAYS_ONLY,
      exceptions: [
        {
          date: '2026-09-14',
          isOpen: false,
          opensAt: '08:00',
          closesAt: '17:00',
        },
      ],
    };
    const day = resolveAvailabilityForDate(source, '2026-09-14');
    expect(day.isOpen).toBe(false);
    expect(day.opensAt).toBeUndefined();
    expect(day.closesAt).toBeUndefined();
  });

  it('no row at all is closed, not open', () => {
    const empty: AvailabilitySource = {
      timezone: 'America/Chicago',
      week: [],
      exceptions: [],
    };
    expect(resolveAvailabilityForDate(empty, '2026-09-14')).toEqual({
      date: '2026-09-14',
      source: 'none',
      isOpen: false,
    });
  });
});

describe('isBookable', () => {
  it('is false with no rows — an absent answer publishes no claim', () => {
    expect(
      isBookable({ timezone: 'America/Chicago', week: [], exceptions: [] }),
    ).toBe(false);
  });

  it('is false without a timezone, however complete the week is', () => {
    expect(isBookable({ ...WEEKDAYS_ONLY, timezone: null })).toBe(false);
    expect(isBookable({ ...WEEKDAYS_ONLY, timezone: undefined })).toBe(false);
  });

  it('is false when every weekday is closed', () => {
    expect(
      isBookable({
        ...WEEKDAYS_ONLY,
        week: WEEKDAYS_ONLY.week.map((d) => ({ ...d, isOpen: false })),
      }),
    ).toBe(false);
  });

  it('is not rescued by an open exception alone', () => {
    expect(
      isBookable({
        timezone: 'America/Chicago',
        week: [],
        exceptions: [
          {
            date: '2026-09-13',
            isOpen: true,
            opensAt: '10:00',
            closesAt: '14:00',
          },
        ],
      }),
    ).toBe(false);
  });

  it('is true with a timezone and one open weekday', () => {
    expect(isBookable(WEEKDAYS_ONLY)).toBe(true);
  });
});
