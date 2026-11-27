import { describe, expect, it } from 'vitest';
import { findAutoBookSlot, type FindAutoBookSlotInput } from './auto-book';

// A Monday in Los Angeles. 2026-10-19 is a Monday.
const MONDAY = '2026-10-19T15:00:00.000Z'; // 08:00 PDT

function input(
  overrides: Partial<FindAutoBookSlotInput> = {},
): FindAutoBookSlotInput {
  return {
    windows: [
      // Tech A, Monday 08:00–17:00 local.
      { userId: 'tech-a', dayOfWeek: 1, startMinute: 480, endMinute: 1020 },
    ],
    blackouts: [],
    buffers: {
      preMinutes: 0,
      postMinutes: 0,
      minGapMinutes: 0,
      maxJobsPerDay: null,
    },
    settings: {
      timezone: 'America/Los_Angeles',
      minNoticeHours: 0,
      maxLeadTimeDays: 7,
      travelBufferMinutes: 0,
    },
    jobs: [],
    durationMinutes: 120,
    now: new Date(MONDAY),
    ...overrides,
  };
}

describe('findAutoBookSlot', () => {
  it('finds the first grid start inside the window', () => {
    const slot = findAutoBookSlot(input());
    expect(slot).toEqual({
      userId: 'tech-a',
      startUtc: '2026-10-19T15:00:00.000Z', // 08:00 PDT
      endUtc: '2026-10-19T17:00:00.000Z',
    });
  });

  it('honours minimum notice — no slot sooner than now + notice', () => {
    const slot = findAutoBookSlot(
      input({
        settings: {
          timezone: 'America/Los_Angeles',
          minNoticeHours: 4,
          maxLeadTimeDays: 7,
          travelBufferMinutes: 0,
        },
      }),
    );
    expect(slot?.startUtc).toBe('2026-10-19T19:00:00.000Z'); // 12:00 PDT
  });

  it('a blackout pushes the slot past it', () => {
    const slot = findAutoBookSlot(
      input({
        blackouts: [
          {
            userId: 'tech-a',
            startAt: '2026-10-19T15:00:00.000Z',
            endAt: '2026-10-19T18:00:00.000Z',
          },
        ],
      }),
    );
    expect(slot?.startUtc).toBe('2026-10-19T18:00:00.000Z');
  });

  it('an existing job plus the post-buffer and gap move the start', () => {
    const slot = findAutoBookSlot(
      input({
        buffers: {
          preMinutes: 0,
          postMinutes: 30,
          minGapMinutes: 30,
          maxJobsPerDay: null,
        },
        jobs: [
          {
            userId: 'tech-a',
            startUtc: '2026-10-19T15:00:00.000Z',
            endUtc: '2026-10-19T16:00:00.000Z',
          },
        ],
      }),
    );
    // Job ends 16:00Z; footprint may not start until 16:00 + 30 gap,
    // on the grid → 16:30Z.
    expect(slot?.startUtc).toBe('2026-10-19T16:30:00.000Z');
  });

  it('maxJobsPerDay closes the day and moves to the next window day', () => {
    const slot = findAutoBookSlot(
      input({
        windows: [
          { userId: 'tech-a', dayOfWeek: 1, startMinute: 480, endMinute: 1020 },
          { userId: 'tech-a', dayOfWeek: 2, startMinute: 480, endMinute: 1020 },
        ],
        buffers: {
          preMinutes: 0,
          postMinutes: 0,
          minGapMinutes: 0,
          maxJobsPerDay: 1,
        },
        jobs: [
          {
            userId: 'tech-a',
            startUtc: '2026-10-19T15:00:00.000Z',
            endUtc: '2026-10-19T16:00:00.000Z',
          },
        ],
      }),
    );
    expect(slot?.startUtc).toBe('2026-10-20T15:00:00.000Z'); // Tuesday
  });

  it('the footprint must fit inside the window — a 2h job + 1h post + travel cannot start at 15:30 in an 08–17 window', () => {
    const slot = findAutoBookSlot(
      input({
        buffers: {
          preMinutes: 0,
          postMinutes: 60,
          minGapMinutes: 0,
          maxJobsPerDay: null,
        },
        settings: {
          timezone: 'America/Los_Angeles',
          minNoticeHours: 0,
          maxLeadTimeDays: 7,
          travelBufferMinutes: 30,
        },
        jobs: [
          // Booked solid 08:00–13:30 local (15:00–20:30Z).
          {
            userId: 'tech-a',
            startUtc: '2026-10-19T15:00:00.000Z',
            endUtc: '2026-10-19T20:30:00.000Z',
          },
        ],
      }),
    );
    // Remaining window after 13:30 local: 3.5h; footprint needs 3.5h
    // (2h work + 1h post + 0.5h travel) starting at 13:30 → ends 17:00. Fits.
    expect(slot?.startUtc).toBe('2026-10-19T20:30:00.000Z');
  });

  it('returns null when no window exists in scope', () => {
    expect(findAutoBookSlot(input({ windows: [] }))).toBeNull();
  });

  it('returns null when the horizon closes before any fit', () => {
    const slot = findAutoBookSlot(
      input({
        windows: [
          // Only Sunday windows; now is Monday with a 2-day horizon and
          // Sunday is 6 days out.
          { userId: 'tech-a', dayOfWeek: 0, startMinute: 480, endMinute: 1020 },
        ],
        settings: {
          timezone: 'America/Los_Angeles',
          minNoticeHours: 0,
          maxLeadTimeDays: 2,
          travelBufferMinutes: 0,
        },
      }),
    );
    expect(slot).toBeNull();
  });

  it('refuses a missing timezone instead of reading it as UTC', () => {
    expect(() =>
      findAutoBookSlot(
        input({
          settings: {
            timezone: null,
            minNoticeHours: 0,
            maxLeadTimeDays: 7,
            travelBufferMinutes: 0,
          },
        }),
      ),
    ).toThrow();
  });
});
