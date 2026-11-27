import { describe, it, expect } from 'vitest';
import { augustaBenefit } from '../src/augusta.js';

describe('augustaBenefit', () => {
  it('caps rental days at 14 and computes tax-free income', () => {
    const r = augustaBenefit(20, 350, 0.413);
    expect(r.rentalDays).toBe(14);
    expect(r.taxFreeIncome).toBe(14 * 350);
  });
  it('computes tax benefit at marginal rate', () => {
    const r = augustaBenefit(14, 350, 0.413);
    expect(r.taxBenefit).toBeCloseTo(14 * 350 * 0.413, 2);
  });
});
