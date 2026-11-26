// Minimal CSS reading helpers for the token/contrast tests. Not a parser —
// just enough to pull custom-property values and declaration blocks out of
// the hand-written stylesheets in pages/css.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const repoFile = (rel) => fileURLToPath(new URL('../../' + rel, import.meta.url));
export const read = (rel) => readFileSync(repoFile(rel), 'utf8');

/**
 * Custom properties declared inside the first `:root` selector block that
 * matches `selectorIncludes`.
 * @returns {Map<string, string>}
 */
export function customProperties(css, selectorIncludes) {
  const blocks = declarationBlocks(css);
  const map = new Map();
  for (const block of blocks) {
    if (!block.selector.includes(selectorIncludes)) continue;
    for (const [, name, value] of block.body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
      map.set(name, value.trim());
    }
  }
  return map;
}

/** Every `selector { body }` pair in a stylesheet, at-rules flattened away. */
export function declarationBlocks(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

/** Resolve a token name through var() indirection within one theme. */
export function resolveToken(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error('circular token: ' + name);
  seen.add(name);
  const raw = tokens.get(name);
  if (raw === undefined) return undefined;
  const varRef = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varRef) return resolveToken(tokens, varRef[1], seen);
  return raw;
}

export function hexToRgb(hex) {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channel(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb) {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 2.x contrast ratio, rounded to 2dp. */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexToRgb(hexA));
  const b = relativeLuminance(hexToRgb(hexB));
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** The two theme palettes as declared in pages/css/tokens.css. */
export function themes() {
  const css = read('pages/css/tokens.css');
  const dark = customProperties(css, ':root[data-theme="dark"]');
  const light = new Map(dark);
  for (const [k, v] of customProperties(css, ':root[data-theme="light"]')) light.set(k, v);
  return { dark, light };
}
