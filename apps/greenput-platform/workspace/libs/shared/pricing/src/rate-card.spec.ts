import { describe, expect, it } from 'vitest';
import { catGet, rcGet, rcNum } from './rate-card.ts';
import type { RateCard } from './types.ts';

const card = {
  slug: 'test',
  name: 'Test card',
  labour: { electrician_hourly: 110 },
  // A leaf may carry provenance instead of being bare — both forms resolve.
  fees: {
    minimum_job: { value: 285, note: 'smallest job we take' },
    permit: { value: { flat: 285, policy: 'we_pull' } },
  },
  materials: {
    markup_pct: 35,
    catalog: { breaker_40: { cost: 42, unit: 'each' } },
  },
} as unknown as RateCard;

describe('rcGet', () => {
  it('reads a bare leaf', () => {
    expect(rcGet(card, 'labour.electrician_hourly')).toBe(110);
  });

  it('unwraps a {value} leaf', () => {
    expect(rcGet(card, 'fees.minimum_job')).toBe(285);
  });

  it('walks through a {value} wrapper on the way down', () => {
    expect(rcGet(card, 'fees.permit.flat')).toBe(285);
  });

  it('returns undefined for a path that does not resolve — the validator depends on it', () => {
    expect(rcGet(card, 'labour.nope')).toBeUndefined();
    expect(rcGet(card, 'nope.nope.nope')).toBeUndefined();
  });

  it('does not unwrap an array', () => {
    const withList = { ...card, tags: ['a', 'b'] } as unknown as RateCard;
    expect(rcGet(withList, 'tags')).toEqual(['a', 'b']);
  });
});

describe('catGet', () => {
  it('reads a parts-list entry', () => {
    expect(catGet(card, 'breaker_40')).toEqual({ cost: 42, unit: 'each' });
  });

  it('returns undefined for a key that is not in the catalog', () => {
    expect(catGet(card, 'not_a_part')).toBeUndefined();
  });
});

describe('rcNum', () => {
  it('coerces to a number', () => {
    expect(rcNum(card, 'materials.markup_pct')).toBe(35);
  });
});
