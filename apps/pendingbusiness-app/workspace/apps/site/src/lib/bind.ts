/**
 * Tiny BaseNative-flavored DOM binding helpers.
 *
 * These wrap effects + targeted DOM updates so the rest of the site can
 * read like signal-driven UI: declare data signals at top of file, then
 * `bindText`, `bindList`, `bindAttr` to wire them into the static HTML.
 *
 * We don't use @basenative/runtime's `hydrate` / template directives here —
 * there's no SSR template step yet (`@basenative/server` isn't a dependency
 * of this app). Once that lands we can switch a lot of the templates over
 * to `@basenative/server` + `@basenative/runtime` hydrate, but the
 * *binding model* stays the same: signal in, DOM out, effect in the middle.
 */
import { effect, type Signal } from '@basenative/runtime';

type ReadableSignal<T> = Signal<T> | (() => T);

function read<T>(s: ReadableSignal<T>): T {
  return typeof s === 'function' ? s() : (s as unknown as () => T)();
}

/** Bind a signal/computed to an element's textContent. */
export function bindText(idOrEl: string | Element | null, source: ReadableSignal<string>): void {
  const el = resolve(idOrEl);
  if (!el) return;
  effect(() => {
    el.textContent = read(source);
  });
}

/** Bind a signal/computed to an attribute. Returns when value is null/undefined → removeAttribute. */
export function bindAttr(
  idOrEl: string | Element | null,
  attr: string,
  source: ReadableSignal<string | null | undefined>,
): void {
  const el = resolve(idOrEl);
  if (!el) return;
  effect(() => {
    const v = read(source);
    if (v == null) el.removeAttribute(attr);
    else el.setAttribute(attr, v);
  });
}

/** Toggle the `hidden` HTML attribute. */
export function bindHidden(idOrEl: string | Element | null, source: ReadableSignal<boolean>): void {
  const el = resolve(idOrEl);
  if (!el) return;
  effect(() => {
    if (read(source)) el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
  });
}

/**
 * Render a list signal into a container. The `keyed` callback returns the
 * fragment for one item; the container's children are replaced on every
 * change. Cheap and correct for PB's table sizes.
 */
export function bindList<T>(
  idOrEl: string | Element | null,
  source: ReadableSignal<readonly T[]>,
  render: (item: T, index: number) => Node,
  empty?: () => Node,
): void {
  const el = resolve(idOrEl);
  if (!el) return;
  effect(() => {
    const items = read(source);
    if (items.length === 0 && empty) {
      el.replaceChildren(empty());
      return;
    }
    el.replaceChildren(...items.map((item, i) => render(item, i)));
  });
}

/**
 * Convenience: build a `<td>`. `num` marks a numeric cell (`data-bn="num"`);
 * `label` is the column heading, stored as `data-label` so the stacked
 * mobile layout in styles.css can render it via `td::before` once the
 * `<thead>` is hidden.
 */
export function td(
  text: string,
  opts: { num?: boolean; colSpan?: number; label?: string } = {},
): HTMLTableCellElement {
  const cell = document.createElement('td');
  if (opts.num) cell.dataset.bn = 'num';
  if (opts.colSpan) cell.colSpan = opts.colSpan;
  if (opts.label) cell.dataset.label = opts.label;
  cell.textContent = text;
  return cell;
}

/** Build a `<tr>` from any number of `<td>` children. */
export function tr(...cells: HTMLTableCellElement[]): HTMLTableRowElement {
  const row = document.createElement('tr');
  for (const c of cells) row.append(c);
  return row;
}

function resolve(idOrEl: string | Element | null): Element | null {
  if (idOrEl == null) return null;
  if (typeof idOrEl !== 'string') return idOrEl;
  return document.getElementById(idOrEl);
}
