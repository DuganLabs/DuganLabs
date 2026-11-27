import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineFragments, resolveTerminal } from './graph.ts';
import { loadSeedBundle } from './seed-loader.ts';
import type { Fragment, Machine, Terminal } from './types.ts';

const SEED_DIR = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'),
  'seeds',
  'pricing',
);

const fragment: Fragment = {
  id: 'ask_two',
  entry: 'one',
  states: [
    { id: 'one', kind: 'checkpoint', next: [{ always: true, go: 'two' }] },
    {
      id: 'two',
      kind: 'checkpoint',
      next: [{ always: true, go: '__return__' }],
    },
  ],
};

const machine: Machine = {
  slug: 'demo',
  name: 'Demo',
  vertical: 'demo',
  entry: 'start',
  states: [
    {
      id: 'start',
      kind: 'fragment',
      fragment: 'ask_two',
      next: [{ always: true, go: 'T_done' }],
    },
  ],
  terminals: [{ id: 'T_done', kind: 'quote', line_items: [] }],
};

describe('inlineFragments', () => {
  const flat = inlineFragments(machine, { ask_two: fragment }, []);

  it('turns the including state into a pass-through into the fragment entry', () => {
    const entry = flat.states.find((s) => s.id === 'start');
    expect(entry?.kind).toBe('checkpoint');
    expect(entry?.next).toEqual([{ always: true, go: 'start__one' }]);
  });

  it('prefixes every internal id and rewrites internal targets', () => {
    expect(flat.states.map((s) => s.id)).toEqual([
      'start',
      'start__one',
      'start__two',
    ]);
    expect(flat.states.find((s) => s.id === 'start__one')?.next).toEqual([
      { always: true, go: 'start__two' },
    ]);
  });

  it("splices the including state's own next list in where __return__ appears", () => {
    expect(flat.states.find((s) => s.id === 'start__two')?.next).toEqual([
      { always: true, go: 'T_done' },
    ]);
  });

  it('leaves the authored machine untouched', () => {
    expect(machine.states).toHaveLength(1);
    expect(machine.states[0].kind).toBe('fragment');
  });

  it('merges a shared ending only when something routes to it', () => {
    const shared: Terminal[] = [
      { id: 'T_done_shared', kind: 'no_quote' },
      { id: 'T_never_used', kind: 'no_quote' },
    ];
    const routed: Machine = {
      ...machine,
      states: [
        {
          id: 'start',
          kind: 'fragment',
          fragment: 'ask_two',
          next: [{ always: true, go: 'T_done_shared' }],
        },
      ],
    };
    const out = inlineFragments(routed, { ask_two: fragment }, shared);
    expect(out.terminals.map((t) => t.id)).toContain('T_done_shared');
    expect(out.terminals.map((t) => t.id)).not.toContain('T_never_used');
  });

  it('refuses a fragment it has never heard of', () => {
    expect(() => inlineFragments(machine, {}, [])).toThrow(/unknown fragment/);
  });

  it('flattens every seeded machine without complaint', () => {
    const { fragments, sharedTerminals, machines } = loadSeedBundle(SEED_DIR);
    for (const m of machines) {
      const out = inlineFragments(m, fragments, sharedTerminals);
      expect(out.states.some((s) => s.kind === 'fragment')).toBe(false);
    }
  });
});

describe('resolveTerminal', () => {
  const withExtends: Machine = {
    ...machine,
    terminals: [
      {
        id: 'T_base',
        kind: 'quote',
        includes: ['a permit'],
        uncertainty: {
          base_spread_pct: 12,
          widen: [{ when: { always: true }, add_pct: 3, because: 'parent' }],
        },
        line_items: [
          {
            id: 'labour',
            kind: 'labour',
            label: 'Labour',
            rate: 'labour.electrician_hourly',
          },
          { id: 'gone', kind: 'fee', label: 'Dropped', rate: 'fees.trip' },
          { id: 'swapped', kind: 'fee', label: 'Old', rate: 'fees.trip' },
        ],
      },
      {
        id: 'T_child',
        kind: 'quote',
        extends: 'T_base',
        drop_items: ['gone'],
        line_items_override: [
          { id: 'swapped', kind: 'fee', label: 'New', rate: 'fees.permit' },
        ],
        line_items_extra: [
          { id: 'added', kind: 'fee', label: 'Added', rate: 'fees.trip' },
        ],
        includes_extra: ['a second visit'],
      },
      { id: 'T_loop_a', kind: 'quote', extends: 'T_loop_b' },
      { id: 'T_loop_b', kind: 'quote', extends: 'T_loop_a' },
    ],
  };

  it('drops, overrides and appends line items in that order', () => {
    const t = resolveTerminal(withExtends, 'T_child');
    expect(t.line_items.map((i) => i.id)).toEqual([
      'labour',
      'swapped',
      'added',
    ]);
    expect(t.line_items.find((i) => i.id === 'swapped')?.label).toBe('New');
  });

  it('concatenates includes rather than replacing them', () => {
    expect(resolveTerminal(withExtends, 'T_child').includes).toEqual([
      'a permit',
      'a second visit',
    ]);
  });

  it('carries the parent widening rules but does not apply them unless asked', () => {
    const t = resolveTerminal(withExtends, 'T_child');
    expect(t._parent_widen).toHaveLength(1);
    expect(t._inherits_widen_from).toBeNull();
  });

  it('refuses an unknown terminal and an extends cycle', () => {
    expect(() => resolveTerminal(withExtends, 'T_nope')).toThrow(
      /unknown terminal/,
    );
    expect(() => resolveTerminal(withExtends, 'T_loop_a')).toThrow(
      /extends cycle/,
    );
  });
});
