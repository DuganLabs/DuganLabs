/**
 * Shared surface GreenPut pages are composed from.
 *
 * Tokens and the button / tab-bar hosts come from the published
 * `@basenative/platform` sheet. What that package does not yet provide —
 * a floating glass tab bar, metric tiles, inset cards, the page column,
 * large titles — is defined once here, translated from Puppertino 2.0
 * (MIT, Edgar Pérez; see NOTICE) into semantic `data-bn` markup.
 *
 * Trinity: the renderers and `SURFACE_CSS` live in this file. Pages must
 * not add a stylesheet of their own.
 *
 * Upstream candidates (not in @basenative/platform 2.1): bn-metric,
 * bn-card-grid, bn-info-card, bn-icon-tile, bn-column, bn-split, bn-cta,
 * bn-large-title, bn-kicker, bn-lead, bn-note, bn-panel, bn-steps,
 * bn-definitions, bn-checks, bn-inset-list, bn-badge, bn-field,
 * bn-scroll, bn-cluster, and `data-placement="floating"` on bn-tab-bar.
 */

const SYSTEM_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Liberation Sans", system-ui, sans-serif';

export const SURFACE_CSS = `
@layer tokens {
  :root {
    --page-gutter: var(--bn-plat-margin);
    --gp-font-system: ${SYSTEM_STACK};
  }

  :root[data-bn-platform="ios"] {
    --bn-plat-font-family: var(--gp-font-system);
  }
}

@layer components {
  /* First rule in the layer is a parser dummy so later selectors are not
     glued to the @layer prelude by the marketing contract walker. */
  html { color: inherit; }

  body {
    font-family: var(--gp-font-system);
    isolation: isolate;
  }

  /* The only viewport wash. Fixed, behind the page, one radial. */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: var(--gp-z-back);
    pointer-events: none;
    background-image: var(--gp-hero-glow);
  }

  [data-bn-column] {
    box-sizing: border-box;
    inline-size: 100%;
    max-inline-size: 72rem;
    min-inline-size: 0;
    margin-inline: auto;
    padding-inline: var(--page-gutter);
  }

  [data-bn="bn-skip"] {
    position: absolute;
    inset-inline-start: var(--page-gutter);
    inset-block-start: 0.5rem;
    z-index: var(--gp-z-skip);
    padding-inline: 0.75rem;
    min-block-size: var(--gp-tap-min);
    display: inline-flex;
    align-items: center;
    transform: translateY(-150%);
    background: var(--bn-plat-color-bg);
    border-radius: var(--gp-radius-full);
    box-shadow: var(--gp-shadow-md);
  }

  [data-bn="bn-skip"]:focus { transform: none; }

  /* One macOS toolbar: a fixed bar, every child on the same center,
     compact controls, the column's own inline edges. */
  [data-bn="bn-topbar"] {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--gp-z-sticky);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    block-size: var(--gp-toolbar-h);
    min-block-size: var(--gp-toolbar-h);
    max-block-size: var(--gp-toolbar-h);
    /* Same material as the floating capsule: frost, blur, and the glass
       elevation. The shadow separates the bar; there is no hard rule. */
    background: var(--gp-capsule-fill);
    backdrop-filter: saturate(180%) blur(var(--gp-capsule-blur));
    -webkit-backdrop-filter: saturate(180%) blur(var(--gp-capsule-blur));
    border: 0;
    box-shadow: var(--gp-shadow-glass);
  }

  /* One center for the mark, the links, and the controls. Block margins
     from the column stack cannot move a child: three attributes beat that
     rule even if the rail stops being excluded from the stack. */
  [data-bn="bn-topbar"] > [data-bn="bn-rail"][data-bn-column] > * {
    align-self: center;
    margin-top: 0;
    margin-block: 0;
  }

  [data-bn="bn-rail"] {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--gp-toolbar-gap);
    box-sizing: border-box;
    block-size: 100%;
    min-block-size: 0;
    max-block-size: 100%;
  }

  [data-bn="bn-brand"] {
    display: inline-flex;
    align-items: center;
    align-self: center;
    gap: var(--gp-space-2);
    margin-inline-end: auto;
    margin-block: 0;
    min-inline-size: 0;
    max-inline-size: 100%;
    min-block-size: var(--gp-tap-min);
    max-block-size: var(--gp-tap-min);
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0;
    text-decoration: none;
    color: inherit;
  }

  [data-bn="bn-brand"] b,
  [data-bn="bn-brand"] strong {
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-bn="bn-brand"] svg {
    display: block;
    flex: none;
  }

  [data-bn="bn-rail"] > a:not([data-bn="bn-button"]) {
    display: inline-flex;
    align-items: center;
    align-self: center;
    justify-content: center;
    box-sizing: border-box;
    min-block-size: var(--gp-tap-min);
    max-block-size: var(--gp-tap-min);
    min-inline-size: var(--gp-tap-min);
    margin-block: 0;
    padding-block: 0;
    padding-inline: 0.65rem;
    line-height: 1;
    border-radius: var(--gp-radius-full);
    text-decoration: none;
    text-align: center;
    color: inherit;
  }

  [data-bn="bn-rail"] > a[aria-current="page"]:not([data-bn="bn-button"]) {
    background: var(--gp-surface);
    color: var(--gp-primary-text);
    box-shadow: var(--gp-shadow-ring);
  }

  [data-bn="bn-tab-bar"][data-placement="floating"] {
    position: fixed;
    inset-inline-start: 50%;
    inset-block-end: max(var(--gp-capsule-inset), env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: var(--gp-z-float);
    display: flex;
    align-items: stretch;
    justify-content: center;
    box-sizing: border-box;
    inline-size: min(22.5rem, calc(100% - 1.5rem));
    max-inline-size: 22.5rem;
    min-block-size: var(--gp-capsule-h);
    margin: 0;
    padding-inline: 0.625rem;
    padding-block: 0.25rem;
    gap: 0;
    border-radius: var(--gp-radius-full);
    background: var(--gp-capsule-fill);
    backdrop-filter: saturate(180%) blur(var(--gp-capsule-blur));
    -webkit-backdrop-filter: saturate(180%) blur(var(--gp-capsule-blur));
    border: 1px solid var(--gp-glass-edge);
    box-shadow: var(--gp-shadow-glass);
  }

  [data-bn="bn-tab-bar"][data-placement="floating"] [data-bn="bn-tab"] {
    position: relative;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--gp-text);
    gap: 0.125rem;
    min-inline-size: 0;
    min-block-size: var(--gp-tap-min);
    padding-block: 0.2rem;
    padding-inline: 0.15rem;
    text-align: center;
    text-decoration: none;
    text-wrap: balance;
    font-size: 0.6875rem;
    font-weight: 590;
    line-height: 1.15;
    letter-spacing: 0;
    color: inherit;
  }

  [data-bn="bn-tab-bar"][data-placement="floating"] [data-bn="bn-symbol"] {
    display: block;
    flex: none;
    inline-size: var(--gp-tab-icon);
    block-size: var(--gp-tab-icon);
    stroke-width: var(--gp-tab-stroke);
  }

  [data-bn="bn-tab-bar"][data-placement="floating"] [data-bn="bn-tab"] small {
    font-size: 0.6875rem;
    font-weight: 590;
    line-height: 1.1;
  }

  /* The capsule is the only glass. The current tab is the accent color,
     not a second pill painted on the bar. */
  [data-bn="bn-tab-bar"][data-placement="floating"] [data-bn="bn-tab"][aria-current="page"] {
    color: var(--gp-primary-text);
  }

  [data-bn="bn-section"],
  [data-bn="bn-cta"] {
    padding-block: calc(var(--gp-stack-section) / 2);
  }

  [data-bn="bn-cta"] {
    text-align: center;
  }

  [data-bn="bn-section"] header,
  [data-bn="bn-split"] > header {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    min-inline-size: 0;
  }

  /* One stack. The general step is heading→content. Title→lead and
     lead→actions are tighter pairs from the same scale. */
  [data-bn-column]:not([data-bn="bn-split"], [data-bn="bn-rail"]) > * + *,
  [data-bn="bn-section"] header > * + *,
  [data-bn="bn-split"] > header > * + * {
    margin-block-start: var(--gp-stack-content);
  }

  [data-bn-column] > :is(h1, h2, [data-bn="bn-large-title"]) + [data-bn="bn-lead"],
  header > :is(h1, h2, [data-bn="bn-large-title"]) + [data-bn="bn-lead"],
  header > [data-bn="bn-kicker"] + :is(h1, h2, [data-bn="bn-large-title"]) {
    margin-block-start: var(--gp-stack-title);
  }

  [data-bn-column] > [data-bn="bn-lead"] + :is([data-bn="bn-cluster"], [data-bn="bn-button"]),
  header > [data-bn="bn-lead"] + :is([data-bn="bn-cluster"], [data-bn="bn-button"]) {
    margin-block-start: var(--gp-stack-actions);
  }

  /* A card title and its badge are one row, not a vertical stack. */
  li[data-bn="bn-info-card"] > header {
    display: flex;
    flex-flow: row nowrap;
    align-items: center;
    gap: 0.4rem 0.65rem;
    min-inline-size: 0;
  }

  li[data-bn="bn-info-card"] > header > :is(h3, strong) {
    min-inline-size: 0;
    flex: 1 1 0;
    text-wrap: wrap;
    /* A visible flex item sizes its text to the unwrapped line and then
       overflows. Hidden overflow is what makes the title wrap inside the
       space left beside the badge. */
    overflow: hidden;
  }

  li[data-bn="bn-info-card"] > header > * + * { margin-block-start: 0; }

  /* The column is the query container, so 9.2cqi is the size at which
     "The Operating System" still fits one line of that column. min() keeps
     the display step from overflowing a narrow measure into a third line. */
  :has(> [data-bn="bn-large-title"]) {
    container-type: inline-size;
  }

  [data-bn="bn-large-title"] {
    font-size: min(var(--gp-text-display), 9.2cqi);
    font-weight: 700;
    letter-spacing: var(--gp-tracking-tight);
    line-height: var(--gp-leading-tight);
    text-wrap: balance;
    margin: 0;
  }

  [data-bn="bn-section"] h2,
  [data-bn="bn-cta"] h2 {
    font-size: var(--gp-text-2xl);
    font-weight: var(--gp-weight-bold);
    letter-spacing: var(--gp-tracking-tight);
    line-height: var(--gp-leading-tight);
  }

  [data-bn="bn-info-card"] :is(h2, h3),
  [data-bn="bn-panel"] :is(h2, h3) {
    font-size: var(--gp-text-xl);
    font-weight: var(--gp-weight-bold);
    letter-spacing: var(--gp-tracking-tight);
    line-height: var(--gp-leading-tight);
  }

  [data-bn="bn-lead"] {
    font-size: var(--gp-text-lg);
    line-height: var(--gp-leading-snug);
    max-inline-size: 40rem;
    margin: 0;
    color: var(--gp-text-muted);
  }

  /* Running copy stays on the body step, same size as the lead or smaller.
     Kickers, notes and button rows keep their own sizes. */
  [data-bn-column] > p:not(
    [data-bn="bn-lead"],
    [data-bn="bn-kicker"],
    [data-bn="bn-note"],
    [data-bn="bn-cluster"]
  ) {
    font-size: var(--gp-text-base);
    line-height: var(--gp-leading-normal);
  }

  [data-bn="bn-kicker"] {
    font-size: var(--gp-text-2xs);
    font-weight: 590;
    letter-spacing: 0;
    text-transform: none;
    margin: 0;
    color: var(--gp-primary-text);
  }

  [data-bn="bn-note"] {
    font-size: var(--gp-text-sm);
    line-height: var(--gp-leading-snug);
    color: var(--gp-text-muted);
    max-inline-size: 40rem;
    margin: 0;
  }

  [data-bn-narrow] > * { max-inline-size: 40rem; }

  [data-bn-narrow] ul,
  [data-bn-narrow] ol {
    display: grid;
    gap: 0.5rem;
    padding-inline-start: 1.25rem;
  }

  [data-bn-narrow] li { min-inline-size: 0; }

  [data-bn="bn-cluster"] {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    margin: 0;
  }

  /* One control. Primary and secondary share the 44px height and the
     capsule radius. Variants change the fill, not the box. The toolbar
     rule below keeps its own compact size. */
  a[data-bn="bn-button"],
  button[data-bn="bn-button"],
  b[data-bn="bn-button"] {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    block-size: var(--gp-control-h);
    min-block-size: var(--gp-control-h);
    max-block-size: var(--gp-control-h);
    height: var(--gp-control-h);
    min-height: var(--gp-control-h);
    padding-block: 0;
    padding-inline: var(--gp-space-5);
    border-radius: var(--gp-radius-full);
    font-weight: var(--gp-weight-semibold);
    line-height: 1;
    border: 1.5px solid transparent;
    corner-shape: round;
  }

  [data-bn="bn-button"][data-variant="prominent"] {
    background: var(--gp-button-fill);
    color: var(--gp-button-fg);
    border-color: transparent;
  }

  [data-bn="bn-button"][data-variant="prominent"]:hover {
    background: var(--gp-button-fill-hover);
    color: var(--gp-button-fg);
  }

  /* Toolbar controls are 32px. The kit's large size is 50px and was
     filling the bar. Hit area stays on the text links; these are the
     compact pair at the trailing edge. */
  [data-bn="bn-topbar"] [data-bn="bn-button"] {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    align-self: center;
    justify-content: center;
    block-size: var(--gp-toolbar-control);
    min-block-size: var(--gp-toolbar-control);
    max-block-size: var(--gp-toolbar-control);
    min-height: var(--gp-toolbar-control);
    height: var(--gp-toolbar-control);
    margin-block: 0;
    padding-block: 0;
    padding-inline: var(--gp-space-3);
    line-height: 1;
    font-size: var(--gp-text-sm);
  }

  [data-bn="bn-button"][data-variant="bordered"] {
    background: color-mix(in srgb, var(--gp-primary) 10%, var(--gp-surface));
    color: var(--gp-primary-text);
    border-color: color-mix(in srgb, var(--gp-primary-text) 55%, var(--gp-surface));
  }

  /* Anchors keep the user-agent underline unless a control rule removes it.
     Capsules (buttons, tabs, the brand) are never underlined links. */
  a[data-bn="bn-button"],
  button[data-bn="bn-button"],
  [data-bn="bn-tab"],
  [data-bn="bn-brand"],
  [data-bn="bn-rail"] > a {
    text-decoration-line: none;
  }

  [data-bn="bn-cta"] [data-bn="bn-cluster"] { justify-content: center; }

  [data-bn="bn-split"] {
    display: grid;
    gap: var(--gp-stack-content);
    align-items: center;
  }

  [data-bn="bn-card-grid"] {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--gp-space-3);
    margin-inline: 0;
    margin-block-end: 0;
    padding: 0;
    list-style: none;
    min-inline-size: 0;
  }

  /* Column counts that divide the item count, so a row is never shorter
     than the one above it when a balanced count fits. These are viewport
     queries, not container queries: a size container on the column drops
     the stack margins of its own children at phone width. The grid is the
     full column, so the viewport is the grid's width plus the gutter. */
  @media (min-width: 36rem) {
    [data-bn="bn-card-grid"]:has(> :nth-child(2):last-child),
    [data-bn="bn-card-grid"]:has(> :nth-child(4):last-child),
    [data-bn="bn-card-grid"]:has(> :nth-child(6):last-child),
    [data-bn="bn-card-grid"]:has(> :nth-child(8):last-child) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 42rem) {
    [data-bn="bn-card-grid"]:has(> :nth-child(3):last-child),
    [data-bn="bn-card-grid"]:has(> :nth-child(6):last-child) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  [data-bn-column]:not([data-bn="bn-split"], [data-bn="bn-rail"]) > * + *,
  [data-bn="bn-section"] header > * + *,
  [data-bn="bn-split"] > header > * + * {
    margin-top: var(--gp-stack-content);
    margin-block-start: var(--gp-stack-content);
  }

  [data-bn-column] > :is(h1, h2, [data-bn="bn-large-title"]) + [data-bn="bn-lead"],
  header > :is(h1, h2, [data-bn="bn-large-title"]) + [data-bn="bn-lead"],
  header > [data-bn="bn-kicker"] + :is(h1, h2, [data-bn="bn-large-title"]) {
    margin-top: var(--gp-stack-title);
    margin-block-start: var(--gp-stack-title);
  }

  [data-bn-column] > [data-bn="bn-lead"] + :is([data-bn="bn-cluster"], [data-bn="bn-button"]),
  header > [data-bn="bn-lead"] + :is([data-bn="bn-cluster"], [data-bn="bn-button"]) {
    margin-top: var(--gp-stack-actions);
    margin-block-start: var(--gp-stack-actions);
  }

  li[data-bn="bn-info-card"] > header > * + * {
    margin-top: 0;
    margin-block-start: 0;
  }

  [data-bn="bn-info-card"],
  [data-bn="bn-panel"] {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    min-inline-size: 0;
    padding-block: var(--gp-card-inset);
    padding-inline: var(--gp-card-inset);
    border-radius: var(--gp-radius-lg);
    background-color: var(--gp-glass-fill);
    background-image: none;
    backdrop-filter: saturate(180%) blur(30px);
    -webkit-backdrop-filter: saturate(180%) blur(30px);
    border: 1px solid var(--gp-glass-edge);
    box-shadow: var(--gp-shadow-glass);
  }

  [data-bn="bn-panel"] {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  /* The user agent indents a blockquote by 40px a side. Inside a panel
     that indent shrinks a phone card below the button's longest word. */
  blockquote[data-bn="bn-panel"] {
    margin: 0;
  }

  [data-bn="bn-info-card"][data-featured] {
    border-color: var(--gp-primary);
  }

  [data-bn="bn-icon-tile"] {
    display: inline-grid;
    place-items: center;
    flex: none;
    inline-size: 2rem;
    block-size: 2rem;
    overflow: hidden;
    border-radius: var(--gp-radius-sm);
    background: color-mix(in srgb, var(--gp-primary) 22%, var(--bn-plat-color-bg));
    color: var(--gp-primary-text);
    box-shadow: var(--gp-shadow-highlight);
  }

  [data-bn="bn-icon-tile"] svg {
    inline-size: 1.125rem;
    block-size: 1.125rem;
    max-inline-size: 1.125rem;
  }

  [data-bn="bn-metrics"] {
    display: grid;
    /* Groups of four (dashboard, Lighthouse) stay 2×2. auto-fit at ~7.25rem
       fitted three columns in the hero panel and left one tile alone. */
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    align-items: stretch;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  [data-bn="bn-metric"] {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    text-align: center;
    min-inline-size: 0;
    block-size: 100%;
    margin: 0;
    padding-block: var(--gp-space-3);
    padding-inline: var(--gp-space-2);
    border-radius: var(--gp-radius-md);
    background: var(--bn-plat-color-fills-tertiary);
    box-shadow: var(--gp-shadow-highlight);
  }

  /* Stats inside a card are rows of that card, not a second bordered tile.
     A 2×2 group meets on hairline rules, the way a grouped list does. */
  :is([data-bn="bn-panel"], [data-bn="bn-info-card"]) [data-bn="bn-metrics"] {
    gap: 0;
  }

  :is([data-bn="bn-panel"], [data-bn="bn-info-card"]) [data-bn="bn-metric"] {
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    border-block-end: 1px solid var(--gp-rule);
    border-inline-end: 1px solid var(--gp-rule);
  }

  :is([data-bn="bn-panel"], [data-bn="bn-info-card"]) [data-bn="bn-metric"]:nth-child(2n) {
    border-inline-end-width: 0;
  }

  :is([data-bn="bn-panel"], [data-bn="bn-info-card"]) [data-bn="bn-metric"]:nth-child(n + 3) {
    border-block-end-width: 0;
  }

  [data-bn="bn-metric"] strong {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: 0.15rem 0.35rem;
    font-size: var(--gp-text-xl);
    font-weight: 590;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  [data-bn="bn-metric"] strong b {
    font-size: var(--gp-text-2xs);
    font-weight: 700;
    line-height: 1;
  }

  [data-bn="bn-metric"] small {
    display: block;
    inline-size: 100%;
    margin: 0;
    text-align: center;
    white-space: nowrap;
    text-wrap: nowrap;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.625rem;
    font-weight: 590;
    line-height: 1.2;
  }

  [data-bn="bn-steps"] {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }

  [data-bn="bn-step"] {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.35rem 0.75rem;
    align-items: start;
    min-inline-size: 0;
  }

  [data-bn="bn-step"] > :not(:first-child) {
    grid-column: 2;
    min-inline-size: 0;
  }

  [data-bn="bn-definitions"] { display: grid; gap: 1rem; margin: 0; }
  [data-bn="bn-definitions"] dt { font-weight: 700; }
  [data-bn="bn-definitions"] dd { margin: 0; color: var(--gp-text-muted); }

  [data-bn="bn-checks"] {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }

  [data-bn="bn-checks"] li {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    min-inline-size: 0;
  }

  [data-bn="bn-inset-list"] {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--gp-radius-md);
    background: color-mix(in srgb, var(--bn-plat-color-bg) 78%, transparent);
    border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }

  [data-bn="bn-inset-row"] {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    min-block-size: var(--gp-tap-min);
    padding-block: 0.55rem;
    padding-inline: 1rem;
    border-radius: 0;
    min-inline-size: 0;
    background: transparent;
    box-shadow: none;
    border-block-end: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  }

  [data-bn="bn-inset-row"]:last-child { border-block-end: 0; }

  [data-bn="bn-inset-row"] p {
    margin: 0;
    min-inline-size: 0;
  }

  /* Icon + title + detail (contact channels) stack the text beside the tile.
     A label + trailing badge stays a single flex row. */
  [data-bn="bn-inset-row"]:has(> [data-bn="bn-icon-tile"]) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
  }

  [data-bn="bn-inset-row"]:has(> [data-bn="bn-icon-tile"]) > :not(:first-child) {
    grid-column: 2;
    min-inline-size: 0;
  }

  [data-bn="bn-badge"] {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-inline-size: 1.75rem;
    min-block-size: 1.5rem;
    padding-inline: 0.55rem;
    border-radius: var(--gp-radius-full);
    background: var(--bn-plat-color-fills-tertiary);
    color: var(--gp-good-ink);
    font-size: 0.8125rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  [data-bn="bn-inset-row"] > [data-bn="bn-badge"] {
    margin-inline-start: auto;
  }

  [data-bn="bn-field-row"] {
    display: grid;
    gap: 0.75rem;
    border: 0;
    margin: 0;
    padding: 0;
    min-inline-size: 0;
  }

  [data-bn="bn-field"] {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin: 0;
    min-inline-size: 0;
  }

  [data-bn="bn-field"] input,
  [data-bn="bn-field"] select,
  [data-bn="bn-field"] textarea {
    inline-size: 100%;
    min-block-size: var(--gp-tap-min);
    padding-inline: 0.75rem;
    padding-block: 0.5rem;
    border-radius: var(--gp-radius-md);
    border: 1px solid var(--bn-plat-color-separator-opaque);
    background: color-mix(in srgb, var(--bn-plat-color-bg) 86%, transparent);
    box-shadow: var(--gp-shadow-highlight);
  }

  [data-bn="bn-scroll"] {
    overflow-x: auto;
    max-inline-size: 100%;
    margin: 0;
  }

  [data-bn="bn-scroll"]:focus-visible {
    outline: 2px solid var(--gp-primary);
    outline-offset: 2px;
  }

  [data-bn="bn-table"] {
    border-collapse: collapse;
    min-inline-size: 48rem;
  }

  [data-bn="bn-table"] th,
  [data-bn="bn-table"] td {
    text-align: start;
    padding-block: 0.5rem;
    padding-inline: 0.6rem;
    border-block-end: 1px solid var(--bn-plat-color-separator);
    white-space: nowrap;
  }

  [data-bn="bn-figure"] {
    margin: 0;
    border-radius: var(--gp-radius-lg);
    overflow: hidden;
    box-shadow: var(--gp-shadow-md);
  }

  [data-bn="bn-figure"] img {
    inline-size: 100%;
    block-size: auto;
    aspect-ratio: 16 / 10;
    object-fit: cover;
  }

  [data-bn="bn-site-footer"] {
    padding-block: var(--gp-stack-section);
    background: color-mix(in srgb, var(--bn-plat-color-bg) 84%, transparent);
    border-block-start: 1px solid var(--gp-glass-edge);
    box-shadow: var(--gp-shadow-highlight);
  }

  [data-bn="bn-site-footer"] > section[data-bn-column] {
    display: grid;
    gap: 1.5rem;
  }

  [data-bn="bn-site-footer"] a { color: var(--gp-primary-text); }
  [data-bn="bn-site-footer"] ul { list-style: none; margin: 0; padding: 0; }
  [data-bn="bn-site-footer"] h2 { font-size: var(--gp-text-sm); }

  [data-bn="bn-section"] a:not([data-bn="bn-button"]),
  [data-bn="bn-cta"] a:not([data-bn="bn-button"]) {
    color: var(--gp-primary-text);
  }

  [data-bn="bn-visually-hidden"] {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  [data-bn="bn-row"] {
    margin: 0;
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }

  [data-bn="bn-price"] {
    font-size: 1rem;
    font-weight: 590;
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }

  [data-bn="bn-price"] strong {
    display: block;
    font-size: 1.35rem;
    overflow-wrap: anywhere;
  }

  [data-bn="bn-panel"] header {
    display: grid;
    gap: var(--gp-stack-title);
    min-inline-size: 0;
  }

  code {
    overflow-wrap: anywhere;
  }

  @media (min-width: 40rem) {
    [data-bn="bn-field-row"] {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (min-width: 48rem) {
    [data-bn="bn-split"] { grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); }

    [data-bn="bn-split"][data-reverse] { direction: rtl; }

    [data-bn="bn-split"][data-reverse] > * { direction: ltr; }

    [data-bn="bn-site-footer"] > section[data-bn-column] {
      grid-template-columns: 1.4fr 1fr 1fr;
    }
  }

  /* The full rail fits on one line from 1024px. Below that, links and
     capsules hide (specificity matches the show rule, and this comes later)
     and the floating tab bar stays. A bare :not() loses to the show rule. */
  @media (max-width: 1023px) {
    [data-bn="bn-rail"] {
      flex-wrap: nowrap;
      min-block-size: 0;
    }

    [data-bn="bn-rail"] > a:not([data-bn="bn-brand"]) { display: none; }

    #main-content > section:first-child {
      padding-block-start: var(--gp-stack-section);
    }

    [data-bn="bn-split"] { gap: var(--gp-stack-title); }

    [data-bn="bn-metric"] strong { font-size: var(--gp-text-lg); }

    [data-bn="bn-inset-row"] {
      min-block-size: 1.75rem;
      padding-block: 0.15rem;
    }

    /* The capsule is position:fixed, so padding on the document only
       clears the last screen. The scrollport itself stops above the bar:
       its height is the viewport minus the capsule and the safe area. */
    html:has([data-bn="bn-tab-bar"][data-placement="floating"]) {
      block-size: 100%;
      overflow: hidden;
    }

    body:has([data-bn="bn-tab-bar"][data-placement="floating"]) {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      block-size: 100dvh;
      max-block-size: 100dvh;
      overflow: hidden;
      padding-block-end: calc(
        var(--gp-capsule-h) + max(var(--gp-capsule-inset), env(safe-area-inset-bottom, 0px))
      );
    }

    body:has([data-bn="bn-tab-bar"][data-placement="floating"]) > * {
      flex: none;
    }

    body:has([data-bn="bn-tab-bar"][data-placement="floating"]) > [data-bn="bn-page"] {
      flex: 1 1 0;
      min-block-size: 0;
      overflow: auto;
      padding-block-end: var(--gp-space-4);
    }
  }

  @media (min-width: 64rem) {
    body { padding-block-end: 0; }

    [data-bn="bn-rail"] { flex-wrap: nowrap; }

    [data-bn="bn-tab-bar"][data-placement="floating"] { display: none; }
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) [data-bn="bn-inset-list"] {
      background: color-mix(in srgb, var(--bn-plat-color-bg) 55%, transparent);
      border-color: var(--gp-glass-edge);
    }

    :root:not([data-theme="light"]) [data-bn="bn-inset-row"] {
      background: transparent;
      border-block-end-color: var(--gp-glass-edge);
    }

    :root:not([data-theme="light"]) [data-bn="bn-badge"] {
      background: var(--bn-plat-color-fills-tertiary);
      color: var(--gp-primary-on-ink);
    }
  }

  /* A list inside a panel is the panel's rows, not a second card.
     The dark rule above repaints every list; this comes later at the
     same specificity and wins for the nested one. */
  :root [data-bn="bn-panel"] [data-bn="bn-inset-list"] {
    background: transparent;
    border-width: 0;
    border-radius: 0;
    box-shadow: none;
  }

  /* Stat rules and list hairlines are the edges of the same content box,
     the card inset in from the border. A row's own inline padding would
     push its label past that line, so a nested row does not add any. */
  :root :is([data-bn="bn-panel"], [data-bn="bn-info-card"]) [data-bn="bn-inset-row"] {
    padding-inline: 0;
    border-block-end-color: var(--gp-rule);
  }
}
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPageHero(options: {
  id: string;
  headingHtml: string;
  lead: string;
  kicker?: string;
  actionsHtml?: string;
  note?: string;
  visualHtml?: string;
}): string {
  const headingId = `${options.id}-heading`;
  const articleAttr = options.visualHtml
    ? 'data-bn="bn-split" data-bn-column'
    : 'data-bn-column';
  const kicker = options.kicker
    ? `<p data-bn="bn-kicker">${escapeHtml(options.kicker)}</p>`
    : '';
  const actions = options.actionsHtml
    ? `<p data-bn="bn-cluster">${options.actionsHtml}</p>`
    : '';
  const note = options.note
    ? `<p data-bn="bn-note">${escapeHtml(options.note)}</p>`
    : '';
  const copy = `${kicker}<h1 data-bn="bn-large-title" id="${headingId}">${options.headingHtml}</h1><p data-bn="bn-lead">${escapeHtml(options.lead)}</p>${actions}${note}`;
  const inner = options.visualHtml
    ? `<header>${copy}</header>${options.visualHtml}`
    : copy;
  return `<section data-bn="bn-section" id="${options.id}" aria-labelledby="${headingId}"><article ${articleAttr}>${inner}</article></section>`;
}

export function renderInfoCard(options: {
  title: string;
  text?: string;
  bodyHtml?: string;
  iconSvg?: string;
  badge?: string;
}): string {
  const icon = options.iconSvg
    ? `<b data-bn="bn-icon-tile" aria-hidden="true">${options.iconSvg}</b>`
    : '';
  const badge = options.badge
    ? `<b data-bn="bn-badge">${escapeHtml(options.badge)}</b>`
    : '';
  const heading = badge
    ? `<header><h3>${escapeHtml(options.title)}</h3>${badge}</header>`
    : `<h3>${escapeHtml(options.title)}</h3>`;
  const body = options.bodyHtml
    ? options.bodyHtml
    : options.text
      ? `<p>${escapeHtml(options.text)}</p>`
      : '';
  return `<li data-bn="bn-info-card">${icon}${heading}${body}</li>`;
}

export function renderPlanCards(
  plans: ReadonlyArray<{
    name: string;
    priceLabel: string;
    tagline: string;
    featured: boolean;
    cta: string;
    ctaHref: string;
    features: readonly string[];
  }>,
): string {
  const items = plans
    .map((plan) => {
      const featured = plan.featured ? ' data-featured' : '';
      const badge = plan.featured
        ? '<p data-bn="bn-kicker">Core revenue model</p>'
        : '';
      const features = plan.features
        .map((feature) => `<li>${escapeHtml(feature)}</li>`)
        .join('');
      return `<li data-bn="bn-info-card"${featured}>${badge}<h3>${escapeHtml(plan.name)}</h3><p data-bn="bn-price">${escapeHtml(plan.priceLabel)}</p><p>${escapeHtml(plan.tagline)}</p><ul data-bn="bn-checks">${features}</ul><a data-bn="bn-button" data-variant="prominent" data-size="large" href="${escapeHtml(plan.ctaHref)}">${escapeHtml(plan.cta)}</a></li>`;
    })
    .join('');
  return `<ul data-bn="bn-card-grid">${items}</ul>`;
}

export function renderFaqList(
  items: ReadonlyArray<{ question: string; answer: string }>,
): string {
  const rows = items
    .map(
      (item) =>
        `<dt>${escapeHtml(item.question)}</dt><dd>${escapeHtml(item.answer)}</dd>`,
    )
    .join('');
  return `<dl data-bn="bn-definitions">${rows}</dl>`;
}

export function renderMetric(
  value: string,
  label: string,
  trend?: string,
): string {
  const extra = trend ? `<b>+${escapeHtml(trend)}%</b>` : '';
  return `<li data-bn="bn-metric"><strong>${escapeHtml(value)}${extra}</strong><small>${escapeHtml(label)}</small></li>`;
}

/** One inset grouped-list row: label on the line, count as a trailing badge. */
export function renderInsetRow(label: string, badge: string): string {
  return `<li data-bn="bn-inset-row"><p>${escapeHtml(label)}</p><b data-bn="bn-badge">${escapeHtml(badge)}</b></li>`;
}

/**
 * Phone tab bar. The published `renderBnTabBar` is a text label only, so
 * the symbol has to be composed here. `symbol` is a trusted SVG from this
 * repo, not caller text.
 */
export function renderFloatingTabs(options: {
  id?: string;
  label: string;
  tabs: ReadonlyArray<{
    label: string;
    href: string;
    current?: boolean;
    symbol: string;
  }>;
}): string {
  const id = options.id ? ` id="${escapeHtml(options.id)}"` : '';
  const tabs = options.tabs
    .map((tab) => {
      const current = tab.current ? ' aria-current="page"' : '';
      return `<a data-bn="bn-tab" href="${escapeHtml(tab.href)}"${current}>${tab.symbol}<small>${escapeHtml(tab.label)}</small></a>`;
    })
    .join('');
  return `<nav data-bn="bn-tab-bar" data-placement="floating" aria-label="${escapeHtml(options.label)}"${id}>${tabs}</nav>`;
}
