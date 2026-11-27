#!/usr/bin/env node
/**
 * Lighthouse audit — the measurement harness behind Greenput's technology
 * showcase (apps/marketing's /technology page). Every number that page
 * shows comes from a JSON report this script wrote; nothing is invented.
 *
 * Runs Google Lighthouse (performance, accessibility, best-practices, seo)
 * against a single URL, on both mobile and desktop, using a Chromium
 * instance launched by Playwright and driven over the Chrome DevTools
 * Protocol (the documented Playwright+Lighthouse recipe: launch with a
 * fixed remote-debugging port, then hand that port to `lighthouse()`).
 *
 * Usage:
 *   AUDIT_BASE_URL=https://greenput-tenant-preview-42.example.workers.dev \
 *     node scripts/audit/lighthouse.mjs
 *
 *   # Or audit an arbitrary URL directly (used for anonymised comparisons —
 *   # see docs/technology-showcase-methodology.md):
 *   AUDIT_URL=https://example.com/ AUDIT_LABEL="comparison-a" \
 *     AUDIT_ANONYMIZE=true AUDIT_SKIP_GATE=true node scripts/audit/lighthouse.mjs
 *
 * Env vars:
 *   AUDIT_BASE_URL   Base origin of the tenant-site deployment to audit.
 *                     The demo tenant is reached via `?slug=demo` (the same
 *                     query-param convention tenant-site itself uses for
 *                     workers.dev preview URLs — see src/index.ts). Default:
 *                     a local dev server, for ad-hoc runs.
 *   AUDIT_URL        Full URL to audit instead of BASE_URL + "?slug=demo".
 *                     Used for one-off comparison targets.
 *   AUDIT_LABEL      Label used in the report filename and JSON. Default:
 *                     "greenput-demo-tenant".
 *   AUDIT_ANONYMIZE  When "true", the report omits the actual URL audited —
 *                     use this for any third-party comparison site so the
 *                     committed artefact never names or links a real
 *                     business (see DO#2 in the showcase task: anonymise,
 *                     never disparage a named business).
 *   AUDIT_SKIP_GATE  When "true", threshold failures are reported but do
 *                     not set a non-zero exit code. Used for informational
 *                     comparison runs — CI should never fail because a
 *                     *third party's* site got slower.
 *   MIN_PERFORMANCE, MIN_ACCESSIBILITY, MIN_BEST_PRACTICES, MIN_SEO
 *                     Regression gate thresholds (0-100), checked against
 *                     the MOBILE run (Google's own ranking signals are
 *                     mobile-first). Defaults below were set a few points
 *                     under the demo site's own measured baseline the day
 *                     this harness was built, specifically so a real
 *                     regression trips it without chasing lab-run noise —
 *                     see the PR description for the measured baseline.
 *   AUDIT_SKIP_CRAWLABLE
 *                     When "true", skips Lighthouse's "is-crawlable" SEO
 *                     audit. The demo tenant is deliberately noindexed
 *                     (see render.ts's `isDemo` handling) so it can be
 *                     browsed without ever competing with a real tenant in
 *                     search results — that's a choice about *this specific
 *                     site*, not a defect in the markup Lighthouse would
 *                     otherwise be grading, so it's excluded only for the
 *                     demo target. A real tenant site is never noindexed
 *                     and this audit runs normally for it.
 *
 * Agentic browsing: the run also collects Lighthouse's "Agentic browsing"
 * category (Lighthouse 13.3+, Chrome 150+). It is report-only: it never
 * gates, and it is kept out of `scores` so the showcase numbers above are
 * unchanged. The report's `agenticBrowsing` field records which of its
 * audits passed (score >= 0.9) out of those that applied; not-applicable
 * audits (e.g. the WebMCP ones on a page with no WebMCP tools) are listed
 * but not counted. A full HTML report per form factor is written next to
 * the JSON one.
 */

import { chromium } from 'playwright';
import lighthouse, { desktopConfig } from 'lighthouse';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, '../../reports');

const AUDIT_BASE_URL = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:18821';
const TARGET_URL =
  process.env.AUDIT_URL ?? `${AUDIT_BASE_URL.replace(/\/$/, '')}/?slug=demo`;
const TARGET_LABEL = process.env.AUDIT_LABEL ?? 'greenput-demo-tenant';
const ANONYMIZE = process.env.AUDIT_ANONYMIZE === 'true';
const SKIP_GATE = process.env.AUDIT_SKIP_GATE === 'true';
const SKIP_AUDITS =
  process.env.AUDIT_SKIP_CRAWLABLE === 'true' ? ['is-crawlable'] : [];

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
// Report-only categories: collected and written to the report, never gated.
const REPORT_ONLY_CATEGORIES = ['agentic-browsing'];

const THRESHOLDS = {
  performance: Number(process.env.MIN_PERFORMANCE ?? 90),
  accessibility: Number(process.env.MIN_ACCESSIBILITY ?? 95),
  'best-practices': Number(process.env.MIN_BEST_PRACTICES ?? 90),
  seo: Number(process.env.MIN_SEO ?? 95),
};

