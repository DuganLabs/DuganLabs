/**
 * Greenput's design tokens — the single palette, type scale, spacing rhythm,
 * elevation and motion shared by `apps/platform`, `apps/tenant-site` and
 * `apps/marketing`.
 *
 * Colour, type, spacing rhythm, radii and materials are the Apple 27 kit
 * in `@basenative/platform` (`--bn-plat-*`). GreenPut's leaf is written
 * onto `--bn-plat-color-accent` by `platform.ts`. The warm ink ramp and the
 * four job-status families stay, because the kit's translucent labels miss
 * the contrast this sheet already promises and the kits have no status
 * pairing that clears those badges.
 *
 * The longer rationale for the ink and the status families lives in
 * `duganlabs-survey/greenput-visual-language.md`.
 *
 * Every ramp step below is committed to a hex value rather than a
 * `color-mix()` so its contrast ratio is a fact that can be computed and
 * tested (see `tokens.spec.ts`, which fails the build on any AA regression)
 * rather than something the browser derives at paint time.
 */

/** `#0F0E0C` — the org's brand black (`@basenative/favicon` greenput preset). */
export const GP_BRAND_INK = '#0F0E0C';
/** `#4EAF7C` — the org's brand accent, the leaf in the mark. */
export const GP_BRAND_LEAF = '#4EAF7C';

/**
 * Archivo: an American-gothic grotesque. One variable file (weights 400-800,
 * latin subset, ~35 KB) carries every register Greenput needs — van-lettering
 * headlines at 800, dense table text at 400, and micro-labels at 600 — so the
 * platform and the contractor micro-sites speak in one voice for one request.
 * It replaced a DM Sans + DM Serif Display pairing that cost two families and
 * whose didone display face read as fashion editorial rather than trade.
 */
export const GP_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@400..800&display=swap';

export const GP_FONT_STACK =
  "'Archivo', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * `<head>` markup that loads the family without blocking first paint.
 *
 * NO `media="print" onload="this.media='all'"`. That trick relies on an inline
 * event handler, and every Greenput surface sends a CSP with a nonce — under
 * which inline handlers do not run, `'unsafe-inline'` in script-src or not.
 * The link therefore stayed at `media="print"` forever and the family never
 * applied: greenput.com shipped in the fallback stack for as long as the trick
 * was there, while `getComputedStyle` still reported "Archivo" because that is
 * only the declared stack.
 *
 * The UI no longer requests it. `@basenative/platform` names SF Pro and
 * falls through to the system UI font, and a webfont on every page was the
 * one render-blocking request the marketing and tenant surfaces made.
 * `GP_FONT_HREF` and `GP_FONT_STACK` stay so the share-card rasterizer,
 * which embeds Archivo by family name, does not change. `GP_FONT_HEAD_HTML`
 * is empty on purpose: there is no stylesheet to defer, and an empty head
 * slot cannot grow an inline handler.
 */
export const GP_FONT_HEAD_HTML = '';

/**
 * The token layer. Emitted into `:root` unlayered so it also overrides
 * `@basenative/components`' own `@layer tokens` defaults where an app
 * bridges `--bn-*` onto these names.
 */
