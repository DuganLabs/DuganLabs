import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDate,
  formatDateTime,
  isExpired,
  daysBetween,
  startOfDay,
  toRelativeTime,
} from './date';

describe('formatDate', () => {
  it('formats a valid ISO string', () => {
    expect(formatDate('2026-03-20T14:30:00Z')).toBe('Mar 20, 2026');
  });

  it('formats Jan 1', () => {
    expect(formatDate('2025-01-01T00:00:00Z')).toBe('Jan 1, 2025');
  });

  it('formats Dec 31', () => {
    expect(formatDate('2024-12-31T23:59:59Z')).toBe('Dec 31, 2024');
  });

  it('returns "Invalid date" for garbage input', () => {
    expect(formatDate('not-a-date')).toBe('Invalid date');
  });

  it('returns "Invalid date" for empty string', () => {
    expect(formatDate('')).toBe('Invalid date');
  });
});

describe('formatDateTime', () => {
  it('formats date and time in 12-hour format', () => {
    expect(formatDateTime('2026-03-20T14:30:00Z')).toBe(
      'Mar 20, 2026, 2:30 PM',
    );
  });

  it('formats midnight as 12:00 AM', () => {
    expect(formatDateTime('2026-01-01T00:00:00Z')).toBe(
      'Jan 1, 2026, 12:00 AM',
    );
  });

  it('formats noon as 12:00 PM', () => {
    expect(formatDateTime('2026-06-15T12:00:00Z')).toBe(
      'Jun 15, 2026, 12:00 PM',
    );
  });

  it('pads minutes with zero', () => {
    expect(formatDateTime('2026-03-20T09:05:00Z')).toBe(
      'Mar 20, 2026, 9:05 AM',
    );
  });

  it('returns "Invalid date" for invalid input', () => {
    expect(formatDateTime('garbage')).toBe('Invalid date');
  });
});

describe('isExpired', () => {
  it('returns true for a past date', () => {
    expect(isExpired('2020-01-01T00:00:00Z')).toBe(true);
  });

  it('returns false for a far future date', () => {
    expect(isExpired('2099-12-31T23:59:59Z')).toBe(false);
  });

  it('returns false for invalid input', () => {
    expect(isExpired('not-a-date')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isExpired('')).toBe(false);
  });
});

describe('daysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(daysBetween('2026-03-20T00:00:00Z', '2026-03-20T00:00:00Z')).toBe(0);
  });

  it('returns correct days for a known range', () => {
    expect(daysBetween('2026-03-01T00:00:00Z', '2026-03-20T00:00:00Z')).toBe(
      19,
    );
  });

  it('is order-independent (absolute value)', () => {
    expect(daysBetween('2026-03-20T00:00:00Z', '2026-03-01T00:00:00Z')).toBe(
      19,
    );
  });

  it('returns 0 for invalid input', () => {
    expect(daysBetween('bad', '2026-03-01T00:00:00Z')).toBe(0);
  });

  it('returns 0 when both are invalid', () => {
    expect(daysBetween('', '')).toBe(0);
  });

  it('handles cross-year dates', () => {
    expect(daysBetween('2025-12-31T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(1);
  });
});

describe('startOfDay', () => {
  it('zeroes out time components', () => {
    expect(startOfDay('2026-03-20T14:30:45.123Z')).toBe(
      '2026-03-20T00:00:00.000Z',
    );
  });

  it('returns same value if already at midnight', () => {
    expect(startOfDay('2026-03-20T00:00:00.000Z')).toBe(
      '2026-03-20T00:00:00.000Z',
    );
  });

  it('returns "Invalid date" for invalid input', () => {
    expect(startOfDay('nope')).toBe('Invalid date');
  });
});

describe('toRelativeTime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const NOW = new Date('2026-03-20T12:00:00Z').getTime();

  it('returns "just now" for very recent times', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2026-03-20T11:59:30Z')).toBe('just now');
  });

  it('returns minutes ago', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2026-03-20T11:55:00Z')).toBe('5 minutes ago');
  });

  it('returns "1 minute ago" for singular', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2026-03-20T11:59:00Z')).toBe('1 minute ago');
  });

  it('returns hours ago', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2026-03-20T10:00:00Z')).toBe('2 hours ago');
  });

  it('returns "1 hour ago" for singular', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2026-03-20T11:00:00Z')).toBe('1 hour ago');
  });

  it('returns days ago', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2026-03-17T12:00:00Z')).toBe('3 days ago');
  });

  it('returns "1 day ago" for singular', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2026-03-19T12:00:00Z')).toBe('1 day ago');
  });

  it('returns months ago', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    // 90 days difference = 3 months
    expect(toRelativeTime('2025-12-20T12:00:00Z')).toBe('3 months ago');
  });

  it('returns "1 month ago" for singular', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    // 45 days = 1 month (floor(45/30) = 1)
    expect(toRelativeTime('2026-02-03T12:00:00Z')).toBe('1 month ago');
  });

  it('returns years ago', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2024-01-20T12:00:00Z')).toBe('2 years ago');
  });

  it('returns "in the future" for future dates', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(toRelativeTime('2026-03-21T12:00:00Z')).toBe('in the future');
  });

  it('returns "Invalid date" for invalid input', () => {
    expect(toRelativeTime('not-a-date')).toBe('Invalid date');
  });
});
