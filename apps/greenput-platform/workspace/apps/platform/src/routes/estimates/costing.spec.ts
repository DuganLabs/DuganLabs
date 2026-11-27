import { afterEach, describe, expect, it } from 'vitest';
import { signal } from '@basenative/runtime';
import type { EstimateLineItem } from '@greenput/shared/models';
import {
  costingTotals,
  lineItemSplit,
  lineItemsFromRows,
  mountCosting,
  newRow,
  rowsFromLineItems,
  type CostingRow,
} from './costing.js';

const ITEMS: EstimateLineItem[] = [
  {
    id: 'li-a',
    type: 'labor',
    description: 'Install',
    quantity: 4,
    unitPrice: 10000,
    total: 40000,
  },
  {
    type: 'material',
    description: 'Panel',
    quantity: 1,
    unitPrice: 80000,
    total: 80000,
  },
];

function q<T extends Element = HTMLElement>(testid: string): T {
  const node = document.querySelector<T>(`[data-testid="${testid}"]`);
  if (!node) throw new Error(`no ${testid}`);
  return node;
}

function type(testid: string, value: string): void {
  const input = q<HTMLInputElement>(testid);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('costing conversions', () => {
  it('rowsFromLineItems turns wire cents into the dollars the boxes show, keeping ids', () => {
    const rows = rowsFromLineItems(ITEMS);
    expect(rows[0]).toEqual({
      id: 'li-a',
      type: 'labor',
      description: 'Install',
      quantity: 4,
      unitPrice: 100,
    });
    // A row without an id gets one, so the editor can address it.
    expect(rows[1]?.id).toMatch(/[0-9a-f-]{36}/);
    expect(rows[1]?.unitPrice).toBe(800);
  });

  it('lineItemsFromRows sends cents with each total whole', () => {
    const rows: CostingRow[] = [
      {
        id: 'r1',
        type: 'labor',
        description: 'Hours',
        quantity: 1.5,
        unitPrice: 33.33,
      },
    ];
    expect(lineItemsFromRows(rows)).toEqual([
      {
        id: 'r1',
        type: 'labor',
        description: 'Hours',
        quantity: 1.5,
        unitPrice: 3333,
        total: 5000,
      },
    ]);
  });

  it('round-trips: wire → rows → wire is the same money', () => {
    expect(lineItemsFromRows(rowsFromLineItems(ITEMS))[0]).toEqual(ITEMS[0]);
  });

  it('costingTotals splits labor and materials and taxes the sum', () => {
    const rows = rowsFromLineItems(ITEMS);
    const t = costingTotals(rows, 8.25);
    expect(t.labor).toBe(400);
    expect(t.materials).toBe(800);
    expect(t.subtotal).toBe(1200);
    expect(t.tax).toBeCloseTo(99);
    expect(t.total).toBeCloseTo(1299);
    // (1299 − 800) / 1299
    expect(t.margin).toBeCloseTo(38.4, 1);
    expect(costingTotals([], 8.25).margin).toBe(0);
  });

  it('lineItemSplit sums the wire totals by type, in cents', () => {
    expect(lineItemSplit(ITEMS)).toEqual({ labor: 40000, materials: 80000 });
  });
});

describe('mountCosting', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  it('renders the rows it is given, edits them in place, and keeps the totals current', () => {
    const rows = signal<CostingRow[]>(rowsFromLineItems(ITEMS));
    const taxRate = signal(8.25);
    const mount = mountCosting({ rows, taxRate, testId: 'cost' });
    dispose = mount.dispose;
    document.body.append(mount.element);

    expect(q<HTMLInputElement>('cost-row-li-a-qty').value).toBe('4');
    expect(q<HTMLInputElement>('cost-row-li-a-price').value).toBe('100');
    expect(q('cost-labor').textContent).toBe('$400');
    expect(q('cost-materials').textContent).toBe('$800');
    expect(q('cost-grand-total').textContent).toBe('$1,299');

    type('cost-row-li-a-qty', '5');
    expect(rows()[0]?.quantity).toBe(5);
    expect(q('cost-labor').textContent).toBe('$500');
    expect(q('cost-grand-total').textContent).toBe('$1,407');

    taxRate.set(0);
    expect(q('cost-grand-total').textContent).toBe('$1,300');
    expect(q('cost-margin').textContent).toBe('38.5%');
  });

  it('adds and removes rows through labelled controls', () => {
    const rows = signal<CostingRow[]>([]);
    const mount = mountCosting({ rows, taxRate: () => 0, testId: 'cost' });
    dispose = mount.dispose;
    document.body.append(mount.element);

    q('cost-add-material').click();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.type).toBe('material');
    const id = rows()[0]?.id ?? '';
    expect(q('cost-row-' + id + '-desc').getAttribute('aria-label')).toBe(
      'Description',
    );
    expect(q('cost-row-' + id + '-remove').getAttribute('aria-label')).toBe(
      'Remove row',
    );
    q('cost-row-' + id + '-remove').click();
    expect(rows()).toHaveLength(0);
    expect(newRow('labor').type).toBe('labor');
  });
});
