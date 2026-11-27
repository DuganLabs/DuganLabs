/**
 * Bridge between `@basenative/components` — pure `render*()` functions that
 * return HTML strings — and this app's imperative `el()` DOM tree.
 *
 * The architecture, decided once and applied to every adopted component:
 *
 *   1. A renderer produces the component *shell*: its markup, `data-bn`
 *      hooks and ARIA wiring. The app parses that string with `fromHtml()`
 *      and mounts the resulting nodes into the `el()` tree.
 *   2. HTML slots (`content`, `footer`, tab `content`, badge `content`, …)
 *      are documented upstream as "not escaped; pass trusted markup only".
 *      The app never puts data into them. It renders the slot empty and
 *      appends real DOM nodes (built with `el()` / `textContent`) into the
 *      slot element after mount, so a customer name or a note can never be
 *      parsed as HTML. Text-semantic fields (`label`, `title`, table cell
 *      values, …) are escaped by the renderer and are passed as-is.
 *   3. Events are handled by delegation on a stable container the app owns
 *      (`delegate()` in dom.ts); re-rendering a component on signal change
 *      swaps its child nodes only.
 */

/** Parse a rendered HTML string into a fragment owned by `document`. */
export function fromHtml(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return document.importNode(template.content, true);
}

/** The first element of a rendered string — the component's root node. */
export function elementFromHtml<T extends HTMLElement = HTMLElement>(
  html: string,
): T {
  const first = fromHtml(html).firstElementChild;
  if (!(first instanceof HTMLElement)) {
    throw new Error('elementFromHtml: the renderer returned no element');
  }
  return first as T;
}
