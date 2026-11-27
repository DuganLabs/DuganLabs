import { describe, expect, it } from 'vitest';
import {
  groupSlotsByLocalDay,
  localDayLabel,
  localTimeLabel,
  slotLabel,
} from './format';

const CHICAGO = 'America/Chicago';

describe('localTimeLabel', () => {
  it('prints the wall-clock time in the zone, not in UTC', () => {
    // 14:00Z is 09:00 in Chicago during daylight time.
    expect(localTimeLabel('2027-06-01T14:00:00.000Z', CHICAGO)).toBe('9:00 AM');
    expect(localTimeLabel('2027-06-01T14:30:00.000Z', CHICAGO)).toBe('9:30 AM');
  });

  it('follows the zone across a clock change', () => {
    // 15:00Z is 09:00 in Chicago once standard time is back.
    expect(localTimeLabel('2027-12-01T15:00:00.000Z', CHICAGO)).toBe('9:00 AM');
  });

  it('refuses a missing zone rather than printing UTC', () => {
    expect(() => localTimeLabel('2027-06-01T14:00:00.000Z', '')).toThrow(
      /time zone/,
    );
  });

  it('refuses a value that is not an instant', () => {
    expect(() => localTimeLabel('tomorrow', CHICAGO)).toThrow(RangeError);
  });
});

describe('localDayLabel', () => {
  it('names the local calendar day an instant falls on', () => {
    // 03:00Z on the 2nd is still the evening of the 1st in Chicago.
    expect(localDayLabel('2027-06-02T03:00:00.000Z', CHICAGO)).toBe(
      'Tuesday, June 1',
    );
  });
});

describe('slotLabel', () => {
  it('prints start and end as one range', () => {
    expect(
      slotLabel(
        {
          startUtc: '2027-06-01T14:00:00.000Z',
          endUtc: '2027-06-01T16:00:00.000Z',
        },
        CHICAGO,
      ),
    ).toBe('9:00 AM – 11:00 AM');
  });
});

describe('groupSlotsByLocalDay', () => {
  it('groups consecutive slots by their LOCAL day, keeping order', () => {
    const days = groupSlotsByLocalDay(
      [
        {
          startUtc: '2027-06-01T14:00:00.000Z',
          endUtc: '2027-06-01T16:00:00.000Z',
        },
        {
          startUtc: '2027-06-01T14:30:00.000Z',
          endUtc: '2027-06-01T16:30:00.000Z',
        },
        // 23:30 local on the 1st: same local day even though UTC has moved on.
        {
          startUtc: '2027-06-02T04:30:00.000Z',
          endUtc: '2027-06-02T06:30:00.000Z',
        },
        {
          startUtc: '2027-06-02T14:00:00.000Z',
          endUtc: '2027-06-02T16:00:00.000Z',
        },
      ],
      CHICAGO,
    );
    expect(days.map((d) => d.date)).toEqual(['2027-06-01', '2027-06-02']);
    expect(days[0].label).toBe('Tuesday, June 1');
    expect(days[0].slots.map((s) => s.label)).toEqual([
      '9:00 AM – 11:00 AM',
      '9:30 AM – 11:30 AM',
      '11:30 PM – 1:30 AM',
    ]);
    // The instants are carried through untouched — they are what gets booked.
    expect(days[1].slots[0].startUtc).toBe('2027-06-02T14:00:00.000Z');
  });

  it('is empty for no slots', () => {
    expect(groupSlotsByLocalDay([], CHICAGO)).toEqual([]);
  });
});
