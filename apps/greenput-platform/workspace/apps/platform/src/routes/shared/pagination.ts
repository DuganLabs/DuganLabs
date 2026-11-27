/**
 * The one pager. Every list route renders it under its table so the 26th
 * row is reachable: `page` / `perPage` are the API's own query names
 * (CLAUDE.md "Query parameters (all list endpoints)") and `total` is the
 * `meta.total` every list endpoint already returns.
 *
 * The nav is `[data-bn-pagination]` with a `[data-bn-pagination-summary]`
 * span and Previous / Next buttons. It hides itself while everything fits
 * on one page, so a short list carries no chrome.
 */

import { effect, type Signal } from '@basenative/runtime';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { el, on, type Cleanup } from '../../lib/dom.js';

const PAGINATION_SHEET = defineSheet(`
[data-bn-pagination] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-block: var(--gp-space-3);
  gap: var(--gp-space-3);
  font-size: var(--gp-text-sm);
  color: var(--gp-text-muted);
}
[data-bn-pagination][hidden] { display: none; }
[data-bn-pagination] menu {
  display: flex;
  gap: var(--gp-space-2);
  list-style: none;
  margin: 0;
  padding: 0;
}
`);

/** The API's default page size (`paginate()` in apps/api/src/lib/response.ts). */
export const DEFAULT_PER_PAGE = 25;

export interface PaginationOptions {
  /** The current 1-indexed page. The route owns it and passes it to `list()`. */
  readonly page: Signal<number>;
  /** `meta.total` from the last response; a signal or computed. */
  readonly total: () => number;
  readonly perPage: number;
  /** Called with the page the user asked for. */
  readonly onPage: (page: number) => void;
  /** Prefix for the buttons' `data-testid`s: `<testId>-prev` / `<testId>-next`. */
  readonly testId: string;
  /** `aria-label` for the nav. */
  readonly label: string;
  /** What the rows are called in the summary ("60 leads"). */
  readonly noun?: string;
  /** Disables paging while the list is loading, so a click cannot skip a page. */
  readonly loading?: () => boolean;
}

export interface PaginationMount {
  readonly element: HTMLElement;
  readonly dispose: Cleanup;
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

export function mountPagination(options: PaginationOptions): PaginationMount {
  adoptSheet(PAGINATION_SHEET);
  const { page, total, perPage, onPage, testId, label } = options;
  const noun = options.noun ?? 'entries';

  const prevButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': `${testId}-prev`,
    },
    'Previous',
  ) as HTMLButtonElement;
  const nextButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': `${testId}-next`,
    },
    'Next',
  ) as HTMLButtonElement;
  const summary = el('span', { 'data-bn-pagination-summary': '' });
  const element = el(
    'nav',
    { 'data-bn-pagination': '', 'aria-label': label, hidden: true },
    summary,
    el('menu', {}, el('li', {}, prevButton), el('li', {}, nextButton)),
  );

  const cleanups: Cleanup[] = [
    on(prevButton, 'click', () => {
      const current = page.peek();
      if (current > 1) onPage(current - 1);
    }),
    on(nextButton, 'click', () => {
      const current = page.peek();
      if (current < pageCount(total(), perPage)) onPage(current + 1);
    }),
    effect(() => {
      const count = total();
      const current = page();
      const pages = pageCount(count, perPage);
      const busy = options.loading?.() ?? false;
      summary.textContent = `Page ${current} of ${pages} · ${count} ${noun}`;
      prevButton.disabled = current <= 1 || busy;
      nextButton.disabled = current >= pages || busy;
      // One page of rows needs no pager. `total` is 0 until the first
      // response lands, so the nav also stays out of the way while loading.
      element.toggleAttribute('hidden', count <= perPage);
    }).dispose,
  ];

  return {
    element,
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}
