/**
 * The job-costing editor: rows of { type: labor | material, description,
 * quantity, unitPrice } with the labor / materials / subtotal / tax / total
 * / margin readout under them. One definition, mounted by the New estimate
 * panel on `/estimates` and by the edit form on `/estimates/:id` (GP-003).
 *
 * Rows hold DOLLARS — the numbers a person types into the price boxes — and
 * every amount on the wire is integer cents (the MONEY note in
 * libs/shared/models/src/wire.ts). `lineItemsFromRows` is the one place the
 * conversion happens on the way out and `rowsFromLineItems` on the way in.
 *
 * `type` is its own field on the wire (GP-038). It used to ride inside the
 * description as "[labor] …", and the customer's proposal printed the
 * bracket.
 */

import { effect, type Signal } from '@basenative/runtime';
import type {
  EstimateLineItem,
  EstimateLineItemType,
} from '@greenput/shared/models';
import { defineSheet } from '../../styles/sheet.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { formatCurrency } from '../../lib/format.js';

export type CostingRow = {
  id: string;
  type: EstimateLineItemType;
  description: string;
  quantity: number;
  /** Dollars, as typed. */
  unitPrice: number;
};

export const COSTING_SHEET = defineSheet(`
[data-bn-costing] {
  display: grid;
  gap: var(--gp-space-3);
}
[data-bn-costing] h3 {
  margin: 0;
  font-size: var(--gp-text-base);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-snug);
  color: var(--gp-text-strong);
}
[data-bn-costing-add] {
  display: flex;
  gap: var(--gp-space-2);
}
[data-bn-costing-rows] {
  display: grid;
  gap: var(--gp-space-2);
}
[data-bn-costing-row] {
  display: grid;
  grid-template-columns: 6rem 1fr 5rem 7rem 7rem auto;
  gap: var(--gp-space-2);
  align-items: center;
  padding: var(--gp-space-2);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
  background: var(--gp-ink-25);
}
[data-bn-costing-row][data-type='labor'] { border-inline-start: 3px solid var(--gp-info); }
[data-bn-costing-row][data-type='material'] { border-inline-start: 3px solid var(--gp-success); }
[data-bn-costing-row] input { padding: var(--gp-space-1) var(--gp-space-2); }
[data-bn-costing-row] [data-bn-row-total] {
  font-weight: 600;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
[data-bn-costing-totals] {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: var(--gp-space-1);
  column-gap: var(--gp-space-3);
  padding-block-start: var(--gp-space-3);
  border-top: 1px solid var(--gp-rule);
}
[data-bn-costing-totals] dt { color: var(--gp-text-muted); }
[data-bn-costing-totals] dd {
  margin: 0;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
[data-bn-costing-totals] dt[data-bn-grand], [data-bn-costing-totals] dd[data-bn-grand] {
  font-weight: 700;
  font-size: var(--gp-text-lg);
  color: var(--gp-text);
  padding-block-start: var(--gp-space-2);
  border-top: 1px solid var(--gp-rule-strong);
}
[data-bn-costing-totals] [data-bn-margin] {
  color: var(--gp-success);
  font-weight: 600;
}
`);

export function newRow(type: EstimateLineItemType): CostingRow {
  return {
    id: crypto.randomUUID(),
    type,
    description: '',
    quantity: 1,
    unitPrice: 0,
  };
}

/** The wire's cents as the dollars the boxes show. */
export function rowsFromLineItems(
  items: readonly EstimateLineItem[],
): CostingRow[] {
  return items.map((item) => ({
    id: item.id ?? crypto.randomUUID(),
    type: item.type,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice / 100,
  }));
}

/**
 * What the API is sent: cents, with each line's total already whole. The
 * API recomputes `total` and mints an `id` for a row without one; sending
 * them costs nothing and keeps the shape `EstimateLineItem` declares.
 */
