#!/usr/bin/env node
/**
 * Shared post-deploy Lighthouse audit runner (report-only).
 *
 * Runs the local `lighthouse` package against each target in
 * LIGHTHOUSE_TARGETS using Playwright's Chromium over a fixed CDP port.
 * Collects performance, accessibility, best-practices, seo, and
 * agentic-browsing (mobile form factor).
 *
 * Writes dist/audit/<label>.html, dist/audit/<label>.json, and
 * dist/audit/lighthouse-summary.json. Appends a markdown summary table to
 * $GITHUB_STEP_SUMMARY when set. Exits non-zero only if a target cannot be
 * audited at all (network or Lighthouse runtime error), never on a score.
 */
import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', '..', 'dist', 'audit');

const SCORE_CATEGORIES = [
  'performance',
  'accessibility',
  'best-practices',
  'seo',
];
const AGENTIC_CATEGORY = 'agentic-browsing';
const CATEGORIES = [...SCORE_CATEGORIES, AGENTIC_CATEGORY];
const CDP_PORT = Number(process.env.LIGHTHOUSE_CDP_PORT ?? 9423);
const NOT_COUNTED = new Set([
  'notApplicable',
  'manual',
  'informative',
  'error',
]);

function parseTargets() {
  const raw = process.env.LIGHTHOUSE_TARGETS;
  if (!raw || !raw.trim()) {
    return [];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('LIGHTHOUSE_TARGETS must be a JSON array');
  }
  return parsed.map((entry, idx) => {
    if (
      !entry ||
      typeof entry.label !== 'string' ||
      typeof entry.url !== 'string'
    ) {
      throw new Error(`Invalid target at index ${idx}: expected {label, url}`);
    }
    return {
      label: entry.label.trim(),
      url: entry.url.trim(),
    };
  });
}

function safeFileLabel(label) {
  return label.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function extractScores(lhr) {
  const scores = {};
  for (const id of SCORE_CATEGORIES) {
    const score = lhr.categories[id]?.score;
    scores[id] = typeof score === 'number' ? Math.round(score * 100) : null;
  }
  return scores;
}

function extractAgenticBrowsing(lhr) {
  const category = lhr.categories[AGENTIC_CATEGORY];
  if (!category) {
    return null;
  }
  const audits = category.auditRefs.map((ref) => {
    const item = lhr.audits[ref.id];
    return {
      id: ref.id,
      title: item?.title ?? null,
      score: item?.score ?? null,
      scoreDisplayMode: item?.scoreDisplayMode ?? null,
    };
  });
  const counted = audits.filter((a) => !NOT_COUNTED.has(a.scoreDisplayMode));
  return {
    passed: counted.filter((a) => a.score !== null && a.score >= 0.9).length,
    applicable: counted.length,
    audits,
  };
}

async function auditUrl(url) {
  // Playwright exposes no wsEndpoint for Lighthouse, so launch Chromium on a
  // fixed CDP port and hand Lighthouse that port. Runs are sequential.
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${CDP_PORT}`],
  });
  try {
    const result = await lighthouse(url, {
      port: CDP_PORT,
      output: ['json', 'html'],
      onlyCategories: CATEGORIES,
    });
    if (!result?.lhr) {
      throw new Error('Lighthouse returned no result');
    }
    if (result.lhr.runtimeError) {
      throw new Error(
        `${result.lhr.runtimeError.code}: ${result.lhr.runtimeError.message}`,
      );
    }
    return result;
  } finally {
    await browser.close();
  }
}

function formatScore(value) {
  return value === null || value === undefined ? 'n/a' : String(value);
}

function buildMarkdownTable(rows) {
  const lines = [
    '### Lighthouse Audit (report-only)',
    '',
    '| Target | URL | Performance | Accessibility | Best Practices | SEO | Agentic browsing |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of rows) {
    if (row.error) {
      lines.push(
        `| ${row.label} | ${row.url} | error | error | error | error | error |`,
      );
      continue;
    }
    const agentic = row.agenticBrowsing
      ? `${row.agenticBrowsing.passed}/${row.agenticBrowsing.applicable}`
      : 'n/a';
    lines.push(
      `| ${row.label} | ${row.url} | ${formatScore(row.scores.performance)} | ${formatScore(row.scores.accessibility)} | ${formatScore(row.scores['best-practices'])} | ${formatScore(row.scores.seo)} | ${agentic} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const targets = parseTargets();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const summaryPath = join(OUTPUT_DIR, 'lighthouse-summary.json');

  const summary = {
    timestamp: new Date().toISOString(),
    categories: CATEGORIES,
    targets: [],
  };
  const tableRows = [];
  let hadError = false;

  console.log(`Lighthouse (report-only): ${CATEGORIES.join(', ')}`);

  for (const target of targets) {
    const { label, url } = target;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname.startsWith('private.')) {
        console.log(`  skip ${label} (private host)`);
        continue;
      }

      const { lhr, report } = await auditUrl(url);
      const fileLabel = safeFileLabel(label);
      writeFileSync(join(OUTPUT_DIR, `${fileLabel}.json`), report[0]);
      writeFileSync(join(OUTPUT_DIR, `${fileLabel}.html`), report[1]);

      const scores = extractScores(lhr);
      const agenticBrowsing = extractAgenticBrowsing(lhr);
      const entry = {
        label,
        url,
        scores,
        agenticBrowsing,
      };
      summary.targets.push(entry);
      tableRows.push(entry);
      writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

      const agenticText = agenticBrowsing
        ? `${agenticBrowsing.passed}/${agenticBrowsing.applicable}`
        : 'n/a';
      console.log(
        `  ${label} (${url}): perf=${formatScore(scores.performance)} a11y=${formatScore(scores.accessibility)} bp=${formatScore(scores['best-practices'])} seo=${formatScore(scores.seo)} agentic=${agenticText}`,
      );
    } catch (err) {
      hadError = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${label} (${url}): FAILED - ${message}`);
      tableRows.push({ label, url, error: message });
    }
  }

  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Summary written to ${summaryPath}`);

  if (process.env.GITHUB_STEP_SUMMARY && tableRows.length > 0) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      buildMarkdownTable(tableRows),
      'utf8',
    );
  }

  if (hadError) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Lighthouse audit error:', err);
  process.exitCode = 1;
});
