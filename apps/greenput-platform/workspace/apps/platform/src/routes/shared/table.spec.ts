import { afterEach, describe, expect, it } from 'vitest';
import { el } from '../../lib/dom.js';
import {
  actionButton,
  fill,
  mountTable,
  onRowAction,
  timeCell,
  twoLines,
  type TableColumn,
} from './table.js';

interface Row {
  id: string;
  name: string;
  total: number;
}

const COLUMNS: readonly TableColumn<Row>[] = [
  { key: 'name', label: 'Name', value: (r) => r.name },
  { key: 'total', label: 'Total', value: (r) => `$${r.total}` },
  {
    key: 'actions',
    label: '',
    value: () => '',
    cell: (r, td) =>
      fill(
        td,
        actionButton({
          action: 'archive',
          id: r.id,
          label: 'Archive',
          testId: `archive-${r.id}`,
        }),
      ),
  },
];

describe('mountTable', () => {
  let host: HTMLElement | null = null;
  afterEach(() => {
    host?.remove();
    host = null;
  });

  it('renders the component table with headers, escaped cells and decorations', () => {
    host = el('div');
    document.body.append(host);
    mountTable(host, {
      columns: COLUMNS,
      rows: [
        { id: 'a', name: '<b>Acme</b>', total: 10 },
        { id: 'b', name: 'Bolt', total: 20 },
      ],
    });

    expect(host.querySelector('[data-bn="table-container"]')).not.toBeNull();
    const headers = host.querySelectorAll('thead th[scope="col"]');
    expect([...headers].map((th) => th.textContent)).toEqual([
      'Name',
      'Total',
      'Actions',
    ]);
    expect(headers[2]?.querySelector('[data-bn-sr-only]')?.textContent).toBe(
      'Actions',
    );
    const rows = host.querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.cells[0]?.textContent).toBe('<b>Acme</b>');
    expect(rows[0]?.querySelector('b')).toBeNull();
    expect(rows[1]?.cells[1]?.textContent).toBe('$20');
    expect(host.querySelector('[data-testid="archive-b"]')).not.toBeNull();
  });

  it('keeps the caption for assistive tech only — the route prints the heading', () => {
    host = el('div');
    mountTable(host, {
      columns: COLUMNS,
      rows: [{ id: 'a', name: 'A', total: 1 }],
      caption: 'Job history',
    });
    const caption = host.querySelector('caption');
    expect(caption?.textContent).toBe('Job history');
    expect(caption?.hasAttribute('data-bn-sr-only')).toBe(true);
  });

  it('re-renders in place and shows the empty-state row', () => {
    host = el('div');
    mountTable(host, {
      columns: COLUMNS,
      rows: [{ id: 'a', name: 'A', total: 1 }],
    });
    mountTable(host, { columns: COLUMNS, rows: [], emptyMessage: 'Nothing' });
    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(host.querySelector('[data-bn="table-empty"]')?.textContent).toBe(
      'Nothing',
    );
  });
});

describe('href columns', () => {
  it('wraps the cell — text or decoration — in a real link to the row’s page', () => {
    const host = el('div');
    document.body.append(host);
    mountTable<Row>(host, {
      columns: [
        {
          key: 'name',
          label: 'Name',
          value: (r) => r.name,
          href: (r) => `/rows/${r.id}`,
          cell: (r, td) => fill(td, ...twoLines(r.name, 'secondary')),
        },
        { key: 'total', label: 'Total', value: (r) => `$${r.total}` },
      ],
      rows: [{ id: 'a', name: 'Acme', total: 10 }],
    });
    const cell = host.querySelector('tbody td') as HTMLTableCellElement;
    const link = cell.querySelector('a[data-bn-row-link]');
    expect(link?.getAttribute('href')).toBe('/rows/a');
    // The decoration survived, inside the link.
    expect(link?.querySelector('strong')?.textContent).toBe('Acme');
    expect(link?.querySelector('[data-bn-secondary]')?.textContent).toBe(
      'secondary',
    );
    expect(cell.childNodes).toHaveLength(1);
    // A column without href gets no anchor.
    expect(host.querySelectorAll('tbody td')[1]?.querySelector('a')).toBeNull();
    host.remove();
  });
});

describe('onRowAction', () => {
  it('reports the action and id of the clicked button, once per click', () => {
    const host = el('div');
    document.body.append(host);
    mountTable(host, {
      columns: COLUMNS,
      rows: [{ id: 'x', name: 'X', total: 1 }],
    });
    const seen: string[] = [];
    const off = onRowAction(host, (action, id) => seen.push(`${action}:${id}`));
    (host.querySelector('[data-testid="archive-x"]') as HTMLElement).click();
    (host.querySelector('td') as HTMLElement).click();
    expect(seen).toEqual(['archive:x']);
    off();
    host.remove();
  });
});

describe('cell helpers', () => {
  it('twoLines renders the secondary line only when present', () => {
    expect(twoLines('A', 'b')).toHaveLength(2);
    expect(twoLines('A', '')).toHaveLength(1);
    expect(twoLines('A')).toHaveLength(1);
  });

  it('timeCell keeps the machine-readable datetime', () => {
    const node = timeCell('2026-04-01T00:00:00Z', 'yesterday');
    expect(node.getAttribute('datetime')).toBe('2026-04-01T00:00:00Z');
    expect(node.textContent).toBe('yesterday');
  });
});
