/**
 * Catch-all `*` route — mounted when the URL doesn't match anything in
 * `ROUTE_TABLE`. Previously the shell left `<main>` empty on an unknown
 * path, so a mistyped link or a stale bookmark looked like the app had
 * crashed. The shell sets `document.title` from this route's `meta.title`
 * the same way it does for every other route.
 */

import { appDocumentHref } from '@greenput/shared/utils';
import { el, type Cleanup } from '../../lib/dom.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import type { RouteView } from '../types.js';

const SHEET = defineSheet(`
[data-bn-route='not-found'] {
  min-height: 60vh;
  display: grid;
  place-items: center;
  padding: var(--gp-space-6);
  text-align: center;
}
[data-bn-route='not-found'] h1 {
  font-family: var(--gp-font-display);
  font-size: var(--gp-text-3xl);
  margin: 0 0 var(--gp-space-2);
}
[data-bn-route='not-found'] p {
  margin: 0 0 var(--gp-space-5);
  color: var(--gp-text-muted);
}
`);

export function renderNotFoundRoute(): RouteView {
  if (typeof location !== 'undefined') {
    const documents = appDocumentHref(
      location.hostname,
      location.pathname,
      location.search,
    );
    if (documents) location.replace(documents);
  }
  adoptSheet(SHEET);

  const root = el(
    'section',
    { 'data-bn-route': 'not-found', 'data-testid': 'not-found-route' },
    el('h1', {}, "We couldn't find that page"),
    el('p', {}, "The page you're looking for doesn't exist or may have moved."),
    el(
      'a',
      {
        href: '/dashboard',
        'data-bn-button': '',
        'data-bn-variant': 'primary',
      },
      'Back to dashboard',
    ),
  );

  const cleanups: Cleanup[] = [];

  return {
    element: root,
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}
