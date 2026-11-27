import { describe, expect, it } from 'vitest';
import {
  InvalidTimezoneError,
  addDays,
  assertTimezone,
  localDateOf,
  minutesOfDay,
  zonedTimeToUtc,
} from './timezone';

const CHICAGO = 'America/Chicago';

describe('assertTimezone', () => {
  it('returns a zone the runtime resolves', () => {
    expect(assertTimezone(CHICAGO)).toBe(CHICAGO);
    expect(assertTimezone('UTC')).toBe('UTC');
  });

  it.each([null, undefined, ''])('%j is missing', (tz) => {
    expect(() => assertTimezone(tz)).toThrow(InvalidTimezoneError);
    expect(() => assertTimezone(tz)).toThrow(/none is set/);
  });

  it('an unresolvable name is unknown, not UTC', () => {
    expect(() => assertTimezone('Chicago')).toThrow(/Unknown IANA time zone/);
  });
});

describe('localDateOf', () => {
  it.each([
    // 2026-09-14T03:00Z is still Sunday evening in Chicago.
    { iso: '2026-09-14T03:00:00Z', tz: CHICAGO, date: '2026-09-13' },
    { iso: '2026-09-14T05:00:00Z', tz: CHICAGO, date: '2026-09-14' },
    { iso: '2026-09-14T23:30:00Z', tz: 'Asia/Tokyo', date: '2026-09-15' },
    { iso: '2026-01-01T00:00:00Z', tz: 'UTC', date: '2026-01-01' },
  ])('$iso in $tz is $date', ({ iso, tz, date }) => {
    expect(localDateOf(new Date(iso), tz)).toBe(date);
  });
});

describe('addDays', () => {
  it('crosses month and year ends by the calendar', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(() => addDays('14/09/2026', 1)).toThrow(RangeError);
  });
});

describe('minutesOfDay', () => {
  it.each([
    ['00:00', 0],
    ['08:30', 510],
    ['23:59', 1439],
  ])('%s is %i minutes', (hhmm, minutes) => {
    expect(minutesOfDay(hhmm)).toBe(minutes);
  });

  it.each(['8:30', '24:00', '12:60', '', 'noon'])('%j is rejected', (bad) => {
    expect(() => minutesOfDay(bad)).toThrow(RangeError);
  });
});

describe('zonedTimeToUtc', () => {
  it.each([
    {
      date: '2026-09-14',
      minute: 8 * 60,
      tz: CHICAGO,
      iso: '2026-09-14T13:00:00.000Z',
    }, // CDT
    {
      date: '2026-01-14',
      minute: 8 * 60,
      tz: CHICAGO,
      iso: '2026-01-14T14:00:00.000Z',
    }, // CST
    {
      date: '2026-09-14',
      minute: 8 * 60,
      tz: 'Asia/Kathmandu',
      iso: '2026-09-14T02:15:00.000Z',
    },
    {
      date: '2026-09-14',
      minute: 0,
      tz: 'UTC',
      iso: '2026-09-14T00:00:00.000Z',
    },
    // The day of the change, either side of it.
    {
      date: '2026-03-08',
      minute: 1 * 60,
      tz: CHICAGO,
      iso: '2026-03-08T07:00:00.000Z',
    }, // 01:00 CST
    {
      date: '2026-03-08',
      minute: 8 * 60,
      tz: CHICAGO,
      iso: '2026-03-08T13:00:00.000Z',
    }, // 08:00 CDT
    {
      date: '2026-11-01',
      minute: 8 * 60,
      tz: CHICAGO,
      iso: '2026-11-01T14:00:00.000Z',
    }, // 08:00 CST
  ])('$date +$minute min in $tz is $iso', ({ date, minute, tz, iso }) => {
    expect(zonedTimeToUtc(date, minute, tz).toISOString()).toBe(iso);
  });

  it('rolls a time inside the spring-forward gap onto the next real one', () => {
    // 02:30 on 2026-03-08 does not exist in Chicago; the clock reads 03:30.
    expect(zonedTimeToUtc('2026-03-08', 150, CHICAGO).toISOString()).toBe(
      '2026-03-08T08:30:00.000Z',
    );
  });

  it('takes the first occurrence of a time that happens twice', () => {
    // 01:30 on 2026-11-01 happens in CDT (06:30Z) and again in CST (07:30Z).
    expect(zonedTimeToUtc('2026-11-01', 90, CHICAGO).toISOString()).toBe(
      '2026-11-01T06:30:00.000Z',
    );
  });
});
