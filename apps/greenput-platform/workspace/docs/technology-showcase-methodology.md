# Technology showcase — methodology

This documents how the numbers on `apps/marketing`'s `/technology` page
(and the `demo` reference tenant they describe) are produced. It's the
technical companion to that page's own "Methodology" section — this
version is for maintainers; that one is for a contractor reading it cold.

## What's being measured

`scripts/audit/lighthouse.mjs` runs Google Lighthouse — performance,
accessibility, best-practices, SEO — against a single URL, on both a
throttled mobile connection and desktop, using a Chromium instance
launched by Playwright and driven over the Chrome DevTools Protocol. It
records the four category scores plus Core Web Vitals (LCP, CLS, TBT,
FCP, Speed Index, TTI), total page weight, and request count, and writes
all of it to a timestamped JSON file under `reports/` (gitignored —
CI uploads it as a build artefact instead of committing it).

The `demo` tenant (`scripts/preview/seed.sql`, slug `demo`) is a fictional
residential electrician — "Rivertown Electric" — built on the same
tenant-site codebase every real Greenput tenant runs on. It exists
specifically so this harness has a stable, believable, non-empty site to
measure. See `apps/tenant-site/src/render.ts`'s `isDemo` handling for how
it's labelled and kept out of search results.

## Why these thresholds

`.github/workflows/ci.yml`'s `lighthouse-demo-tenant` job gates on the
**mobile** run (Google's own ranking signals are mobile-first, and mobile
throttling is the stricter of the two form factors) against:

| Category | Minimum | Why |
| --- | --- | --- |
| Performance | 90 | Lighthouse's own "good" cutoff; the demo tenant measured 100 the day this harness was built, so 90 leaves room for lab-run variance without masking a real regression. |
| Accessibility | 95 | Set higher than Performance because there's no equivalent to network/CPU throttling noise here — a drop is almost always a real regression, not measurement jitter. |
| Best Practices | 90 | Matches Performance's reasoning. |
| SEO | 95 | Same reasoning as Accessibility — SEO audits are static/DOM checks, not timing-sensitive. |

These are configurable via `MIN_PERFORMANCE` / `MIN_ACCESSIBILITY` /
`MIN_BEST_PRACTICES` / `MIN_SEO` env vars on the script; the CI job uses
the defaults above.

## Why staging, not a per-PR preview

Per-PR preview environments were removed repo-wide (see `ceab1bb`/`60da83c`
and `CLAUDE.md` §3.1) after they exhausted the Cloudflare account's D1
database cap. `lighthouse-demo-tenant` follows the same pattern the
`accessibility` and `laws-of-ux` jobs already established: it targets the
always-on staging deployment (`greenput-tenant-staging`, seeded with the
`demo` workspace by `scripts/staging/setup.sh` on every staging deploy)
rather than a per-PR target. The trade-off is the same one documented on
those jobs: staging reflects whatever last merged to main, not this PR's
own commit, so this is a standing canary rather than a gate on the exact
diff under review.

## The `is-crawlable` exclusion

The `demo` tenant sets `noindex` on every page (see `render.ts`) so a
fictional business can never rank in real search results or get confused
for a real one. Lighthouse's `is-crawlable` SEO audit treats that as a
failure — correctly, for a real page, but it's a false positive here
since the "problem" it's flagging is an intentional, unrelated choice
about this one site, not a defect in the markup the audit otherwise
grades. The harness accepts `AUDIT_SKIP_CRAWLABLE=true` to skip only that
one audit; every other SEO check (titles, meta description, structured
data, crawlable links, viewport, etc.) still runs normally. A real
Greenput tenant is never noindexed, so this exclusion never applies to
one.

## Comparison sites — anonymisation policy

The `/technology` page compares the demo tenant against two other,
real, publicly reachable sites representative of what contractors are
sold today: a mainstream SaaS website-builder's own public template
preview, and a free, publicly downloadable HTML template. Both were
measured the same way, on the same day, with the same script
(`AUDIT_ANONYMIZE=true AUDIT_SKIP_GATE=true node scripts/audit/lighthouse.mjs`).

Neither is named, linked, or otherwise identified anywhere in this
repository or on the page — the point is to make an honest, provable
statement about a *category* of product, not to single out a specific
business or template author. `AUDIT_ANONYMIZE=true` makes the harness
itself omit the audited URL from its JSON report for exactly this reason:
so a comparison report can be regenerated and re-verified without ever
persisting the target's identity anywhere committed.

`AUDIT_SKIP_GATE=true` means a comparison site's scores are recorded and
reported but never fail CI — CI has no business failing because a third
party's website got slower.

## What we deliberately didn't do

- We didn't invent numbers for anything we didn't or couldn't measure.
  If a number isn't backed by a report in `reports/`, it isn't on the
  page.
- We didn't give the demo tenant a license number, certification, or
  testimonial — none of those exist for a fictional business, so none
  are shown.
- We didn't add photography to the demo tenant to pad out its page
  weight to look more "real" — see the page's own "Image handling" note.
- We didn't audit a specific competitor's paying customer site, and we
  don't name either comparison site.

## Reproducing a measurement

```bash
# Against a local wrangler dev instance of tenant-site (see
# apps/tenant-site's own README/wrangler.toml for [dev] port):
AUDIT_BASE_URL=http://127.0.0.1:8788 AUDIT_SKIP_CRAWLABLE=true \
  node scripts/audit/lighthouse.mjs

# Against any live deployment:
AUDIT_BASE_URL=https://greenput-tenant-staging.<account>.workers.dev \
  AUDIT_SKIP_CRAWLABLE=true node scripts/audit/lighthouse.mjs

# An anonymised, non-gating comparison run against a third-party URL:
AUDIT_URL=https://example.com/ AUDIT_LABEL="my-comparison" \
  AUDIT_ANONYMIZE=true AUDIT_SKIP_GATE=true node scripts/audit/lighthouse.mjs
```
