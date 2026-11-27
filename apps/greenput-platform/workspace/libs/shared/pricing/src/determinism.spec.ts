import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { evaluate } from './evaluate.ts';
import {
  listFixtureFiles,
  loadFlattenedSeed,
  readFixture,
} from './seed-loader.ts';
import { questionKeys } from './traverse.ts';
import type { Answers, Machine, State } from './types.ts';

/**
 * The guarantee the whole product rests on: same version, same answers, same
 * price. Every time, in any order, for as long as the version exists.
 *
 * A quote is a promise a contractor has to honour, and a lead is billed on it.
 * If evaluating twice could produce two answers, no version pin would be worth
 * anything — the row would say which graph and which rate card, and still not
 * say what the homeowner was told.
 *
 * So this is a property test, not an example test. It generates answers over
 * the machines' own declared option sets, evaluates each set twice, and
 * requires the two results to be byte-identical as JSON. The generator is
 * seeded, so a failure names the exact input that broke it and a re-run
 * reproduces it.
 *
 * It has already caught one: `evaluate()` used to append the minimum-job
 * sentence onto `terminal.presentation.conditions`, which `resolveTerminal`
 * shares with the machine object. The second evaluation of a small job carried
 * the sentence twice, the tenth carried it ten times — a pure function quietly
 * accumulating state in the graph it was reading.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const SEED_DIR = join(REPO, 'seeds', 'pricing');
const FIXTURE_DIR = join(SEED_DIR, 'fixtures');

const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const fixtures = listFixtureFiles(FIXTURE_DIR).map((file) =>
  readFixture(join(FIXTURE_DIR, file)),
);

/** A small deterministic PRNG, so a failing case is reproducible by seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const pick = <T>(rand: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rand() * xs.length) % xs.length];

/** Every question state in a machine, fragments already inlined. */
const questionStates = (machine: Machine): State[] =>
  machine.states.filter((s) => s.kind === 'question' && s.answer);

/**
 * Generate one plausible answer per key a machine can ask for.
 *
 * Over-answering is the point: the traversal reads only the keys its route
 * reaches, so filling every key exercises many routes without the generator
 * having to understand the graph.
 */
function randomAnswers(machine: Machine, rand: () => number): Answers {
  const answers: Answers = {};
  for (const state of questionStates(machine)) {
    const spec = state.answer;
    if (!spec) continue;
    const fields =
      spec.type === 'group'
        ? (spec.fields ?? [])
        : [{ ...spec, key: spec.key as string }];

    for (const field of fields) {
      const key = field.key;
      if (!key) continue;
      switch (field.type) {
        case 'choice':
          if ((field.options ?? []).length > 0) {
            answers[key] = pick(rand, field.options ?? []).value;
          }
          break;
        case 'multi_choice': {
          const options = field.options ?? [];
          answers[key] = options
            .filter(() => rand() < 0.4)
            .slice(0, field.max_select ?? options.length)
            .map((o) => o.value);
          break;
        }
        case 'measurement': {
          const min = field.min ?? 1;
          const max = field.max ?? min + 100;
          const value = Math.round(min + rand() * (max - min));
          // Half the time, the "I'm not sure" ladder — which is a different
          // shape of answer and widens the band.
          answers[key] = rand() < 0.5 ? value : { value, estimated: true };
          break;
        }
        case 'photo':
          answers[key] = {
            status: pick(rand, [
              'missing',
              'unreviewed',
              'reviewed',
              'unreadable',
            ]),
            fields: {},
          };
          break;
        case 'email':
          answers[key] = 'dana@example.com';
          break;
        case 'phone':
          answers[key] = '512-555-0134';
          break;
        case 'zip':
          answers[key] = '78704';
          break;
        default:
          answers[key] = 'Something a homeowner typed';
      }
    }
  }
  return answers;
}

const ENVIRONMENTS = [
  {},
  { in_service_area: false },
  { rate_card_tuned: false },
  { is_weekend: true },
  { rate_card_tuned: false, is_weekend: true },
];

