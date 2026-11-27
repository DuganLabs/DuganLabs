/**
 * The share card and the square mark, as SVG documents.
 *
 * These live in `apps/api` and not in `libs/shared/design` for one reason: the
 * rasterizer that turns them into PNGs (`@basenative/og-image`, which carries
 * `@resvg/resvg-wasm` — 2.4 MB of WASM, 926 KiB gzipped) must not become
 * reachable from `apps/tenant-site`'s module graph. `tenant-site` serves every
 * micro-site page view; an earlier attempt put the generator there and took
 * that Worker from 229 KiB to 1178 KiB gzipped, paying a cold start on every
 * page to render an image that changes when a contractor renames their
 * business. `apps/api` already owns workspace writes and is not a per-page hot
 * path.
 *
 * `libs/shared/design` keeps what both Workers genuinely share: the identity,
 * the facts, the version token and the URL. `tenant-site` imports those and
 * nothing from here.
 *
 * ## The scene's only input is the facts
 *
 * `shareCardSvg(facts, options)` draws from {@link ShareCardFacts} and nothing
 * else. `options` carries no new content: `logoDataUri` is the *bytes of*
 * `facts.logoUrl`, and `fontFamily` is a rendering detail. So every string on
 * the card is a field of `facts`, every field of `facts` is hashed into the URL
 * version, and a field cannot be added to the drawing without moving the URL.
 * `workspaces.phone` is not a field of `facts` and must never become one — see
 * the note in `libs/shared/design/src/brand-assets.ts`.
 */

import {
  clippedLine,
  escapeXml,
  headline,
  num,
  rect,
  svgDoc,
} from '@basenative/og-image';
import {
  GP_MARK_ASSET_SIZE,
  GP_SHARE_CARD_SIZE,
  markTreatmentSvg,
  type GpMarkOrientation,
  type GpMarkShape,
  type GpMarkTreatment,
  type ShareCardFacts,
} from '@greenput/shared/design';

/**
 * The family the rasterizer is handed buffers for. A stack (`'Archivo',
 * system-ui, …`) is meaningless to resvg — there are no system fonts on a
 * Worker — so the SVG names exactly one family.
 */
export const CARD_FONT_FAMILY = 'Archivo';

/**
 * Characters the shipped Archivo TTFs can actually draw.
 *
 * This exists because of what resvg does with the ones they cannot: it draws
 * the font's `.notdef` glyph — a hollow box — rather than nothing. A business
 * called "שרברב טוב" rendered as eight tofu boxes where its name should be, and
 * "🌿" as one. Measured, on workerd, at 1200x630, before this filter existed.
 *
 * ASCII printable, Latin-1 Supplement and Latin Extended-A/B (so "Ångström"
 * and "Ñuñez" survive intact), the general-punctuation dashes and quotes a
 * business name actually uses, currency, and the trademark sign. Deliberately
 * NOT `\p{Script=Common}`, which would let emoji through — U+1F33F is Common.
 *
 * The honest limit this encodes: a name in a script we ship no font for cannot
 * be drawn, and a per-script font subset is not something this Worker can fetch
 * for an arbitrary name. What it can do is never print a broken box — the card
 * falls back to the site's own hostname, which is ASCII by construction.
 */
const UNDRAWABLE =
  /[^\u0020-\u007E\u00A0-\u024F\u2010-\u2027\u2030-\u205E\u20A0-\u20BF\u2122]/gu;

/**
 * The part of `text` the shipped font can draw, whitespace collapsed. Removed
 * characters become a space rather than nothing, so "Reed\u{1F33F}HVAC" reads
 * as "Reed HVAC" rather than "ReedHVAC".
 */
export function drawableText(text: string): string {
  return text.replace(UNDRAWABLE, ' ').replace(/\s+/g, ' ').trim();
}

/** `--gp-ink-25`: the warm paper every Greenput surface is printed on. */
const PAPER = '#FBF9F5';
/** `--gp-ink-800` / `--gp-ink-500`. */
const INK = '#1C1A16';
const MUTED = '#5C564D';

