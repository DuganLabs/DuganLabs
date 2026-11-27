/**
 * Visual and layout gate for every greenput.com route.
 *
 * Screenshots: 320 / 768 / 1280, light and dark.
 * Overflow and metric labels: 320, 375, 390, 430, 768, 1280.
 * "Best practices" must stay one centered line at 320 — a wrap or a
 * left-aligned second line fails this test.
 * axe: serious and critical violations block the route.
 */
/* eslint-disable playwright/no-conditional-in-test, playwright/valid-title --
   Titles are the route slug. The rule only accepts a string literal. */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { readCraft, readLabels } from './craft';
import marketingWorker from '../../apps/marketing/src/worker/index';
import { GUIDES } from '../../apps/marketing/src/worker/geo/guides';
import { serveWorker, type WorkerServer } from './worker-server';

const axePath = 'node_modules/axe-core/axe.js';

const ROUTES = [
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

const LAYOUT_WIDTHS = [320, 375, 390, 430, 768, 1280] as const;
const SHOT_WIDTHS = [320, 768, 1280] as const;
const SCHEMES = ['light', 'dark'] as const;

function slug(route: string): string {
  if (route === '/') return 'home';
  return route.replace(/^\//, '').replace(/\//g, '-');
}

test.describe('marketing visual contract', () => {
  test.describe.configure({ timeout: 300_000 });
  test.use({ bypassCSP: true });
  let server: WorkerServer;

  test.beforeAll(async () => {
    server = await serveWorker(marketingWorker, {
      hostname: 'greenput.com',
      assetsDir: join(process.cwd(), 'apps/marketing/assets'),
    });
  });

  test.afterAll(async () => {
    await server?.close();
  });

  for (const route of ROUTES) {
    test(slug(route), async ({ page }) => {
      const failures: string[] = [];
      for (const width of LAYOUT_WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({
          colorScheme: 'light',
          reducedMotion: 'reduce',
        });
        await page.goto(server.origin + route, { waitUntil: 'load' });
        const overflow = await page.evaluate(() => {
          const root = document.documentElement;
          const offenders: string[] = [];
          const walk = (el: Element): void => {
            const cs = getComputedStyle(el);
            if (
              cs.overflowX !== 'visible' &&
              cs.overflowX !== 'clip' &&
              (cs.overflowX === 'auto' ||
                cs.overflowX === 'scroll' ||
                cs.overflowX === 'hidden')
            ) {
              return;
            }
            if (
              el.clientWidth > 0 &&
              el.scrollWidth > el.clientWidth + 1 &&
              cs.overflowX === 'visible'
            ) {
              const bn = el.getAttribute('data-bn');
              const text = (el.textContent ?? '')
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, 42);
              offenders.push(
                `${el.tagName.toLowerCase()}${bn ? `[data-bn="${bn}"]` : ''} ${el.scrollWidth}>${el.clientWidth} "${text}"`,
              );
            }
            if (offenders.length > 8) return;
            for (const child of el.children) walk(child);
          };
          walk(document.body);
          return {
            page:
              root.scrollWidth > window.innerWidth + 1
                ? root.scrollWidth - window.innerWidth
                : 0,
            offenders: offenders.slice(0, 8),
          };
        });
        if (overflow.page > 0) {
          failures.push(`${route} @${width} page overflow +${overflow.page}px`);
        }
        if (overflow.offenders.length) {
          failures.push(
            `${route} @${width} scrollWidth>clientWidth: ${overflow.offenders.join('; ')}`,
          );
        }
        const craft = await readCraft(page, width);
        for (const item of craft) failures.push(`${route} @${width} ${item}`);
        const labels = await readLabels(page);
        for (const label of labels) {
          const centered = label.textAlign === 'center' || label.delta <= 1;
          const tracking =
            label.letterSpacing === '0px' || label.letterSpacing === 'normal';
          if (
            label.lines !== 1 ||
            !centered ||
            label.textTransform !== 'none' ||
            !tracking ||
            label.whiteSpace !== 'nowrap' ||
            label.scrollWidth > label.clientWidth + 1
          ) {
            failures.push(
              `${route} @${width} label "${label.text}" lines=${label.lines} align=${label.textAlign} delta=${label.delta.toFixed(1)} transform=${label.textTransform} spacing=${label.letterSpacing} white=${label.whiteSpace} scroll=${label.scrollWidth} client=${label.clientWidth}`,
            );
          }
        }
        if (route === '/technology' && width === 320) {
          const best = labels.find((label) => label.text === 'Best practices');
          if (!best) failures.push('Best practices label missing at 320');
        }
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      await page.goto(server.origin + route, { waitUntil: 'load' });
      await page.addScriptTag({ path: axePath });
      const lightAxe = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: {
              run: (node: Document) => Promise<{
                violations: Array<{
                  id: string;
                  impact: string | null;
                  help: string;
                }>;
              }>;
            };
          }
        ).axe;
        const result = await axe.run(document);
        return result.violations
          .filter(
            (item) => item.impact === 'serious' || item.impact === 'critical',
          )
          .map((item) => {
            const sample = (
              item as { nodes?: Array<{ html?: string }> }
            ).nodes?.[0]?.html?.slice(0, 140);
            return `${item.impact} ${item.id}: ${item.help} :: ${sample ?? ''}`;
          });
      });
      if (lightAxe.length) {
        failures.push(`${route} axe light: ${lightAxe.join(' | ')}`);
      }

      await page.setViewportSize({ width: 320, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.goto(server.origin + route, { waitUntil: 'load' });
      await page.addScriptTag({ path: axePath });
      const darkAxe = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: {
              run: (node: Document) => Promise<{
                violations: Array<{
                  id: string;
                  impact: string | null;
                  help: string;
                }>;
              }>;
            };
          }
        ).axe;
        const result = await axe.run(document);
        return result.violations
          .filter(
            (item) => item.impact === 'serious' || item.impact === 'critical',
          )
          .map((item) => {
            const sample = (
              item as { nodes?: Array<{ html?: string }> }
            ).nodes?.[0]?.html?.slice(0, 140);
            return `${item.impact} ${item.id}: ${item.help} :: ${sample ?? ''}`;
          });
      });
      if (darkAxe.length) {
        failures.push(`${route} axe dark: ${darkAxe.join(' | ')}`);
      }

      expect(failures, failures.join('\n')).toEqual([]);

      for (const scheme of SCHEMES) {
        await page.emulateMedia({
          colorScheme: scheme,
          reducedMotion: 'reduce',
        });
        for (const width of SHOT_WIDTHS) {
          await page.setViewportSize({
            width,
            height: width === 1280 ? 900 : 844,
          });
          await page.goto(server.origin + route, { waitUntil: 'load' });
          await page.evaluate(async () => {
            const images = [...document.querySelectorAll('img')];
            await Promise.race([
              Promise.all(
                images.map(
                  (node) =>
                    new Promise<void>((resolve) => {
                      const img = node as HTMLImageElement;
                      const finish = () => resolve();
                      if (img.complete && img.naturalWidth > 0) {
                        finish();
                        return;
                      }
                      img.loading = 'eager';
                      img.addEventListener('load', finish, { once: true });
                      img.addEventListener('error', finish, { once: true });
                      const src = img.currentSrc || img.src;
                      if (src) img.src = src;
                    }),
                ),
              ),
              new Promise<void>((resolve) => setTimeout(resolve, 4000)),
            ]);
            await document.fonts.ready;
          });
          await page.evaluate(() => window.scrollTo(0, 0));
          const name = `${slug(route)}-${width}-${scheme}.png`;
          await expect.soft(page).toHaveScreenshot(name, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.02,
          });
        }
      }
    });
  }
});
