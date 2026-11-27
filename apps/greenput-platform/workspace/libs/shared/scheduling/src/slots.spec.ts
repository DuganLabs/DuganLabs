import { describe, expect, it } from 'vitest';
import type { DatedHours, WeekdayHours } from '@greenput/shared/utils';
import { generateSlots, type GenerateSlotsInput, type Slot } from './slots';
import { InvalidTimezoneError } from './timezone';

const CHICAGO = 'America/Chicago';

function week(
  openDays: readonly number[],
  opensAt = '08:00',
  closesAt = '17:00',
): WeekdayHours[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isOpen: openDays.includes(weekday),
    opensAt,
    closesAt,
  }));
}

const WEEKDAYS = week([1, 2, 3, 4, 5]);
const EVERY_DAY = week([0, 1, 2, 3, 4, 5, 6]);

/** Monday 2026-09-14, 07:00 CDT — an hour before a weekday opens. */
const MONDAY_7AM = new Date('2026-09-14T12:00:00Z');

const BASE: GenerateSlotsInput = {
  availability: WEEKDAYS,
  exceptions: [],
  jobs: [],
  durationMinutes: 60,
  timezone: CHICAGO,
  leadHours: 0,
  horizonDays: 1,
  travelBufferMinutes: 0,
  concurrency: 1,
  now: MONDAY_7AM,
};

const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

const starts = (slots: readonly Slot[]): string[] =>
  slots.map((s) => s.startUtc);

/** `HH:MM` of an instant on the workspace's own wall clock — checked through Intl, not through the code under test. */
function localTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

const onDate = (slots: readonly Slot[], isoDate: string): Slot[] =>
  slots.filter((s) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: CHICAGO })
      .format(new Date(s.startUtc))
      .startsWith(isoDate),
  );

describe('generateSlots across a DST boundary', () => {
  // 2026-03-08: 02:00 CST becomes 03:00 CDT (UTC-6 → UTC-5) at 08:00Z.
  // 2026-11-01: 02:00 CDT becomes 01:00 CST (UTC-5 → UTC-6) at 07:00Z.
  it.each([
    {
      name: 'March: 08:00 local moves from 14:00Z to 13:00Z',
      now: new Date('2026-03-06T12:00:00Z'),
      before: '2026-03-07',
      after: '2026-03-08',
      beforeOpen: '2026-03-07T14:00:00.000Z',
      afterOpen: '2026-03-08T13:00:00.000Z',
      beforeLast: '2026-03-07T22:00:00.000Z',
      afterLast: '2026-03-08T21:00:00.000Z',
    },
    {
      name: 'November: 08:00 local moves from 13:00Z to 14:00Z',
      now: new Date('2026-10-30T12:00:00Z'),
      before: '2026-10-31',
      after: '2026-11-01',
      beforeOpen: '2026-10-31T13:00:00.000Z',
      afterOpen: '2026-11-01T14:00:00.000Z',
      beforeLast: '2026-10-31T21:00:00.000Z',
      afterLast: '2026-11-01T22:00:00.000Z',
    },
  ])(
    '$name',
    ({ now, before, after, beforeOpen, afterOpen, beforeLast, afterLast }) => {
      const slots = generateSlots({
        ...BASE,
        availability: EVERY_DAY,
        now,
        horizonDays: 3,
      });
      const dayBefore = onDate(slots, before);
      const dayAfter = onDate(slots, after);

      // The opening time on the contractor's wall is fixed…
      expect(localTime(dayBefore[0]?.startUtc ?? '', CHICAGO)).toBe('08:00');
      expect(localTime(dayAfter[0]?.startUtc ?? '', CHICAGO)).toBe('08:00');
      // …and the instant behind it has moved by an hour.
      expect(dayBefore[0]?.startUtc).toBe(beforeOpen);
      expect(dayAfter[0]?.startUtc).toBe(afterOpen);
      // The close moves with it: last one-hour start is 16:00 local on both days.
      expect(last(dayBefore)?.startUtc).toBe(beforeLast);
      expect(last(dayAfter)?.startUtc).toBe(afterLast);
      // 08:00 … 16:00 on the half hour is 17 starts, on either side of the change.
      expect(dayBefore).toHaveLength(17);
      expect(dayAfter).toHaveLength(17);
      for (const slot of [...dayBefore, ...dayAfter]) {
        expect(localTime(slot.startUtc, CHICAGO)).toMatch(/^\d\d:(00|30)$/);
      }
    },
  );

  it('offers a slot inside the spring-forward gap exactly once', () => {
    // Open 01:00–05:00 on 2026-03-08: the 02:00 and 02:30 wall-clock times
    // do not exist, and rolling them forward must not duplicate 03:00/03:30.
    const slots = generateSlots({
      ...BASE,
      availability: week([0], '01:00', '05:00'),
      now: new Date('2026-03-08T00:00:00Z'),
      horizonDays: 1,
    });
    expect(starts(slots)).toEqual([
      '2026-03-08T07:00:00.000Z', // 01:00 CST
      '2026-03-08T07:30:00.000Z', // 01:30 CST
      '2026-03-08T08:00:00.000Z', // 03:00 CDT
      '2026-03-08T08:30:00.000Z', // 03:30 CDT
      '2026-03-08T09:00:00.000Z', // 04:00 CDT
    ]);
  });
});

