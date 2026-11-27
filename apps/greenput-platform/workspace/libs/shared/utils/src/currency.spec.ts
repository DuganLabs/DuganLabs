import { describe, it, expect } from 'vitest';
import { formatCurrency, parseCurrency } from './currency';

describe('formatCurrency', () => {
  it('formats zero cents', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats small amount', () => {
    expect(formatCurrency(99)).toBe('$0.99');
  });

  it('formats even dollars', () => {
    expect(formatCurrency(5000)).toBe('$50.00');
  });

  it('formats with commas for thousands', () => {
    expect(formatCurrency(123456)).toBe('$1,234.56');
  });

  it('formats large amounts', () => {
    expect(formatCurrency(1000000)).toBe('$10,000.00');
  });

  it('formats negative amounts', () => {
    expect(formatCurrency(-123456)).toBe('-$1,234.56');
  });

  it('returns "$0.00" for NaN', () => {
    expect(formatCurrency(NaN)).toBe('$0.00');
  });

  it('returns "$0.00" for Infinity', () => {
    expect(formatCurrency(Infinity)).toBe('$0.00');
  });

  it('handles single cent', () => {
    expect(formatCurrency(1)).toBe('$0.01');
  });

  it('returns "$0.00" for -Infinity', () => {
    expect(formatCurrency(-Infinity)).toBe('$0.00');
  });

  it('formats very large amount with multiple comma groups', () => {
    expect(formatCurrency(99999999)).toBe('$999,999.99');
  });

  it('formats exactly one million dollars', () => {
    expect(formatCurrency(100000000)).toBe('$1,000,000.00');
  });

  it('formats negative single cent', () => {
    expect(formatCurrency(-1)).toBe('-$0.01');
  });
});

describe('parseCurrency', () => {
  it('parses a formatted dollar string', () => {
    expect(parseCurrency('$1,234.56')).toBe(123456);
  });

  it('parses without dollar sign', () => {
    expect(parseCurrency('1234.56')).toBe(123456);
  });

  it('parses zero', () => {
    expect(parseCurrency('$0.00')).toBe(0);
  });

  it('parses a small amount', () => {
    expect(parseCurrency('$0.99')).toBe(99);
  });

  it('parses negative amounts', () => {
    expect(parseCurrency('-$1,234.56')).toBe(-123456);
  });

  it('returns 0 for empty string', () => {
    expect(parseCurrency('')).toBe(0);
  });

  it('returns 0 for garbage input', () => {
    expect(parseCurrency('not-money')).toBe(0);
  });

  it('handles amount with spaces', () => {
    expect(parseCurrency('$ 50.00')).toBe(5000);
  });

  it('handles whole dollar amounts', () => {
    expect(parseCurrency('$100')).toBe(10000);
  });

  it('parses negative formatted amount', () => {
    expect(parseCurrency('-$50.00')).toBe(-5000);
  });

  it('parses million dollar amount with commas', () => {
    expect(parseCurrency('$1,000,000.00')).toBe(100000000);
  });

  it('parses amount starting with decimal point', () => {
    expect(parseCurrency('.99')).toBe(99);
  });

  it('returns 0 for dollar sign only', () => {
    expect(parseCurrency('$')).toBe(0);
  });
});