export interface BrandSceneOptions {
  /**
   * A `data:image/...;base64,…` URI for the contractor's uploaded logo. Present
   * only when `facts.logoUrl` was fetched and passed every guard in
   * `routes/brand.ts`; absent means "draw the generated mark", which is also
   * what every failure falls back to.
   */
  readonly logoDataUri?: string;
  readonly fontFamily?: string;
}

/**
 * The mark, as scene children on a `size`-square box anchored at `x, y`.
 *
 * The generated tile is drawn here rather than reused from
 * `generatedMarkSvg` because that function emits a whole `<svg>` document with
 * its own viewBox, and a nested `<svg>` inside a rasterized document is a
 * different code path in resvg than plain geometry. The two drawings are pinned
 * to each other by `brand-card.spec.ts`, which renders both and compares the
 * fill and the letters.
 */
function markChildren(
  facts: ShareCardFacts,
  options: BrandSceneOptions,
  box: { x: number; y: number; size: number },
): string {
  const { x, y, size } = box;
  const family = options.fontFamily ?? CARD_FONT_FAMILY;

  if (options.logoDataUri !== undefined && options.logoDataUri !== '') {
    // The uploaded logo sits on a paper tile so a transparent PNG drawn on a
    // dark logo still has something to be seen against, and `meet` never crops
    // or stretches it — a contractor's own logo is the one thing on this card
    // we have no licence to redraw.
    return (
      rect({
        x,
        y,
        width: size,
        height: size,
        fill: '#FFFFFF',
        rx: size * 0.22,
      }) +
      `<image x="${num(x + size * 0.1)}" y="${num(y + size * 0.1)}"` +
      ` width="${num(size * 0.8)}" height="${num(size * 0.8)}"` +
      ` preserveAspectRatio="xMidYMid meet"` +
      ` href="${escapeXml(options.logoDataUri)}"/>`
    );
  }

  // The same tile the standalone mark draws (generatedMarkSvg): shape,
  // treatment, accent and orientation from the same identity, so the card
  // and the nav monogram are one drawing.
  const parts = [
    rect({
      x,
      y,
      width: size,
      height: size,
      fill: facts.markBg,
      rx: facts.markShape === 'round' ? size / 2 : size * 0.22,
    }),
    markTreatmentSvg(
      {
        treatment: facts.markTreatment as GpMarkTreatment,
        accent: { id: 'accent', bg: facts.markAccent, fg: facts.markFg },
        shape: facts.markShape as GpMarkShape,
        orientation: Number(facts.markOrientation) as GpMarkOrientation,
      },
      x,
      y,
      size,
      'gp-card-mark-clip',
    ),
  ];
  if (facts.initials !== '') {
    const fontSize = facts.initials.length > 1 ? size * 0.44 : size * 0.54;
    parts.push(
      // `dominant-baseline` is not used: resvg's text stack is not the
      // browser's, and a vertical-centring property it ignores would drop the
      // letters onto the tile's bottom edge in the PNG while looking right in
      // Chrome. The same `centre + 0.35em` arithmetic is in
      // `generatedMarkSvg`.
      `<text x="${num(x + size / 2)}" y="${num(y + size / 2 + fontSize * 0.35)}"` +
        ` text-anchor="middle" font-family="${escapeXml(family)}"` +
        ` font-size="${num(fontSize)}" font-weight="800"` +
        ` letter-spacing="${num(fontSize * 0.02)}" fill="${facts.markFg}"` +
        `>${escapeXml(facts.initials)}</text>`,
    );
  }
  return parts.join('');
}

/**
 * The 1200x630 share card.
 *
 * Every run is fitted to a width budget and the vertical stack is resolved
 * against the space between the mark and the footer rule, so no input can push
 * a run off the canvas or over another run. Every run is also passed through
 * {@link drawableText} first, so the font's `.notdef` box can never appear —
 * and when nothing of the business name survives that filter, the title falls
 * back to the site's own hostname, which is ASCII by construction. A card
 * always names somebody.
 */
