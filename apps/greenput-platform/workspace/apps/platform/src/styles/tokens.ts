/**
 * The platform's token layer: Greenput's shared visual language
 * (`@greenput/shared/design`) plus the density knobs a field app needs and
 * the bridge that re-points `@basenative/components`' `--bn-*` names at it.
 *
 * The platform is used one-handed, in a van, in daylight, often with gloves.
 * That drives three decisions that differ from the micro-sites:
 *
 *   1. Density. Rows are 3rem, cards are 12-16px padded, and structure is
 *      carried by rules rather than by gaps between floating cards — so a
 *      screen holds a day's work instead of four numbers.
 *   2. Tap size. Every interactive element answers at 44px even where it
 *      draws smaller, via the `[data-bn-tap]` hit expander below.
 *   3. A dark shell. The header is the brand ink, which anchors the page,
 *      cuts the glare of a full-width white bar in sun, and makes the app
 *      unmistakably Greenput at arm's length.
 */

import {
  GP_BASE_CSS,
  GP_PLATFORM_CSS,
  GP_TOKENS_CSS,
  minifyCss,
} from '@greenput/shared/design';

export const TOKEN_CSS = `${GP_PLATFORM_CSS}
${GP_TOKENS_CSS}

/* ── Platform density ──────────────────────────────────────────────────── */
:root {
  --gp-shell-h: var(--gp-toolbar-h);
  --gp-gutter: var(--gp-space-4);
  --gp-pane-max: 92rem;
  --gp-stack: var(--gp-space-5);
}
@media (min-width: 48rem) {
  :root {
    --gp-gutter: var(--gp-space-6);
    --gp-stack: var(--gp-space-6);
  }
}

${GP_BASE_CSS}

html, body { min-height: 100dvh; }
body { line-height: var(--gp-leading-snug); }
a { color: var(--gp-primary-text); text-underline-offset: 0.15em; }

/* A gloved thumb gets 44px even where the control draws smaller. The
   expander is transparent, centred on the control, and never affects
   layout — so a table row can stay 3rem tall with 2.125rem buttons in it
   and still pass 2.5.8 Target Size. */
[data-bn-tap] { position: relative; }
[data-bn-tap]::after {
  content: '';
  position: absolute;
  inset: 50% 0 0 50%;
  translate: -50% -50%;
  min-width: var(--gp-tap-min);
  min-height: var(--gp-tap-min);
  width: 100%;
  height: 100%;
}

[data-bn-skip-link] {
  position: absolute;
  inset-inline-start: var(--gp-space-3);
  inset-block-start: var(--gp-space-3);
  /* The skip link is a control like any other and gets the 44px floor. */
  display: inline-flex;
  align-items: center;
  min-block-size: var(--gp-tap-min);
  padding: var(--gp-space-2) var(--gp-space-4);
  background: var(--gp-surface);
  color: var(--gp-text-strong);
  font-weight: var(--gp-weight-semibold);
  border-radius: var(--gp-radius-md);
  box-shadow: var(--gp-shadow-md);
  transform: translateY(-250%);
  z-index: var(--gp-z-overlay);
  transition: transform var(--gp-motion-2);
}
[data-bn-skip-link]:focus-visible { transform: translateY(0); }

[data-bn-sr-only] {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* ── @basenative/components bridge ─────────────────────────────────────────
   The components read \`--bn-*\` custom properties (see
   @basenative/components/tokens.css). This block is intentionally unlayered so
   it beats the package's \`@layer tokens\` defaults and re-points every
   semantic \`--bn-*\` name at the \`--gp-*\` palette above. Names without a
   Greenput equivalent (calendar knobs, zebra) keep upstream defaults. Keep
   this the only place that mentions \`--bn-*\`. */
:root {
  /* Surfaces */
  --bn-color-surface: var(--gp-surface);
  --bn-color-surface-subtle: var(--gp-bg);
  --bn-color-surface-muted: var(--gp-surface-sunk);
  --bn-color-surface-raised: var(--gp-surface);
  --bn-color-surface-inset: var(--gp-surface-sunk);
  --bn-color-surface-inverse: var(--gp-surface-ink);

  /* Text */
  --bn-color-text: var(--gp-text);
  --bn-color-text-muted: var(--gp-text-muted);
  --bn-color-text-subtle: var(--gp-text-subtle);
  --bn-color-text-inverse: var(--gp-text-on-ink);
  --bn-color-text-link: var(--gp-primary-text);

  /* Borders + focus */
  --bn-color-border: var(--gp-rule);
  --bn-color-border-strong: var(--gp-rule-strong);
  --bn-color-border-control: var(--gp-border-control);
  --bn-color-border-light: var(--gp-ink-100);
  /* Rows are separated by a rule, not by stripes — zebra banding fights the
     status rule on the start edge and makes a dense table noisier, not
     clearer. */
  --bn-color-zebra: transparent;
  --bn-color-border-focus: var(--gp-focus);
  --bn-focus-ring-color: var(--gp-focus);
  --bn-focus-ring: 0 0 0 2px var(--gp-surface), 0 0 0 4px var(--gp-focus);

  /* Brand scale — upstream aliases --bn-color-accent-* to these */
  --bn-color-primary-50: var(--gp-green-50);
  --bn-color-primary-100: var(--gp-green-100);
  --bn-color-primary-200: var(--gp-green-200);
  --bn-color-primary-300: var(--gp-green-300);
  --bn-color-primary-400: var(--gp-green-400);
  --bn-color-primary-500: var(--gp-green-500);
  --bn-color-primary-600: var(--gp-green-600);
  --bn-color-primary-700: var(--gp-green-700);
  --bn-color-primary-800: var(--gp-green-800);
  --bn-color-primary-900: var(--gp-green-900);

  /* Semantic status */
  --bn-color-success-500: var(--gp-green-500);
  --bn-color-success-600: var(--gp-success);
  --bn-color-warning-500: var(--gp-copper-500);
  --bn-color-warning-600: var(--gp-warning);
  --bn-color-error-500: var(--gp-brick-500);
  --bn-color-error-600: var(--gp-danger);
  --bn-color-error-fg: var(--gp-dead-ink);
  --bn-color-info-500: var(--gp-slate-500);
  --bn-color-info-600: var(--gp-info);
  --bn-color-success-50: var(--gp-good-bg);
  --bn-color-warning-50: var(--gp-move-bg);

  /* Alert surfaces */
  --bn-color-info-bg: var(--gp-idle-bg);
  --bn-color-info-border: var(--gp-slate-100);
  --bn-color-info-text: var(--gp-idle-ink);
  --bn-color-success-bg: var(--gp-good-bg);
  --bn-color-success-border: var(--gp-green-100);
  --bn-color-success-text: var(--gp-good-ink);
  --bn-color-warning-bg: var(--gp-move-bg);
  --bn-color-warning-border: var(--gp-copper-100);
  --bn-color-warning-text: var(--gp-move-ink);
  --bn-color-error-bg: var(--gp-dead-bg);
  --bn-color-error-border: var(--gp-brick-100);
  --bn-color-error-text: var(--gp-dead-ink);

  /* Badge surfaces — the signal families, whose inks are contrast-tested
     against their own tints in libs/shared/design/src/tokens.spec.ts. */
  --bn-color-success-badge-bg: var(--gp-good-bg);
  --bn-color-success-badge-text: var(--gp-good-ink);
  --bn-color-warning-badge-bg: var(--gp-move-bg);
  --bn-color-warning-badge-text: var(--gp-move-ink);
  --bn-color-error-badge-bg: var(--gp-dead-bg);
  --bn-color-error-badge-text: var(--gp-dead-ink);

  /* Selection */
  --bn-color-selected-bg: var(--gp-primary-tint);
  --bn-color-selected-text: var(--gp-good-ink);

  /* Typography */
  --bn-font-family: var(--gp-font-sans);
  --bn-font-size-xs: var(--gp-text-xs);
  --bn-font-size-sm: var(--gp-text-sm);
  --bn-font-size-base: var(--gp-text-base);
  --bn-font-size-lg: var(--gp-text-lg);
  --bn-font-size-xl: var(--gp-text-xl);
  --bn-font-size-2xl: var(--gp-text-2xl);
  --bn-font-size-3xl: var(--gp-text-3xl);

  /* Spacing */
  --bn-space-1: var(--gp-space-1);
  --bn-space-2: var(--gp-space-2);
  --bn-space-3: var(--gp-space-3);
  --bn-space-4: var(--gp-space-4);
  --bn-space-6: var(--gp-space-6);
  --bn-space-8: var(--gp-space-7);
  --bn-space-12: var(--gp-space-9);
  --bn-space-16: var(--gp-space-10);

  /* Radius ladder */
  --bn-radius-sm: var(--gp-radius-sm);
  --bn-radius-md: var(--gp-radius-md);
  --bn-radius-lg: var(--gp-radius-lg);
  --bn-radius-xl: var(--gp-radius-xl);
  --bn-radius-full: var(--gp-radius-full);
  --bn-radius-control: var(--gp-radius-md);
  --bn-radius-container: var(--gp-radius-lg);
  --bn-radius-modal: var(--gp-radius-lg);

  /* Elevation */
  --bn-shadow-sm: var(--gp-shadow-sm);
  --bn-shadow-md: var(--gp-shadow-md);
  --bn-shadow-lg: var(--gp-shadow-lg);
  --bn-shadow-modal: var(--gp-shadow-lg);

  /* Controls — 44px, because gloves. */
  --bn-control-height: var(--gp-control-h);
  --bn-control-height-sm: var(--gp-control-h-sm);

  /* Motion */
  --bn-transition-fast: var(--gp-motion-1);
  --bn-transition-normal: var(--gp-motion-2);
  --bn-transition-slow: var(--gp-motion-3);
  --bn-motion-fast: var(--gp-motion-1);
  --bn-motion-base: var(--gp-motion-2);
  --bn-motion-slow: var(--gp-motion-3);

  /* Overlays */
  --bn-scrim: var(--gp-scrim);
  --bn-z-dropdown: var(--gp-z-overlay);
  --bn-z-modal: var(--gp-z-overlay);
  --bn-z-toast: var(--gp-z-toast);
}
`;

let adopted = false;

export function adoptDesignTokens(target: Document = document): void {
  if (adopted) return;
  const sheet = new CSSStyleSheet();
  // The rationale above is for whoever opens this file, not for the browser.
  sheet.replaceSync(minifyCss(TOKEN_CSS));
  target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  adopted = true;
}

export function resetTokensForTesting(): void {
  adopted = false;
}
