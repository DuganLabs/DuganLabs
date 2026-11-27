import { describe, expect, it } from 'vitest';
import { questionKeys, traverse, traverseGraph } from './traverse.ts';
import type { EvalContext, Machine, RateCard, State } from './types.ts';

const rateCard = {
  slug: 't',
  name: 'T',
  materials: { catalog: {} },
} as unknown as RateCard;

const ctx = (answers: Record<string, unknown>): EvalContext => ({
  rateCard,
  answers: { ...answers },
  env: {},
  notices: new Set<string>(),
});

const machine: Machine = {
  slug: 'demo',
  name: 'Demo',
  vertical: 'demo',
  entry: 'colour',
  states: [
    {
      id: 'colour',
      kind: 'question',
      answer: {
        type: 'choice',
        key: 'colour',
        options: [
          { value: 'red', label: 'Red' },
          { value: 'blue', label: 'Blue' },
        ],
      },
      next: [{ always: true, go: 'derive_warm' }],
    },
    {
      id: 'derive_warm',
      kind: 'derive',
      sets: 'warm',
      rules: [
        {
          when: { var: 'colour', eq: 'red' },
          value: true,
          notice: 'warm_colour',
        },
        { always: true, value: false },
      ],
      next: [{ always: true, go: 'fill_defaults' }],
    },
    {
      id: 'fill_defaults',
      kind: 'defaults',
      sets: { finish: 'matte', colour: 'never_overwritten' },
      next: [
        { when: { var: 'warm', eq: true }, go: 'T_warm' },
        { always: true, go: 'T_cool' },
      ],
    },
  ],
  terminals: [
    { id: 'T_warm', kind: 'quote' },
    { id: 'T_cool', kind: 'quote' },
  ],
};

describe('questionKeys', () => {
  it('returns one key for a plain screen and every field key for a group', () => {
    expect(questionKeys(machine.states[0])).toEqual(['colour']);
    const group: State = {
      id: 'g',
      kind: 'question',
      answer: {
        type: 'group',
        fields: [
          { key: 'a', type: 'text' },
          { key: 'b', type: 'text' },
        ],
      },
      next: [],
    };
    expect(questionKeys(group)).toEqual(['a', 'b']);
  });

  it('returns nothing for a state that asks nothing', () => {
    expect(questionKeys(machine.states[1])).toEqual([]);
  });
});

describe('traverse', () => {
  it('walks to a terminal and records the route', () => {
    const c = ctx({ colour: 'red' });
    const r = traverse(machine, c);
    expect(r.terminalId).toBe('T_warm');
    expect(r.path).toEqual([
      'colour',
      'derive_warm',
      'fill_defaults',
      'T_warm',
    ]);
  });

  it('writes derived values and raises notices', () => {
    const c = ctx({ colour: 'red' });
    traverse(machine, c);
    expect(c.answers['warm']).toBe(true);
    expect([...c.notices]).toEqual(['warm_colour']);
  });

  it('fills a default only where nothing was answered', () => {
    const c = ctx({ colour: 'blue' });
    traverse(machine, c);
    expect(c.answers['finish']).toBe('matte');
    expect(c.answers['colour']).toBe('blue');
  });

  it('refuses to guess at a missing answer', () => {
    expect(() => traverse(machine, ctx({}))).toThrow(/no answer for "colour"/);
  });

  it('reads a photo into its interpreted fields without waiting for it', () => {
    const withPhoto: Machine = {
      ...machine,
      entry: 'photo',
      states: [
        {
          id: 'photo',
          kind: 'question',
          answer: {
            type: 'photo',
            key: 'panel_photo',
            interpretation: {
              status_key: 'photo_status',
              fields: {
                panel_capacity: {
                  type: 'enum',
                  default_when_missing: 'unknown',
                },
                panel_spaces_free: {
                  type: 'number',
                  default_when_missing: null,
                },
              },
            },
          },
          next: [{ always: true, go: 'T_warm' }],
        },
      ],
    };

    const reviewed = ctx({
      panel_photo: {
        status: 'reviewed',
        fields: { panel_capacity: 'spare_capable' },
      },
    });
    traverse(withPhoto, reviewed);
    expect(reviewed.answers['photo_status']).toBe('reviewed');
    expect(reviewed.answers['panel_capacity']).toBe('spare_capable');
    // A field the reviewer did not fill falls back rather than blocking.
    expect(reviewed.answers['panel_spaces_free']).toBeNull();

    const skipped = ctx({ panel_photo: { status: 'missing' } });
    traverse(withPhoto, skipped);
    expect(skipped.answers['photo_status']).toBe('missing');
    expect(skipped.answers['panel_capacity']).toBe('unknown');
  });

  it('stops a machine that cannot make progress rather than looping forever', () => {
    const stuck: Machine = {
      ...machine,
      entry: 'a',
      states: [
        { id: 'a', kind: 'checkpoint', next: [{ always: true, go: 'b' }] },
        { id: 'b', kind: 'checkpoint', next: [{ always: true, go: 'a' }] },
      ],
    };
    expect(() => traverse(stuck, ctx({}))).toThrow(/did not terminate/);
  });

  it('complains when no edge can fire, and when a derive matches no rule', () => {
    const noEdge: Machine = {
      ...machine,
      entry: 'a',
      states: [
        {
          id: 'a',
          kind: 'checkpoint',
          next: [{ when: { var: 'x', eq: 1 }, go: 'T_warm' }],
        },
      ],
    };
    expect(() => traverse(noEdge, ctx({}))).toThrow(
      /had no edge that could fire/,
    );

    const noRule: Machine = {
      ...machine,
      entry: 'd',
      states: [
        {
          id: 'd',
          kind: 'derive',
          sets: 'x',
          rules: [{ when: { var: 'nope', eq: 1 }, value: 1 }],
          next: [{ always: true, go: 'T_warm' }],
        },
      ],
    };
    expect(() => traverse(noRule, ctx({}))).toThrow(/matched no rule/);
  });
});

describe('traverseGraph in pause mode', () => {
  it('stops at the first screen it cannot answer', () => {
    const r = traverseGraph(machine, ctx({}), { onUnanswered: 'pause' });
    expect(r.status).toBe('question');
    if (r.status !== 'question') throw new Error('unreachable');
    expect(r.state.id).toBe('colour');
    expect(r.path).toEqual(['colour']);
  });

  it('runs to the terminal once every screen is answered', () => {
    const r = traverseGraph(machine, ctx({ colour: 'blue' }), {
      onUnanswered: 'pause',
    });
    expect(r.status).toBe('terminal');
  });

  it('re-asks a group screen until every one of its fields is present', () => {
    const grouped: Machine = {
      ...machine,
      entry: 'pair',
      states: [
        {
          id: 'pair',
          kind: 'question',
          answer: {
            type: 'group',
            fields: [
              { key: 'a', type: 'text' },
              { key: 'b', type: 'text', required: false },
            ],
          },
          next: [{ always: true, go: 'T_warm' }],
        },
      ],
    };
    const partial = traverseGraph(grouped, ctx({ a: 'yes' }), {
      onUnanswered: 'pause',
    });
    expect(partial.status).toBe('question');
    // An optional field left blank still has to be RECORDED as blank, or the
    // screen would ask forever.
    const complete = traverseGraph(grouped, ctx({ a: 'yes', b: '' }), {
      onUnanswered: 'pause',
    });
    expect(complete.status).toBe('terminal');
  });
});
