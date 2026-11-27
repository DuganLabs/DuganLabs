/**
 * The mark a contractor gets when they have not uploaded a logo.
 *
 * `mark.ts` already produced the *letters* (`initialsFor`) for the text
 * monogram `apps/tenant-site` draws in its nav and about block. What did not
 * exist was an **identity**: a letterform plus a colour that is the same in the
 * nav, on an invoice, and on the share card a crawler fetches. This file is
 * that identity, and it is the single definition every surface reads.
 *
 * ## Derived, not stored
 *
 * Nothing here is written to the database. There is no `generated_logo_url`
 * column and no backfill, because there is nothing to backfill: a mark is a
 * pure function of two fields the `workspaces` row already carries.
 *
 *   - **the colour comes from `slug`** — allocated once by `/api/auth/register`
 *     and never rewritten by any code path in this repo (checked: only that
 *     route's INSERT writes `workspaces.slug`). So the colour is minted at
 *     signup, exactly as a stored column would be, and a contractor who renames
 *     their business keeps the mark that is already on every card anyone has
 *     shared. That is the whole reason the seed is the slug and not the name:
 *     hashing the name would repaint a live identity on a rename.
 *   - **the letters come from `name`** — they have to follow a rename; they
 *     *are* the name.
 *
 * The tradeoff a stored column would have bought (one write at signup, every
 * reader unchanged) is not available for free anyway: an absolute URL written
 * into `workspaces.logo_url` would (a) destroy the one bit that distinguishes
 * "the contractor uploaded a logo" from "we drew one", which is the bit
 * `/api/branding` and every `logo_url ? … : …` branch in this repo reads, and
 * (b) be blocked in the browser on every micro-site page view, because
 * `apps/tenant-site` sends `img-src 'self' data:`. Deriving costs one function
 * call at render time and cannot go stale.
 *
 * ## Not Greenput's own mark
 *
 * `greenputMark` in `mark.ts` is the leaf: `GP_BRAND_LEAF` on `GP_BRAND_INK`.
 * A contractor's generated mark is a different object — a rounded tile of solid
 * colour with their initials cut out of it — and the palette below deliberately
 * contains neither of those two hexes, so no contractor's mark can be mistaken
 * for the platform's. `brand-identity.spec.ts` asserts that.
 */

import { GP_BRAND_INK, GP_BRAND_LEAF, GP_FONT_STACK } from './tokens.js';

/** One tile colourway. `id` is stable and appears in no URL — it is a token. */
export interface GpMarkVariant {
  readonly id: string;
  /** Tile fill. */
  readonly bg: string;
  /** Letterform colour. */
  readonly fg: string;
}

/**
 * Warm paper, not pure white — `--gp-ink-25`. Every variant uses it, so a wall
 * of generated marks reads as one family rather than fifteen unrelated logos.
 */
const MARK_FG = '#FBF9F5';

/**
 * The colourways, drawn from the deep steps of the five Greenput ramps in
 * `tokens.ts`.
 *
 * Only steps that clear 4.5:1 against `MARK_FG` are here. That rules out
 * `--gp-green-400` (the brand leaf, 2.58:1), `--gp-green-500` (3.74:1) and
 * `--gp-copper-500` (3.70:1) — a monogram is small text on a small tile in the
 * nav, not large-scale text, so the 3:1 large-text allowance does not apply.
 * `--gp-ink-900` is excluded for a different reason: it is `GP_BRAND_INK`, the
 * ground the platform's own leaf sits on.
 *
 * Fifteen colourways times the initials means two contractors collide only when
 * they share both, and the two are drawn from independent inputs (slug and
 * name).
 */
