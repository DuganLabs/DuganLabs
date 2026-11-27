import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@basenative/runtime';
import {
  bindTable,
  figure,
  identity,
  badge,
  note,
  text,
  type TableState,
  type TableView,
} from '../src/lib/table.js';

/**
 * The ledger view layer. Two things are being guarded:
 *
 *  1. Everything renders through `@basenative/components`' `renderTable` —
 *     the markup must carry the package's own `data-bn` hooks, not a
 *     hand-rolled table.
 *  2. The renderer's own options carry the money-table contract (column
 *     `numeric`, `labelCells`, `footer`, `emptyContent`, `cellAttrs`), and
 *     the post-render step adds only what it has no option for (colgroup
 *     widths, `data-row` variants, `aria-busy`).
 */

interface Row {
  name: string;
  amount: number;
}

const ROWS: Row[] = [
  { name: 'Chase Sapphire', amount: 18_420 },
  { name: 'Amex Platinum', amount: 7310 },
];

function view(overrides: Partial<TableView<Row>> = {}): TableView<Row> {
  return {
    emptyMessage: 'Nothing tracked.',
    columns: [
      {
        key: 'name',
        label: 'Liability',
        identity: true,
        width: '60%',
        cell: r => identity(r.name, 'credit card'),
      },
      {
        key: 'amount',
        label: 'Principal',
        numeric: true,
        primary: true,
        width: '40%',
        cell: r => figure(`$${r.amount}`, { bar: 0.5 }),
        foot: rows => figure(`$${rows.reduce((s, r) => s + r.amount, 0)}`),
      },
    ],
    ...overrides,
  };
}

