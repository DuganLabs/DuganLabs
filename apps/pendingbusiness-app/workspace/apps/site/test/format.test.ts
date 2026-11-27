import { describe, it, expect } from 'vitest';
import { usd, usdSigned, usdOwed, pct, fraction, age, MINUS, DASH } from '../src/lib/format.js';

/**
 * Guards for the numeric treatment in
 * `duganlabs-survey/pendingbusiness-visual-language.md` §2.3. These are
 * presentation rules with real consequences: a hyphen instead of U+2212
 * breaks column alignment, and a column whose cells carry different
 * precisions cannot be decimal-aligned by any amount of CSS.
 */

describe('currency precision is fixed per call, nulls included', () => {
  it('renders whole dollars at 0 dp — no stray cents', () => {
    expect(usd(310_500)).toBe('$310,500');
    expect(usd(8000)).toBe('$8,000');
    expect(usd(8000.4)).toBe('$8,000');
  });

  it('renders the waterfall at 2 dp, always both digits', () => {
    expect(usd(8000, 2)).toBe('$8,000.00');
    expect(usd(231.5, 2)).toBe('$231.50');
    expect(usd(0, 2)).toBe('$0.00');
  });

  it('every cell in a 0 dp column has the same digit count after the point', () => {
    // Decimal alignment is a consequence of equal fraction digits, not a
    // separate mechanism — so this is the property that has to hold.
    const column = [8000, 310_500.49, 0, 612_400].map(n => usd(n));
    for (const cell of column) expect(cell).not.toContain('.');
  });

  it('renders an unknown balance as an em dash, never as $0', () => {
    expect(usd(null)).toBe(DASH);
    expect(usd(undefined)).toBe(DASH);
    expect(usd(Number.NaN)).toBe(DASH);
    expect(usd(null)).not.toBe('$0');
  });
});

describe('negatives use U+2212 MINUS SIGN, never HYPHEN-MINUS', () => {
  it('swaps the hyphen Intl emits for a true minus', () => {
    expect(usd(-18_420)).toBe(`${MINUS}$18,420`);
    expect(usd(-18_420)).not.toContain('-');
    expect(MINUS).toBe('−');
  });

  it('usdOwed always renders an amount as negative', () => {
    expect(usdOwed(18_420)).toBe(`${MINUS}$18,420`);
    expect(usdOwed(-18_420)).toBe(`${MINUS}$18,420`);
    expect(usdOwed(0)).toBe('$0');
    expect(usdOwed(null)).toBe(DASH);
  });
});

describe('sign is rendered wherever direction is meaningful', () => {
  it('usdSigned marks both directions explicitly', () => {
    expect(usdSigned(5184)).toBe('+$5,184');
    expect(usdSigned(-5184)).toBe(`${MINUS}$5,184`);
    expect(usdSigned(0)).toBe('$0');
  });
});

describe('rates', () => {
  it('defaults APR to 2 dp — 24.49% vs 24.00% changes avalanche order', () => {
    expect(pct(0.2449)).toBe('24.49%');
    expect(pct(0.1999)).toBe('19.99%');
    expect(pct(0.0312)).toBe('3.12%');
  });

  it('takes an explicit precision for projections', () => {
    expect(pct(0.427, 1)).toBe('42.7%');
    expect(pct(0.153, 1)).toBe('15.3%');
  });

  it('renders a missing rate as an em dash', () => {
    expect(pct(null)).toBe(DASH);
  });
});

describe('fraction — the 0..1 value the CSS magnitude bars consume', () => {
  it('clamps into range and tolerates a zero or absent maximum', () => {
    expect(fraction(50, 100)).toBeCloseTo(0.5);
    expect(fraction(500, 100)).toBe(1);
    expect(fraction(-50, 100)).toBeCloseTo(0.5);
    expect(fraction(50, 0)).toBe(0);
    expect(fraction(Number.NaN, 100)).toBe(0);
  });
});

describe('age — drives the "stale" badge on a sync column', () => {
  it('marks anything a day old or more as stale', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    expect(age(twoDaysAgo).stale).toBe(true);
    expect(age(twoDaysAgo).text).toMatch(/\dd ago/);
  });

  it('leaves a fresh sync unmarked', () => {
    const tenMinsAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(age(tenMinsAgo)).toEqual({ text: '10m ago', stale: false });
  });

  it('renders a never-synced account as an em dash, not "Invalid Date"', () => {
    expect(age(null)).toEqual({ text: DASH, stale: false });
    expect(age('not a date').text).toBe(DASH);
  });
});