export const GP_MARK_PALETTE: readonly GpMarkVariant[] = Object.freeze([
  { id: 'green-600', bg: '#1F7A4D', fg: MARK_FG },
  { id: 'green-700', bg: '#17603C', fg: MARK_FG },
  { id: 'green-800', bg: '#11492E', fg: MARK_FG },
  { id: 'green-900', bg: '#0B3020', fg: MARK_FG },
  { id: 'copper-600', bg: '#9C5B12', fg: MARK_FG },
  { id: 'copper-700', bg: '#7D470C', fg: MARK_FG },
  { id: 'brick-500', bg: '#C0442F', fg: MARK_FG },
  { id: 'brick-600', bg: '#A5351F', fg: MARK_FG },
  { id: 'brick-700', bg: '#832917', fg: MARK_FG },
  { id: 'slate-500', bg: '#4A6B87', fg: MARK_FG },
  { id: 'slate-600', bg: '#395670', fg: MARK_FG },
  { id: 'slate-700', bg: '#2B4256', fg: MARK_FG },
  { id: 'ink-600', bg: '#45403A', fg: MARK_FG },
  { id: 'ink-700', bg: '#2E2A24', fg: MARK_FG },
  { id: 'ink-800', bg: '#1C1A16', fg: MARK_FG },
] as const satisfies readonly GpMarkVariant[]);

/** The workspace fields a mark is derived from. Nothing else is read. */
export interface GpBusinessRef {
  /** `workspaces.name`. */
  readonly name: string;
  /** `workspaces.slug` — nullable in both live databases. */
  readonly slug?: string | null;
}

/**
 * The third and fourth axes of a mark (GP-109). Initials × fifteen colourways
 * collided at the designed rate — `cascade-plumbing` and `clearwater-plumbing`
 * were byte-identical — so the tile also carries a TREATMENT (flat, a diagonal
 * split, a corner notch, a ring) and a SHAPE (rounded square or circle). Both
 * are read from different bit ranges of the same slug hash as the colourway,
 * so none of the three correlate, and none of them is a glyph — a name in a
 * script we ship no font for still gets every axis.
 */
export type GpMarkTreatment = 'split' | 'notch' | 'ring' | 'stripe';
export type GpMarkShape = 'rounded' | 'round';
export const GP_MARK_TREATMENTS: readonly GpMarkTreatment[] = Object.freeze([
  'split',
  'notch',
  'ring',
  'stripe',
]);
export const GP_MARK_SHAPES: readonly GpMarkShape[] = Object.freeze([
  'rounded',
  'round',
]);
/** Which way the treatment faces: quarter turns for a split, notch or
 *  stripe; for a ring, thin / thick / dashed / dotted. */
export type GpMarkOrientation = 0 | 1 | 2 | 3;

export interface GpGeneratedIdentity {
  /**
   * One or two characters from `[A-Z0-9]`, or `''` when neither the name nor
   * the slug offered a single Latin alphanumeric. Deliberately ASCII: the
   * rasterizer behind the share card is handed one Latin font, and a glyph it
   * does not have is drawn as *nothing at all* rather than as an error — so a
   * monogram in a script we cannot ship a font for would be an empty tile on
   * the card while looking fine in the browser. One mark on every surface is
   * worth more than a mark that is only right on one of them.
   */
  readonly initials: string;
  readonly variant: GpMarkVariant;
  readonly treatment: GpMarkTreatment;
  /** The treatment's colour: a SECOND colourway, never the tile's own. */
  readonly accent: GpMarkVariant;
  readonly shape: GpMarkShape;
  readonly orientation: GpMarkOrientation;
  /** What the colour was chosen from — the slug where there is one. */
  readonly seed: string;
}

/**
 * FNV-1a, 32-bit.
 *
 * Written out rather than imported because it has to give the same answer in
 * `apps/api` (workerd), `apps/tenant-site` (workerd) and Node, forever: the
 * colour of a live contractor's logo is decided by it. `Math.imul` keeps the
 * multiply in 32-bit signed range on every engine, and `>>> 0` puts it back
 * into unsigned; the naive `h * 0x01000193` loses precision past 2^53 and
 * drifts between engines.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Fold a seed to one canonical spelling before hashing it, so the same business
 * written two ways gets one mark. NFKC first (fullwidth and compatibility forms
 * collapse), then case, then whitespace runs.
 */
function canonicalSeed(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}

/**
 * The Latin alphanumerics a business name offers, accents folded away.
 *
 * NFKD splits "é" into "e" + U+0301 and `\p{M}` drops the mark, so "Ångström
 * Elektro" yields "AE" rather than nothing — the same fold
 * `libs/shared/utils/workspace-slug.ts` applies before slugifying, for the same
 * reason.
 */
