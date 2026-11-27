/**
 * Shared CSS for list-style routes (`/leads`, `/jobs`, `/customers`,
 * `/vehicles`, `/campaigns`, `/plugins`, `/reviews`, `/opportunities`, …).
 * All hooks use `data-bn-*` attributes — no class selectors.
 *
 * The density rules here are the field app's whole argument. A route is a
 * single sheet of paper: one page head, one toolbar, then ruled rows. Cards
 * do not float on a grey ground with 24px of air between them — that pattern
 * puts four facts on a phone screen. Structure is carried by 1px rules and by
 * weight, and the surface only lifts for something that genuinely floats.
 *
 * Every interactive element still answers at 44px: `[data-bn-tap]`
 * (see styles/tokens.ts) expands the hit area of the 34px row buttons
 * without changing the row height.
 *
 * Routes opt in by `adoptSheet(LIST_ROUTE_SHEET)` once on mount.
 */

import { defineSheet } from './sheet.js';

export const LIST_ROUTE_SHEET = defineSheet(`
[data-bn-list-route] {
  display: grid;
  /* minmax(0, 1fr), not 1fr: a wide table or kanban board must scroll
     internally rather than push the document past the viewport. */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gp-space-5);
  padding: var(--gp-space-5) var(--gp-gutter) var(--gp-space-10);
  max-width: var(--gp-pane-max);
  margin: 0 auto;
  align-content: start;
}

/* ── Page head ──────────────────────────────────────────────────────────
   A ruled masthead rather than a floating title: the rule under it is the
   same hairline that separates every row below, so the page reads as one
   sheet. */
[data-bn-list-route] > header,
[data-bn-route-header] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--gp-space-3) var(--gp-space-4);
  padding-block-end: var(--gp-space-3);
  border-block-end: 1px solid var(--gp-rule);
}
[data-bn-list-route] > header h1,
[data-bn-route-header] h1 {
  font-size: var(--gp-text-2xl);
  font-weight: var(--gp-weight-black);
  letter-spacing: var(--gp-tracking-tight);
  color: var(--gp-text-strong);
  margin: 0;
  overflow-wrap: anywhere;
}
[data-bn-list-route] > header p,
[data-bn-route-header] p {
  margin: var(--gp-space-1) 0 0;
  color: var(--gp-text-muted);
  font-size: var(--gp-text-sm);
  max-width: 44ch;
}

[data-bn-toolbar] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gp-space-2);
}
/* Search takes the slack; the filters keep their own width instead of each
   claiming a full row (which is what a bare width:100% input did). */
[data-bn-toolbar] [data-bn-search] {
  flex: 1 1 14rem;
  min-width: 12rem;
}
[data-bn-toolbar] > select[data-bn-input],
[data-bn-toolbar] > input[data-bn-input]:not([data-bn-search]) {
  inline-size: auto;
  flex: 0 1 auto;
  min-inline-size: 9rem;
}

/* ── Controls ───────────────────────────────────────────────────────────
   Apple 27 fields: 44px tall, a 12px corner, and a 1px border that stays
   at least 3:1 on the grouped ground. The kit's tertiary fill has no
   stroke, which fails that boundary check, so the border stays. */
[data-bn-input] {
  width: 100%;
  min-block-size: var(--gp-control-h);
  padding: var(--gp-space-2) var(--gp-space-3);
  border: 1px solid var(--gp-border-control);
  border-radius: var(--gp-radius-md);
  background: var(--bn-plat-color-fills-tertiary);
  color: var(--gp-text);
  font: inherit;
  transition: border-color var(--gp-motion-1), box-shadow var(--gp-motion-1);
}
[data-bn-input]::placeholder { color: var(--gp-text-muted); }
[data-bn-input]:hover { border-color: var(--gp-ink-600); }
[data-bn-input]:focus-visible {
  outline: none;
  border-color: var(--gp-primary);
  box-shadow: 0 0 0 3px var(--gp-primary-tint);
}
[data-bn-input][aria-invalid='true'] { border-color: var(--gp-danger); }
textarea[data-bn-input] {
  min-height: 5.5rem;
  resize: vertical;
  line-height: var(--gp-leading-normal);
}
select[data-bn-input] { cursor: pointer; }

[data-bn-field] {
  display: grid;
  gap: var(--gp-space-1);
}
[data-bn-field] > label {
  font-size: var(--gp-text-xs);
  font-weight: var(--gp-weight-semibold);
  letter-spacing: 0;
  text-transform: none;
  color: var(--gp-text-muted);
}

/* Forms cap at three columns. auto-fit alone put six name-width inputs on
   one line at 1440px, which is a form you have to read across rather than
   down. */
[data-bn-field-grid] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: var(--gp-space-3) var(--gp-space-4);
}
@media (min-width: 60rem) {
  [data-bn-field-grid] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
[data-bn-panel] { max-width: 64rem; }

/* ── Buttons ────────────────────────────────────────────────────────────
   Capsule controls from the Apple 27 button: leaf fill and ink label for
   the one action, a tertiary fill for the alternative, borderless tint
   text for the rest. 44px is the floor; the kit's large size is 50px. */
[data-bn-button] {
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gp-space-2);
  min-block-size: var(--gp-control-h);
  font-weight: var(--gp-weight-semibold);
  font-size: var(--gp-text-sm);
  letter-spacing: var(--gp-tracking-snug);
  border-radius: var(--gp-radius-full);
  padding: var(--gp-space-2) var(--gp-space-4);
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
  transition: background var(--gp-motion-1), color var(--gp-motion-1),
    border-color var(--gp-motion-1);
}
[data-bn-button][hidden] { display: none; }
[data-bn-button] svg { inline-size: 1.125rem; block-size: 1.125rem; }
[data-bn-button][data-bn-variant='primary'] {
  background: var(--gp-primary);
  color: var(--gp-primary-fg);
}
[data-bn-button][data-bn-variant='primary']:hover {
  background: var(--gp-primary-hover);
}
[data-bn-button][data-bn-variant='secondary'] {
  background: var(--bn-plat-color-fills-tertiary);
  color: var(--gp-primary-text);
  border-color: transparent;
}
[data-bn-button][data-bn-variant='secondary']:hover {
  background: var(--gp-surface-sunk);
  border-color: transparent;
}
[data-bn-button][data-bn-variant='ghost'],
[data-bn-button][data-bn-variant='quiet'] {
  background: transparent;
  color: var(--gp-primary-text);
  padding-inline: var(--gp-space-3);
}
[data-bn-button][data-bn-variant='ghost']:hover,
[data-bn-button][data-bn-variant='quiet']:hover {
  color: var(--gp-primary-text);
  background: var(--gp-surface-sunk);
}
[data-bn-button][data-bn-variant='danger'] {
  background: var(--gp-danger);
  color: var(--gp-primary-fg);
}
[data-bn-button][data-bn-variant='danger']:hover {
  background: var(--gp-brick-700);
}
[data-bn-button][disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}
/* Row-level actions draw compact but keep a 44px hit area — see
   [data-bn-tap] in styles/tokens.ts. */
[data-bn-button][data-bn-size='sm'] {
  min-block-size: var(--gp-control-h-sm);
  font-size: var(--gp-text-xs);
  padding: var(--gp-space-1) var(--gp-space-3);
}

/* The components' neutral badge falls back to a border-coloured chip; give
   it the system's own "nothing here" surface instead. */
[data-bn="badge"][data-variant="default"] {
  background: var(--gp-null-bg);
  color: var(--gp-null-ink);
  box-shadow: inset 0 0 0 1px var(--gp-rule-strong);
}

/* ── Status badges ──────────────────────────────────────────────────────
   Four families a contractor learns once: grey has not started, copper is in
   motion, green is money in, brick is dead. The label is always written out,
   so hue is reinforcement and never the only carrier of meaning. */
[data-bn="badge"][data-bn-status],
[data-bn="pipeline-card"] > [data-bn="badge"] {
  font-weight: var(--gp-weight-bold);
  font-size: var(--gp-text-2xs);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  border-radius: var(--gp-radius-sm);
  padding-inline: var(--gp-space-2);
}

/* ── View tabs ──────────────────────────────────────────────────────────
   The List / Kanban switch is an Apple 27 segmented control: a tertiary
   track and a selected pill, not a row of ink chips. */
[data-bn="tabs"][data-variant="pills"] [data-bn="tab-list"] {
  display: inline-flex;
  gap: 0;
  padding: 2px;
  border: 0;
  border-radius: var(--gp-radius-full);
  background: var(--bn-plat-color-fills-tertiary);
  align-self: start;
}
[data-bn="tabs"][data-variant="pills"] [data-bn="tab"] {
  min-block-size: var(--gp-tap-min);
  padding: var(--gp-space-1) var(--gp-space-4);
  border-radius: var(--gp-radius-full);
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-semibold);
  color: var(--gp-text);
  background: transparent;
}
[data-bn="tabs"][data-variant="pills"] [data-bn="tab"]:hover {
  background: transparent;
  color: var(--gp-text-strong);
}
[data-bn="tabs"][data-variant="pills"] [data-bn="tab"][aria-selected="true"] {
  background: var(--bn-plat-color-miscellaneous-segmented-control-selected-fill);
  color: var(--bn-plat-color-labels-primary);
  box-shadow: var(--gp-shadow-md);
}
/* A flex item's min-width is auto, so a five-column board inside a tab panel
   pushed the whole document sideways on a phone instead of scrolling inside
   its own region. */
[data-bn="tabs"],
[data-bn="tab-panel"] { min-inline-size: 0; }
[data-bn="tab-panel"] { padding: var(--gp-space-4) 0 0; }

/* ── Card grid ──────────────────────────────────────────────────────────
   Used where a record genuinely is a card (a vehicle, a plugin), not as the
   default wrapper for everything. */
[data-bn-card-grid] {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--gp-space-3);
}
[data-bn-card] {
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-xl);
  padding: var(--gp-space-4);
  display: grid;
  gap: var(--gp-space-3);
  align-content: start;
}
[data-bn-card] > header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--gp-space-2);
  align-items: center;
}
[data-bn-card] h2 {
  margin: 0;
  font-size: var(--gp-text-base);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-snug);
  color: var(--gp-text-strong);
}
[data-bn-card] p {
  margin: 0;
  color: var(--gp-text-muted);
  font-size: var(--gp-text-sm);
}
[data-bn-card] footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--gp-space-2);
  padding-block-start: var(--gp-space-2);
  border-block-start: 1px solid var(--gp-rule);
}

/* ── Tables ─────────────────────────────────────────────────────────────
   The densest surface in the product, and the one that has to survive a
   gloved thumb: 3rem rows, a sunk ruled header, and money right-aligned on
   tabular figures so a column of totals reads as a column. */
[data-bn-table-wrap] {
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-lg);
  overflow: hidden;
}
[data-bn-table-wrap] table { width: 100%; border-collapse: collapse; }
[data-bn-table-wrap] thead th {
  background: var(--gp-surface-sunk);
  color: var(--gp-text-muted);
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  text-align: start;
  padding: var(--gp-space-2) var(--gp-space-3);
  border-block-end: 1px solid var(--gp-rule-strong);
  white-space: nowrap;
}
[data-bn-table-wrap] tbody td {
  padding: var(--gp-space-2) var(--gp-space-3);
  border-block-end: 1px solid var(--gp-rule);
  font-size: var(--gp-text-sm);
  block-size: var(--gp-row-h);
  vertical-align: middle;
}
[data-bn-table-wrap] tbody tr:last-child td { border-block-end: none; }
[data-bn-table-wrap] tbody tr:hover td { background: var(--gp-ink-25); }
/* An sr-only cell label is position:absolute; without a containing block on
   the scroller it escapes the horizontal scroll region and drags the whole
   document sideways on a phone. */
[data-bn-table-wrap] [data-bn="table-container"] { position: relative; }
[data-bn-table-wrap] [data-bn-align='end'] { text-align: end; }
[data-bn-table-wrap] tbody td strong {
  font-weight: var(--gp-weight-semibold);
  color: var(--gp-text-strong);
}
[data-bn-table-wrap] tbody td [data-bn-secondary] {
  font-size: var(--gp-text-xs);
  color: var(--gp-text-muted);
}
/* The row's link to its own page: the cell reads as it did, and the name
   underlines on hover so the way in is discoverable without a click. */
[data-bn-row-link] {
  display: block;
  color: inherit;
  text-decoration: none;
}
[data-bn-row-link]:hover strong,
[data-bn-row-link]:focus-visible strong {
  color: var(--gp-primary);
  text-decoration: underline;
}
[data-bn-row-link]:focus-visible {
  outline: 2px solid var(--gp-primary);
  outline-offset: 2px;
  border-radius: var(--gp-radius-sm);
}

/* ── Tables on a phone ──────────────────────────────────────────────────
   A four-column table in a 390px viewport is a horizontal scrollbar, which
   is the last thing a thumb in a van wants. Below 40rem each row becomes a
   record: the first column is the title, and every other cell prints its
   column name beside its value. mountTable writes the table/row/cell roles
   explicitly, so changing "display" here costs nothing in the accessibility
   tree. */
@media (max-width: 40rem) {
  [data-bn-table-wrap] [data-bn="table-container"] { overflow-x: visible; }
  [data-bn-table-wrap] table,
  [data-bn-table-wrap] tbody,
  [data-bn-table-wrap] tr,
  [data-bn-table-wrap] td { display: block; inline-size: 100%; }
  [data-bn-table-wrap] thead {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  [data-bn-table-wrap] tbody tr {
    padding-block: var(--gp-space-2);
    border-block-end: 1px solid var(--gp-rule-strong);
  }
  [data-bn-table-wrap] tbody tr:last-child { border-block-end: none; }
  [data-bn-table-wrap] tbody td {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    align-items: baseline;
    gap: var(--gp-space-3);
    padding: var(--gp-space-1) var(--gp-space-4);
    border-block-end: none;
    block-size: auto;
    min-block-size: 0;
  }
  [data-bn-table-wrap] tbody td[data-bn-label]::before {
    content: attr(data-bn-label);
    font-size: var(--gp-text-2xs);
    font-weight: var(--gp-weight-bold);
    letter-spacing: var(--gp-tracking-label);
    text-transform: uppercase;
    color: var(--gp-text-muted);
  }
  [data-bn-table-wrap] tbody td[data-bn-align='end'] { text-align: start; }
  /* Badges and buttons sit at their own width in the value column rather
     than stretching across it. */
  [data-bn-table-wrap] tbody td > * { justify-self: start; }
  [data-bn-table-wrap] tbody td:not([data-bn-label]):empty { display: none; }
  [data-bn-table-wrap] tbody td[data-bn-primary-cell] {
    grid-template-columns: minmax(0, 1fr);
    padding-block: var(--gp-space-2) var(--gp-space-1);
    font-size: var(--gp-text-base);
  }
  [data-bn-table-wrap] tbody td[data-bn-primary-cell]::before { content: none; }
  [data-bn-table-wrap] tbody td:not([data-bn-label]) {
    grid-template-columns: minmax(0, 1fr);
    padding-block-start: var(--gp-space-2);
  }
  [data-bn-table-wrap] tbody td:not([data-bn-label]) [data-bn-row-actions] {
    justify-content: flex-start;
  }
  [data-bn-table-wrap] tbody td:not([data-bn-label]) [data-bn-button] {
    min-block-size: var(--gp-control-h);
    font-size: var(--gp-text-sm);
  }
}

/* ── Panels ─────────────────────────────────────────────────────────────
   A create/edit panel is a work order clipped to the top of the list: it
   shares the list's paper, takes a green top rule so it reads as the active
   thing, and keeps its footer actions right where the thumb already is. */
[data-bn-panel] {
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-block-start: 3px solid var(--gp-primary);
  border-radius: var(--gp-radius-lg);
  padding: var(--gp-space-4);
  display: grid;
  gap: var(--gp-space-4);
  box-shadow: var(--gp-shadow-sm);
}
[data-bn-panel] header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gp-space-3);
  padding-block-end: var(--gp-space-3);
  border-block-end: 1px solid var(--gp-rule);
}
[data-bn-panel] header h2 {
  margin: 0;
  font-size: var(--gp-text-lg);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-snug);
  color: var(--gp-text-strong);
}
[data-bn-panel-form] {
  display: grid;
  gap: var(--gp-space-3);
}
[data-bn-panel] footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--gp-space-2);
  padding-block-start: var(--gp-space-3);
  border-block-start: 1px solid var(--gp-rule);
}
@media (max-width: 40rem) {
  [data-bn-panel] footer { flex-direction: row-reverse; }
  [data-bn-panel] footer [data-bn-button] { flex: 1; }
}

/* ── Empty / loading / error ────────────────────────────────────────────
   Plain-spoken, on the same paper as the content they replace. */
[data-bn-empty],
[data-bn-loading],
[data-bn-error] {
  padding: var(--gp-space-7) var(--gp-space-5);
  text-align: center;
  font-size: var(--gp-text-sm);
  border-radius: var(--gp-radius-lg);
  border: 1px dashed var(--gp-rule-strong);
  background: var(--gp-surface);
}
[data-bn-empty] { color: var(--gp-text-muted); }
[data-bn-loading] { color: var(--gp-text-muted); }
[data-bn-error] {
  background: var(--gp-dead-bg);
  border: 1px solid var(--gp-brick-100);
  color: var(--gp-dead-ink);
  text-align: start;
  padding: var(--gp-space-3) var(--gp-space-4);
  font-weight: var(--gp-weight-medium);
}
/* Outcome of a lifecycle action (qualified / accepted / withdrawn) —
   a status line on the good-news paper, announced by role="status". */
[data-bn-notice] {
  padding: var(--gp-space-3) var(--gp-space-4);
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-medium);
  border-radius: var(--gp-radius-lg);
  border: 1px solid var(--gp-good-ink);
  background: var(--gp-good-bg);
  color: var(--gp-good-ink);
}
[data-bn-notice][hidden] { display: none; }
/* The fee stated in the Accept confirmation, before the click. */
[data-bn-lead-fee] {
  font-size: var(--gp-text-base);
  font-weight: var(--gp-weight-semibold);
}

/* ── Segmented control ──────────────────────────────────────────────────
   Same track as the kit: tertiary fill, capsule, selected pill. The
   segments stay 44px so a gloved thumb can hit them. */
[data-bn-segmented] {
  display: inline-flex;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
  border: 0;
  border-radius: var(--gp-radius-full);
  background: var(--bn-plat-color-fills-tertiary);
  padding: 2px;
  gap: 0;
}
[data-bn-segmented] [data-bn-button] {
  min-block-size: var(--gp-tap-min);
  padding: var(--gp-space-1) var(--gp-space-4);
  border-radius: var(--gp-radius-full);
  font-size: var(--gp-text-sm);
  background: transparent;
  color: var(--gp-text);
}
[data-bn-segmented] [data-bn-button]:hover { background: transparent; }
[data-bn-segmented] [data-bn-button][data-bn-active] {
  background: var(--bn-plat-color-miscellaneous-segmented-control-selected-fill);
  color: var(--bn-plat-color-labels-primary);
  box-shadow: var(--gp-shadow-md);
}

/* ── Inline stat ────────────────────────────────────────────────────────
   A label and a figure on one line. No card, no shadow — a stat is a fact,
   not an object. */
[data-bn-stat] {
  display: inline-flex;
  align-items: baseline;
  gap: var(--gp-space-2);
  padding: var(--gp-space-2) var(--gp-space-4) var(--gp-space-2) 0;
  border-inline-start: 3px solid var(--gp-rule-strong);
  padding-inline-start: var(--gp-space-3);
  background: none;
}
[data-bn-stat] > span {
  color: var(--gp-text-muted);
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  order: -1;
}
[data-bn-stat] > strong {
  font-size: var(--gp-text-xl);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-tight);
  color: var(--gp-text-strong);
  font-variant-numeric: tabular-nums;
}
[data-bn-stat][data-bn-tone='good'] { border-inline-start-color: var(--gp-good-line); }
[data-bn-stat][data-bn-tone='move'] { border-inline-start-color: var(--gp-move-line); }

/* ── Kanban ─────────────────────────────────────────────────────────────
   Columns are lanes on one board, separated by rules, so five stages fit a
   laptop without horizontal scrolling and each card can stay compact. */
[data-bn-kanban] { min-inline-size: 0; }
[data-bn-kanban] [data-bn="pipeline"] {
  /* The board scrolls sideways inside itself. It needs to be the containing
     block for that to hold: each card's "Move to…" carries a
     position:absolute sr-only label, and without this the label escapes the
     scroll region and drags the whole document sideways on a phone. */
  position: relative;
  grid-auto-columns: minmax(13rem, 1fr);
  gap: var(--gp-space-3);
}
[data-bn-kanban] [data-bn="pipeline-column"] {
  background: var(--gp-surface-sunk);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-lg);
  padding: var(--gp-space-2);
}
[data-bn-kanban] [data-bn="pipeline-column-header"],
[data-bn-kanban] [data-bn="pipeline-column"] > header {
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  color: var(--gp-text-muted);
}
[data-bn-kanban] [data-bn="pipeline-card"] {
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
  box-shadow: none;
}
[data-bn-kanban] [data-bn="pipeline-card"]:hover {
  border-color: var(--gp-rule-strong);
}
[data-bn-kanban] [data-bn="pipeline-card-title"] {
  font-weight: var(--gp-weight-semibold);
  color: var(--gp-text-strong);
  letter-spacing: var(--gp-tracking-snug);
}
[data-bn-kanban] [data-bn="pipeline-card-actions"] select,
[data-bn-jobs-sidebar] [data-bn="pipeline-card-actions"] select {
  min-block-size: var(--gp-control-h-sm);
  border: 1px solid var(--gp-border-control);
  border-radius: var(--gp-radius-sm);
  background: var(--gp-surface);
  color: var(--gp-text-muted);
  font-size: var(--gp-text-xs);
  padding-inline: var(--gp-space-2);
  inline-size: 100%;
}
[data-bn-kanban] [data-bn="pipeline-card-actions"] [data-bn="button"],
[data-bn-kanban] [data-bn="pipeline-card-actions"] button {
  min-block-size: var(--gp-control-h-sm);
  font-size: var(--gp-text-xs);
}
/* REGRESSION fix (fe9c957 renderPipeline swap): the component's own
   [data-bn="pipeline-empty"] rule layers opacity: 0.6 on top of the muted
   text color. Full opacity on --gp-text-muted is 7.26:1 on paper. */
[data-bn-kanban] [data-bn="pipeline-empty"] {
  opacity: 1;
  color: var(--gp-text-muted);
  font-size: var(--gp-text-xs);
}

[data-bn-quote] {
  margin: 0;
  padding: var(--gp-space-3) var(--gp-space-4);
  border-inline-start: 3px solid var(--gp-rule-strong);
  background: var(--gp-surface-sunk);
  border-radius: 0 var(--gp-radius-md) var(--gp-radius-md) 0;
  color: var(--gp-text);
  font-size: var(--gp-text-sm);
}

[data-bn-stars] {
  display: inline-flex;
  gap: 1px;
  color: var(--gp-copper-500);
}
[data-bn-star='empty'] { color: var(--gp-ink-200); }

[data-bn-stats] {
  display: grid;
  gap: var(--gp-space-3);
  padding: var(--gp-space-4);
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-lg);
}
[data-bn-stats] header {
  display: flex;
  align-items: baseline;
  gap: var(--gp-space-3);
}
[data-bn-stats] header h2 {
  font-size: var(--gp-text-3xl);
  font-weight: var(--gp-weight-black);
  letter-spacing: var(--gp-tracking-tight);
  margin: 0;
  font-variant-numeric: tabular-nums;
}
[data-bn-stats-platforms] {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: var(--gp-space-2);
  margin: 0;
}
[data-bn-stats-platforms] dt {
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  color: var(--gp-text-muted);
  text-transform: uppercase;
}
[data-bn-stats-platforms] dd {
  margin: 0;
  font-weight: var(--gp-weight-bold);
  font-variant-numeric: tabular-nums;
}

[data-bn-secondary] {
  color: var(--gp-text-muted);
  font-size: var(--gp-text-sm);
}

[data-bn-section-header] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gp-space-3);
  margin-block-end: var(--gp-space-2);
}
[data-bn-section-header] h2,
[data-bn-section-header] h3 {
  font-size: var(--gp-text-lg);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-snug);
  margin: 0;
}
[data-bn-form-footer] {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--gp-space-2);
  margin-block-start: var(--gp-space-3);
}
[data-bn-row-actions] {
  display: flex;
  gap: var(--gp-space-1);
  justify-content: flex-end;
}
[data-bn-billing-summary] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--gp-space-2) var(--gp-space-4);
  margin: 0;
}
[data-bn-billing-summary] dt {
  color: var(--gp-text-muted);
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
}
[data-bn-billing-summary] dd {
  margin: 0;
  font-weight: var(--gp-weight-medium);
}

[data-bn-review-list] {
  display: grid;
  gap: var(--gp-space-3);
}
[data-bn-review-body] {
  font-size: var(--gp-text-base);
  line-height: var(--gp-leading-normal);
}
[data-bn-review-response] {
  background: var(--gp-primary-tint);
  border-inline-start: 3px solid var(--gp-good-line);
  border-radius: 0 var(--gp-radius-md) var(--gp-radius-md) 0;
  padding: var(--gp-space-3);
  font-size: var(--gp-text-sm);
}
`);
