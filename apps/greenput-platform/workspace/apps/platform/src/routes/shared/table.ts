/**
 * Data table — `@basenative/components` `renderTable` mounted into the
 * `el()` tree.
 *
 * renderTable produces the whole table: the scroll container,
 * `<table data-bn="table">`, `<thead>` with `scope="col"` headers, one `<tr>`
 * per row with escaped text cells, and the empty-state row. Its cells are
 * text only — there is no per-column render slot — so composite cells (a
 * primary line plus a muted secondary line, a `<time>`, a status badge, a
 * row-action button) are applied after mount: a column may give a
 * `cell(row, td)` decorator that replaces the escaped text with DOM nodes.
 *
 * Row actions are buttons carrying `data-action` / `data-id` and are handled
 * by delegation on the stable host (`onRowAction`), so re-rendering the rows
 * on every signal change never re-binds a listener. A column with `href`
 * wraps its cell in a real `<a>` — the row's way to its detail route.
 */

import { renderTable } from '@basenative/components';
import { clear, delegate, el, type Cleanup } from '../../lib/dom.js';
import { fromHtml } from '../../lib/html.js';

export interface TableColumn<T> {
  readonly key: string;
  readonly label: string;
  /** Plain text the renderer escapes into the cell. */
  readonly value: (row: T) => string;
  /** Optional DOM decoration that replaces the cell's text. */
  readonly cell?: (row: T, td: HTMLTableCellElement) => void;
  /**
   * Make the cell a link to the row's own page (`/leads/:id`, say). The
   * cell's content — text or `cell` decoration — is wrapped in an `<a>`,
   * so the row is reached by Tab and Enter like any other link; no click
   * handler on the `<tr>` (CLAUDE.md rule 15).
   */
  readonly href?: (row: T) => string;
  /**
   * Column alignment. Money and counts are set `'end'` so a column of
   * figures lines up on its last digit — with `font-variant-numeric:
   * tabular-nums` from the base layer, a total is then scannable down the
   * column instead of ragged.
   */
  readonly align?: 'start' | 'end';
}

export interface MountTableOptions<T> {
  readonly columns: readonly TableColumn<T>[];
  readonly rows: readonly T[];
  readonly caption?: string;
  readonly emptyMessage?: string;
}

/** Render the table into `host`, replacing whatever was there. */
export function mountTable<T>(
  host: HTMLElement,
  options: MountTableOptions<T>,
): void {
  const { columns, rows, caption, emptyMessage } = options;
  const fragment = fromHtml(
    renderTable({
      columns: columns.map(({ key, label }) => ({ key, label })),
      rows: rows.map((row) =>
        Object.fromEntries(columns.map((c) => [c.key, c.value(row)])),
      ),
      caption,
      emptyMessage,
    }),
  );
  // renderTable leaves a column with an empty label as a bare
  // `<th scope="col"></th>` (a row-action column, typically) — axe flags
  // that as an empty table header. Give it a visually-hidden accessible
  // name without changing the visible column.
  // Below 40rem the stylesheet re-lays the table out as stacked records
  // (see LIST_ROUTE_SHEET): `display: block/grid` on table elements drops
  // their implicit table semantics in every engine, so the roles are
  // written explicitly here and the layout change costs nothing in the
  // accessibility tree. Each cell also carries its column's label, which
  // the stacked layout renders as the row's field name.
  fragment.querySelector('table')?.setAttribute('role', 'table');
  // The caption names the table for assistive tech; every route that passes
  // one already prints the same words as the section's visible heading, so
  // it is not shown twice.
  fragment.querySelector('caption')?.setAttribute('data-bn-sr-only', '');
  for (const group of fragment.querySelectorAll('thead, tbody')) {
    group.setAttribute('role', 'rowgroup');
  }
  for (const row of fragment.querySelectorAll('tr')) {
    row.setAttribute('role', 'row');
  }

  const headerCells =
    fragment.querySelectorAll<HTMLTableCellElement>('thead th');
  columns.forEach((column, index) => {
    const th = headerCells[index];
    th?.setAttribute('role', 'columnheader');
    if (column.align === 'end') th?.setAttribute('data-bn-align', 'end');
    if (column.label.trim() !== '') return;
    th?.append(el('span', { 'data-bn-sr-only': '' }, 'Actions'));
  });
  const bodyRows = fragment.querySelectorAll<HTMLTableRowElement>('tbody tr');
  rows.forEach((row, index) => {
    const tr = bodyRows[index];
    if (!tr) return;
    columns.forEach((column, cellIndex) => {
      const td = tr.cells[cellIndex];
      if (!td) return;
      td.setAttribute('role', 'cell');
      if (column.label.trim() !== '') {
        td.setAttribute('data-bn-label', column.label);
      }
      if (cellIndex === 0) td.setAttribute('data-bn-primary-cell', '');
      if (column.align === 'end') td.setAttribute('data-bn-align', 'end');
      if (column.cell) column.cell(row, td);
      if (column.href) {
        const link = el('a', {
          href: column.href(row),
          'data-bn-row-link': '',
        });
        while (td.firstChild) link.append(td.firstChild);
        td.append(link);
      }
    });
  });
  clear(host);
  host.append(fragment);

  // On mobile, wide tables scroll horizontally inside this container; make
  // that scroll region keyboard-reachable (axe scrollable-region-focusable).
  const container = host.querySelector<HTMLElement>(
    '[data-bn="table-container"]',
  );
  if (container && container.scrollWidth > container.clientWidth) {
    container.setAttribute('tabindex', '0');
    container.setAttribute('aria-label', caption ?? 'Scrollable table');
  }
}

/** Replace a cell's escaped text with DOM children. */
export function fill(
  td: HTMLTableCellElement,
  ...children: (Node | string | null | undefined | false)[]
): void {
  clear(td);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    td.append(child);
  }
}

/** Primary line with an optional muted secondary line underneath. */
export function twoLines(
  primary: string,
  secondary?: string | null,
): HTMLElement[] {
  const nodes = [el('strong', {}, primary)];
  if (secondary) nodes.push(el('div', { 'data-bn-secondary': '' }, secondary));
  return nodes;
}

/** `<time datetime>` with a human label. */
export function timeCell(iso: string, label: string): HTMLElement {
  return el('time', { datetime: iso }, label);
}

export interface RowActionOptions {
  readonly action: string;
  readonly id: string;
  readonly label: string;
  readonly testId: string;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

/** A row-action button; routes react to it through `onRowAction`. */
export function actionButton(options: RowActionOptions): HTMLElement {
  return el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': options.variant ?? 'secondary',
      // Row actions draw compact so a table row stays 3rem tall, and carry
      // the hit expander so they still answer a gloved thumb at 44px.
      'data-bn-size': 'sm',
      'data-bn-tap': '',
      'data-action': options.action,
      'data-id': options.id,
      'data-testid': options.testId,
    },
    options.label,
  );
}

/**
 * Delegate clicks on `[data-action]` buttons inside `host` to `handler`.
 * Returns the listener cleanup.
 */
export function onRowAction(
  host: HTMLElement,
  handler: (action: string, id: string, button: HTMLElement) => void,
): Cleanup {
  return delegate(host, 'click', 'button[data-action]', (_event, button) => {
    handler(
      button.getAttribute('data-action') ?? '',
      button.getAttribute('data-id') ?? '',
      button,
    );
  });
}
