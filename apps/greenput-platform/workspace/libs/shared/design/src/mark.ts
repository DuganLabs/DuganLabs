/**
 * The Greenput mark and the generated imagery that stands in for photography.
 *
 * Everything here is drawn, not licensed: the leaf is the org's own
 * `@basenative/favicon` greenput preset path rescaled from its 1024 grid to a
 * 24-unit viewBox, and the monogram is composed from a contractor's own
 * initials. No stock photograph ships in any Greenput surface.
 */

export interface MarkOptions {
  /** Rendered size in px. */
  readonly size?: number;
  /** Fill of the leaf body. */
  readonly leaf?: string;
  /** Colour of the stem and veins cut out of the leaf — normally the ground. */
  readonly cut?: string;
  readonly title?: string;
}

/**
 * The Greenput leaf. Used wherever Greenput itself is speaking: the platform
 * shell, greenput.com, and the "powered by" line on a contractor's site. A
 * contractor's own site leads with *their* mark, never this one.
 */
export function greenputMark(options: MarkOptions = {}): string {
  const {
    size = 24,
    leaf = 'var(--gp-mark)',
    cut = 'var(--gp-surface-ink)',
    title,
  } = options;
  const label = title
    ? `role="img" aria-label="${title}"`
    : 'aria-hidden="true"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ${label}><path d="M19.22 4.69C19.22 4.69 12.66 4.22 8.91 7.97C5.16 11.72 4.69 17.81 4.69 19.22C6.56 19.22 12.66 18.75 16.41 15C20.16 11.25 19.22 4.69 19.22 4.69Z" fill="${leaf}"/><path d="M18.28 5.63L6.56 18.75" stroke="${cut}" stroke-width="0.66" stroke-linecap="round"/><path d="M14.53 6.56L10.78 10.78M10.78 10.78L7.5 14.06" stroke="${cut}" stroke-width="0.42" stroke-linecap="round" opacity="0.7"/></svg>`;
}

/**
 * A contractor's stand-in mark when they have not uploaded a logo: their
 * initials cut into a leaf-green tile. Deterministic, generated at render
 * time, and better than showing every tenant the same generic tick.
 */
export function initialsFor(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

/**
 * A drawn "service drop" — the overhead line, weatherhead, meter and gable a
 * homeowner recognises as their own house. It carries the micro-site hero in
 * place of a stock photograph of a stranger in a hard hat.
 *
 * Intrinsic width/height are set as attributes, not just a viewBox: the
 * browser then reserves the right box before any stylesheet lands (no layout
 * shift next to the LCP headline), and the drawing is exempt from the
 * critical-CSS `svg:not([width]):not([height])` sizing fallback.
 */
export const HOUSE_LINE_SVG = `<svg viewBox="0 0 220 150" width="220" height="150" fill="none" aria-hidden="true" data-gp-house><path d="M20 148V70l52-40 52 40v78" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" opacity="0.85"/><path d="M8 78 72 28l64 50" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="58" y="96" width="28" height="52" stroke="currentColor" stroke-width="2" opacity="0.7"/><rect x="34" y="88" width="16" height="16" stroke="currentColor" stroke-width="2" opacity="0.55"/><rect x="94" y="88" width="16" height="16" stroke="currentColor" stroke-width="2" opacity="0.55"/><circle cx="132" cy="92" r="9" stroke="currentColor" stroke-width="2" opacity="0.8"/><path d="M132 83v-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.8"/><path d="M132 70c24 0 44 -6 66 -18" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.55"/><path d="M198 52v96" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/><path d="M188 58h20" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.7"/><path d="M0 148h220" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.4"/></svg>`;

/** A drawn bolt — the one piece of ornament the system allows itself. */
export const BOLT_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 2 4 13.5h6L9.5 22 20 10.5h-6.5L13.5 2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
