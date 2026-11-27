/**
 * Adopted-stylesheet helper. Each route or component declares its CSS as a
 * tagged template literal and we attach it to `document.adoptedStyleSheets`
 * exactly once per call site (keyed by identity).
 */

const adopted = new WeakSet<CSSStyleSheet>();

export function defineSheet(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

export function adoptSheet(
  sheet: CSSStyleSheet,
  target: Document = document,
): void {
  if (adopted.has(sheet)) return;
  target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  adopted.add(sheet);
}
