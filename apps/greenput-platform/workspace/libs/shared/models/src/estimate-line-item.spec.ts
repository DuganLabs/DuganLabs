import { describe, expect, it } from 'vitest';
import {
  readEstimateLineItem,
  readEstimateLineItems,
} from './estimate-line-item';

describe('readEstimateLineItem', () => {
  it('passes a typed row through unchanged', () => {
    expect(
      readEstimateLineItem({
        id: 'li-1',
        type: 'material',
        description: '200A breaker',
        quantity: 2,
        unitPrice: 4500,
        total: 9000,
      }),
    ).toEqual({
      id: 'li-1',
      type: 'material',
      description: '200A breaker',
      quantity: 2,
      unitPrice: 4500,
      total: 9000,
    });
  });

  // GP-038: the rows the editor wrote before `type` was on the wire. The
  // customer's proposal read "[labor] Replace service panel".
  it.each([
    ['[labor] Replace service panel', 'labor', 'Replace service panel'],
    ['[material] 200A breaker', 'material', '200A breaker'],
    ['[material]No space', 'material', 'No space'],
  ])(
    'lifts the legacy prefix out of %j into type',
    (description, type, plain) => {
      const item = readEstimateLineItem({
        id: 'li-old',
        description,
        quantity: 1,
        unitPrice: 100,
        total: 100,
      });
      expect(item.type).toBe(type);
      expect(item.description).toBe(plain);
      expect(item.description).not.toMatch(/^\[/);
    },
  );

  it('defaults a row with neither a type nor a prefix to labor', () => {
    const item = readEstimateLineItem({
      description: 'Permit',
      quantity: 1,
      unitPrice: 25000,
      total: 25000,
    });
    expect(item.type).toBe('labor');
    expect(item.description).toBe('Permit');
    expect('id' in item).toBe(false);
  });

  it('keeps an explicit type over a stale prefix and still strips the prefix', () => {
    const item = readEstimateLineItem({
      type: 'material',
      description: '[labor] Wire',
      quantity: 1,
      unitPrice: 1,
      total: 1,
    });
    expect(item).toMatchObject({ type: 'material', description: 'Wire' });
  });

  it('leaves a bracketed word that is not a type alone', () => {
    const item = readEstimateLineItem({
      description: '[urgent] Same-day call-out',
      quantity: 1,
      unitPrice: 1,
      total: 1,
    });
    expect(item.description).toBe('[urgent] Same-day call-out');
    expect(item.type).toBe('labor');
  });

  it('ignores a type it does not know', () => {
    expect(
      readEstimateLineItem({ type: 'equipment', description: 'Lift' }).type,
    ).toBe('labor');
  });
});

describe('readEstimateLineItems', () => {
  it('parses the JSON column D1 hands back', () => {
    const items = readEstimateLineItems(
      '[{"description":"[labor] Rough-in","quantity":4,"unitPrice":17500,"total":70000}]',
    );
    expect(items).toEqual([
      {
        type: 'labor',
        description: 'Rough-in',
        quantity: 4,
        unitPrice: 17500,
        total: 70000,
      },
    ]);
  });

  it('accepts an already-parsed array', () => {
    expect(
      readEstimateLineItems([{ type: 'material', description: 'Pipe' }]),
    ).toMatchObject([{ type: 'material', description: 'Pipe' }]);
  });

  it.each([null, undefined, '', 'not json', '{"a":1}', 42])(
    'answers [] for %j',
    (column) => {
      expect(readEstimateLineItems(column)).toEqual([]);
    },
  );

  it('drops entries that are not objects', () => {
    expect(readEstimateLineItems('[1, null, {"description":"x"}]')).toEqual([
      { type: 'labor', description: 'x', quantity: 0, unitPrice: 0, total: 0 },
    ]);
  });
});
