import { describe, expect, it } from 'vitest';
import { evalPredicate, rawValue, readVarOf } from './predicates.ts';
import type { EvalContext, RateCard } from './types.ts';

function ctxWith(
  answers: Record<string, unknown>,
  env: Record<string, unknown> = {},
  notices: string[] = [],
): EvalContext {
  return {
    rateCard: {
      slug: 't',
      name: 'T',
      labour: { electrician_hourly: 110 },
      materials: { catalog: {} },
    } as unknown as RateCard,
    answers,
    env,
    notices: new Set(notices),
  };
}

describe('rawValue', () => {
  it('unwraps an estimated measurement', () => {
    expect(rawValue({ value: 35, estimated: true })).toBe(35);
  });

  it('leaves a bare value and an array alone', () => {
    expect(rawValue(35)).toBe(35);
    expect(rawValue(['a'])).toEqual(['a']);
  });
});

describe('readVarOf', () => {
  const ctx = ctxWith({ n: 12 }, { in_service_area: false }, ['aluminium']);

  it('reads answers, environment facts, rate-card paths and notices', () => {
    expect(readVarOf({ var: 'n' }, ctx)).toBe(12);
    expect(readVarOf({ env: 'in_service_area' }, ctx)).toBe(false);
    expect(readVarOf({ rate_card: 'labour.electrician_hourly' }, ctx)).toBe(
      110,
    );
    expect(readVarOf({ notice: 'aluminium' }, ctx)).toBe(true);
  });
});

describe('evalPredicate', () => {
  const ctx = ctxWith(
    {
      capacity: 'spare_capable',
      distance: 35,
      loads: ['electric_dryer', 'central_ac'],
      estimated_distance: { value: 70, estimated: true },
      blank: null,
    },
    { rate_card_tuned: false },
    ['panel_full'],
  );

  it('treats a missing predicate and {always:true} as true', () => {
    expect(evalPredicate(undefined, ctx)).toBe(true);
    expect(evalPredicate({ always: true }, ctx)).toBe(true);
  });

  it('compares with eq / ne / in / nin', () => {
    expect(evalPredicate({ var: 'capacity', eq: 'spare_capable' }, ctx)).toBe(
      true,
    );
    expect(evalPredicate({ var: 'capacity', ne: 'spare_capable' }, ctx)).toBe(
      false,
    );
    expect(
      evalPredicate({ var: 'capacity', in: ['a', 'spare_capable'] }, ctx),
    ).toBe(true);
    expect(evalPredicate({ var: 'capacity', nin: ['a'] }, ctx)).toBe(true);
  });

  it('compares numbers with lt / lte / gt / gte', () => {
    expect(evalPredicate({ var: 'distance', lt: 40 }, ctx)).toBe(true);
    expect(evalPredicate({ var: 'distance', lte: 35 }, ctx)).toBe(true);
    expect(evalPredicate({ var: 'distance', gt: 35 }, ctx)).toBe(false);
    expect(evalPredicate({ var: 'distance', gte: 35 }, ctx)).toBe(true);
  });

  it('inspects arrays with contains / contains_any / count_gte', () => {
    expect(evalPredicate({ var: 'loads', contains: 'central_ac' }, ctx)).toBe(
      true,
    );
    expect(
      evalPredicate(
        { var: 'loads', contains_any: ['pool', 'central_ac'] },
        ctx,
      ),
    ).toBe(true);
    expect(evalPredicate({ var: 'loads', contains_any: ['pool'] }, ctx)).toBe(
      false,
    );
    expect(evalPredicate({ var: 'loads', count_gte: 2 }, ctx)).toBe(true);
    expect(evalPredicate({ var: 'loads', count_gte: 3 }, ctx)).toBe(false);
  });

  it('distinguishes an estimated answer from a measured one', () => {
    expect(
      evalPredicate({ var: 'estimated_distance', estimated: true }, ctx),
    ).toBe(true);
    expect(evalPredicate({ var: 'distance', estimated: true }, ctx)).toBe(
      false,
    );
    expect(evalPredicate({ var: 'distance', estimated: false }, ctx)).toBe(
      true,
    );
  });

  it('treats null as unanswered', () => {
    expect(evalPredicate({ var: 'blank', answered: true }, ctx)).toBe(false);
    expect(evalPredicate({ var: 'blank', answered: false }, ctx)).toBe(true);
    expect(evalPredicate({ var: 'distance', answered: true }, ctx)).toBe(true);
  });

  it('reads a notice as a bare flag, but compares it when eq is present', () => {
    expect(evalPredicate({ notice: 'panel_full' }, ctx)).toBe(true);
    expect(evalPredicate({ notice: 'nothing_raised' }, ctx)).toBe(false);
    expect(evalPredicate({ notice: 'panel_full', eq: true }, ctx)).toBe(true);
    expect(evalPredicate({ notice: 'nothing_raised', eq: true }, ctx)).toBe(
      false,
    );
  });

  it('reads environment facts', () => {
    expect(evalPredicate({ env: 'rate_card_tuned', eq: false }, ctx)).toBe(
      true,
    );
  });

  it('combines with all / any / not', () => {
    expect(
      evalPredicate(
        {
          all: [
            { var: 'capacity', eq: 'spare_capable' },
            { var: 'distance', lte: 40 },
          ],
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evalPredicate(
        {
          any: [
            { var: 'capacity', eq: 'nope' },
            { var: 'distance', lte: 40 },
          ],
        },
        ctx,
      ),
    ).toBe(true);
    expect(evalPredicate({ not: { var: 'capacity', eq: 'nope' } }, ctx)).toBe(
      true,
    );
  });

  it('refuses to guess at an operator it does not know', () => {
    expect(() =>
      evalPredicate({ var: 'distance', roughly: 35 } as never, ctx),
    ).toThrow(/unsupported predicate/);
  });
});
