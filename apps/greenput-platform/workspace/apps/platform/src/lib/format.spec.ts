import { describe, expect, it } from 'vitest';
import { formatCurrency, formatRelativeTime } from './format.js';

describe('formatCurrency', () => {
  it('rounds whole-dollar amounts by default', () => {
    expect(formatCurrency(1234.5)).toBe('$1,235');
  });

  it('shows cents when requested', () => {
    expect(formatCurrency(1234.5, { cents: true })).toBe('$1,234.50');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-04-30T12:00:00Z');

  it('returns "just now" for seconds-old timestamps', () => {
    expect(formatRelativeTime('2026-04-30T11:59:30Z', now)).toBe('just now');
  });

  it('rounds minutes', () => {
    expect(formatRelativeTime('2026-04-30T11:55:00Z', now)).toBe(
      '5 minutes ago',
    );
  });

  it('uses singular for 1 minute', () => {
    expect(formatRelativeTime('2026-04-30T11:59:00Z', now)).toBe(
      '1 minute ago',
    );
  });

  it('rounds hours', () => {
    expect(formatRelativeTime('2026-04-30T08:00:00Z', now)).toBe('4 hours ago');
  });

  it('rounds days for less-than-a-week timestamps', () => {
    expect(formatRelativeTime('2026-04-27T12:00:00Z', now)).toBe('3 days ago');
  });

  it('falls back to short date for older timestamps', () => {
    const out = formatRelativeTime('2026-03-01T12:00:00Z', now);
    expect(out).toMatch(/Mar\s+1/);
  });

  it('returns empty string for invalid input', () => {
    expect(formatRelativeTime('not a date', now)).toBe('');
  });
});
