/**
 * Reference diff for the marketing surface.
 *
 * Each route screenshot is compared with the live production page at the
 * same width and color scheme, and with the Apple 27 kit PNG that matches
 * the viewport (phone → iOS materials / tab bar, wide → macOS materials).
 * Pixel inequality is recorded. It does not fail the run: production is the
 * previous design, and the kit is a different medium. A fresh reviewer
 * scores the artifacts. Kit files are never copied into the repo.
 */
/* eslint-disable playwright/no-conditional-in-test */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import marketingWorker from '../../apps/marketing/src/worker/index';
import { GUIDES } from '../../apps/marketing/src/worker/geo/guides';
import { serveWorker, type WorkerServer } from './worker-server';

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

const WIDTHS = [320, 768, 1280] as const;
const SCHEMES = ['light', 'dark'] as const;
const OUT = join(process.cwd(), 'dist/.playwright/responsive/reference-diff');

function slug(route: string): string {
  if (route === '/') return 'home';
  return route.replace(/^\//, '').replace(/\//g, '-');
}

function kitRoot(): string | null {
  const fromEnv = process.env['KIT_REFERENCE_DIR'];
  const candidates = [
    fromEnv,
    '/tmp/apple27/basenative-figma-shots',
    '/tmp/apple27',
  ].filter((dir): dir is string => !!dir);
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

function findKit(root: string, name: string): string | null {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name === name) return path;
    }
  }
  return null;
}

async function shoot(
  page: Page,
  url: string,
  width: number,
  scheme: 'light' | 'dark',
): Promise<Buffer> {
  await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll('img')].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    });
    await Promise.race([
      Promise.all(
        images.map(
          (node) =>
            new Promise<void>((resolve) => {
              const img = node as HTMLImageElement;
              if (img.complete && img.naturalWidth > 0) {
                resolve();
                return;
              }
              const finish = () => resolve();
              img.addEventListener('load', finish, { once: true });
              img.addEventListener('error', finish, { once: true });
              const src = img.currentSrc || img.src;
              if (src) img.src = src;
            }),
        ),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
    await document.fonts.ready;
  });
  return page.screenshot({ animations: 'disabled', caret: 'hide' });
}

async function diffRatio(page: Page, left: Buffer, right: Buffer): Promise<number> {
  return page.evaluate(
    async ({ a, b }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('image'));
          img.src = src;
        });
      const [ia, ib] = await Promise.all([
        load(`data:image/png;base64,${a}`),
        load(`data:image/png;base64,${b}`),
      ]);
      const w = Math.min(ia.naturalWidth, ib.naturalWidth, 640);
      const h = Math.min(ia.naturalHeight, ib.naturalHeight, 480);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 1;
      const sample = (img: HTMLImageElement) => {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const da = sample(ia);
      const db = sample(ib);
      let changed = 0;
      const pixels = w * h;
      for (let i = 0; i < da.length; i += 16) {
        const delta =
          Math.abs((da[i] ?? 0) - (db[i] ?? 0)) +
          Math.abs((da[i + 1] ?? 0) - (db[i + 1] ?? 0)) +
          Math.abs((da[i + 2] ?? 0) - (db[i + 2] ?? 0));
        if (delta > 48) changed++;
      }
      return changed / (pixels / 4);
    },
    { a: left.toString('base64'), b: right.toString('base64') },
  );
}

test.describe('marketing reference diff', () => {
  test.describe.configure({ timeout: 600_000 });
  let server: WorkerServer;

  test.beforeAll(async () => {
    server = await serveWorker(marketingWorker, {
      hostname: 'greenput.com',
      assetsDir: join(process.cwd(), 'apps/marketing/assets'),
    });
    mkdirSync(OUT, { recursive: true });
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test('records production and kit diffs without treating inequality as failure', async ({
    page,
  }) => {
    const root = kitRoot();
    const phoneKit = root && existsSync(join(root, 'ios/Tab-Bars.png'))
      ? join(root, 'ios/Tab-Bars.png')
      : root
        ? findKit(root, 'Tab-Bars.png')
        : null;
    const wideKit = root && existsSync(join(root, 'macos/Materials.png'))
      ? join(root, 'macos/Materials.png')
      : root
        ? findKit(root, 'Materials.png')
        : null;
    const phoneKitPng = phoneKit ? readFileSync(phoneKit) : null;
    const wideKitPng = wideKit ? readFileSync(wideKit) : null;
    const entries: Array<Record<string, string | number | null>> = [];

    for (const route of ROUTES) {
      for (const scheme of SCHEMES) {
        for (const width of WIDTHS) {
          const name = `${slug(route)}-${width}-${scheme}`;
          const local = await shoot(page, server.origin + route, width, scheme);
          writeFileSync(join(OUT, `${name}-local.png`), local);
          let production: Buffer | null = null;
          let productionError: string | null = null;
          try {
            production = await shoot(page, `https://greenput.com${route}`, width, scheme);
            writeFileSync(join(OUT, `${name}-production.png`), production);
          } catch (error) {
            productionError = error instanceof Error ? error.message : 'production fetch failed';
          }
          const kitPng = width < 768 ? phoneKitPng : wideKitPng;
          const kitPath = width < 768 ? phoneKit : wideKit;
          entries.push({
            name,
            route,
            width,
            scheme,
            productionError,
            productionDiff: production ? Number((await diffRatio(page, local, production)).toFixed(3)) : null,
            kit: kitPath,
            kitDiff: kitPng ? Number((await diffRatio(page, local, kitPng)).toFixed(3)) : null,
          });
        }
      }
    }

    const report = {
      note: 'Diff ratios are evidence for a reviewer. A high ratio against production or the kit is expected and is not a failure.',
      kitRoot: root,
      entries,
    };
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    expect(entries).toHaveLength(ROUTES.length * WIDTHS.length * SCHEMES.length);
    const missing = entries.filter((entry) => entry.productionError);
    expect(missing, missing.map((entry) => `${entry.name}: ${entry.productionError}`).join('\n')).toEqual(
      [],
    );
  });
});
