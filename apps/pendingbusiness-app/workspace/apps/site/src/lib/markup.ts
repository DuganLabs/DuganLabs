/**
 * Bridge between `@basenative/components`' string renderers and the DOM the
 * imperative views build.
 *
 * Every helper in the package returns HTML as a string, which is the right
 * shape for a server and an awkward one for a page that assembles nodes and
 * attaches listeners. Without a bridge each call site repeats the same
 * `<template>` dance, and the easy thing to do instead is to reach for
 * `document.createElement('button')` and hand-style it — which is exactly what
 * this app had been doing on /account.
 */
import { renderBadge, renderButton } from '@basenative/components';

/** Parse trusted markup from a package renderer into its single root element. */
export function fromHtml<T extends Element = HTMLElement>(html: string): T {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild as T;
}

export interface BnButtonOptions {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  type?: 'button' | 'submit' | 'reset';
  /** Raw attribute markup for the `<button>`; trusted, never user data. */
  attrs?: string;
  /** Plain text; set with `setAttribute`, so a value can never become markup. */
  ariaLabel?: string;
  onClick?: (event: MouseEvent) => void;
}

/**
 * A live `renderButton` element.
 *
 * `label` and `ariaLabel` are applied after parsing rather than handed to the
 * renderer's HTML slot or its `attrs` string, so a value can never arrive as
 * markup — these buttons are labelled with things like
 * `Rename passkey "<the user's own nickname>"`.
 */
export function bnButton(label: string, options: BnButtonOptions = {}): HTMLButtonElement {
  const { onClick, ariaLabel, ...renderOptions } = options;
  const button = fromHtml<HTMLButtonElement>(renderButton('', renderOptions));
  button.textContent = label;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

/** A live `renderBadge` element whose text is set as `textContent`, never markup. */
export function bnBadge(
  text: string,
  options: { variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' } = {},
): HTMLElement {
  const badge = fromHtml(renderBadge('', options));
  badge.textContent = text;
  return badge;
}