export const GP_TOKENS_CSS = `:root {
  color-scheme: light dark;

  /* ── Ink: a warm neutral ramp pulled off the brand black ${GP_BRAND_INK}.
     Hue ~40°, not the 220° blue-grey of a default dashboard — warm greys
     read as paper and workshop, cool greys read as enterprise software. */
  --gp-ink-900: ${GP_BRAND_INK};
  --gp-ink-800: #1C1A16;
  --gp-ink-700: #2E2A24;
  --gp-ink-600: #45403A;
  --gp-ink-500: #5C564D;
  --gp-ink-400: #7A7267;
  --gp-ink-300: #A79E91;
  --gp-ink-200: #CFC7B9;
  --gp-ink-150: #E2DBCE;
  --gp-ink-100: #EDE8DE;
  --gp-ink-50:  #F6F3EC;
  --gp-ink-25:  #FBF9F5;
  --gp-paper:   #FFFFFF;

  /* ── Green: the leaf ${GP_BRAND_LEAF} is step 400. It is a fill and a mark,
     never body text on paper (2.7:1). Text and buttons use 600/700. */
  --gp-green-50:  #E8F5EE;
  --gp-green-100: #CFEBDD;
  --gp-green-200: #A5D9BE;
  --gp-green-300: #78C79E;
  --gp-green-400: ${GP_BRAND_LEAF};
  --gp-green-500: #2F9160;
  --gp-green-600: #1F7A4D;
  --gp-green-700: #17603C;
  --gp-green-800: #11492E;
  --gp-green-900: #0B3020;

  /* ── Copper: work and money in motion. Warm, so it belongs to the same
     family as the ink instead of fighting it the way a stock amber would. */
  --gp-copper-50:  #FBF0E4;
  --gp-copper-100: #F6E0C6;
  --gp-copper-300: #E0A868;
  --gp-copper-500: #B9701B;
  --gp-copper-600: #9C5B12;
  --gp-copper-700: #7D470C;

  /* ── Brick: dead work. A fired-clay red, not an alarm red. */
  --gp-brick-50:  #FBEDEA;
  --gp-brick-100: #F6D8D2;
  --gp-brick-500: #C0442F;
  --gp-brick-600: #A5351F;
  --gp-brick-700: #832917;

  /* ── Slate: nothing has happened yet. Deep and desaturated so it reads as
     ink with a hint of blue, not as a corporate primary. */
  --gp-slate-50:  #ECF0F4;
  --gp-slate-100: #DAE2EA;
  --gp-slate-500: #4A6B87;
  --gp-slate-600: #395670;
  --gp-slate-700: #2B4256;

  /* ── Semantic surfaces — Apple 27 grouped materials. */
  --gp-bg: var(--bn-plat-color-backgrounds-grouped-primary);
  --gp-surface: var(--bn-plat-color-backgrounds-primary);
  --gp-surface-sunk: var(--bn-plat-color-backgrounds-secondary);
  --gp-surface-muted: var(--bn-plat-color-fills-vibrant-tertiary);
  --gp-surface-ink: var(--gp-ink-900);
  --gp-surface-ink-raised: var(--gp-ink-800);

  /* ── Semantic ink. Primary labels follow the kit (black / white).
     Muted and subtle stay on the warm ramp; see platform.ts. */
  --gp-text: var(--bn-plat-color-labels-primary);
  --gp-text-strong: var(--bn-plat-color-labels-primary);
  --gp-text-muted: var(--gp-ink-500);
  --gp-text-subtle: #6A645C;
  --gp-text-on-ink: var(--bn-plat-color-grays-white);
  --gp-text-on-ink-muted: var(--gp-ink-200);
  /* The faintest ink-band text there is. --gp-ink-400 is only 4.07:1 on the
     band — fine as a border, not as 11px type — so anything that has to be
     read on the ink stops here (7.3:1). */
  --gp-text-on-ink-subtle: var(--gp-ink-300);

  /* ── Lines. Rules carry structure here; shadow is reserved for things that
     genuinely float. --gp-border-control is darker than the decorative rule
     because WCAG 1.4.11 wants 3:1 on the boundary of an input or a button. */
  --gp-rule: var(--bn-plat-color-separators-opaque);
  --gp-rule-strong: var(--bn-plat-color-grays-gray-3);
  --gp-border-control: var(--gp-ink-400);
  --gp-rule-on-ink: #2A2620;

  /* ── Brand roles. The leaf stays the accent for icons, links, and the
     hero glow. A prominent button cannot use it: white on the leaf is
     2.71:1, and the ink label is what shipped on the green fill. The
     button fill steps to green-600 so white clears 4.5:1 (5.32:1). */
  --gp-primary: var(--gp-green-400);
  --gp-primary-hover: var(--gp-green-500);
  --gp-primary-fg: var(--gp-ink-900);
  --gp-button-fill: var(--gp-green-600);
  --gp-button-fill-hover: var(--gp-green-700);
  --gp-button-fg: #FFFFFF;
  --gp-primary-text: var(--gp-green-600);
  --gp-primary-tint: var(--gp-green-50);
  --gp-primary-on-ink: var(--gp-green-300);
  --gp-mark: var(--gp-green-400);
  --gp-focus: var(--gp-green-600);
  --gp-focus-on-ink: var(--gp-green-300);

  /* ── Signal families. The whole status system is four words a contractor
     learns once: grey has not started, copper is in motion, green is money
     in, brick is dead. Hue never carries the meaning alone — every use is
     paired with a written label. */
  --gp-idle-bg: var(--gp-slate-50);
  --gp-idle-line: var(--gp-slate-500);
  --gp-idle-ink: var(--gp-slate-700);
  --gp-move-bg: var(--gp-copper-50);
  --gp-move-line: var(--gp-copper-500);
  --gp-move-ink: var(--gp-copper-700);
  --gp-good-bg: var(--gp-green-50);
  --gp-good-line: var(--gp-green-500);
  --gp-good-ink: var(--gp-green-700);
  --gp-dead-bg: var(--gp-brick-50);
  --gp-dead-line: var(--gp-brick-500);
  --gp-dead-ink: var(--gp-brick-700);
  --gp-null-bg: var(--gp-ink-50);
  --gp-null-line: var(--gp-ink-300);
  --gp-null-ink: var(--gp-ink-600);

  /* Alert / feedback roles reuse the same four families. */
  --gp-success: var(--gp-green-600);
  --gp-warning: var(--gp-copper-600);
  --gp-danger: var(--gp-brick-600);
  --gp-info: var(--gp-slate-600);

  /* ── Type */
  --gp-font-sans: var(--bn-plat-font-family);
  /* Kept as an alias so any call site still asking for a "display" face gets
     the one family rather than a serif fallback. */
  --gp-font-display: var(--gp-font-sans);
  --gp-font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace;

  --gp-text-2xs: var(--bn-plat-font-caption-1-size);
  --gp-text-xs: var(--bn-plat-font-footnote-size);
  --gp-text-sm: var(--bn-plat-font-subheadline-size);
  --gp-text-base: var(--bn-plat-font-body-size);
  --gp-text-lg: var(--bn-plat-font-title-3-size);
  --gp-text-xl: var(--bn-plat-font-title-2-size);
  --gp-text-2xl: var(--bn-plat-font-title-1-size);
  --gp-text-3xl: var(--bn-plat-font-large-title-size);
  --gp-text-4xl: var(--bn-plat-font-large-title-size);
  /* Display step. 36px below the point where 4.4vw catches up, 56px once
     the viewport is wide. Large titles then cap that with the column so a
     narrow measure cannot wrap the hero onto a third line. */
  --gp-text-display: clamp(2.25rem, 4.4vw, 3.5rem);

  --gp-weight-regular: var(--bn-plat-weight-regular);
  --gp-weight-medium: var(--bn-plat-weight-medium);
  --gp-weight-semibold: var(--bn-plat-weight-semibold);
  --gp-weight-bold: var(--bn-plat-weight-bold);
  --gp-weight-black: var(--bn-plat-weight-heavy);

  --gp-leading-tight: 1.1;
  --gp-leading-snug: 1.3;
  --gp-leading-normal: 1.45;
  --gp-leading-loose: 1.6;

  --gp-tracking-tight: -0.022em;
  --gp-tracking-snug: -0.01em;
  --gp-tracking-label: 0.08em;

  /* ── Spacing: a 4px grid. */
  --gp-space-1: 0.25rem;
  --gp-space-2: 0.5rem;
  --gp-space-3: 0.75rem;
  --gp-space-4: 1rem;
  --gp-space-5: 1.25rem;
  --gp-space-6: 1.5rem;
  --gp-space-7: 2rem;
  --gp-space-8: 2.5rem;
  --gp-space-9: 3rem;
  --gp-space-10: 4rem;
  --gp-space-11: 5rem;
  --gp-space-12: 6rem;

  /* Stack rhythm. Minimums: title→lead 12px, lead→actions 20px,
     heading→content 24px, section→section 40px (64px from 48rem). */
  --gp-stack-title: var(--gp-space-3);
  --gp-stack-actions: var(--gp-space-5);
  --gp-stack-content: var(--gp-space-6);
  --gp-stack-section: var(--gp-space-8);
  /* One inset for a card's label, its stat rules, and its list hairlines.
     It clears the 22px corner, so the label does not sit in the curve. */
  --gp-card-inset: var(--gp-space-6);

  /* ── Hit targets. Visual size and hit size are separate on purpose: a row
     action can look 34px tall and still answer a gloved thumb at 44px
     through a transparent ::after expander. */
  --gp-tap-min: 2.75rem;
  --gp-control-h: 2.75rem;
  --gp-control-h-sm: 2.125rem;
  /* The prominent CTA. Named so apps/marketing's hero buttons stop carrying
     a literal 52px of their own. */
  --gp-control-h-lg: 3.25rem;
  --gp-row-h: 3rem;
  /* macOS-style toolbar. One fixed bar, compact controls, one gap. */
  --gp-toolbar-h: 3.25rem;
  --gp-toolbar-control: 2rem;
  --gp-toolbar-gap: var(--gp-space-2);
  /* The mark in a brand lockup. 36px sits inside the 44px tap target so
     the tile and the two-line name share one center. */
  --gp-mark-tile: 2.25rem;

  /* ── Radius. Capsule controls, continuous-corner cards, sheet corners. */
  --gp-radius-sm: 8px;
  --gp-radius-md: 12px;
  --gp-radius-lg: 22px;
  --gp-radius-xl: 34px;
  --gp-radius-full: 1000px;

  /* ── Elevation. sm / md / lg are the only drop shadows. Glass is the
     top highlight plus md — one material, no tinted second shadow. */
  --gp-shadow-sm: 0 1px 2px rgb(15 14 12 / 0.05);
  --gp-shadow-md: 0 6px 16px -4px rgb(15 14 12 / 0.10), 0 2px 4px -2px rgb(15 14 12 / 0.06);
  --gp-shadow-lg: 0 24px 48px -12px rgb(15 14 12 / 0.22);
  --gp-shadow-highlight: inset 0 1px 0 rgb(255 255 255 / 0.9);
  --gp-shadow-glass: var(--gp-shadow-highlight), var(--gp-shadow-md);
  --gp-shadow-ring: inset 0 0 0 1.5px var(--gp-primary);
  --gp-scrim: var(--bn-plat-color-overlays-default);

  /* Neutral glass. The fill is not mixed with the leaf. */
  --gp-glass-fill: color-mix(in srgb, var(--bn-plat-color-bg) 74%, transparent);
  --gp-glass-edge: color-mix(in srgb, white 72%, transparent);
  /* The phone capsule is denser than a card. 74% (and 58% in the dark)
     left the page readable through the bar. */
  --gp-capsule-fill: color-mix(in srgb, var(--bn-plat-color-bg) 92%, transparent);
  --gp-capsule-blur: 48px;
  /* The floating bar's own box, and how far it sits off the viewport edge.
     Content padding below the scrollport is this height plus the inset. */
  --gp-capsule-h: 4.25rem;
  --gp-capsule-inset: 0.75rem;
  /* Phone tab glyph. 28px is the iOS tab-bar draw size. The stroke is
     medium so an inactive icon still reads on the glass. */
  --gp-tab-icon: 1.75rem;
  --gp-tab-stroke: 2.25;
  /* A cluster control takes its own row below this, and grows to the
     column above it, so a short label cannot end before the headline. */
  --gp-cluster-min: 12.5rem;
  /* One faint glow. A wide ellipse eased to transparent, centered below
     the toolbar. A short ellipse with a hard stop bands on the dark field. */
  --gp-hero-glow: radial-gradient(ellipse 88% 46% at 50% 34%, color-mix(in srgb, var(--gp-primary) 5%, transparent) 0%, color-mix(in srgb, var(--gp-primary) 2%, transparent) 46%, transparent 100%);

  /* ── Motion: short, decelerating, and never decorative. A gloved thumb
     wants the result, not the transition. */
  --gp-motion-1: 100ms cubic-bezier(0.2, 0, 0, 1);
  --gp-motion-2: 160ms cubic-bezier(0.2, 0, 0, 1);
  --gp-motion-3: 240ms cubic-bezier(0.2, 0, 0, 1);

  --gp-z-back: -1;
  --gp-z-shell: 10;
  --gp-z-sticky: 40;
  --gp-z-overlay: 50;
  --gp-z-float: 70;
  --gp-z-skip: 80;
  --gp-z-toast: 100;

  /* ── Generated imagery. The only "photography" in the system is drawn by
     CSS: a surveyor's grid for dark bands and a hairline grid for paper. No
     stock photograph is ever shipped for a contractor we cannot license one
     for. */
  --gp-grid-on-ink:
    repeating-linear-gradient(0deg, rgb(255 255 255 / 0.045) 0 1px, transparent 1px 2rem),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.045) 0 1px, transparent 1px 2rem);
  --gp-grid-on-paper:
    repeating-linear-gradient(0deg, rgb(15 14 12 / 0.032) 0 1px, transparent 1px 2rem),
    repeating-linear-gradient(90deg, rgb(15 14 12 / 0.032) 0 1px, transparent 1px 2rem);

  accent-color: var(--gp-primary);
}

@media (min-width: 48rem) {
  :root { --gp-stack-section: var(--gp-space-10); }
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* Grouped primary and primary are both pure black in the dark kit.
       Secondary is the system background (28, 28, 30); tertiary is the
       elevated surface one step above it. */
    --gp-bg: var(--bn-plat-color-backgrounds-secondary);
    --gp-surface: var(--bn-plat-color-backgrounds-tertiary);
    --gp-glass-fill: color-mix(in srgb, var(--gp-surface) 88%, transparent);
    --gp-glass-edge: color-mix(in srgb, white 18%, transparent);
    --gp-shadow-highlight: inset 0 1px 0 rgb(255 255 255 / 0.22);
    --gp-capsule-fill: color-mix(in srgb, var(--gp-surface) 92%, transparent);
  }
}

:root[data-theme="dark"] {
  --gp-bg: var(--bn-plat-color-backgrounds-secondary);
  --gp-surface: var(--bn-plat-color-backgrounds-tertiary);
  --gp-glass-fill: color-mix(in srgb, var(--gp-surface) 88%, transparent);
  --gp-glass-edge: color-mix(in srgb, white 18%, transparent);
  --gp-shadow-highlight: inset 0 1px 0 rgb(255 255 255 / 0.22);
  --gp-capsule-fill: color-mix(in srgb, var(--gp-surface) 92%, transparent);
}`;

