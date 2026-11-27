import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from './evaluate.ts';
import { formatQuotePrice, quoteStageOf } from './quote-stage.ts';
import { loadFlattenedSeed, readFixture } from './seed-loader.ts';
import type { EvaluationResult } from './types.ts';

/**
 * The quote ends at one exact number (docs/pricing-fsm-designs.md §9 H1):
 *
 *   no price  →  a range  →  one exact number
 *
 * The homeowner's own answers get them to a range. The range collapses to one
 * number only when every source of guesswork is gone AND the contractor has
 * confirmed the work order (`env.work_order_confirmed`): the provider's input
 * is the last thing that turns an estimate into a price.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(HERE, '..', '..', '..', '..', 'seeds', 'pricing');
const { rateCard, machines } = loadFlattenedSeed(SEED);

function run(
  file: string,
  env: Record<string, unknown> = {},
): EvaluationResult {
  const fx = readFixture(join(SEED, 'fixtures', file));
  const machine = machines.find((m) => m.slug === fx.machine);
  if (!machine) throw new Error(`no machine ${fx.machine}`);
  return evaluate(machine, rateCard, fx.answers, { ...(fx.env ?? {}), ...env });
}

describe('quote stage — no price → range → one exact number', () => {
  it('shows no price on an outcome that is not a quote', () => {
    const r = run('04-ev-no-photo-estimated-distance.json', {
      work_order_confirmed: true,
    });
    expect(r.stage).toBe('no_price');
    expect(r.exact).toBeUndefined();
  });

  it('stays a range on homeowner answers alone, even with nothing guessed', () => {
    const r = run('01-ev-typical.json');
    expect(r.stage).toBe('range');
    expect(r.exact).toBeUndefined();
    expect(r.low).toBe(1000);
    expect(r.high).toBe(1275);
    expect(r.exact_blockers).toContain(
      'The contractor has not confirmed the work order yet.',
    );
  });

  it('collapses to one exact number once the contractor confirms a work order with nothing left to guess', () => {
    const r = run('01-ev-typical.json', { work_order_confirmed: true });
    expect(r.stage).toBe('exact');
    // To the cent: the exact number is the sum of the priced lines, so it
    // matches the estimate the contractor sends.
    expect(r.exact).toBe(1126.98);
    expect(r.low).toBe(1126.98);
    expect(r.high).toBe(1126.98);
    expect(r.exact_blockers).toEqual([]);
    const sum =
      Math.round((r.lines || []).reduce((s, l) => s + l.cost, 0) * 100) / 100;
    expect(r.exact).toBe(sum);
  });

  it('only ever narrows: the exact number sits inside the range it replaces (H6)', () => {
    for (const f of [
      '01-ev-typical.json',
      '03-ev-detached-garage-trench.json',
      '07-panel-subpanel-instead.json',
      '09-circuit-tap-existing.json',
      '10-circuit-dryer.json',
      '15-surge-standard.json',
    ]) {
      const before = run(f);
      const after = run(f, { work_order_confirmed: true });
      expect(after.stage, f).toBe('exact');
      expect(after.exact!, f).toBeGreaterThanOrEqual(before.low!);
      expect(after.exact!, f).toBeLessThanOrEqual(before.high!);
    }
  });

  it('applies the minimum job to the exact number', () => {
    // Fixture 09 prices at $250.74, under the $285 minimum call-out.
    const r = run('09-circuit-tap-existing.json', {
      work_order_confirmed: true,
    });
    expect(r.stage).toBe('exact');
    expect(r.exact).toBe(285);
    expect(r.minimum_applied).toBe(true);
  });

  it('stays a range while any widen rule still fires, and says which', () => {
    const r = run('08-panel-swap-hazard-brand.json', {
      work_order_confirmed: true,
    });
    expect(r.stage).toBe('range');
    expect(r.exact).toBeUndefined();
    expect(r.exact_blockers!.length).toBeGreaterThanOrEqual(2);
    expect(r.exact_blockers!.join(' ')).toMatch(
      /number of circuits was estimated/,
    );
  });

  it('stays a range on an untuned rate card (a provider input still missing)', () => {
    const r = run('18-ev-untuned-rate-card.json', {
      work_order_confirmed: true,
    });
    expect(r.stage).toBe('range');
    expect(r.exact_blockers!.join(' ')).toMatch(
      /not finished setting their prices/,
    );
  });

  it('stays a range while some lines are priced only if needed', () => {
    const r = run('12-troubleshoot-diagnostic.json', {
      work_order_confirmed: true,
    });
    expect(r.stage).toBe('range');
    expect(r.exact_blockers!.join(' ')).toMatch(/only if/i);
  });

  it('stays a range while the photo is unread (a span)', () => {
    const r = run('02-ev-plug-in-finished-wall.json', {
      work_order_confirmed: true,
    });
    expect(r.stage).toBe('range');
    expect(r.exact).toBeUndefined();
  });

  it('a no_quote result is no_price even with an indicative band', () => {
    const r = run('17-surge-refuses.json', { work_order_confirmed: true });
    expect(r.stage).toBe('no_price');
  });
});

describe('quoteStageOf — the stage of a stored result', () => {
  it('reads the stage of a stored quote_json written before stages existed', () => {
    const r = run('01-ev-typical.json');
    const legacy = { ...r } as Partial<EvaluationResult>;
    delete legacy.stage;
    expect(quoteStageOf(legacy as EvaluationResult)).toBe('range');
    expect(
      quoteStageOf({ kind: 'no_quote', low: null, high: null } as never),
    ).toBe('no_price');
    expect(quoteStageOf(null)).toBe('no_price');
  });
});

describe('formatQuotePrice — the one place a quote becomes words', () => {
  it('prints an exact quote as one number to the cent', () => {
    expect(
      formatQuotePrice(
        run('01-ev-typical.json', { work_order_confirmed: true }),
      ),
    ).toBe('$1,126.98');
    expect(
      formatQuotePrice(
        run('09-circuit-tap-existing.json', { work_order_confirmed: true }),
      ),
    ).toBe('$285.00');
  });
  it('prints a range with an en dash', () => {
    expect(formatQuotePrice(run('01-ev-typical.json'))).toBe('$1,000–$1,275');
  });
  it('prints nothing when there is no price', () => {
    expect(formatQuotePrice(run('17-surge-refuses.json'))).toBeNull();
  });
});
