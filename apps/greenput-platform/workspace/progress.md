# Surface progress — 2026-10-22

## Coverage

56% (32 of 57 listed pages). Marketing, the contractor micro-site, and its quote, proposal, and invoice pages use the shared surface. The platform SPA is not started. See `coverage.json`.

Marketing PR #252 merged to main (`d36cebd`, same tree as `791047b`). This pull request targets main. https://github.com/DuganLabs/GreenPut/actions/runs/39831557652

## Gates run locally

- `apps/marketing` vitest: 113 passed, including axiom lint (organism names are `data-bn` attributes on semantic elements, never custom tags) and the phone-rail hide rule at `max-width: 1023px`.
- `shared-design` vitest: 139 passed. Surface checks now require `text-decoration-line: none` on capsules, large-title weight 700, a two-column metric grid, a trailing inset badge, a 2rem icon tile, a neutral card (`background-image: none`, no `::after` disc), one `--gp-hero-glow` on `body::before`, every component `box-shadow` / `border-radius` / `z-index` on the `--gp-*` scale, one accent on icon tiles, stack tokens on title/lead/actions, inset rows with radius 0 and no per-row shadow, a balanced 3-column rule for six cards, one capsule radius on both button variants, lead and running copy on `--gp-text-base` (the phone lead is no longer 15px), and `margin: 0` on a panel blockquote.
- Playwright `e2e/responsive/marketing-visual.spec.ts`: 20 passed. Previous gates still hold. Computed-style gates: stack tokens are at least 12 / 20 / 24 / 40px (64px section gap from 768px up); consecutive block children fail below those tokens (inline links, such as the footer legal line, are line boxes and are not a stack); the first two screens fail a content gap taller than `max(0.4 × viewport, section token + 48)`; a card grid fails when a row is shorter than another and a divisor fits, and when six or three cards are not in the balanced column count the width allows; "Coming soon" is a badge beside the title; inset rows are radius 0 inside one rounded list; Sign In and Get Started share radius and weight from 1024px; where a page has both a lead and a column body paragraph, the lead's font size and line box are at least the body's. `toHaveScreenshot` at 320/768/1280 × light/dark. axe serious/critical on each route in light (1280) and dark (320).
- Playwright `e2e/responsive/reference-diff.spec.ts`: 1 passed. Each route × 320/768/1280 × light/dark is compared with production and, when present, the kit PNG. Pixel inequality is recorded and is not a failure. Kit files are not in the repo; CI reports a null kit root.
- Playwright `e2e/responsive/page-spine.spec.ts`: 52 passed, marketing and tenant. The tenant shell uses the same `[data-bn-column]` spine. A long workspace name truncates inside the brand instead of widening the page.
- Playwright `e2e/responsive/tenant-visual.spec.ts`: the five public routes (`/`, `/services`, `/about`, `/contact`, `/no-such-page`) pass the same layout gates as marketing — tab clearance, type scale, stack, card grids, overflow, axe serious/critical — at 320, 375, 390, 430, 768 and 1280. `toHaveScreenshot` is hard again at 320/768/1280 × light/dark. `maxDiffPixelRatio` stays 0.02. The 19 frames that moved with quiet glass are the runner actuals from https://github.com/DuganLabs/GreenPut/actions/runs/39845222835. The rest stay the frames from https://github.com/DuganLabs/GreenPut/actions/runs/39836186976. Layout gates on 39845222835 passed before the screenshots were written. Card regions on the new frames are near-neutral (services at 1280 dark dropped from 37% green-dominant pixels to under 1%).

Fresh reviewer (not the implementer), agent `bc-bf7bf526-7f2e-5e59-9f39-24a165fcad23`, with the kit Settings / inset grouped list (`ios/Examples.png`) beside the new shots. First pass scored design 3, kit fidelity 4, craft 3 after reading the hero's inset rows as a card grid. Corrected re-score, same agent, told which image is the hero list and which is the feature grid: design quality 4, kit fidelity 4, craft 4. All six checks passed (rhythm, no empty technology band, 3×2 features, Coming soon badge, hairline inset list, one capsule). Marketing shipped in #252. This branch quiets the card wash that shipped with it.

GitHub run https://github.com/DuganLabs/GreenPut/actions/runs/39830223920 on `cdf275b` passed every job except Responsive Contract, and that job failed only `toHaveScreenshot`. Every route still cleared the layout gates (tab, stack, type scale, grids, overflow) before the frames were written. The baselines are now those runner frames. `toHaveScreenshot` is hard again. `maxDiffPixelRatio` stays 0.02.

## Blocked

https://greenput.com is the #252 surface: every card still carries the green wash this branch removes. Do not treat this branch as live until it deploys.

## Next

1. Marketing is merged. After deploy, capture https://greenput.com at 320, 768, and 1280.
2. Quote, proposal, and invoice are on this branch. The platform SPA stays not started. Screenshot frames that move with the toolbar wait for the runner actuals.

## Concerns

- `GP_TOKENS_CSS` is still unlayered on purpose so it overrides component layers. The axiom lint covers the new surface sheet, not that pre-existing token sheet.
- The published platform token sheet still names “SF Pro” first. The surface overrides `--bn-plat-font-family` with the system stack, and names Liberation Sans ahead of `system-ui`. That face is already on the GitHub runner (`fonts-liberation` 1:2.1.5-3, installed by Playwright). The responsive browser turns font hinting off so the 320px shots match. No SF Pro files are shipped.
- Screenshot baselines are the Chromium frames from the GitHub runner (marketing quiet-glass run 39841295200 for the frames that moved, tenant quiet-glass run 39845222835 for the 19 frames that moved). Liberation Sans is on that runner and hinting is off, and a local machine still rasterizes the same stack to different pixels, so updating the PNGs locally will fail CI. `maxDiffPixelRatio` stays 0.02.
- `bn-scroll` hosts must set `tabindex="0"` (the technology comparison table does). That requirement is not enforced by a renderer yet.
- Missing organisms live in one shared file and are listed in `coverage.json` for upstreaming. They are not in a published `@basenative` package.
- Cards are neutral glass: `--gp-glass-fill`, one edge, `--gp-shadow-glass` (highlight plus `--gp-shadow-md`). No accent gradient and no `::after` disc. `--gp-hero-glow` is the only brand radial, painted on `body::before` behind the hero. The phone tab bar is that same capsule; the current tab is the accent color, not a second pill.
- Stack gaps are sibling margins from `--gp-stack-title` (12px), `--gp-stack-actions` (20px), `--gp-stack-content` (24px), and `--gp-stack-section` (40px, 64px from 48rem). Section padding is half the section token so two sections add up to the full step. Card columns are viewport queries, not a size container on the column: that container was dropping those margins at 320px. Six cards go to three columns; four cards stay two-by-two so a title plus a badge still fits.
- Dark glass uses the same material. The fill and edge tokens change under the dark scheme; the leaf does not come back as a card wash. Inner metric tiles still use the platform tertiary fill.
- Kit PNGs live outside the repo. The reference-diff step does not fail CI when they are absent.
