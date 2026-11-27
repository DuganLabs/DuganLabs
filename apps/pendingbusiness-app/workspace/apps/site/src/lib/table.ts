/**
 * Data-table view layer, built on `@basenative/components`' `renderTable`.
 *
 * Every ledger on the dashboard and in settings goes through here rather than
 * building `<tr>`/`<td>` by hand, so structure, escaping, the empty state and
 * the caption all stay the package's job.
 *
 * `renderTable` (0.9.0+) expresses everything a money table needs: column
 * `numeric` (right-aligned, `tabular-nums`, marked on the `<th>` as well as
 * the cells), `labelCells` (`data-label` on every body and footer cell for the
 * responsive stacked layout), `footer` rows (a `<tfoot>` whose first cell is a
 * `<th scope="row">`), `emptyContent` (an HTML empty state that can carry a
 * call to action) and `cellAttrs` (the `data-role` hooks the mobile record
 * transform promotes). PB used to add those in a DOM pass after rendering,
 * until the upstream release that shipped them; the pass is gone.
 *
 * What `finishTable()` still does after the render is the part the renderer
 * has no option for: a `<colgroup>` of fixed widths, a per-row `data-row`
 * variant, and `aria-busy` on the body while loading.
 */
import { renderTable, renderSkeleton, renderAlert, renderBadge } from '@basenative/components';
import { escapeAttr, escapeText } from '@basenative/runtime/shared/escape';
import { effect } from '@basenative/runtime';

/** One column of a ledger. */
export interface Column<T> {
  /** Stable key. Only used to address the column; cell content comes from `cell`. */
  key: string;
  /** Column heading. Also becomes each cell's `data-label` for the mobile transform. */
  label: string;
  /** Right-aligns the column and its heading, and switches figures to `tabular-nums`. */
  numeric?: boolean;
  /** The row's name. Becomes the card title in the mobile record transform. */
  identity?: boolean;
  /** The row's headline figure. Promoted next to the title on mobile. */
  primary?: boolean;
  /** Explicit column width, so a value change cannot reflow the table. */
  width?: string;
  /** Cell markup. HTML slot: escape anything interpolated (use `text()`/`figure()`). */
  cell: (row: T, index: number) => string;
  /** Markup for this column's `<tfoot>` cell. Omit for no total. */
  foot?: (rows: readonly T[]) => string;
}

export interface TableView<T> {
  columns: readonly Column<T>[];
  caption?: string;
  /** Plain-English sentence shown when there are no rows. */
  emptyMessage: string;
  /** Optional call to action rendered under the empty message. */
  emptyAction?: { href: string; label: string };
  /** Row label for the totals row. Omit to render no `<tfoot>`. */
  footLabel?: string;
  /** At most one row should ever qualify for `emphasis` (visual-language §5.7). */
  rowVariant?: (row: T, index: number) => 'emphasis' | 'muted' | undefined;
  /** How many skeleton rows to show while loading. Defaults to 4. */
  skeletonRows?: number;
}

export type TableState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void }
  | { status: 'ready'; rows: readonly T[] };

// ── cell content helpers ─────────────────────────────────────

/** Escaped plain text. */
export function text(value: string): string {
  return escapeText(value);
}

export type Tone = 'gain' | 'loss' | 'caution';

/**
 * A figure cell. `bar` (0..1) draws the magnitude rule beneath the value —
 * neutral ink, one hue, never coloured by magnitude (that would double-encode
 * length as colour; visual-language §5.8). The bar is `aria-hidden`; the
 * figure beside it is the accessible value.
 */
export function figure(
  value: string,
  opts: { bar?: number | undefined; tone?: Tone | undefined; note?: string | undefined } = {},
): string {
  const tone = opts.tone ? ` data-tone="${opts.tone}"` : '';
  let html = `<span data-fig${tone}><span data-fig-value>${escapeText(value)}</span>`;
  if (opts.note) html += `<span data-fig-note>${escapeText(opts.note)}</span>`;
  if (typeof opts.bar === 'number') {
    const v = Math.min(1, Math.max(0, opts.bar)).toFixed(4);
    html += `<span data-bar style="--v:${v}" aria-hidden="true"></span>`;
  }
  return `${html}</span>`;
}

/** The row's name, with an optional second line of qualifier. */
export function identity(name: string, qualifier?: string | undefined): string {
  let html = `<span data-ident><span data-ident-name>${escapeText(name)}</span>`;
  if (qualifier) html += `<span data-ident-meta>${escapeText(qualifier)}</span>`;
  return `${html}</span>`;
}

/**
 * A text badge. Always text, never a bare coloured dot — the badge *is* the
 * non-colour carrier that lets a state survive greyscale (visual-language
 * §3.4).
 */
export function badge(
  label: string,
  variant: 'default' | 'primary' | 'success' | 'warning' | 'error' = 'default',
): string {
  return renderBadge(escapeText(label), { variant });
}

