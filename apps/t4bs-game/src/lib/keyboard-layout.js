/* The play keyboard: QWERTY with ENTER and ⌫, because this is a game you
   type words into — a letter goes into the active word's next open tile,
   backspace takes it out, ENTER submits the word. (A letters-only layout
   shipped briefly with the reveal-a-letter experiment and was rejected
   with it.) */

import { renderKeyboard } from "@basenative/keyboard";

export const PLAY_LAYOUT = "qwerty";

/* SSR-safe markup for the same keyboard the client hydrates, so the first
   paint already shows the keys. The id is pinned so server and client emit
   one document. Disabled until hydration wires it. */
/**
 * Normalize upstream @basenative/keyboard markup for strict CSP and WCAG 2.5.3:
 * - Strip inline style="flex:1.5;" (moved to .bn-kb-key--wide in styles.css).
 * - Align visible text "ENT" -> "ENTER" with aria-label="ENTER key" so axe/Lighthouse
 *   label-content-name-mismatch passes.
 */
export function normalizeKeyboardHtml(html) {
  return html
    .replace(/\sstyle="flex:1\.5;"/g, "")
    .replace(
      /(data-kb-key="ENTER"[^>]*><span aria-hidden="true">)ENT(<\/span>)/,
      "$1ENTER$2",
    );
}

export function renderPlayKeyboard() {
  return normalizeKeyboardHtml(
    renderKeyboard({
      id: "play-kb",
      layout: PLAY_LAYOUT,
      primary: "ENTER",
      label: "On-screen keyboard",
      disabled: true,
    }),
  );
}