export function shareCardSvg(
  facts: ShareCardFacts,
  options: BrandSceneOptions = {},
): string {
  const { width, height } = GP_SHARE_CARD_SIZE;
  const family = options.fontFamily ?? CARD_FONT_FAMILY;
  const pad = 72;
  const accent = facts.markBg;

  const parts: string[] = [
    rect({ x: 0, y: 0, width, height, fill: PAPER }),
    // A rule in the tenant's own colour along the top edge: the card is
    // personalised beyond the tile, and an otherwise text-only layout reads as
    // designed rather than as a rendering accident.
    rect({ x: 0, y: 0, width, height: 12, fill: accent }),
  ];

  const markSize = 132;
  const markTop = pad + 18;
  parts.push(
    markChildren(facts, options, { x: pad, y: markTop, size: markSize }),
  );

  // The footer is pinned to the bottom, so its box is computed before the
  // headline is laid out and the headline gets whatever is left.
  const footerSize = 30;
  const footerTop = height - pad - footerSize;
  const ruleY = footerTop - 34;
  const contentWidth = width - pad * 2;
  const stackTop = markTop + markSize + 46;
  const available = ruleY - 24 - stackTop;

  // Every run is filtered to what the font can draw; the title falls back to
  // the hostname when nothing of the name survives, so a card always names
  // somebody. See `drawableText`.
  const footer = drawableText(facts.host);
  const drawnName = drawableText(facts.name);
  const title = drawnName || footer;
  const showFooter = footer !== '' && footer !== title;
  const subtitle = [drawableText(facts.trade), drawableText(facts.area)]
    .filter((s) => s !== '')
    .join(' · ');

  // Progressively tighter line budgets until the stack fits. Width always fits
  // — `headline` shrinks for that — so this only has to settle height.
  let nameBlock = { svg: '', height: 0 };
  let subBlock = { svg: '', height: 0 };
  for (const maxLines of [2, 1]) {
    const nb =
      title === ''
        ? { svg: '', height: 0 }
        : headline({
            x: pad,
            y: stackTop,
            text: title,
            maxWidth: contentWidth,
            fontSize: 88,
            minFontSize: 44,
            maxLines,
            lineHeight: 1.08,
            fill: INK,
            fontFamily: family,
            weight: 800,
            tracking: -1.6,
          });
    const gap = title !== '' && subtitle !== '' ? 22 : 0;
    const sb =
      subtitle === ''
        ? { svg: '', height: 0 }
        : headline({
            x: pad,
            y: stackTop + nb.height + gap,
            text: subtitle,
            maxWidth: contentWidth,
            fontSize: 38,
            minFontSize: 28,
            maxLines: 1,
            lineHeight: 1.2,
            fill: MUTED,
            fontFamily: family,
            weight: 600,
          });
    nameBlock = { svg: nb.svg, height: nb.height };
    subBlock = { svg: sb.svg, height: sb.height };
    if (nb.height + gap + sb.height <= available) break;
  }

  parts.push(nameBlock.svg, subBlock.svg);
  // The rule is always drawn — it is the layout's bottom anchor, and a card
  // without it reads as a render that stopped halfway. The hostname UNDER it is
  // skipped only when the title already is the hostname, because a card that
  // prints the same string twice looks like a bug.
  parts.push(
    rect({
      x: pad,
      y: ruleY,
      width: contentWidth,
      height: 2,
      fill: accent,
      rx: 1,
    }),
  );
  if (showFooter) {
    parts.push(
      clippedLine({
        x: pad,
        y: footerTop,
        text: footer,
        maxWidth: contentWidth,
        fontSize: footerSize,
        fill: accent,
        fontFamily: family,
        weight: 600,
      }),
    );
  }

  return svgDoc({ width, height, children: parts.join('') });
}

/**
 * The square mark asset — 512x512, the same drawing as the card's tile.
 *
 * This is the "logo with a URL" the text monogram never was: what an email
 * body, a PDF header and Google's `LocalBusiness.logo` can point at.
 */
export function markAssetSvg(
  facts: ShareCardFacts,
  options: BrandSceneOptions = {},
): string {
  const { width, height } = GP_MARK_ASSET_SIZE;
  return svgDoc({
    width,
    height,
    children: markChildren(facts, options, { x: 0, y: 0, size: width }),
  });
}
