import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { evaluate } from './evaluate.ts';
import { resolveTerminal } from './graph.ts';
import {
  listFixtureFiles,
  loadFlattenedSeed,
  readExpectation,
  readFixture,
} from './seed-loader.ts';
import type { EvaluationResult, Machine, RateCard } from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const SEED_DIR = join(REPO, 'seeds', 'pricing');
const FIXTURE_DIR = join(SEED_DIR, 'fixtures');

/**
 * The shape `scripts/seed/pricing-fsms.mjs expect` freezes. Built here from the
 * engine's own output so the comparison is against the whole record — terminal,
 * band, point estimate, spread, every line item and the route taken — not just
 * the two numbers at the end.
 */
function frozenShape(result: EvaluationResult) {
  return {
    terminal: result.terminal,
    kind: result.kind,
    low: result.low,
    high: result.high,
    point: result.point ?? null,
    spread_pct: result.spread_pct ?? null,
    minimum_applied: result.minimum_applied ?? null,
    refused_because: result.refused_because ?? null,
    indicative: result.indicative ?? null,
    spans: (result.spans || []).map((s) => ({
      id: s.id,
      low: s.low,
      high: s.high,
    })),
    lines: (result.lines || []).map((l) => ({
      id: l.id,
      qty: l.qty,
      cost: l.cost,
      side: l.side,
    })),
    path: result.path,
  };
}

const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const fixtures = listFixtureFiles(FIXTURE_DIR);

/** A fixture naming a machine that is not in the seed is a broken fixture. */
function machineFor(slug: string): Machine {
  const machine = machines.find((m) => m.slug === slug);
  if (!machine) throw new Error(`no machine "${slug}" in seeds/pricing`);
  return machine;
}

describe('evaluate — conformance against the frozen fixtures', () => {
  it('finds all eighteen worked examples', () => {
    expect(fixtures).toHaveLength(18);
  });

  for (const file of fixtures) {
    it(`reproduces ${file} exactly`, () => {
      const expectedPath = join(
        FIXTURE_DIR,
        file.replace('.json', '.expected.json'),
      );
      expect(existsSync(expectedPath)).toBe(true);

      const fixture = readFixture(join(FIXTURE_DIR, file));
      const machine = machineFor(fixture.machine);

      const result = evaluate(
        machine,
        rateCard,
        fixture.answers,
        fixture.env ?? {},
      );

      const expected = readExpectation(expectedPath);
      delete expected['_note'];
      expect(frozenShape(result)).toEqual(expected);
    });
  }
});

