import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referencedVars, validate } from './validate.ts';
import { loadFlattenedSeed } from './seed-loader.ts';
import type { AnswerSpec, Machine, RateCard } from './types.ts';

const SEED_DIR = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'),
  'seeds',
  'pricing',
);

const rateCard = {
  slug: 't',
  name: 'T',
  labour: { electrician_hourly: 100 },
  materials: { catalog: { breaker: { cost: 40, unit: 'each' } } },
} as unknown as RateCard;

/** A minimal machine that passes every rule, to mutate one rule at a time. */
function goodMachine(): Machine {
  return {
    slug: 'demo',
    name: 'Demo',
    vertical: 'demo',
    entry: 'ask',
    states: [
      {
        id: 'ask',
        kind: 'question',
        ask: { question: 'Red or blue?', why: 'because it changes the part' },
        answer: {
          type: 'choice',
          key: 'colour',
          exhaustive: true,
          options: [
            { value: 'red', label: 'Red' },
            { value: 'blue', label: 'Blue' },
          ],
        },
        next: [{ always: true, go: 'T_done' }],
      },
    ],
    terminals: [
      {
        id: 'T_done',
        kind: 'quote',
        line_items: [
          {
            id: 'labour',
            kind: 'labour',
            label: 'Labour',
            rate: 'labour.electrician_hourly',
            qty: { base: 1 },
          },
        ],
      },
    ],
  };
}

const errorsOf = (m: Machine) => validate(m, rateCard).errors;

describe('referencedVars', () => {
  it('collects guard vars and quantity sources', () => {
    expect([
      ...referencedVars({ all: [{ var: 'a', eq: 1 }, { per: [{ of: 'b' }] }] }),
    ]).toEqual(['a', 'b']);
  });

  it('ignores an `answered` check — asking whether a key was answered is legal anywhere', () => {
    expect([...referencedVars({ var: 'a', answered: true })]).toEqual([]);
  });
});

describe('validate', () => {
  it('passes a well-formed machine', () => {
    expect(validate(goodMachine(), rateCard).errors).toEqual([]);
  });

  it('catches an entry, an edge or an outcome that does not exist', () => {
    const m = goodMachine();
    m.entry = 'nowhere';
    expect(errorsOf(m).join()).toMatch(/entry "nowhere" does not exist/);

    const n = goodMachine();
    n.states[0].next = [{ always: true, go: 'T_nope' }];
    expect(errorsOf(n).join()).toMatch(
      /goes to "T_nope", which does not exist/,
    );
  });

  it('catches a dead end and a branch that can never fire', () => {
    const m = goodMachine();
    m.states[0].next = [];
    expect(errorsOf(m).join()).toMatch(/is a dead end/);

    const n = goodMachine();
    n.states[0].next = [
      { always: true, go: 'T_done' },
      { when: { var: 'colour', eq: 'red' }, go: 'T_done' },
    ];
    expect(errorsOf(n).join()).toMatch(/can never happen/);
  });

  it('catches a missing catch-all, on a state and on a derive', () => {
    const m = goodMachine();
    m.states[0].next = [{ when: { var: 'colour', eq: 'red' }, go: 'T_done' }];
    expect(errorsOf(m).join()).toMatch(/has no catch-all branch/);

    const n = goodMachine();
    n.states.push({
      id: 'd',
      kind: 'derive',
      sets: 'warm',
      rules: [{ when: { var: 'colour', eq: 'red' }, value: true }],
      next: [{ always: true, go: 'T_done' }],
    });
    n.states[0].next = [{ always: true, go: 'd' }];
    expect(errorsOf(n).join()).toMatch(/has no catch-all rule/);
  });

  it('says which answer nothing handles, in the words the option uses', () => {
    const m = goodMachine();
    m.states[0].next = [{ when: { var: 'colour', eq: 'red' }, go: 'T_done' }];
    expect(errorsOf(m).join()).toMatch(
      /you haven't said what happens if they answer "Blue"/,
    );
  });

  it('catches an unreachable state and an unreachable outcome', () => {
    const m = goodMachine();
    m.states.push({
      id: 'orphan',
      kind: 'checkpoint',
      next: [{ always: true, go: 'T_done' }],
    });
    expect(errorsOf(m).join()).toMatch(/state "orphan" can never be reached/);

    const n = goodMachine();
    n.terminals.push({ id: 'T_orphan', kind: 'no_quote' });
    expect(errorsOf(n).join()).toMatch(
      /outcome "T_orphan" can never be reached/,
    );
  });

  it('catches an outcome that charges for nothing', () => {
    const m = goodMachine();
    m.terminals[0].line_items = [];
    expect(errorsOf(m).join()).toMatch(/charges for nothing/);
  });

  it('catches a rate-card, parts-list or line-order reference that does not resolve', () => {
    const m = goodMachine();
    m.terminals[0].line_items = [
      {
        id: 'l',
        kind: 'labour',
        label: 'L',
        rate: 'labour.nope',
        qty: { base: 1 },
      },
    ];
    expect(errorsOf(m).join()).toMatch(/no rate-card entry "labour.nope"/);

    const n = goodMachine();
    n.terminals[0].line_items = [
      {
        id: 'm',
        kind: 'material',
        label: 'M',
        catalog: 'nope',
        qty: { base: 1 },
      },
    ];
    expect(errorsOf(n).join()).toMatch(/no parts-list entry "nope"/);

    const o = goodMachine();
    o.terminals[0].line_items = [
      {
        id: 'first',
        kind: 'labour',
        label: 'F',
        rate: 'labour.electrician_hourly',
        qty: { of_item: 'second', factor: 1 },
      },
      {
        id: 'second',
        kind: 'labour',
        label: 'S',
        rate: 'labour.electrician_hourly',
        qty: { base: 1 },
      },
    ];
    expect(errorsOf(o).join()).toMatch(/which is priced after it/);
  });

  it('catches a price that reads an answer some route never collects', () => {
    const m = goodMachine();
    m.states[0].next = [
      { when: { var: 'colour', eq: 'red' }, go: 'extra' },
      { always: true, go: 'T_done' },
    ];
    m.states.push({
      id: 'extra',
      kind: 'question',
      ask: { question: 'How many?', why: 'it changes the count' },
      answer: { type: 'measurement', key: 'count' },
      next: [{ always: true, go: 'T_done' }],
    });
    // T_done is reachable both with and without `count`, so pricing off it is a lie.
    m.terminals[0].line_items = [
      {
        id: 'labour',
        kind: 'labour',
        label: 'L',
        rate: 'labour.electrician_hourly',
        qty: { per: [{ of: 'count', rate: 1 }] },
      },
    ];
    expect(errorsOf(m).join()).toMatch(
      /outcome "T_done" uses "count", but there's a route here that never asks it/,
    );
  });

  it('warns about a question with no reason and no way to say "I don\'t know"', () => {
    const m = goodMachine();
    delete m.states[0].ask;
    const answer = m.states[0].answer as AnswerSpec;
    answer.exhaustive = false;
    const { warnings } = validate(m, rateCard);
    expect(warnings.join()).toMatch(/doesn't say why it's being asked/);
    expect(warnings.join()).toMatch(/gives no way to say "I don't know"/);
  });

  it('accepts every seeded machine with no errors at all', () => {
    const { rateCard: seedCard, machines } = loadFlattenedSeed(SEED_DIR);
    for (const m of machines) {
      const report = validate(m, seedCard);
      expect(report.errors, `${m.slug}: ${report.errors.join(' | ')}`).toEqual(
        [],
      );
      expect(report.depth).toBeGreaterThan(0);
    }
  });
});
