import { describe, it, expect } from 'vitest';
import { nextTaxThreshold, ctcAfterPhaseout, saltAfterPhaseout } from '../src/tax/thresholds.js';

describe('nextTaxThreshold', () => {
  it('returns NIIT at $245k MAGI with $5k distance', () => {
    const t = nextTaxThreshold(245_000);
    expect(t.name).toBe('NIIT');
    expect(t.amount).toBe(250_000);
    expect(t.distance).toBe(5_000);
  });
  it('returns CTC phaseout after NIIT is crossed', () => {
    const t = nextTaxThreshold(300_000);
    expect(t.name).toBe('CTC phaseout');
    expect(t.distance).toBe(100_000);
  });
  it('returns SALT phaseout after CTC is crossed', () => {
    const t = nextTaxThreshold(450_000);
    expect(t.name).toBe('SALT phaseout');
  });
});

describe('ctcAfterPhaseout', () => {
  it('returns full credit × kids below $400k MFJ', () => {
    expect(ctcAfterPhaseout(2_200, 302_000, 3)).toBe(6_600);
  });
  it('reduces CTC by $50 per $1,000 over $400k MFJ', () => {
    const after = ctcAfterPhaseout(2_200, 410_000, 3);
    expect(after).toBe(3 * 2_200 - 10 * 50);
  });
  it('floors at zero', () => {
    expect(ctcAfterPhaseout(2_200, 1_000_000, 3)).toBe(0);
  });
});

describe('saltAfterPhaseout', () => {
  it('reduces SALT cap by 30% per dollar over $505k', () => {
    const after = saltAfterPhaseout(40_400, 510_000);
    expect(after).toBeCloseTo(40_400 - 5_000 * 0.3, 2);
  });
  it('respects the $10k SALT floor', () => {
    expect(saltAfterPhaseout(40_400, 10_000_000)).toBe(10_000);
  });
});
