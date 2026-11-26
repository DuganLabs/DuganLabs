# Design

**Bar:** Plaid, Apple, Stripe, Mercury, Jobber. The aim is a page that is calm and
confident, with one idea, one action and nothing decorative that does not carry meaning.

## The kit (libs/coming-soon) is the default
- A system font stack, with no web fonts to download. Text is the hero.
- One accent per app (`theme.accent`, plus dark-mode variants). Everything else is neutral ink on paper.
- Layout: nav (mark + "Log in"), then a hero (eyebrow, headline, one-line idea, email form,
  consent), an optional product panel (`visual.rows`, 2–4), three value points, and a footer.
- Light and dark follow `prefers-color-scheme`. Both are designed, not inverted.
- Motion is limited to a subtle hover/focus and is disabled under `prefers-reduced-motion`.
- No inline `style=` (CSP). No external images, fonts or scripts, except Turnstile, which
  loads only after the form gets focus.

## Senior-designer critique checklist (before anything is shown)
1. Hierarchy: can the headline, the idea and the action each be read in about a second?
2. Rhythm: consistent spacing scale; gutters match across sections; no orphaned footer on
   short pages.
3. Alignment: panel rows, cards and form share edges; nothing overflows its container
   at 390px or 1440px.
4. Copy: real facts only; no filler, no exclamation marks; consent is one plain sentence.
5. States: empty, error, success (`?joined=1`), no-JS, and dark mode all look intentional.
6. Data views (leads): numbers right-aligned, quiet empty cells (`.nil`), and an obvious
   search and export.
