import { describe, it, expect } from 'vitest';
import { ficaW2, ficaSE } from '../src/tax/fica.js';

describe('ficaW2', () => {
  it('caps Social Security at the 2026 wage base', () => {
    const result = ficaW2(250_000);
    expect(result.socialSecurity).toBeCloseTo(176_100 * 0.062, 2);
  });
  it('applies 0.9% additional Medicare only on MAGI above $250k MFJ', () => {
    const below = ficaW2(240_000, 240_000);
    const above = ficaW2(240_000, 300_000);
    expect(below.medicareAdditional).toBe(0);
    expect(above.medicareAdditional).toBeCloseTo(50_000 * 0.009, 2);
  });
});

describe('ficaSE', () => {
  it('doubles SS and Medicare on the 92.35% SE earnings base', () => {
    const net = 100_000;
    const result = ficaSE(net);
    const base = net * 0.9235;
    const expectedSS = Math.min(base, 176_100) * 0.062 * 2;
    const expectedMedicare = base * 0.0145 * 2;
    expect(result.socialSecurity).toBeCloseTo(expectedSS, 2);
    expect(result.medicare).toBeCloseTo(expectedMedicare, 2);
  });
});