describe('generateSlots', () => {
  it('walks the whole open window on the half hour, first slot at opening time', () => {
    const slots = generateSlots(BASE);
    expect(slots[0]).toEqual({
      startUtc: '2026-09-14T13:00:00.000Z',
      endUtc: '2026-09-14T14:00:00.000Z',
    });
    expect(last(slots)).toEqual({
      startUtc: '2026-09-14T21:00:00.000Z',
      endUtc: '2026-09-14T22:00:00.000Z',
    });
    expect(slots).toHaveLength(17);
  });

  it('starts at the first half hour when the workspace opens off the grid', () => {
    const slots = generateSlots({
      ...BASE,
      availability: week([1, 2, 3, 4, 5], '08:15', '12:00'),
    });
    expect(starts(slots)[0]).toBe('2026-09-14T13:30:00.000Z');
  });

  it('keeps the local grid in a quarter-hour-offset zone', () => {
    // Kathmandu is UTC+05:45: 08:00 local is 02:15Z.
    const slots = generateSlots({
      ...BASE,
      timezone: 'Asia/Kathmandu',
      now: new Date('2026-09-14T00:00:00Z'),
    });
    expect(starts(slots)[0]).toBe('2026-09-14T02:15:00.000Z');
    expect(localTime(slots[0]?.startUtc ?? '', 'Asia/Kathmandu')).toBe('08:00');
  });

  describe('travel buffer around an existing job', () => {
    // A job 09:00–11:00 local (14:00Z–16:00Z) on Monday.
    const jobs = [
      { startUtc: '2026-09-14T14:00:00Z', endUtc: '2026-09-14T16:00:00Z' },
    ];

    it.each([
      {
        name: 'with a 30-minute buffer, 11:00 is blocked and 11:30 is free',
        travelBufferMinutes: 30,
        blocked: ['2026-09-14T16:00:00.000Z'],
        offered: ['2026-09-14T16:30:00.000Z'],
      },
      {
        name: 'with no buffer, 11:00 is the first start after the job',
        travelBufferMinutes: 0,
        blocked: ['2026-09-14T15:30:00.000Z'],
        offered: ['2026-09-14T16:00:00.000Z'],
      },
      {
        name: 'the buffer also follows the new job: 08:00 + 60 + 30 would reach into 09:00',
        travelBufferMinutes: 30,
        blocked: ['2026-09-14T13:00:00.000Z'],
        offered: [],
      },
    ])('$name', ({ travelBufferMinutes, blocked, offered }) => {
      const got = starts(generateSlots({ ...BASE, jobs, travelBufferMinutes }));
      for (const s of blocked) expect(got).not.toContain(s);
      for (const s of offered) expect(got).toContain(s);
    });

    it('with no buffer a job may start the minute the previous one ends', () => {
      const got = starts(
        generateSlots({ ...BASE, jobs, travelBufferMinutes: 0 }),
      );
      expect(got).toContain('2026-09-14T13:00:00.000Z'); // 08:00–09:00, job starts 09:00
    });
  });

  it('refuses a two-hour quote a slot 90 minutes before close', () => {
    const got = starts(generateSlots({ ...BASE, durationMinutes: 120 }));
    expect(got).toContain('2026-09-14T20:00:00.000Z'); // 15:00 → 17:00, fits
    expect(got).not.toContain('2026-09-14T20:30:00.000Z'); // 15:30 → 17:30, over
    expect(last(got)).toBe('2026-09-14T20:00:00.000Z');
  });

  it('counts the travel buffer against the close as well', () => {
    const got = starts(
      generateSlots({ ...BASE, durationMinutes: 120, travelBufferMinutes: 30 }),
    );
    expect(last(got)).toBe('2026-09-14T19:30:00.000Z'); // 14:30 + 2h + 30m = 17:00
  });

  describe('concurrency', () => {
    // One job 09:00–10:00 local on Monday.
    const jobs = [
      { startUtc: '2026-09-14T14:00:00Z', endUtc: '2026-09-14T15:00:00Z' },
    ];
    it.each([
      { concurrency: 1, expectOffered: false },
      { concurrency: 2, expectOffered: true },
    ])(
      'concurrency $concurrency → 09:00 offered: $expectOffered',
      ({ concurrency, expectOffered }) => {
        const got = starts(generateSlots({ ...BASE, jobs, concurrency }));
        expect(got.includes('2026-09-14T14:00:00.000Z')).toBe(expectOffered);
      },
    );

    it('two jobs fill a two-van shop', () => {
      const got = starts(
        generateSlots({ ...BASE, jobs: [...jobs, ...jobs], concurrency: 2 }),
      );
      expect(got).not.toContain('2026-09-14T14:00:00.000Z');
      expect(got).toContain('2026-09-14T15:00:00.000Z');
    });
  });

  describe('exceptions', () => {
    it('an exception closing a day removes every slot on it', () => {
      const exceptions: DatedHours[] = [{ date: '2026-09-14', isOpen: false }];
      const slots = generateSlots({ ...BASE, exceptions, horizonDays: 1 });
      expect(onDate(slots, '2026-09-14')).toEqual([]);
      // Tuesday is untouched — the horizon (Tue 07:00 local) leaves it empty
      // here, so widen it to prove the exception is per-date.
      const wider = generateSlots({ ...BASE, exceptions, horizonDays: 2 });
      expect(onDate(wider, '2026-09-15').length).toBeGreaterThan(0);
    });

    it('an exception opening a closed day adds slots with its own hours', () => {
      const sunday = new Date('2026-09-13T12:00:00Z');
      const closed = generateSlots({ ...BASE, now: sunday, horizonDays: 0.5 });
      expect(closed).toEqual([]);
      const opened = generateSlots({
        ...BASE,
        now: sunday,
        horizonDays: 0.5,
        exceptions: [
          {
            date: '2026-09-13',
            isOpen: true,
            opensAt: '10:00',
            closesAt: '12:00',
          },
        ],
      });
      expect(starts(opened)).toEqual([
        '2026-09-13T15:00:00.000Z',
        '2026-09-13T15:30:00.000Z',
        '2026-09-13T16:00:00.000Z',
      ]);
    });

    it('an exception shortening an open day narrows the window', () => {
      const slots = generateSlots({
        ...BASE,
        exceptions: [
          {
            date: '2026-09-14',
            isOpen: true,
            opensAt: '13:00',
            closesAt: '15:00',
          },
        ],
      });
      expect(starts(slots)).toEqual([
        '2026-09-14T18:00:00.000Z',
        '2026-09-14T18:30:00.000Z',
        '2026-09-14T19:00:00.000Z',
      ]);
    });
  });

  describe('lead hours and horizon', () => {
    it.each([
      // now is 07:00 local; slots run 08:00–16:00.
      { leadHours: 0, first: '2026-09-14T13:00:00.000Z' },
      { leadHours: 1, first: '2026-09-14T13:00:00.000Z' }, // exactly now + 1h qualifies
      { leadHours: 1.25, first: '2026-09-14T13:30:00.000Z' },
      { leadHours: 3, first: '2026-09-14T15:00:00.000Z' },
      { leadHours: 24, first: '2026-09-15T13:00:00.000Z' },
    ])('leadHours $leadHours → first start $first', ({ leadHours, first }) => {
      const got = starts(generateSlots({ ...BASE, leadHours, horizonDays: 3 }));
      expect(got[0]).toBe(first);
    });

    it.each([
      // now is Monday 10:00 local (15:00Z).
      { horizonDays: 1, lastStart: '2026-09-15T15:00:00.000Z' }, // Tue 10:00 inclusive
      { horizonDays: 0.5, lastStart: '2026-09-14T21:00:00.000Z' }, // Mon 22:00 local > close
      { horizonDays: 0, lastStart: '2026-09-14T15:00:00.000Z' }, // only "right now"
    ])(
      'horizonDays $horizonDays → last start $lastStart',
      ({ horizonDays, lastStart }) => {
        const got = starts(
          generateSlots({
            ...BASE,
            now: new Date('2026-09-14T15:00:00Z'),
            horizonDays,
          }),
        );
        expect(last(got)).toBe(lastStart);
      },
    );

    it('never offers a start before now even with zero lead', () => {
      const got = starts(
        generateSlots({ ...BASE, now: new Date('2026-09-14T15:10:00Z') }),
      );
      expect(got[0]).toBe('2026-09-14T15:30:00.000Z');
    });

    it('is empty when lead hours reach past the horizon', () => {
      expect(generateSlots({ ...BASE, leadHours: 48, horizonDays: 1 })).toEqual(
        [],
      );
    });

    it('is empty when the workspace has never said when it works', () => {
      expect(generateSlots({ ...BASE, availability: [] })).toEqual([]);
    });
  });

  describe('refuses bad input rather than guessing', () => {
    it.each([null, undefined, ''])(
      'timezone %j is refused as missing',
      (tz) => {
        expect(() => generateSlots({ ...BASE, timezone: tz })).toThrow(
          InvalidTimezoneError,
        );
        try {
          generateSlots({ ...BASE, timezone: tz });
        } catch (e) {
          expect((e as InvalidTimezoneError).reason).toBe('missing');
        }
      },
    );

    it('an unknown zone is refused as unknown', () => {
      expect(() =>
        generateSlots({ ...BASE, timezone: 'Mars/Olympus_Mons' }),
      ).toThrow(InvalidTimezoneError);
      try {
        generateSlots({ ...BASE, timezone: 'Mars/Olympus_Mons' });
      } catch (e) {
        expect((e as InvalidTimezoneError).reason).toBe('unknown');
      }
    });

    it.each([
      { patch: { durationMinutes: 0 }, name: 'zero duration' },
      { patch: { concurrency: 0 }, name: 'zero concurrency' },
      { patch: { concurrency: 1.5 }, name: 'fractional concurrency' },
      { patch: { travelBufferMinutes: -5 }, name: 'negative buffer' },
      { patch: { leadHours: Number.NaN }, name: 'NaN lead' },
      { patch: { now: new Date('nope') }, name: 'invalid now' },
      {
        patch: { jobs: [{ startUtc: 'yesterday', endUtc: 'today' }] },
        name: 'a job without instants',
      },
    ])('$name throws a RangeError', ({ patch }) => {
      expect(() => generateSlots({ ...BASE, ...patch })).toThrow(RangeError);
    });
  });
});
