import { describe, expect, it } from 'vitest';
import {
  dateTimeLocalToIso,
  nextWholeHour,
  toDateTimeLocal,
} from './datetime.js';

describe('datetime-local helpers', () => {
  it('nextWholeHour is the first whole local hour strictly after the instant', () => {
    const at = new Date(2026, 4, 1, 9, 17, 42, 500);
    expect(nextWholeHour(at).getTime()).toBe(
      new Date(2026, 4, 1, 10, 0, 0, 0).getTime(),
    );
    // Already on the hour still moves forward: "next", not "this".
    expect(nextWholeHour(new Date(2026, 4, 1, 9, 0)).getHours()).toBe(10);
  });

  it('toDateTimeLocal formats in local time and round-trips through new Date()', () => {
    const at = new Date(2026, 0, 5, 7, 3);
    expect(toDateTimeLocal(at)).toBe('2026-01-05T07:03');
    expect(new Date(toDateTimeLocal(at)).getTime()).toBe(at.getTime());
  });

  it('dateTimeLocalToIso is the UTC instant of the local value, or null for nothing', () => {
    const at = new Date(2026, 0, 5, 7, 3);
    expect(dateTimeLocalToIso(toDateTimeLocal(at))).toBe(at.toISOString());
    expect(dateTimeLocalToIso('')).toBeNull();
    expect(dateTimeLocalToIso('   ')).toBeNull();
    expect(dateTimeLocalToIso('not a date')).toBeNull();
  });
});