export function lineItemsFromRows(
  rows: readonly CostingRow[],
): EstimateLineItem[] {
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    description: r.description,
    quantity: r.quantity,
    unitPrice: Math.round(r.unitPrice * 100),
    total: Math.round(r.quantity * r.unitPrice * 100),
  }));
}

export interface CostingTotals {
  labor: number;
  materials: number;
  subtotal: number;
  tax: number;
  total: number;
  /** Percent: (total − materials) / total. 0 for an empty estimate. */
  margin: number;
}

/** Dollars in, dollars out — `taxRate` is a percentage (8.25 = 8.25%). */
export function costingTotals(
  rows: readonly CostingRow[],
  taxRate: number,
): CostingTotals {
  const sum = (type: EstimateLineItemType): number =>
    rows
      .filter((r) => r.type === type)
      .reduce((acc, r) => acc + r.quantity * r.unitPrice, 0);
  const labor = sum('labor');
  const materials = sum('material');
  const subtotal = labor + materials;
  const tax = subtotal * ((taxRate || 0) / 100);
  const total = subtotal + tax;
  const margin = total === 0 ? 0 : ((total - materials) / total) * 100;
  return { labor, materials, subtotal, tax, total, margin };
}

/**
 * The same split for line items already on the wire (cents in, cents out)
 * — the read-only readout on the detail page, computed from the API's own
 * rows rather than re-derived from a form.
 */
export function lineItemSplit(items: readonly EstimateLineItem[]): {
  labor: number;
  materials: number;
} {
  const sum = (type: EstimateLineItemType): number =>
    items
      .filter((item) => item.type === type)
      .reduce((acc, item) => acc + item.total, 0);
  return { labor: sum('labor'), materials: sum('material') };
}

export interface MountCostingArgs {
  readonly rows: Signal<CostingRow[]>;
  /** Read reactively: the totals follow it. */
  readonly taxRate: () => number;
  /** Prefix for every `data-testid` inside: "estimates", "estimate-detail". */
  readonly testId: string;
}

export interface CostingMount {
  readonly element: HTMLElement;
  dispose(): void;
}

