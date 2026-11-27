#!/usr/bin/env node
/**
 * Lighthouse audit, post-deploy across all 5 categories.
 *
 * Runs the local `lighthouse` package against the deployed docs home and
 * docs reference in Playwright's Chromium driven over a fixed CDP port.
 * It uses no PageSpeed API, no LHCI server and no secrets. By default it
 * audits performance, accessibility, best-practices, seo, and agentic-browsing
 * across both mobile and desktop form factors. Set LIGHTHOUSE_MIN_SCORE (0-100)
 * to gate scored categories; without it the audit is report-only and fails
 * only when a page cannot be audited at all.
 *
 * Usage:
 *   pnpm audit:lighthouse
 *   LIGHTHOUSE_URLS=https://basenative-docs.pages.dev/,https://basenative-docs.pages.dev/docs/ pnpm audit:lighthouse
 *
 * Env vars:
 *   SITE_URL               Base URL used when LIGHTHOUSE_URLS is unset.
 *                          Default: https://basenative-docs.pages.dev.
 *   LIGHTHOUSE_URLS        Comma-separated URLs. Default: ${SITE_URL}/ and
 *                          ${SITE_URL}/docs/.
 *   LIGHTHOUSE_CATEGORIES  Comma-separated category ids. Default:
 *                          performance,accessibility,best-practices,seo,agentic-browsing.
 *   LIGHTHOUSE_PRESETS     Comma-separated presets (mobile,desktop). Default:
 *                          mobile,desktop.
 *   LIGHTHOUSE_MIN_SCORE   Optional 0-100 minimum score for scored categories.
 *   LIGHTHOUSE_CDP_PORT    Remote-debugging port. Default: 9423.
 *
 * Writes reports/lighthouse-<label>-<preset>.html and .json (the full
 * Lighthouse reports), plus reports/lighthouse-summary.json.
 */
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, '..', '..', 'reports');

const BASE_SITE_URL = (process.env.SITE_URL ?? 'https://basenative-docs.pages.dev').replace(
  /\/+$/,
  '',
);
const URLS = (process.env.LIGHTHOUSE_URLS ?? `${BASE_SITE_URL}/,${BASE_SITE_URL}/docs/`)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
const CATEGORIES = (
  process.env.LIGHTHOUSE_CATEGORIES ??
  'performance,accessibility,best-practices,seo,agentic-browsing'
)
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);
const PRESETS = (process.env.LIGHTHOUSE_PRESETS ?? 'mobile,desktop')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter(Boolean);
const MIN_SCORE = process.env.LIGHTHOUSE_MIN_SCORE
  ? Number(process.env.LIGHTHOUSE_MIN_SCORE)
  : null;
const CDP_PORT = Number(process.env.LIGHTHOUSE_CDP_PORT ?? 9423);
const NOT_COUNTED = ['notApplicable', 'informative', 'manual', 'error'];

function labelFor(url, preset) {
  const { hostname, pathname } = new URL(url);
  const path = pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-');
  return `${hostname}${path ? `-${path}` : '-home'}-${preset}`;
}

function summarise(lhr) {
  const categories = {};
  for (const id of CATEGORIES) {
    const category = lhr.categories[id];
    if (!category) {
      categories[id] = null;
      continue;
    }
    const audits = category.auditRefs.map((ref) => ({
      id: ref.id,
      title: lhr.audits[ref.id]?.title ?? null,
      scoreDisplayMode: lhr.audits[ref.id]?.scoreDisplayMode ?? null,
      score: lhr.audits[ref.id]?.score ?? null,
    }));
    const counted = audits.filter((a) => !NOT_COUNTED.includes(a.scoreDisplayMode));
    categories[id] = {
      score: category.score,
      score100: category.score !== null ? Math.round(category.score * 100) : null,
      passed: counted.filter((a) => a.score !== null && a.score >= 0.9).length,
      applicable: counted.length,
      audits,
    };
  }
  return categories;
}

async function audit(url, preset) {
  // Playwright exposes no wsEndpoint for Lighthouse, so launch Chromium on a
  // fixed CDP port and hand Lighthouse that port. Runs are sequential.
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${CDP_PORT}`],
  });
  try {
    const flags = {
      port: CDP_PORT,
      output: ['json', 'html'],
      onlyCategories: CATEGORIES,
    };
    const config =
      preset === 'desktop'
        ? {
            extends: 'lighthouse:default',
            settings: {
              formFactor: 'desktop',
              throttling: {
                rttMs: 40,
                throughputKbps: 10240,
                cpuSlowdownMultiplier: 1,
                requestLatencyMs: 0,
                downloadThroughputKbps: 0,
                uploadThroughputKbps: 0,
              },
              screenEmulation: {
                mobile: false,
                width: 1350,
                height: 940,
                deviceScaleFactor: 1,
                disabled: false,
              },
            },
          }
        : undefined;
    const result = await lighthouse(url, flags, config);
    if (!result?.lhr) throw new Error('Lighthouse returned no result');
    if (result.lhr.runtimeError) {
      throw new Error(`${result.lhr.runtimeError.code}: ${result.lhr.runtimeError.message}`);
    }
    return result;
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const mode = MIN_SCORE !== null ? `gate >= ${MIN_SCORE}` : 'report-only';
  console.log(`\nLighthouse (${mode}): ${CATEGORIES.join(', ')} [${PRESETS.join(', ')}]\n`);

  const summary = {
    timestamp: new Date().toISOString(),
    categories: CATEGORIES,
    presets: PRESETS,
    minScore: MIN_SCORE,
    pages: [],
  };
  const failures = [];

  for (const url of URLS) {
    for (const preset of PRESETS) {
      const label = labelFor(url, preset);
      const { lhr, report } = await audit(url, preset);
      writeFileSync(join(REPORTS_DIR, `lighthouse-${label}.json`), report[0]);
      writeFileSync(join(REPORTS_DIR, `lighthouse-${label}.html`), report[1]);
      const categories = summarise(lhr);
      summary.pages.push({
        url,
        preset,
        label,
        lighthouseVersion: lhr.lighthouseVersion,
        userAgent: lhr.environment?.hostUserAgent ?? null,
        categories,
      });
      console.log(`  ${url} (${preset})`);
      for (const [id, c] of Object.entries(categories)) {
        if (!c) {
          console.log(`    ${id}: not in this Lighthouse`);
          continue;
        }
        const scorePart = c.score100 !== null ? `${c.score100}/100 · ` : '';
        console.log(`    ${id}: ${scorePart}${c.passed}/${c.applicable} passed`);
        if (MIN_SCORE !== null && c.score100 !== null && c.score100 < MIN_SCORE) {
          failures.push(`${url} (${preset}) ${id}: ${c.score100} < ${MIN_SCORE}`);
        }
      }
    }
  }

  const summaryPath = join(REPORTS_DIR, 'lighthouse-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n  Summary written to ${summaryPath}`);

  if (failures.length) {
    console.error('\nLighthouse score gate failed:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Lighthouse audit error:', err);
  process.exitCode = 1;
});
