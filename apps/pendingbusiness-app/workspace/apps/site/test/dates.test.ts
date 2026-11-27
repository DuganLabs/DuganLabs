// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { formatTimestamp, parseTimestamp, NO_VALUE } from '../src/lib/dates.js';

/**
 * The defect these replace: three call sites each did
 * `new Date(value + 'Z').toLocaleString()`, which parses exactly one input
 * shape. Given a valid ISO-8601 `createdAt` the Saved scenarios table rendered
 * "Invalid Date" in every row, because `…10:00:00Z` + `Z` is `…10:00:00ZZ`.
 *
 * These assert the properties — every timestamp shape the API can produce
 * parses to the same instant, and nothing ever reaches the DOM as
 * "Invalid Date" — rather than pinning today's formatted output, which is
 * locale- and timezone-dependent anyway.
 */

const INSTANT = Date.UTC(2026, 8, 1, 10, 0, 0); // 2026-09-01T10:00:00Z

describe('parseTimestamp', () => {
  it('reads every shape the API can hand back as the same instant', () => {
    const shapes = [
      '2026-09-01 10:00:00', // SQLite datetime('now') — no zone, stored as UTC
      '2026-09-01T10:00:00Z', // ISO-8601 UTC
      '2026-09-01T10:00:00.000Z', // ISO-8601 with milliseconds
      '2026-09-01T12:00:00+02:00', // ISO-8601 with an offset
      '2026-09-01T05:00:00-05:00', // ...and a negative one
    ];
    for (const shape of shapes) {
      expect(parseTimestamp(shape)?.getTime(), shape).toBe(INSTANT);
    }
  });

  it('does not double-append a zone to a value that already carries one', () => {
    // The specific failure: 'Z' + 'Z'. If this regresses, getTime() is NaN.
    expect(Number.isNaN(parseTimestamp('2026-09-01T10:00:00Z')?.getTime() ?? NaN)).toBe(false);
  });

  it('returns null rather than an Invalid Date for anything unparseable', () => {
    for (const bad of [null, undefined, '', '   ', 'not a date', '2026-13-45 99:99:99']) {
      expect(parseTimestamp(bad as string | null), String(bad)).toBeNull();
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseTimestamp('  2026-09-01 10:00:00  ')?.getTime()).toBe(INSTANT);
  });
});

describe('formatTimestamp', () => {
  it('never renders the string "Invalid Date", whatever it is given', () => {
    const inputs = [
      null,
      undefined,
      '',
      'not a date',
      '2026-09-01 10:00:00',
      '2026-09-01T10:00:00Z',
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T12:00:00+02:00',
    ];
    for (const value of inputs) {
      expect(formatTimestamp(value as string | null), String(value)).not.toBe('Invalid Date');
    }
  });

  it('falls back to the site-wide no-value mark, not an empty cell', () => {
    expect(formatTimestamp(null)).toBe(NO_VALUE);
    expect(formatTimestamp('garbage')).toBe(NO_VALUE);
  });

  it('formats the two storage shapes identically — they are the same instant', () => {
    expect(formatTimestamp('2026-09-01 10:00:00')).toBe(formatTimestamp('2026-09-01T10:00:00Z'));
  });
});

describe('no view re-implements timestamp parsing', () => {
  it('nothing appends a bare Z to a timestamp any more', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const srcDir = resolve(process.cwd(), 'src');
    const libDir = resolve(srcDir, 'lib');
    const files = [
      ...(await readdir(srcDir)).filter(f => f.endsWith('.ts')).map(f => resolve(srcDir, f)),
      ...(await readdir(libDir))
        .filter(f => f.endsWith('.ts') && f !== 'dates.ts')
        .map(f => resolve(libDir, f)),
    ];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, `${file} concatenates a timezone onto a date string`).not.toMatch(
        /new Date\([^)]*\+\s*['"]Z['"]/,
      );
    }
  });
});
