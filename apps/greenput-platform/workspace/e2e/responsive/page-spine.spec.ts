/**
 * The responsive contract for greenput.com and the contractor micro-sites.
 *
 * Two properties, measured in a real browser against this commit's own worker
 * source (see worker-server.ts for why not staging):
 *
 *   1. no page scrolls sideways at any width from 320px up, and nothing wide
 *      is clipped where a reader cannot scroll to it;
 *   2. every wrapper on the page spine starts on the same x as the brand.
 *
 * (2) is the one that has now been fixed three times. The reason it kept
 * coming back is that each fix made three separate mechanisms agree at the
 * widths someone happened to check, instead of reducing them to one. So the
 * spine membership below is read out of the stylesheet's own rule rather than
 * re-listed here: if a wrapper leaves that rule, or a second rule starts
 * computing a gutter of its own, this test measures the consequence and
 * design-contract.spec.ts catches the cause.
 */
/*
 * Each test sweeps many widths and collects every failure before asserting
 * once, so a red build names every width that broke rather than only the
 * first. That means a conditional inside the test body, which
 * playwright/no-conditional-in-test flags by default; the alternative — one
 * test per route per width — would be ~600 tests and would still only report
 * the first failure per width.
 */
/* eslint-disable playwright/no-conditional-in-test */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { siteStyles } from '../../apps/marketing/src/worker/styles';
import marketingWorker from '../../apps/marketing/src/worker/index';
import { GUIDES } from '../../apps/marketing/src/worker/geo/guides';
import { tenantStyles } from '../../apps/tenant-site/src/render';
import tenantWorker from '../../apps/tenant-site/src/index';
import {
  BOUNDARY_WIDTHS,
  WIDTHS,
  explain,
  measure,
  type Measurement,
} from './measure';
import { tenantStubEnv } from './tenant-env';
import { serveWorker, type WorkerServer } from './worker-server';

/**
 * The selector list of a stylesheet's page-spine rule, read from the sheet.
 *
 * The rule is identified by the one declaration that defines it — the inline
 * padding taken from the gutter token — so this cannot drift out of sync with
 * the CSS the way a hand-maintained copy would. An empty result fails the
 * guard test below rather than silently checking nothing.
 */
function spineSelectorOf(css: string, gutterToken: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(
    `([^{}]+)\\{[^{}]*padding-inline\\s*:\\s*var\\(\\s*${gutterToken}\\s*\\)`,
    'g',
  );
  const lists: string[] = [];
  for (const m of stripped.matchAll(re)) {
    // The captured text may include the tail of the previous rule.
    const list = m[1].slice(m[1].lastIndexOf('}') + 1).trim();
    if (list && !list.startsWith('@')) lists.push(list);
  }
  return lists.join(', ');
}

const MARKETING_SPINE = spineSelectorOf(siteStyles, '--page-gutter');
const TENANT_SPINE = spineSelectorOf(tenantStyles, '--page-gutter');

const MARKETING_ROUTES = [
  '/',
  '/features',
  '/pricing',
  '/contact',
  '/about',
  '/technology',
  '/ai',
  '/investors',
  '/privacy',
  '/terms',
  ...GUIDES.map((guide) => guide.path),
  '/no-such-page',
];

/**
 * Tenant routes the stub env can serve. `/no-such-page` still renders the
 * full tenant shell (branded, noindexed, nav and footer intact), so it counts
 * as a surface rather than as an error page.
 */
const TENANT_ROUTES = [
  '/',
  '/services',
  '/about',
  '/contact',
  '/quote',
  '/proposal',
  '/invoice',
  '/no-such-page',
];

/**
 * A workspace name long enough to be ordinary and long enough to break a
 * header that never truncates. The demo tenant's 18-character name is the
 * only reason the untruncated brand was not already visible in production.
 */
const LONG_TENANT_NAME =
  'Rivertown Electrical Contracting & Generator Services';

interface Surface {
  name: string;
  routes: string[];
  spine: string;
  brand: string;
  server: () => Promise<WorkerServer>;
}

const SURFACES: Surface[] = [
  {
    name: 'marketing',
    routes: MARKETING_ROUTES,
    spine: MARKETING_SPINE,
    brand: '[data-bn="bn-brand"]',
    server: () =>
      serveWorker(marketingWorker, {
        hostname: 'greenput.com',
        assetsDir: join(process.cwd(), 'apps/marketing/assets'),
      }),
  },
  {
    name: 'tenant-site',
    routes: TENANT_ROUTES,
    spine: TENANT_SPINE,
    brand: '[data-bn="bn-brand"]',
    server: () =>
      serveWorker(tenantWorker, {
        hostname: 'demo.greenput.com',
        env: tenantStubEnv({ quote: true }),
      }),
  },
];