function extractAgentic(lhr) {
  const category = lhr.categories['agentic-browsing'];
  if (!category) return null;
  const NOT_COUNTED = ['notApplicable', 'informative', 'manual', 'error'];
  const audits = category.auditRefs.map((ref) => {
    const audit = lhr.audits[ref.id];
    return {
      id: ref.id,
      title: audit?.title ?? null,
      scoreDisplayMode: audit?.scoreDisplayMode ?? null,
      score: audit?.score ?? null,
    };
  });
  const counted = audits.filter(
    (a) => !NOT_COUNTED.includes(a.scoreDisplayMode),
  );
  return {
    score: category.score,
    passed: counted.filter((a) => a.score !== null && a.score >= 0.9).length,
    applicable: counted.length,
    audits,
  };
}

function extractMetrics(lhr) {
  const audits = lhr.audits;
  const scores = Object.fromEntries(
    CATEGORIES.map((c) => [
      c,
      lhr.categories[c] ? Math.round(lhr.categories[c].score * 100) : null,
    ]),
  );
  return {
    scores,
    coreWebVitals: {
      largestContentfulPaintMs:
        audits['largest-contentful-paint']?.numericValue ?? null,
      cumulativeLayoutShift:
        audits['cumulative-layout-shift']?.numericValue ?? null,
      totalBlockingTimeMs: audits['total-blocking-time']?.numericValue ?? null,
      firstContentfulPaintMs:
        audits['first-contentful-paint']?.numericValue ?? null,
      speedIndexMs: audits['speed-index']?.numericValue ?? null,
      timeToInteractiveMs: audits['interactive']?.numericValue ?? null,
    },
    pageWeightBytes: audits['total-byte-weight']?.numericValue ?? null,
    requestCount: audits['network-requests']?.details?.items?.length ?? null,
    agenticBrowsing: extractAgentic(lhr),
  };
}

// Playwright's `Browser` doesn't expose the Puppeteer-style `wsEndpoint()`
// getter, so — per Google's own documented recipe for combining Playwright
// with Lighthouse — launch Chromium with a fixed CDP port and hand that
// same port to `lighthouse()`, which drives Chrome over CDP independently
// of Playwright's own connection. Mobile and desktop runs happen
// sequentially (never concurrently), so reusing one port is safe.
const CDP_PORT = Number(process.env.AUDIT_CDP_PORT ?? 9422);

async function runFormFactor(url, formFactor, htmlPath) {
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${CDP_PORT}`],
  });
  try {
    const config = formFactor === 'desktop' ? desktopConfig : undefined;
    const result = await lighthouse(
      url,
      {
        port: CDP_PORT,
        output: ['json', 'html'],
        onlyCategories: [...CATEGORIES, ...REPORT_ONLY_CATEGORIES],
        skipAudits: SKIP_AUDITS,
      },
      config,
    );
    if (!result?.lhr) {
      throw new Error('Lighthouse returned no result (page may not have loaded)');
    }
    // An anonymised run never writes the HTML report: it names the URL.
    if (htmlPath) writeFileSync(htmlPath, result.report[1]);
    return extractMetrics(result.lhr);
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  console.log(`\nLighthouse audit: ${TARGET_LABEL}`);
  console.log(`  ${ANONYMIZE ? '(url withheld from report)' : TARGET_URL}\n`);

  const runId = Date.now();
  const htmlPath = (formFactor) =>
    ANONYMIZE
      ? undefined
      : join(
          REPORTS_DIR,
          `lighthouse-${TARGET_LABEL}-${formFactor}-${runId}.html`,
        );
  const logAgentic = ({ agenticBrowsing: a }) => {
    if (a)
      console.log(
        `    agentic-browsing (report-only): ${a.passed}/${a.applicable} passed`,
      );
  };

  const mobile = await runFormFactor(TARGET_URL, 'mobile', htmlPath('mobile'));
  console.log('  Mobile:');
  for (const [cat, score] of Object.entries(mobile.scores)) {
    console.log(`    ${cat}: ${score}`);
  }
  logAgentic(mobile);

  const desktop = await runFormFactor(
    TARGET_URL,
    'desktop',
    htmlPath('desktop'),
  );
  console.log('  Desktop:');
  for (const [cat, score] of Object.entries(desktop.scores)) {
    console.log(`    ${cat}: ${score}`);
  }
  logAgentic(desktop);

  const report = {
    timestamp: new Date().toISOString(),
    target: TARGET_LABEL,
    ...(ANONYMIZE ? {} : { url: TARGET_URL }),
    mobile,
    desktop,
    thresholds: THRESHOLDS,
    skippedAudits: SKIP_AUDITS,
  };

  const reportPath = join(
    REPORTS_DIR,
    `lighthouse-${TARGET_LABEL}-${runId}.json`,
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report written to ${reportPath}`);

  // Gate on the mobile run — Google's own ranking signals are mobile-first,
  // and mobile throttling is the stricter of the two, so it's the more
  // meaningful regression signal.
  const failures = CATEGORIES.filter(
    (cat) => mobile.scores[cat] !== null && mobile.scores[cat] < THRESHOLDS[cat],
  );

  if (failures.length > 0) {
    const detail = failures
      .map((cat) => `${cat}: ${mobile.scores[cat]} < ${THRESHOLDS[cat]}`)
      .join(', ');
    if (SKIP_GATE) {
      console.log(`\n::warning::Lighthouse below threshold (${detail}) — not gating (comparison run)`);
    } else {
      console.error(`\n✗ Lighthouse regression — ${detail}`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log('\n✓ Lighthouse PASSED — mobile scores meet every threshold');
  }
}

main().catch((err) => {
  console.error('Lighthouse audit error:', err);
  process.exitCode = 1;
});
