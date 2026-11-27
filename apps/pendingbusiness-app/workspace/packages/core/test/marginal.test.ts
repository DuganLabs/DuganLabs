import { describe, it, expect } from 'vitest';
import { marginalRate, stackedMarginal, totalTax } from '../src/tax/marginal.js';
import { FEDERAL_MFJ_2026, CA_MFJ_2026 } from '../src/tax/brackets-2026.js';

describe('marginalRate', () => {
  it('returns 24% federal at $350k MFJ (just below the 32% bracket)', () => {
    expect(marginalRate(350_000, FEDERAL_MFJ_2026)).toBe(0.24);
  });
  it('returns 32% federal once MAGI crosses $394,600 MFJ', () => {
    expect(marginalRate(450_000, FEDERAL_MFJ_2026)).toBe(0.32);
  });
  it('returns 9.3% CA at $350k MFJ', () => {
    expect(marginalRate(350_000, CA_MFJ_2026)).toBe(0.093);
  });
});

describe('stackedMarginal', () => {
  it('stacks federal + CA at $450k MFJ MAGI to 41.3%', () => {
    const combined = stackedMarginal(450_000, FEDERAL_MFJ_2026, CA_MFJ_2026);
    expect(combined).toBeCloseTo(0.413, 3);
  });
});

describe('totalTax', () => {
  it('computes progressive federal tax at $206,700 (bracket boundary)', () => {
    const tax = totalTax(206_700, FEDERAL_MFJ_2026);
    const expected = 23_850 * 0.1 + (96_950 - 23_850) * 0.12 + (206_700 - 96_950) * 0.22;
    expect(tax).toBeCloseTo(expected, 2);
  });
});