export function mountCosting(args: MountCostingArgs): CostingMount {
  const { rows, testId } = args;
  const cleanups: Cleanup[] = [];
  const rowsContainer = el('div', { 'data-bn-costing-rows': '' });

  const addButton = (
    type: EstimateLineItemType,
    label: string,
  ): HTMLElement => {
    const button = el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-bn-variant': 'secondary',
        'data-testid': `${testId}-add-${type}`,
      },
      label,
    );
    cleanups.push(
      on(button, 'click', () => {
        rows.set([...rows.peek(), newRow(type)]);
      }),
    );
    return button;
  };

  const patchRow = (id: string, patch: Partial<CostingRow>): void => {
    rows.set(rows.peek().map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  // Rows are rebuilt only when the SET of rows changes (a row added or
  // removed). A keystroke changes a value, not the set, so it updates the
  // row's total in place — rebuilding the inputs under the user's hands
  // would drop focus on every character.
  let rowCleanups: Cleanup[] = [];
  let renderedIds = '';
  const rowTotals = new Map<string, HTMLElement>();

  function renderRows(list: readonly CostingRow[]): void {
    for (const fn of rowCleanups) fn();
    rowCleanups = [];
    rowTotals.clear();
    clear(rowsContainer);
    for (const row of list) {
      const descInput = el('input', {
        type: 'text',
        'data-bn-input': '',
        'data-testid': `${testId}-row-${row.id}-desc`,
        'aria-label': 'Description',
        placeholder: 'Description',
      }) as HTMLInputElement;
      descInput.value = row.description;
      rowCleanups.push(
        on(descInput, 'input', () => {
          patchRow(row.id, { description: descInput.value });
        }),
      );

      const qtyInput = el('input', {
        type: 'number',
        'data-bn-input': '',
        'data-testid': `${testId}-row-${row.id}-qty`,
        'aria-label': 'Quantity',
        min: '0',
      }) as HTMLInputElement;
      qtyInput.value = String(row.quantity);
      rowCleanups.push(
        on(qtyInput, 'input', () => {
          patchRow(row.id, { quantity: Number(qtyInput.value) || 0 });
        }),
      );

      const priceInput = el('input', {
        type: 'number',
        'data-bn-input': '',
        'data-testid': `${testId}-row-${row.id}-price`,
        'aria-label': 'Unit price (USD)',
        step: '0.01',
        min: '0',
      }) as HTMLInputElement;
      priceInput.value = String(row.unitPrice);
      rowCleanups.push(
        on(priceInput, 'input', () => {
          patchRow(row.id, { unitPrice: Number(priceInput.value) || 0 });
        }),
      );

      const removeBtn = el(
        'button',
        {
          type: 'button',
          'data-bn-button': '',
          'data-bn-variant': 'ghost',
          'aria-label': 'Remove row',
          'data-testid': `${testId}-row-${row.id}-remove`,
        },
        '×',
      );
      rowCleanups.push(
        on(removeBtn, 'click', () => {
          rows.set(rows.peek().filter((r) => r.id !== row.id));
        }),
      );

      const total = el(
        'span',
        { 'data-bn-row-total': '' },
        formatCurrency(row.quantity * row.unitPrice),
      );
      rowTotals.set(row.id, total);
      rowsContainer.append(
        el(
          'div',
          { 'data-bn-costing-row': '', 'data-type': row.type },
          el('span', {}, row.type),
          descInput,
          qtyInput,
          priceInput,
          total,
          removeBtn,
        ),
      );
    }
  }

  cleanups.push(
    effect(() => {
      const list = rows();
      const ids = list.map((r) => r.id).join('\n');
      if (ids !== renderedIds) {
        renderedIds = ids;
        renderRows(list);
        return;
      }
      for (const row of list) {
        const total = rowTotals.get(row.id);
        if (total)
          total.textContent = formatCurrency(row.quantity * row.unitPrice);
      }
    }).dispose,
  );

  const totals = el('dl', { 'data-bn-costing-totals': '' });
  cleanups.push(
    effect(() => {
      const t = costingTotals(rows(), args.taxRate());
      clear(totals);
      totals.append(
        el('dt', {}, 'Labor'),
        el('dd', { 'data-testid': `${testId}-labor` }, formatCurrency(t.labor)),
        el('dt', {}, 'Materials'),
        el(
          'dd',
          { 'data-testid': `${testId}-materials` },
          formatCurrency(t.materials),
        ),
        el('dt', {}, 'Subtotal'),
        el('dd', {}, formatCurrency(t.subtotal)),
        el('dt', {}, 'Tax'),
        el('dd', {}, formatCurrency(t.tax)),
        el('dt', { 'data-bn-grand': '' }, 'Total'),
        el(
          'dd',
          { 'data-bn-grand': '', 'data-testid': `${testId}-grand-total` },
          formatCurrency(t.total),
        ),
        el('dt', {}, 'Estimated margin'),
        el(
          'dd',
          { 'data-bn-margin': '', 'data-testid': `${testId}-margin` },
          `${t.margin.toFixed(1)}%`,
        ),
      );
    }).dispose,
  );

  const headingId = `${testId}-costing-heading`;
  const element = el(
    'section',
    { 'data-bn-costing': '', 'aria-labelledby': headingId },
    el('h3', { id: headingId }, 'Job costing'),
    el(
      'div',
      { 'data-bn-costing-add': '' },
      addButton('labor', '+ Labor row'),
      addButton('material', '+ Material row'),
    ),
    rowsContainer,
    totals,
  );

  return {
    element,
    dispose: () => {
      for (const fn of rowCleanups) fn();
      for (const fn of cleanups) fn();
    },
  };
}