/** Evaluate, but never let a generated dead end fail the property. */
function tryEvaluate(
  machine: Machine,
  answers: Answers,
  env: Record<string, unknown>,
): string | null {
  try {
    return JSON.stringify(evaluate(machine, rateCard, answers, env));
  } catch {
    // A random answer set can reach a state whose edges cannot all fire —
    // that is a generator artefact, not a determinism failure.
    return null;
  }
}

describe('evaluate is deterministic', () => {
  it('reproduces every frozen fixture identically on a repeated call', () => {
    for (const fixture of fixtures) {
      const machine = machines.find((m) => m.slug === fixture.machine);
      expect(machine, fixture.machine).toBeDefined();
      const first = JSON.stringify(
        evaluate(machine!, rateCard, fixture.answers, fixture.env ?? {}),
      );
      const second = JSON.stringify(
        evaluate(machine!, rateCard, fixture.answers, fixture.env ?? {}),
      );
      expect(second, `${fixture.machine} changed on the second call`).toBe(
        first,
      );
    }
  });

  it('gives the same answer ten times running for the same input', () => {
    // The regression that motivated this: a job under the call-out minimum.
    const fixture = fixtures.find((f) => JSON.stringify(f).includes('circuit'));
    expect(fixture).toBeDefined();
    const machine = machines.find((m) => m.slug === fixture!.machine)!;

    const runs = Array.from({ length: 10 }, () =>
      JSON.stringify(
        evaluate(machine, rateCard, fixture!.answers, fixture!.env ?? {}),
      ),
    );
    expect(
      new Set(runs).size,
      'ten evaluations produced more than one result',
    ).toBe(1);
  });

  it('is stable across generated answers for every seeded machine', () => {
    let checked = 0;

    for (const machine of machines) {
      for (let seed = 1; seed <= 40; seed++) {
        const rand = rng(seed * 2654435761);
        const answers = randomAnswers(machine, rand);
        const env = ENVIRONMENTS[seed % ENVIRONMENTS.length];

        const first = tryEvaluate(machine, answers, env);
        if (first === null) continue;
        checked += 1;

        // Same call again.
        expect(
          tryEvaluate(machine, answers, env),
          `${machine.slug} seed ${seed}: two calls disagreed\n${JSON.stringify(answers)}`,
        ).toBe(first);

        // And again after the machine has priced something else, which is
        // what catches state accumulating on the graph between quotes.
        tryEvaluate(machine, randomAnswers(machine, rng(seed + 9999)), {});
        expect(
          tryEvaluate(machine, answers, env),
          `${machine.slug} seed ${seed}: an unrelated quote changed this one`,
        ).toBe(first);
      }
    }

    // A property test that silently evaluated nothing proves nothing.
    expect(checked).toBeGreaterThan(100);
  });

  it('does not mutate the machine, the rate card, or the answers it is given', () => {
    const machine = machines.find((m) => m.slug === 'ev-charger-install')!;
    const fixture = fixtures.find((f) => f.machine === 'ev-charger-install')!;

    const machineBefore = JSON.stringify(machine);
    const rateCardBefore = JSON.stringify(rateCard);
    const answers = JSON.parse(JSON.stringify(fixture.answers)) as Answers;
    const answersBefore = JSON.stringify(answers);

    for (let i = 0; i < 5; i++) {
      evaluate(machine, rateCard, answers, fixture.env ?? {});
    }

    // The graph a version pin points at has to read the same after a
    // thousand quotes as it did before the first one.
    expect(JSON.stringify(machine)).toBe(machineBefore);
    expect(JSON.stringify(rateCard)).toBe(rateCardBefore);
    // The caller's answers are the homeowner's record of what they said.
    expect(JSON.stringify(answers)).toBe(answersBefore);
  });

  it('asks the same question keys for the same state every time', () => {
    for (const machine of machines) {
      for (const state of questionStates(machine)) {
        expect(questionKeys(state)).toEqual(questionKeys(state));
      }
    }
  });
});
