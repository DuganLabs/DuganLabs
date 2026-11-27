import { describe, expect, it } from 'vitest';
import {
  bandFrom,
  computeSpread,
  evalQty,
  priceTerminal,
  r2,
  roundTo,
} from './pricing.ts';
import type { EvalContext, RateCard, ResolvedTerminal } from './types.ts';

const rateCard = {
  slug: 't',
  name: 'T',
  labour: { electrician_hourly: 100 },
  fees: { minimum_job: 285, permit: 200, weekend_multiplier: 1.5 },
  uncertainty: {
    base_spread_pct: 12,
    max_spread_pct: 30,
    skew: 0.6,
    flat_pad_usd: 60,
    flat_pad_cap_pct: 5,
    round_to: 25,
  },
  materials: {
    markup_pct: 50,
    sales_tax_pct: 0,
    waste_pct_default: 10,
    catalog: {
      wire: { cost: 2, unit: 'ft' },
      breaker: { cost: 40, unit: 'each' },
      permit_allowance: { cost: 300, unit: 'each' },
    },
  },
} as unknown as RateCard;

const ctx = (answers: Record<string, unknown> = {}): EvalContext => ({
  rateCard,
  answers,
  env: {},
  notices: new Set<string>(),
});

describe('roundTo and r2', () => {
  it('rounds to a step, and passes through when there is none', () => {
    expect(roundTo(1.13, 0.25)).toBe(1.25);
    expect(roundTo(1.13)).toBe(1.13);
  });

  it('carries money to two decimals', () => {
    expect(r2(1.005)).toBe(1.0);
    expect(r2(123.456)).toBe(123.46);
  });
});

describe('evalQty', () => {
  it('defaults to one when a line declares no quantity', () => {
    expect(evalQty(undefined, ctx(), new Map())).toBe(1);
  });

  it('applies base, then per terms, then modifiers in order, then min/max, then rounding', () => {
    const qty = evalQty(
      {
        base: 1,
        per: [{ of: 'feet', rate: 0.02 }],
        modifiers: [
          { always: true, op: 'multiply', value: 2 },
          { always: true, op: 'add', value: 0.1 },
        ],
        min: 0.5,
        round_to: 0.25,
      },
      ctx({ feet: 50 }),
      new Map(),
    );
    // 1 + 50*0.02 = 2, x2 = 4, +0.1 = 4.1, rounded to 4.0
    expect(qty).toBe(4);
  });

  it('skips a modifier whose guard does not fire', () => {
    const q = {
      base: 1,
      modifiers: [
        { when: { var: 'x', eq: 1 }, op: 'multiply' as const, value: 5 },
      ],
    };
    expect(evalQty(q, ctx({ x: 2 }), new Map())).toBe(1);
    expect(evalQty(q, ctx({ x: 1 }), new Map())).toBe(5);
  });

  it('counts a multi-choice answer, and subtracts with minus', () => {
    expect(
      evalQty(
        { per: [{ of: 'loads', rate: 1 }] },
        ctx({ loads: ['a', 'b', 'c'] }),
        new Map(),
      ),
    ).toBe(3);
    expect(
      evalQty(
        { per: [{ of: 'loads', rate: 1, minus: 2 }] },
        ctx({ loads: ['a', 'b', 'c'] }),
        new Map(),
      ),
    ).toBe(1);
    // `minus` never goes negative.
    expect(
      evalQty(
        { per: [{ of: 'loads', rate: 1, minus: 9 }] },
        ctx({ loads: ['a'] }),
        new Map(),
      ),
    ).toBe(0);
  });

  it('falls back to the per-term default when the answer is absent', () => {
    expect(
      evalQty(
        { per: [{ of: 'missing', rate: 1, default: 7 }] },
        ctx(),
        new Map(),
      ),
    ).toBe(7);
  });

  it("reads another line item's quantity, and refuses when it has not been priced yet", () => {
    const computed = new Map([['wire', 40]]);
    expect(evalQty({ of_item: 'wire', factor: 0.5 }, ctx(), computed)).toBe(20);
    expect(() =>
      evalQty({ of_item: 'nope', factor: 1 }, ctx(), computed),
    ).toThrow(/not computed before use/);
  });
});