test.describe('responsive contract', () => {
  test('each stylesheet declares exactly one page-spine rule', () => {
    // Guard on the derivation: every assertion below reads its membership
    // from these, so an empty or renamed spine must fail here and not pass
    // silently by checking nothing.
    for (const [label, spine] of [
      ['marketing', MARKETING_SPINE],
      ['tenant-site', TENANT_SPINE],
    ] as const) {
      expect(spine, `${label} has no page-spine rule`).not.toBe('');
      expect(spine, `${label} spine is the shared column`).toContain(
        '[data-bn-column]',
      );
      expect(spine.split(',').map((part) => part.trim())).toEqual([
        '[data-bn-column]',
      ]);
    }
  });

  for (const surface of SURFACES) {
    test.describe(surface.name, () => {
      let server: WorkerServer;

      test.beforeAll(async () => {
        server = await surface.server();
      });

      test.afterAll(async () => {
        await server?.close();
      });

      // ── 1. the page never scrolls sideways ──────────────────────────────

      for (const route of surface.routes) {
        test(`no horizontal overflow on ${route}`, async ({ page }) => {
          const failures: string[] = [];
          for (const width of [...WIDTHS, ...BOUNDARY_WIDTHS]) {
            await page.setViewportSize({ width, height: 844 });
            await page.goto(server.origin + route, { waitUntil: 'load' });
            const m: Measurement = await measure(
              page,
              surface.spine,
              surface.brand,
            );
            if (m.overflow > 0 || m.spills.length || m.unreachable.length)
              failures.push(explain(route, width, m));
          }
          expect(
            failures.join('\n\n'),
            'the page body must not scroll sideways at any width from 320px up, and wide content must scroll inside its own container',
          ).toBe('');
        });
      }

      // ── 2. the brand and the content column agree ───────────────────────
      for (const route of surface.routes) {
        // Every marketing document is the v4 shell. It has no
        // design-system column and no [data-bn="bn-brand"] to line up on.
        if (surface.name === 'marketing') continue;

        test(`brand and content column line up on ${route}`, async ({
          page,
        }) => {
          const failures: string[] = [];
          for (const width of [...WIDTHS, ...BOUNDARY_WIDTHS]) {
            await page.setViewportSize({ width, height: 844 });
            await page.goto(server.origin + route, { waitUntil: 'load' });
            const m: Measurement = await measure(
              page,
              surface.spine,
              surface.brand,
            );
            expect(
              m.brandLeft,
              `${route} @${width} has no ${surface.brand} to line up against`,
            ).not.toBeNull();
            const toolbarWidth =
              width === 768 || width === 1024 || width === 1280;
            if (m.spineDrift.length || (toolbarWidth && m.toolbarDrift.length))
              failures.push(explain(route, width, m));
          }
          expect(
            failures.join('\n\n'),
            'every wrapper on the page spine must start on the same x as the brand — one mechanism, not three that agree',
          ).toBe('');
        });
      }
    });
  }

  // ── the header must survive a real trade name ─────────────────────────────
  // Not a width sweep but the same property: the tenant header is a nowrap
  // flex row, and the brand was the one child that refused to shrink, so the
  // page's width was a function of the contractor's name.
  test('a long workspace name does not widen the tenant header', async ({
    page,
  }) => {
    const server = await serveWorker(tenantWorker, {
      hostname: 'demo.greenput.com',
      env: tenantStubEnv({ name: LONG_TENANT_NAME }),
    });
    try {
      const failures: string[] = [];
      for (const width of [...WIDTHS, ...BOUNDARY_WIDTHS]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(server.origin + '/', { waitUntil: 'load' });
        const rendered = await page
          .locator('[data-bn="nav-name"] strong')
          .textContent();
        expect(
          rendered?.trim(),
          'the long workspace name never reached the header, so this asserts nothing',
        ).toBe(LONG_TENANT_NAME);
        const m = await measure(page, TENANT_SPINE, '[data-bn="bn-brand"]');
        if (m.overflow > 0 || m.spills.length || m.spineDrift.length)
          failures.push(
            explain(
              `/ (${LONG_TENANT_NAME.length}-char workspace name)`,
              width,
              m,
            ),
          );
      }
      expect(
        failures.join('\n\n'),
        'the tenant header must fit the viewport whatever the workspace is called — the brand truncates, the tap targets do not shrink',
      ).toBe('');
    } finally {
      await server.close();
    }
  });
});
