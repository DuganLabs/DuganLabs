/**
 * Shared form-field wrapper: associates a visible `<label>` with its input
 * via `for`/`id` (or wraps the input in the label when no id is available)
 * so every control has an accessible name. Every route's `[data-bn-field]`
 * div should be built through this helper instead of pairing a bare
 * sibling `<label>` with an unrelated input.
 */

import { el } from '../../lib/dom.js';

let uid = 0;

export function field(
  label: string,
  input: HTMLElement,
  id?: string,
): HTMLElement {
  const inputId = id || input.id || `field-${(uid += 1)}`;
  input.id = inputId;
  return el(
    'div',
    { 'data-bn-field': '' },
    el('label', { for: inputId }, label),
    input,
  );
}