function latinInitials(raw: string): string {
  const folded = raw.normalize('NFKD').replace(/\p{M}+/gu, '');
  const words = folded
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 0);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return '';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

/**
 * The mark for a workspace. Pure, total, and never throws — every input below
 * returns a drawable identity:
 *
 *   - `''`                   → no letters, tile only
 *   - `'🌿'`                  → no Latin alphanumeric in the name, so the slug
 *                              supplies the letters
 *   - 200 characters         → first and last word initials, as always
 *   - `'שרברב טוב'`           → same as the emoji case
 *   - `'!!!'`                → same as the emoji case
 *   - `'<script>x</script>'` → letters only: `SX`
 */
export function generatedIdentityFor(
  business: GpBusinessRef,
): GpGeneratedIdentity {
  const name = String(business.name ?? '');
  const slug = String(business.slug ?? '');

  // The slug is the seed wherever there is one: it is minted at signup and
  // never rewritten, so the colour survives a rename. Five rows in `greenput`
  // carry slug NULL (see migrations/015) and fall back to the name, which is
  // what a stored column would have been seeded from anyway.
  const seed = canonicalSeed(slug || name);
  // The colourway is the unsalted hash's low bucket — unchanged since the
  // palette shipped, because a live contractor's colour must not move. Every
  // other axis hashes the seed under its own salt: four independent draws,
  // so two businesses whose colourways happen to agree do not agree on the
  // rest by the same accident (bit-slicing one hash did exactly that — two
  // "…-fence" slugs matched on every slice at once).
  const index = fnv1a32(seed) % GP_MARK_PALETTE.length;
  const variant = GP_MARK_PALETTE[index] as GpMarkVariant;
  // The accent is one of the OTHER fourteen colourways.
  const accentOffset =
    1 + (fnv1a32(`accent:${seed}`) % (GP_MARK_PALETTE.length - 1));
  const accent = GP_MARK_PALETTE[
    (index + accentOffset) % GP_MARK_PALETTE.length
  ] as GpMarkVariant;
  const treatment = GP_MARK_TREATMENTS[
    fnv1a32(`treatment:${seed}`) % GP_MARK_TREATMENTS.length
  ] as GpMarkTreatment;
  const shape = GP_MARK_SHAPES[
    fnv1a32(`shape:${seed}`) % GP_MARK_SHAPES.length
  ] as GpMarkShape;
  const orientation = (fnv1a32(`turn:${seed}`) % 4) as GpMarkOrientation;

  const initials = latinInitials(name) || latinInitials(slug);

  return { initials, variant, accent, treatment, shape, orientation, seed };
}

/**
 * The treatment, as geometry clipped to the tile: plain fills in the accent
 * colourway, no text, so resvg and the browser agree on it exactly. Shared by
 * the standalone mark and the share card, which draws the same tile at
 * (x, y, size) inside a larger scene — `clipId` keeps the two clip paths
 * distinct when a document holds both.
 */
