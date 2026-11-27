import { describe, it, expect } from 'vitest';
import { compareSoleVsScorp } from '../src/scorp/compare.js';

describe('compareSoleVsScorp', () => {
  it('shows meaningful FICA savings at $100k net profit with 50/50 split', () => {
    const c = compareSoleVsScorp(100_000, 0.5);
    expect(c.ficaSavings).toBeGreaterThan(3_500);
    expect(c.scorp.distributionPortion).toBe(50_000);
    expect(c.scorp.w2Portion).toBe(50_000);
  });
  it('savings grow with higher net profit', () => {
    const at100 = compareSoleVsScorp(100_000, 0.5).ficaSavings;
    const at150 = compareSoleVsScorp(150_000, 0.5).ficaSavings;
    expect(at150).toBeGreaterThan(at100);
  });
});