describe('priceTerminal', () => {
  const terminal: ResolvedTerminal = {
    id: 'T',
    kind: 'quote',
    line_items: [
      {
        id: 'labour',
        kind: 'labour',
        label: 'Labour',
        rate: 'labour.electrician_hourly',
        qty: { base: 2 },
      },
      {
        id: 'wire',
        kind: 'material',
        label: 'Wire',
        catalog: 'wire',
        qty: { base: 10 },
      },
      {
        id: 'breaker',
        kind: 'material',
        label: 'Breaker',
        catalog: 'breaker',
        qty: { base: 1 },
      },
      {
        id: 'permit',
        kind: 'allowance',
        label: 'Permit',
        catalog: 'permit_allowance',
        qty: { base: 1 },
      },
      {
        id: 'trip',
        kind: 'fee',
        label: 'Trip',
        rate: 'fees.permit',
        qty: { base: 1 },
      },
      {
        id: 'extra_hour',
        kind: 'labour',
        label: 'Maybe another hour',
        rate: 'labour.electrician_hourly',
        qty: { base: 1 },
        range_side: 'high_only',
      },
      {
        id: 'weekend',
        kind: 'adjustment',
        label: 'Weekend',
        multiply_by_rate_card: 'fees.weekend_multiplier',
        when: { env: 'is_weekend', eq: true },
      },
    ],
  };

  it('prices labour, marked-up material, un-marked-up allowance and flat fees', () => {
    const { lines } = priceTerminal(terminal, ctx());
    const by = (id: string) => lines.find((l) => l.id === id);
    expect(by('labour')?.cost).toBe(200);
    // 10ft +10% waste = 11 x $2 x 1.5 markup
    expect(by('wire')?.cost).toBe(33);
    // Non-`ft` units take no default waste.
    expect(by('breaker')?.cost).toBe(60);
    // An allowance is a pass-through: no markup.
    expect(by('permit')?.cost).toBe(300);
    expect(by('trip')?.cost).toBe(200);
  });

  it('keeps a high_only line out of the point estimate but in the high one', () => {
    const { point, pointHigh } = priceTerminal(terminal, ctx());
    expect(pointHigh - point).toBe(100);
  });

  it('applies an adjustment to the labour subtotal only, and only when its guard fires', () => {
    const weekend: EvalContext = { ...ctx(), env: { is_weekend: true } };
    const { lines } = priceTerminal(terminal, weekend);
    // Labour subtotal is 200 + 100 (the high_only hour is still labour) = 300.
    expect(lines.find((l) => l.id === 'weekend')?.cost).toBe(150);
    expect(
      priceTerminal(terminal, ctx()).lines.find((l) => l.id === 'weekend'),
    ).toBeUndefined();
  });

  it('drops a line that prices to nothing rather than showing a $0 row', () => {
    const zero: ResolvedTerminal = {
      id: 'T',
      kind: 'quote',
      line_items: [
        {
          id: 'nothing',
          kind: 'labour',
          label: 'Nothing',
          rate: 'labour.electrician_hourly',
          qty: { base: 0 },
        },
      ],
    };
    expect(priceTerminal(zero, ctx()).lines).toHaveLength(0);
  });

  it('refuses a catalog key and a line kind it does not know', () => {
    expect(() =>
      priceTerminal(
        {
          id: 'T',
          kind: 'quote',
          line_items: [
            { id: 'x', kind: 'material', label: 'X', catalog: 'nope' },
          ],
        },
        ctx(),
      ),
    ).toThrow(/unknown catalog item/);
    expect(() =>
      priceTerminal(
        {
          id: 'T',
          kind: 'quote',
          line_items: [{ id: 'x', kind: 'wishful' as never, label: 'X' }],
        },
        ctx(),
      ),
    ).toThrow(/unknown line-item kind/);
  });
});

describe('computeSpread', () => {
  const base: ResolvedTerminal = {
    id: 'T',
    kind: 'quote',
    line_items: [],
    uncertainty: {
      extra_spread_pct: 2,
      extra_spread_because: 'this one is awkward',
      widen: [
        {
          when: { var: 'guessed', eq: true },
          add_pct: 6,
          because: 'the distance was estimated',
        },
        {
          when: { var: 'never', eq: true },
          add_pct: 99,
          because: 'never fires',
        },
      ],
    },
  };

  it('adds the terminal extra and every widening rule that fires', () => {
    const s = computeSpread(base, ctx({ guessed: true }));
    expect(s.spread).toBe(20);
    expect(s.reasons.map((r) => r.because)).toEqual([
      'this one is awkward',
      'the distance was estimated',
    ]);
  });

  it('caps the spread but reports what it would have been', () => {
    const wide: ResolvedTerminal = {
      ...base,
      uncertainty: {
        base_spread_pct: 12,
        widen: [{ when: { always: true }, add_pct: 40, because: 'a lot' }],
      },
    };
    const s = computeSpread(wide, ctx());
    expect(s.spread).toBe(30);
    expect(s.uncapped).toBe(52);
    expect(s.cap).toBe(30);
  });

  it("uses a parent's widening rules only when the child opts in", () => {
    const child: ResolvedTerminal = {
      id: 'C',
      kind: 'quote',
      line_items: [],
      uncertainty: { base_spread_pct: 12 },
      _parent_widen: [
        { when: { always: true }, add_pct: 5, because: 'inherited' },
      ],
      _inherits_widen_from: null,
    };
    expect(computeSpread(child, ctx()).spread).toBe(12);
    expect(
      computeSpread({ ...child, _inherits_widen_from: 'T_parent' }, ctx())
        .spread,
    ).toBe(17);
  });
});

describe('bandFrom', () => {
  it('skews the band so most of the spread sits above the point estimate', () => {
    const band = bandFrom(1000, 1000, 10, ctx(), { flat_pad_usd: 0 });
    // low = 1000 x (1 - 0.4 x 0.10) = 960 -> floor to 950
    // high = 1000 x (1 + 0.6 x 0.10) = 1060 -> ceil to 1075
    expect(band).toEqual({ low: 950, high: 1075, minimum_applied: false });
  });

  it('caps the flat pad as a share of the estimate, so a small job keeps a small range', () => {
    // A $60 pad on a $420 job would invent a 30% range; the 5% cap makes it $21.
    const small = bandFrom(420, 420, 0, ctx(), {});
    expect(small.low).toBe(375);
    expect(small.high).toBe(450);
  });

  it('lets a terminal set the pad to exactly zero', () => {
    expect(bandFrom(400, 400, 0, ctx(), { flat_pad_usd: 0 })).toEqual({
      low: 400,
      high: 400,
      minimum_applied: false,
    });
  });

  it('raises the low end to the minimum job and says that it did', () => {
    const band = bandFrom(100, 100, 10, ctx(), { flat_pad_usd: 0 });
    expect(band.low).toBe(285);
    expect(band.minimum_applied).toBe(true);
    expect(band.high).toBeGreaterThanOrEqual(band.low);
  });

  it('never returns a high below the low', () => {
    const band = bandFrom(50, 50, 0, ctx(), { flat_pad_usd: 0 });
    expect(band.high).toBe(band.low);
  });
});