function mount(v: TableView<Row>, state: TableState<Row>): HTMLElement {
  const host = document.createElement('div');
  host.id = 'host';
  document.body.append(host);
  bindTable('host', v, () => state);
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('renders through the package renderer', () => {
  it('emits the component table markup, not a bare <table>', () => {
    const host = mount(view(), { status: 'ready', rows: ROWS });
    expect(host.querySelector('[data-bn="table-container"]')).toBeTruthy();
    expect(host.querySelector('table[data-bn="table"]')).toBeTruthy();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('escapes row data that reaches a cell through text()', () => {
    const host = mount(
      view({
        columns: [{ key: 'name', label: 'Liability', cell: r => text(r.name) }],
      }),
      { status: 'ready', rows: [{ name: '<img src=x onerror=alert(1)>', amount: 0 }] },
    );
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('numeric columns', () => {
  it('marks the heading and every cell, so the column and its header align', () => {
    const host = mount(view(), { status: 'ready', rows: ROWS });
    const heads = [...host.querySelectorAll('thead th')];
    expect(heads[0]?.hasAttribute('data-numeric')).toBe(false);
    expect(heads[1]?.hasAttribute('data-numeric')).toBe(true);
    for (const row of host.querySelectorAll('tbody tr')) {
      expect(row.children[1]?.hasAttribute('data-numeric')).toBe(true);
    }
  });

  it('locks column geometry with a colgroup so values cannot reflow the table', () => {
    const host = mount(view(), { status: 'ready', rows: ROWS });
    const cols = [...host.querySelectorAll('colgroup col')];
    expect(cols).toHaveLength(2);
    expect((cols[0] as HTMLElement).style.width).toBe('60%');
  });
});

describe('the mobile record transform has what it needs', () => {
  it('labels every cell so a hidden <thead> never leaves a bare zig-zag', () => {
    const host = mount(view(), { status: 'ready', rows: ROWS });
    const cells = [...host.querySelectorAll('tbody tr:first-child td')];
    expect(cells.map(c => c.getAttribute('data-label'))).toEqual(['Liability', 'Principal']);
  });

  it('marks the identity and primary cells that get promoted to the card head', () => {
    const host = mount(view(), { status: 'ready', rows: ROWS });
    const row = host.querySelector('tbody tr');
    expect(row?.children[0]?.getAttribute('data-role')).toBe('identity');
    expect(row?.children[1]?.getAttribute('data-role')).toBe('primary');
  });

  it('keeps <thead> in the DOM — the transform is CSS-only', () => {
    const host = mount(view(), { status: 'ready', rows: ROWS });
    expect(host.querySelectorAll('thead th')).toHaveLength(2);
  });
});

describe('totals row', () => {
  it('renders a <tfoot> with the row label and only the columns that total', () => {
    const host = mount(view({ footLabel: 'Total' }), { status: 'ready', rows: ROWS });
    const foot = host.querySelector('tfoot tr');
    expect(foot?.children[0]?.textContent).toBe('Total');
    expect(foot?.children[0]?.getAttribute('scope')).toBe('row');
    expect(foot?.children[1]?.textContent).toContain('$25730');
  });

  it('omits the totals row entirely when there are no rows to total', () => {
    const host = mount(view({ footLabel: 'Total' }), { status: 'ready', rows: [] });
    expect(host.querySelector('tfoot')).toBeNull();
  });

  it('leaves a non-totalling column empty so mobile can drop it (tfoot td:empty)', () => {
    const host = mount(
      view({
        footLabel: 'Total',
        columns: [
          { key: 'name', label: 'Liability', cell: r => text(r.name) },
          { key: 'amount', label: 'Principal', numeric: true, cell: () => '', foot: () => '$1' },
        ],
      }),
      { status: 'ready', rows: ROWS },
    );
    const foot = host.querySelector('tfoot tr');
    expect(foot?.children[1]?.getAttribute('data-label')).toBe('Principal');
    expect(foot?.children[1]?.textContent).toBe('$1');
    expect(foot?.children[0]?.textContent).toBe('Total');
  });

  it('labels every footer cell — the renderer stamps them, the CSS drops the empty ones', () => {
    const host = mount(
      view({
        footLabel: 'Total',
        columns: [
          { key: 'name', label: 'Liability', cell: r => text(r.name) },
          { key: 'note', label: 'Note', cell: () => '' },
          { key: 'amount', label: 'Principal', numeric: true, cell: () => '', foot: () => '$1' },
        ],
      }),
      { status: 'ready', rows: ROWS },
    );
    const cells = [...(host.querySelector('tfoot tr')?.children ?? [])];
    expect(cells.map(c => c.tagName)).toEqual(['TH', 'TD', 'TD']);
    expect(cells[1]?.textContent).toBe('');
    expect(cells[1]?.matches(':empty')).toBe(true);
    expect(cells[2]?.hasAttribute('data-numeric')).toBe(true);
    expect(cells[2]?.hasAttribute('data-role')).toBe(false);
  });
});

describe('states', () => {
  it('loading keeps the real column count and marks the body busy', () => {
    const host = mount(view({ skeletonRows: 3 }), { status: 'loading' });
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(host.querySelectorAll('tbody tr:first-child [data-bn="skeleton"]')).toHaveLength(2);
    expect(host.querySelector('tbody')?.getAttribute('aria-busy')).toBe('true');
  });

  it('empty renders the package empty cell plus the action that fixes it', () => {
    const host = mount(
      view({ emptyAction: { href: '/settings.html', label: 'Connect a bank →' } }),
      { status: 'ready', rows: [] },
    );
    const cell = host.querySelector('td[data-bn="table-empty"]');
    expect(cell?.textContent).toContain('Nothing tracked.');
    expect(cell?.querySelector('a')?.getAttribute('href')).toBe('/settings.html');
  });

  it('error renders an alert with role="alert" and a working retry', () => {
    const host = document.createElement('div');
    host.id = 'host';
    document.body.append(host);
    let retried = 0;
    const state = signal<TableState<Row>>({
      status: 'error',
      message: "Couldn't load your situation.",
      retry: () => {
        retried += 1;
      },
    });
    bindTable('host', view(), () => state());

    const alert = host.querySelector('[data-bn="alert"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.getAttribute('data-variant')).toBe('error');
    expect(alert?.textContent).toContain("Couldn't load your situation.");
    host.querySelector<HTMLButtonElement>('[data-retry]')?.click();
    expect(retried).toBe(1);

    // …and the table comes back when the state does.
    state.set({ status: 'ready', rows: ROWS });
    expect(host.querySelector('[data-bn="alert"]')).toBeNull();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});

describe('row emphasis', () => {
  it('marks only the rows the view asks for', () => {
    const host = mount(view({ rowVariant: (_r, i) => (i === 0 ? 'emphasis' : undefined) }), {
      status: 'ready',
      rows: ROWS,
    });
    const rows = [...host.querySelectorAll('tbody tr')];
    expect(rows[0]?.getAttribute('data-row')).toBe('emphasis');
    expect(rows[1]?.hasAttribute('data-row')).toBe(false);
  });
});

describe('cell helpers', () => {
  it('figure hides its bar from assistive tech — the number is the value', () => {
    expect(figure('$1', { bar: 0.25 })).toContain('aria-hidden="true"');
    expect(figure('$1', { bar: 0.25 })).toContain('--v:0.2500');
  });

  it('a tone is only ever a second channel on top of the rendered text', () => {
    const html = figure('−$18,420', { tone: 'loss' });
    expect(html).toContain('data-tone="loss"');
    expect(html).toContain('−$18,420');
  });

  it('badge renders text, never a bare coloured dot', () => {
    const html = badge('avalanche target', 'primary');
    expect(html).toContain('avalanche target');
    expect(html).toContain('data-bn="badge"');
  });

  it('identity and note escape their input', () => {
    expect(identity('<b>x</b>')).not.toContain('<b>');
    expect(note('<b>x</b>')).not.toContain('<b>');
  });
});
