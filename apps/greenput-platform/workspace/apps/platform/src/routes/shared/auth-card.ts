/**
 * The card on the ink band — the surface every signed-out screen uses.
 *
 * `/login` and `/recover` are one journey seen twice: a contractor who cannot
 * get in moves between them, and the two have to look like the same product
 * or the second one reads as a phishing page. This module owns the shared
 * chrome (grid, card, brand lockup, buttons, banners) so they cannot drift.
 *
 * Every hook is a `data-bn-*` attribute on semantic HTML — no classes.
 */

import { greenputMark } from '@greenput/shared/design';
import { defineSheet } from '../../styles/sheet.js';
import { el } from '../../lib/dom.js';

export const AUTH_CARD_SHEET = defineSheet(`
/* The first screen a contractor ever sees. It is the brand ink with the
   surveyor grid — the same band the app shell, greenput.com and every
   contractor micro-site open on — with one card on it. */
[data-bn-auth-screen] {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--gp-space-5);
  background-color: var(--gp-surface-ink);
  background-image: var(--gp-grid-on-ink);
}
[data-bn-auth-card] {
  background: var(--gp-surface);
  border-radius: var(--gp-radius-lg);
  border-block-start: 3px solid var(--gp-mark);
  padding: var(--gp-space-7) var(--gp-space-6);
  box-shadow: var(--gp-shadow-lg);
  width: min(24rem, 100%);
  display: grid;
  gap: var(--gp-space-4);
}
[data-bn-auth-brand] {
  display: flex;
  align-items: center;
  gap: var(--gp-space-3);
}
[data-bn-auth-brand] svg { flex: none; }
[data-bn-auth-brand] h1 {
  font-size: var(--gp-text-2xl);
  font-weight: var(--gp-weight-black);
  letter-spacing: var(--gp-tracking-tight);
  color: var(--gp-text-strong);
  margin: 0;
}
[data-bn-auth-card] p {
  margin: 0;
  color: var(--gp-text-muted);
  font-size: var(--gp-text-sm);
}
/* The step forms are the card's own rhythm continued inside a <form>: the
   card's gap stops at its children, so without this the label sits flush
   against the paragraph above it and the button against the input. */
[data-bn-auth-step] { display: grid; gap: var(--gp-space-4); }
[data-bn-auth-actions] { display: grid; gap: var(--gp-space-2); }
[data-bn-auth-card] [data-bn-button][data-bn-variant='primary'] {
  background: var(--gp-primary);
  color: var(--gp-primary-fg);
  border: none;
  border-radius: var(--gp-radius-md);
  min-block-size: var(--gp-control-h);
  padding: var(--gp-space-2) var(--gp-space-5);
  font-weight: var(--gp-weight-bold);
  font-size: var(--gp-text-base);
  letter-spacing: var(--gp-tracking-snug);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gp-space-2);
  transition: background var(--gp-motion-1);
}
[data-bn-auth-card] [data-bn-button][data-bn-variant='primary']:hover {
  background: var(--gp-primary-hover);
}
[data-bn-auth-card] [data-bn-button][data-bn-busy] {
  opacity: 0.6;
  cursor: progress;
}
[data-bn-auth-card] [data-bn-button][data-bn-variant='quiet'] {
  background: none;
  border: 0;
  padding: var(--gp-space-2);
  min-block-size: var(--gp-tap-min);
  color: var(--gp-primary-text);
  font: inherit;
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-semibold);
  cursor: pointer;
  text-align: center;
}
[data-bn-auth-card] [data-bn-button][disabled] { cursor: not-allowed; opacity: 0.5; }
[data-bn-auth-card] [data-bn-error] {
  background: var(--gp-dead-bg);
  border: 1px solid var(--gp-brick-100);
  color: var(--gp-dead-ink);
  padding: var(--gp-space-3);
  border-radius: var(--gp-radius-md);
  font-size: var(--gp-text-sm);
}
[data-bn-auth-card] [data-bn-notice] {
  background: var(--gp-surface-sunk);
  border: 1px solid var(--gp-rule);
  color: var(--gp-text);
  padding: var(--gp-space-3);
  border-radius: var(--gp-radius-md);
  font-size: var(--gp-text-sm);
}
[data-bn-auth-card] [data-bn-field] { display: grid; gap: var(--gp-space-2); }
[data-bn-auth-card] [data-bn-field] label {
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-semibold);
  color: var(--gp-text-strong);
}
[data-bn-auth-card] [data-bn-field] input {
  font: inherit;
  font-size: var(--gp-text-base);
  min-block-size: var(--gp-control-h);
  padding: var(--gp-space-2) var(--gp-space-3);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
  background: var(--gp-surface);
  color: var(--gp-text-strong);
}
[data-bn-auth-card] [data-bn-field] input:focus-visible {
  outline: 2px solid var(--gp-focus);
  outline-offset: 1px;
}
/* The 6-digit code. Wide tracking and a tabular face so a contractor reading
   a code off a phone screen in a van can see they typed it right. */
[data-bn-auth-card] [data-bn-field] input[data-bn-code] {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.4em;
  font-size: var(--gp-text-xl);
  text-align: center;
}
[data-bn-auth-footer] {
  font-size: var(--gp-text-sm);
  color: var(--gp-text-muted);
  text-align: center;
  padding-block-start: var(--gp-space-3);
  border-block-start: 1px solid var(--gp-rule);
  display: grid;
  gap: var(--gp-space-1);
}
[data-bn-auth-footer] a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: var(--gp-tap-min);
  padding-inline: var(--gp-space-1);
  color: var(--gp-primary-text);
  font-weight: var(--gp-weight-semibold);
}

/* A [hidden] element styled display:grid keeps winning the cascade against
   the UA default, so say it explicitly — see CLAUDE.md §10.4. */
[data-bn-auth-step][hidden],
[data-bn-auth-actions][hidden] { display: none; }
`);

export interface AuthCardArgs {
  /** The `<h1>`. Always the product name — this screen is the brand. */
  readonly heading: string;
  /** One sentence under it saying what this screen is for. */
  readonly lede: string;
  readonly testId: string;
}

export interface AuthCard {
  /** The `<section>` to return as the route's element. */
  readonly root: HTMLElement;
  /** The `<article>` — append steps, actions and the footer here. */
  readonly card: HTMLElement;
  readonly lede: HTMLParagraphElement;
}

export function buildAuthCard(args: AuthCardArgs): AuthCard {
  const headingId = `${args.testId}-title`;

  const heading = el('h1', { id: headingId }, args.heading);
  const lede = el('p', {}, args.lede);

  const card = el(
    'article',
    { 'data-bn-auth-card': '' },
    el(
      'header',
      { 'data-bn-auth-brand': '' },
      // The org leaf, on paper — the same mark the shell behind it carries.
      htmlFragment(greenputMark({ size: 34, cut: 'var(--gp-surface)' })),
      heading,
    ),
    lede,
  );

  const root = el(
    'section',
    {
      'data-bn-auth-screen': '',
      'data-bn-route': args.testId,
      'aria-labelledby': headingId,
    },
    card,
  );

  return { root, card, lede };
}

export function htmlFragment(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}