/** A muted inline note, e.g. a type qualifier next to an identity. */
export function note(value: string): string {
  return `<span data-note>${escapeText(value)}</span>`;
}

// ── rendering ────────────────────────────────────────────────

type Row = Record<string, unknown>;

/**
 * The one footer row. `renderTable` reads footer rows through the same
 * `render` hook as the body, so the hook tells them apart by identity.
 */
const FOOT: Row = Object.freeze({ __foot: true });

/** `data-role` for the mobile record transform — on body cells only. */
function roleAttr<T>(col: Column<T>): string | undefined {
  if (col.identity) return 'data-role="identity"';
  if (col.primary) return 'data-role="primary"';
  return undefined;
}

function renderBody<T>(view: TableView<T>, state: TableState<T>): string {
  if (state.status === 'error') {
    const retry = state.retry
      ? ' <button type="button" data-retry data-bn="button" data-variant="secondary" data-size="sm">Retry</button>'
      : '';
    return renderAlert(`${escapeText(state.message)}${retry}`, { variant: 'error' });
  }

  const columns = view.columns;
  const caption = view.caption ? { caption: view.caption } : {};

  if (state.status === 'loading') {
    const n = view.skeletonRows ?? 4;
    const rows: Row[] = Array.from({ length: n }, () => ({ __skeleton: true }));
    return renderTable({
      ...caption,
      labelCells: true,
      columns: columns.map(col => ({
        key: col.key,
        label: col.label,
        ...(col.numeric ? { numeric: true } : {}),
        cellAttrs: () => roleAttr(col),
        render: () => renderSkeleton({ height: '0.75rem', width: col.numeric ? '4.5rem' : '60%' }),
      })),
      rows,
    });
  }

  // `renderTable`'s `render` hook passes the row but not its index, and
  // several cells need it (the avalanche rank, the S-Corp break-even rung).
  // One map beats an indexOf scan per cell.
  const indexOf = new Map<T, number>();
  state.rows.forEach((row, i) => indexOf.set(row, i));

  // Totals row, above the double rule — only when there is something to total.
  const hasFoot = Boolean(view.footLabel) && state.rows.length > 0 && columns.some(c => c.foot);

  // `emptyMessage` is text; the call to action makes it an HTML slot.
  const emptyContent = view.emptyAction
    ? `${escapeText(view.emptyMessage)}<span data-empty-action><a href="${escapeAttr(view.emptyAction.href)}">${escapeText(view.emptyAction.label)}</a></span>`
    : undefined;

  return renderTable({
    ...caption,
    emptyMessage: view.emptyMessage,
    ...(emptyContent ? { emptyContent } : {}),
    labelCells: true,
    columns: columns.map((col, i) => ({
      key: col.key,
      label: col.label,
      ...(col.numeric ? { numeric: true } : {}),
      cellAttrs: (_value: unknown, row: Row) => (row === FOOT ? undefined : roleAttr(col)),
      render: (_value: unknown, row: Row) => {
        if (row === FOOT) {
          // The first footer cell is the `<th scope="row">` carrying the label.
          if (i === 0) return escapeText(view.footLabel ?? '');
          return col.foot ? col.foot(state.rows) : '';
        }
        const typed = row as unknown as T;
        return col.cell(typed, indexOf.get(typed) ?? 0);
      },
    })),
    rows: state.rows as unknown as Row[],
    footer: hasFoot ? [FOOT] : [],
  });
}

/**
 * What the renderer has no option for: fixed column geometry, per-row
 * variants and the busy flag while loading.
 */
function finishTable<T>(root: ParentNode, view: TableView<T>, state: TableState<T>): void {
  const table = root.querySelector('table[data-bn="table"]');
  if (!table) return;

  // Fixed column geometry: a value going from $9,999 to $142,310 must not
  // reflow the table (visual-language §5.3).
  if (!table.querySelector('colgroup')) {
    const group = document.createElement('colgroup');
    for (const col of view.columns) {
      const c = document.createElement('col');
      if (col.width) c.style.width = col.width;
      group.append(c);
    }
    table.prepend(group);
  }

  if (state.status === 'ready' && view.rowVariant) {
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    state.rows.forEach((row, i) => {
      const variant = view.rowVariant?.(row, i);
      if (variant) bodyRows[i]?.setAttribute('data-row', variant);
    });
  }

  const body = table.querySelector('tbody');
  if (body) body.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
}

/**
 * Render a `TableView` into `target` and keep it in sync with `source`.
 *
 * `source` is read inside a `@basenative/runtime` effect, so any signal it
 * touches re-renders the table.
 */
export function bindTable<T>(
  target: string | Element | null,
  view: TableView<T>,
  source: () => TableState<T>,
): void {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;

  effect(() => {
    const state = source();
    el.innerHTML = renderBody(view, state);
    finishTable(el, view, state);
    if (state.status === 'error' && state.retry) {
      el.querySelector('[data-retry]')?.addEventListener('click', () => state.retry?.());
    }
  });
}