describe('evaluate — properties that hold for every fixture', () => {
  it('never returns a band whose low exceeds its high', () => {
    for (const file of fixtures) {
      const fixture = readFixture(join(FIXTURE_DIR, file));
      const machine = machineFor(fixture.machine);
      const r = evaluate(machine, rateCard, fixture.answers, fixture.env ?? {});
      if (r.low !== null && r.high !== null) {
        expect(r.low, file).toBeLessThanOrEqual(r.high);
      }
    }
  });

  it("is pure — the same inputs produce an identical result twice, and the caller's answers are not mutated", () => {
    const fixture = readFixture(join(FIXTURE_DIR, fixtures[0]));
    const machine = machineFor(fixture.machine);
    const before = JSON.stringify(fixture.answers);
    const a = evaluate(machine, rateCard, fixture.answers, fixture.env ?? {});
    const b = evaluate(machine, rateCard, fixture.answers, fixture.env ?? {});
    expect(JSON.stringify(fixture.answers)).toBe(before);
    expect(frozenShape(a)).toEqual(frozenShape(b));
  });

  it('shows no price at all on any outcome that is not a quote', () => {
    // A terminal that refuses, refers or escalates must not leak a band.
    // Assert the rule rather than naming the fixtures, so it survives a rename.
    const results = fixtures.map((f) => {
      const fixture = readFixture(join(FIXTURE_DIR, f));
      const machine = machineFor(fixture.machine);
      return {
        f,
        r: evaluate(machine, rateCard, fixture.answers, fixture.env ?? {}),
      };
    });
    const unpriced = results.filter(
      ({ r }) => r.kind !== 'quote' && r.kind !== 'span',
    );
    expect(unpriced.length).toBeGreaterThan(0);
    for (const { f, r } of unpriced) {
      expect(r.low, f).toBeNull();
      expect(r.high, f).toBeNull();
    }
    // At least one of them says why in words a homeowner can read.
    expect(unpriced.some(({ r }) => Boolean(r.refused_because))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// The words the homeowner reads (GP-001).
//
// `frozenShape` deliberately projects a span down to {id, low, high}, so
// nothing above could notice that a span part carried no title, or that a
// spread refusal wore the withdrawn quote's heading. These do.
// ─────────────────────────────────────────────────────────────
describe('evaluate — the words the homeowner reads', () => {
  const evFixture = readFixture(
    join(FIXTURE_DIR, '02-ev-plug-in-finished-wall.json'),
  );
  const ev = machineFor(evFixture.machine);
  const refusalTerminal = resolveTerminal(
    ev,
    ev.honesty?.on_exceed_max_spread || 'T_site_visit_required',
  );

  /** The default rate card with the spread ceiling pulled below any quote. */
  function cappedAt(pct: number): RateCard {
    const copy = JSON.parse(JSON.stringify(rateCard)) as RateCard;
    (copy['uncertainty'] as Record<string, unknown>)['max_spread_pct'] = pct;
    return copy;
  }

  it('names each end of a span the way its own terminal does, never by id', () => {
    const result = evaluate(
      ev,
      rateCard,
      evFixture.answers,
      evFixture.env ?? {},
    );
    expect(result.kind).toBe('span');
    expect(result.spans?.map((s) => s.title)).toEqual([
      'A new charger circuit from your existing panel',
      'A small extra panel, then your charger',
    ]);
    for (const s of result.spans ?? []) expect(s.title).not.toMatch(/^T_/);
  });

  it('a span that blows the spread ceiling wears the refusal terminal, not the span', () => {
    const honest = evaluate(
      ev,
      rateCard,
      evFixture.answers,
      evFixture.env ?? {},
    );
    const refused = evaluate(
      ev,
      cappedAt(1),
      evFixture.answers,
      evFixture.env ?? {},
    );
    expect(refused.kind).toBe('no_quote');
    expect(refused.terminal).toBe(refusalTerminal.id);
    expect(refused.refused_because).toMatch(/above the 1% ceiling/);
    expect(refused.title).toBe(refusalTerminal.title);
    expect(refused.summary).toBe(refusalTerminal['summary']);
    expect(refused.body).toBe(refusalTerminal['body']);
    expect(refused.next_step).toEqual(refusalTerminal['next_step']);
    expect(refused.title).not.toBe(honest.title);
  });

  it('a single quote that blows the spread ceiling wears the refusal terminal, not the quote', () => {
    const quoteFixture = readFixture(join(FIXTURE_DIR, '01-ev-typical.json'));
    const honest = evaluate(
      ev,
      rateCard,
      quoteFixture.answers,
      quoteFixture.env ?? {},
    );
    expect(honest.kind).toBe('quote');
    const refused = evaluate(
      ev,
      cappedAt(1),
      quoteFixture.answers,
      quoteFixture.env ?? {},
    );
    expect(refused.kind).toBe('no_quote');
    expect(refused.terminal).toBe(refusalTerminal.id);
    expect(refused.title).toBe(refusalTerminal.title);
    expect(refused.title).not.toBe(honest.title);
    expect(refused.summary).toBe(refusalTerminal['summary']);
    expect(refused.body).toBe(refusalTerminal['body']);
    expect(refused.next_step).toEqual(refusalTerminal['next_step']);
    expect(refused.low).toBeNull();
    expect(refused.high).toBeNull();
  });
});