/**
 * Reset + base typography. Shared so a heading, a link, a focus ring and a
 * tap target behave identically in the field app and on a contractor's
 * storefront.
 */
export const GP_BASE_CSS = `*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: none; text-size-adjust: none; }
body {
  margin: 0;
  background: var(--gp-bg);
  color: var(--gp-text);
  font-family: var(--gp-font-sans);
  font-size: var(--gp-text-base);
  line-height: var(--gp-leading-normal);
  font-synthesis-weight: none;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, h4 {
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-tight);
  line-height: var(--gp-leading-tight);
  text-wrap: balance;
  margin: 0;
}
p { text-wrap: pretty; }
img, svg, video { display: block; max-inline-size: 100%; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }

/* Figures are tabular everywhere: money, counts and clock times line up in a
   column whether they are in a table, a KPI or a kanban card. */
[data-gp-figure], table td, table th, time, output {
  font-variant-numeric: tabular-nums;
}

:focus-visible {
  outline: 2px solid var(--gp-focus);
  outline-offset: 2px;
  border-radius: var(--gp-radius-sm);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    /* none, not a 0.01ms duration. transition-property starts as all, so a
       non-zero duration interpolates every property — including font-size —
       from the user-agent value. A size container resolves that first pass
       at 16px and the next frame is too late for the type gate. */
    transition-property: none !important;
    scroll-behavior: auto !important;
  }
}`;