export function markTreatmentSvg(
  identity: Pick<
    GpGeneratedIdentity,
    'treatment' | 'accent' | 'shape' | 'orientation'
  >,
  x: number,
  y: number,
  size: number,
  clipId = 'gp-mark-clip',
): string {
  const radius = identity.shape === 'round' ? size / 2 : size * 0.22;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const clip = `<clipPath id="${clipId}"><rect x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" rx="${n(radius)}"/></clipPath>`;
  const fill = identity.accent.bg;
  const turn = ` transform="rotate(${identity.orientation * 90} ${n(x + size / 2)} ${n(y + size / 2)})"`;
  const on = `clip-path="url(#${clipId})"${turn}`;
  switch (identity.treatment) {
    case 'split':
      // One diagonal half in the accent: a diagonal that reads at 36px.
      return `<defs>${clip}</defs><polygon points="${n(x + size)},${n(y)} ${n(x + size)},${n(y + size)} ${n(x)},${n(y + size)}" fill="${fill}" ${on}/>`;
    case 'notch':
      // A corner cut.
      return `<defs>${clip}</defs><polygon points="${n(x + size * 0.58)},${n(y)} ${n(x + size)},${n(y)} ${n(x + size)},${n(y + size * 0.42)}" fill="${fill}" ${on}/>`;
    case 'stripe':
      // A band along one edge.
      return `<defs>${clip}</defs><rect x="${n(x)}" y="${n(y + size * 0.78)}" width="${n(size)}" height="${n(size * 0.22)}" fill="${fill}" ${on}/>`;
    case 'ring':
    default: {
      // A ring inset from the edge: thin, thick, dashed or dotted.
      const width = identity.orientation === 1 ? size * 0.09 : size * 0.05;
      const dash =
        identity.orientation === 2
          ? ` stroke-dasharray="${n(size * 0.16)} ${n(size * 0.08)}"`
          : identity.orientation === 3
            ? ` stroke-dasharray="${n(size * 0.02)} ${n(size * 0.1)}" stroke-linecap="round"`
            : '';
      return `<circle cx="${n(x + size / 2)}" cy="${n(y + size / 2)}" r="${n(size * 0.4)}" fill="none" stroke="${fill}" stroke-width="${n(width)}"${dash}/>`;
    }
  }
}

/** Escape for an XML/SVG attribute or text node. */
function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface GpMarkSvgOptions {
  /** Rendered size in px. Both the tile and the letters scale with it. */
  readonly size?: number;
  /** `role="img"` + this as the accessible name. Omitted ⇒ `aria-hidden`. */
  readonly title?: string;
  /**
   * Font stack. Defaults to the web stack; the rasterizer wants the single
   * family name it was handed buffers for (`'Archivo'`).
   */
  readonly fontFamily?: string;
}

/**
 * The mark as a standalone SVG document — the same drawing in an `<img>`, a
 * PDF, and as the tile on the share card.
 *
 * The baseline is computed, not delegated to `dominant-baseline: central`:
 * resvg's text support is not the browser's, and a vertical-centring property
 * it ignores would drop the letters onto the bottom edge of the tile in the
 * PNG while looking correct in Chrome. `y = centre + 0.35em` is the same
 * arithmetic in both.
 */
export function generatedMarkSvg(
  identity: GpGeneratedIdentity,
  options: GpMarkSvgOptions = {},
): string {
  const size = options.size ?? 48;
  const family = options.fontFamily ?? GP_FONT_STACK;
  const { initials, variant } = identity;
  const shape = identity.shape ?? 'rounded';

  // Drawn on a fixed 48-unit grid and scaled by width/height, so every caller
  // gets identical proportions and the radius stays a constant fraction.
  const grid = 48;
  const radius = shape === 'round' ? grid / 2 : grid * 0.22;
  // Two characters at 21 units fill the tile; one at 26 matches its weight.
  const fontSize = initials.length > 1 ? 21 : 26;
  const baseline = grid / 2 + fontSize * 0.35;

  const label =
    options.title === undefined || options.title === ''
      ? 'aria-hidden="true"'
      : `role="img" aria-label="${escapeXmlText(options.title)}"`;

  const letters =
    initials === ''
      ? ''
      : `<text x="${grid / 2}" y="${baseline}" text-anchor="middle"` +
        ` font-family="${escapeXmlText(family)}" font-size="${fontSize}"` +
        ` font-weight="800" letter-spacing="0.4" fill="${variant.fg}"` +
        `>${escapeXmlText(initials)}</text>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}"` +
    ` width="${size}" height="${size}" ${label}>` +
    `<rect width="${grid}" height="${grid}" rx="${radius}" fill="${variant.bg}"/>` +
    `${markTreatmentSvg(identity, 0, 0, grid, 't')}` +
    `${letters}</svg>`
  );
}

/**
 * Guard: the palette must never contain the platform's own two brand hexes.
 * Exported so both this library's spec and a consumer can assert it.
 */
export const GP_MARK_RESERVED_HEXES: readonly string[] = Object.freeze([
  GP_BRAND_INK,
  GP_BRAND_LEAF,
]);
