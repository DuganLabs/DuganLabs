/**
 * Captures the five product screenshots greenput.com/features shows, from
 * the real product.
 *
 * Nothing here draws a mockup. The pixels come out of apps/platform's
 * production build rendering what apps/api's real `fetch` handler returns,
 * and out of apps/tenant-site's real `fetch` handler, both over one real
 * SQLite database built from schema.sql — the same `createSqliteD1` harness
 * the Workers' own end-to-end specs use. The only stubs are KV (a Map;
 * sessions are the one thing D1 does not hold) and the clock's zone.
 *
 * ── STATUS (2026-09-14): writes all five ─────────────────────────────────
 *
 * The 2026-09-11 note that used to sit here recorded that this harness wrote
 * nothing: apps/api's list endpoints returned snake_case D1 rows verbatim
 * while apps/platform read the camelCase models in libs/shared/models, so
 * every list screen rendered "Invalid Date" / "Could not load". That is
 * fixed — the read path now goes through the wire contract
 * (`entity` / `entityArray` over the WIRE_* schemas in
 * libs/shared/models/src/wire.ts), the SPA gets the models it declares, and
 * the guards below pass against the real API. The guards stay: a shot is
 * only written if its screen renders the seeded data and no text on it says
 * Invalid Date / NaN / undefined, and no shot is written unless every shot
 * passes. They are what turned the earlier break into a hard stop instead
 * of a marketing page quietly photographing a bug.
 *
 * ── What each shot shows, and what to look for ───────────────────────────
 *
 *   leads.webp       /leads, kanban view. Five columns — New, Contacted,
 *                    Qualified, Unqualified, Converted — with fifteen cards
 *                    across them, each a name, a service type and a dollar
 *                    figure. Look for: no empty column, no "$0" on a card
 *                    other than the Unqualified one, no "Could not load".
 *   scheduling.webp  /jobs?view=calendar&week=<this week>. The week grid
 *                    with six blocks Mon–Fri, all inside 8 AM–5 PM Chicago
 *                    time (two on Monday), and the "won deals" sidebar with
 *                    two cards to drag on. Look for: the week heading is the
 *                    CURRENT week, blocks sit on business hours (a block at
 *                    2 AM means the zone pin broke), each block is titled.
 *   invoicing.webp   GET /api/jobs/<JOB-1037>/invoice — the invoice
 *                    document libs/shared/documents renders for an invoiced
 *                    job: contractor and customer blocks, three line items,
 *                    Subtotal and Total Due of $290.00. Look for: amounts in
 *                    the hundreds of dollars, not tens of thousands (the
 *                    columns are cents), and an "Invoiced" date.
 *   customers.webp   /customers/<Jordan Lee>. The customer's definition
 *                    list (contact, address, lifetime value "$2,185 · 3
 *                    jobs") and the job-history table with three rows:
 *                    scheduled, invoiced, paid. Look for: three status
 *                    badges, no "Invalid Date" in the Scheduled column.
 *   portal.webp      https://demo.greenput.com/proposal/<EST-1019>, served
 *                    by apps/tenant-site in-process — the homeowner-facing
 *                    proposal: Rivertown Electric's header, SENT badge,
 *                    three typed line items (Materials / Labor), Subtotal
 *                    $1,190.00, Tax (8.25%) and Total $1,288.18. Look for:
 *                    the Type column filled in, the tax line reading a
 *                    percentage and not "0.0825%".
 *
 * It NEVER touches a deployed environment: no Cloudflare credential is in the
 * process, there is no D1 binding, and the only origins it talks to are the
 * two it starts on 127.0.0.1 (plus fonts.googleapis.com, which both apps'
 * HTML asks for — the screenshots have to be in Archivo / DM Sans, not a
 * fallback stack).
 *
 * Run (see capture.mjs for the TZ pin and the alias list):
 *   NODE_OPTIONS=--max-old-space-size=4096 \
 *     pnpm exec vite build --config apps/platform/vite.config.ts
 *   node scripts/screenshots/capture.mjs
 * Chromium comes from Playwright's own download; set CHROMIUM_PATH for a
 * sandbox that ships its own build, and LD_LIBRARY_PATH if libnss3 and
 * friends live outside the system library path.
 */
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { createSqliteD1 } from '@greenput/shared/testing';
import apiWorker from '../../apps/api/src/index';
import tenantWorker from '../../apps/tenant-site/src/index';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SPA_DIR = join(ROOT, 'dist', 'apps', 'platform');
const OUT_DIR = join(ROOT, 'apps', 'marketing', 'assets', 'screens');

/** The seed workspace is in Texas; capture.mjs pins the process to match. */
const TIMEZONE = 'America/Chicago';

/**
 * The tile on /features is a 16/10 box. Captured at 1600x1000 CSS px at a
 * device pixel ratio of 1 and written at the same size: 16:10, wide enough
 * that the tile is never upscaled at any layout width, and the platform's
 * desktop rail (a drawer below 64rem) is in frame with room for the
 * calendar's five columns beside its sidebar.
 */
const VIEWPORT = { width: 1600, height: 1000 } as const;
const OUTPUT = { width: 1600, height: 1000 } as const;
/**
 * WebP, no JPEG fallback. Every browser that can render this page can decode
 * WebP: the marketing stylesheet already requires `light-dark()` (Safari
 * 17.5, Chrome 123) and `@layer` (Safari 15.4, Chrome 99), all of which
 * shipped years after WebP (Safari 14, Chrome 32). A fallback copy would be
 * bytes in the repo for a browser that cannot read the page anyway.
 *
 * 0.82 is the knee for flat UI: below ~0.75 the 1px rules and badge edges
 * ring, above ~0.88 the file grows with nothing visible to show for it.
 */
const WEBP_QUALITY = 0.82;

/** The signed-in user — the row scripts/screenshots/seed.sql inserts. */
const SESSION_USER = {
  id: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  email: 'demo@greenput.com',
  role: 'owner',
  firstName: 'Demo',
  lastName: 'User',
};

/** Rows the seed inserts that the shots address by id. */
const SEED = {
  /** JOB-1037, status invoiced, three line items. */
  invoicedJobId: '00000000-0000-4000-8000-000000000608',
  /** Jordan Lee: a scheduled, an invoiced and a paid job. */
  customerId: '00000000-0000-4000-8000-000000000804',
  /** EST-1019, status sent, typed line items. */
  estimateId: '00000000-0000-4000-8000-000000000301',
  /** Every job in the seed — the API probe checks the seed loaded whole. */
  jobCount: 9,
  /** Jobs the seed puts in the current week. */
  jobsThisWeek: 6,
} as const;

/**
 * The tenant site resolves its workspace from the hostname, so every request
 * the harness forwards to it is re-addressed to the demo workspace's
 * subdomain. Nothing is fetched from this host; it is a label on a Request.
 */
const TENANT_HOST = 'demo.greenput.com';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

interface Shot {
  /** Output file name, and the `feature.id` on /features it belongs to. */
  readonly id: string;
  /** Which in-process origin serves it. */
  readonly origin: 'platform' | 'tenant';
  readonly path: string;
  /** Drives the screen into the state worth photographing, and proves it. */
  readonly prepare: (page: Page) => Promise<void>;
}

/** Local `YYYY-MM-DD`, the format `/jobs?week=` reads. */
function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday of the current week in the pinned zone. */
function mondayOfThisWeek(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + 1);
  return d;
}

/** A platform route has mounted once its route host is on screen. */
async function routeMounted(page: Page): Promise<void> {
  await page.locator('[data-bn-list-route]').waitFor({ state: 'visible' });
}

const SHOTS: readonly Shot[] = [
  {
    id: 'leads',
    origin: 'platform',
    path: '/leads',
    prepare: async (page) => {
      await routeMounted(page);
      await page.getByTestId('leads-view-kanban').click();
      // Every column the board declares, and cards across them.
      await expectCount(page, '[data-bn="pipeline-column"]', 5);
      await expectAtLeast(page, '[data-bn="pipeline-card"]', 10);
    },
  },
  {
    id: 'scheduling',
    origin: 'platform',
    // Addressable since GP-006/062: the calendar on this week, no click.
    path: `/jobs?view=calendar&week=${localDate(mondayOfThisWeek())}`,
    prepare: async (page) => {
      await routeMounted(page);
      await expectAtLeast(page, '[data-bn="calendar-event"]', 5);
      const found = await page.locator('[data-bn="calendar-event"]').count();
      if (found !== SEED.jobsThisWeek) {
        throw new Error(
          `calendar: expected ${SEED.jobsThisWeek} blocks this week, found ${found}`,
        );
      }
    },
  },
  {
    id: 'invoicing',
    origin: 'platform',
    // The invoice DOCUMENT, not the list that raises it: text/html straight
    // from apps/api, rendered by libs/shared/documents.
    path: `/api/jobs/${SEED.invoicedJobId}/invoice`,
    prepare: async (page) => {
      await page.getByText('Total Due').waitFor({ state: 'visible' });
      await page.getByText('$290.00').first().waitFor({ state: 'visible' });
    },
  },
  {
    id: 'customers',
    origin: 'platform',
    path: `/customers/${SEED.customerId}`,
    prepare: async (page) => {
      await routeMounted(page);
      await page
        .locator('[data-bn-detail-fields]')
        .waitFor({ state: 'visible' });
      await expectAtLeast(
        page,
        '[data-testid="customer-detail-jobs"] tbody tr',
        1,
      );
    },
  },
  {
    id: 'portal',
    origin: 'tenant',
    path: `/proposal/${SEED.estimateId}`,
    prepare: async (page) => {
      await page
        .locator('[data-bn="totals-row"][data-bn-grand]')
        .getByText('$1,288.18')
        .waitFor({ state: 'visible' });
    },
  },
];

/**
 * Text that means a field did not arrive. A screenshot is a claim about the
 * product, so this is checked on every shot: "Invalid Date" in a Scheduled
 * column is exactly how a read-path break renders, and it would have gone
 * to production on a marketing page unnoticed.
 */
const BROKEN_TEXT =
  /Invalid Date|NaN|undefined|\[object Object\]|Could not load|--:--/;

async function expectCount(
  page: Page,
  selector: string,
  count: number,
): Promise<void> {
  await page
    .locator(selector)
    .nth(count - 1)
    .waitFor({ state: 'visible' });
  const found = await page.locator(selector).count();
  if (found !== count) {
    throw new Error(`${selector}: expected ${count} on screen, found ${found}`);
  }
}

async function expectAtLeast(
  page: Page,
  selector: string,
  count: number,
): Promise<void> {
  await page
    .locator(selector)
    .nth(count - 1)
    .waitFor({ state: 'visible' });
}

/** Throws if the rendered page shows a field that did not arrive. */
async function assertNothingUnrendered(page: Page, id: string): Promise<void> {
  const offending = await page.evaluate((source) => {
    const pattern = new RegExp(source);
    const hits: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      if (text && pattern.test(text)) hits.push(text.slice(0, 120));
    }
    return hits;
  }, BROKEN_TEXT.source);
  if (offending.length > 0) {
    throw new Error(
      `${id}: the screen rendered a field that never arrived — ${offending
        .slice(0, 5)
        .join(' | ')}`,
    );
  }
}

/** A KV-shaped stub over a Map — a session is all this harness stores. */
function kvStub(store: Map<string, string>): unknown {
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ keys: [], list_complete: true }),
  };
}

/** The whole incoming request as a fetch Request, addressed to `base`. */
async function toRequest(
  req: import('node:http').IncomingMessage,
  base: string,
): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' && key !== 'host') headers.set(key, value);
  }
  // Every limiter in apps/api keys off this header.
  headers.set('CF-Connecting-IP', '203.0.113.7');
  const method = req.method ?? 'GET';
  return new Request(`${base}${req.url ?? '/'}`, {
    method,
    headers,
    body:
      method === 'GET' || method === 'HEAD' || chunks.length === 0
        ? undefined
        : Buffer.concat(chunks),
  });
}

async function relay(
  res: import('node:http').ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

interface Origin {
  origin: string;
  close: () => Promise<void>;
}

async function listen(server: Server): Promise<Origin> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done, fail) =>
        server.close((err) => (err ? fail(err) : done())),
      ),
  };
}

const EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as never;

/**
 * The platform origin: apps/api's Worker for /api/*, the built SPA for
 * everything else. One origin is what the SPA expects —
 * `resolveGreenPutApiBase` returns '' for localhost, so the client calls
 * /api/… same-origin — and it keeps the session cookie a first-party cookie.
 * The Worker is called the way Cloudflare calls it (a real Request, the env,
 * an ExecutionContext), so its whole middleware chain runs: rate limit, API
 * key, requireAuth, billing gate.
 */
function servePlatform(env: unknown): Promise<Origin> {
  return listen(
    createServer((req, res) => {
      void (async () => {
        const path = (req.url ?? '/').split('?')[0];
        if (path.startsWith('/api/')) {
          const request = await toRequest(req, 'http://127.0.0.1');
          await relay(
            res,
            await apiWorker.fetch(request, env as never, EXECUTION_CONTEXT),
          );
          return;
        }

        const file = join(SPA_DIR, path === '/' ? 'index.html' : path);
        try {
          const body = readFileSync(file);
          res.writeHead(200, {
            'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
          });
          res.end(body);
        } catch {
          // History-routed SPA: any path that is not a file is a route.
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(readFileSync(join(SPA_DIR, 'index.html')));
        }
      })();
    }),
  );
}

/**
 * The tenant origin: apps/tenant-site's Worker, the one that serves
 * <slug>.greenput.com. It resolves the workspace from the hostname, so each
 * request is re-addressed to the demo subdomain before it is handed over —
 * exactly how that Worker's own specs build their requests. Its env is the
 * specs' env: the same database, and nothing else.
 */
function serveTenant(env: unknown): Promise<Origin> {
  return listen(
    createServer((req, res) => {
      void (async () => {
        const request = await toRequest(req, `https://${TENANT_HOST}`);
        await relay(res, await tenantWorker.fetch(request, env as never));
      })();
    }),
  );
}

/**
 * Re-encodes a capture as WebP at `OUTPUT`, in Chromium: `createImageBitmap`
 * does any resample (`resizeQuality: 'high'`, a real filter rather than the
 * nearest-neighbour a naive drawImage gives) and libwebp does the encode. No
 * image library, no native build step, and the encoder is the one every
 * visitor's browser decodes with.
 *
 * `page` must be a blank page of its own, never the one that was shot: the
 * documents apps/api and apps/tenant-site serve carry a CSP whose
 * connect-src refuses the `data:` fetch this starts with.
 */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ pngBase64, width, height, quality }) => {
      const blob = await (
        await fetch(`data:image/png;base64,${pngBase64}`)
      ).blob();
      const bitmap = await createImageBitmap(blob, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
      });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const url = canvas.toDataURL('image/webp', quality);
      if (!url.startsWith('data:image/webp')) {
        throw new Error(`browser did not encode WebP: ${url.slice(0, 30)}`);
      }
      return url.slice(url.indexOf(',') + 1);
    },
    {
      pngBase64: png.toString('base64'),
      width: OUTPUT.width,
      height: OUTPUT.height,
      quality: WEBP_QUALITY,
    },
  );
  return Buffer.from(base64, 'base64');
}

async function main(): Promise<void> {
  if (!existsSync(join(SPA_DIR, 'index.html'))) {
    throw new Error(
      `No SPA build at ${SPA_DIR} — build apps/platform first (see the header).`,
    );
  }
  if (process.env['TZ'] !== TIMEZONE) {
    throw new Error(
      `TZ is ${process.env['TZ'] ?? 'unset'}, not ${TIMEZONE} — run this through capture.mjs`,
    );
  }

  const sqlite = createSqliteD1({
    files: [join(ROOT, 'schema.sql'), join(import.meta.dirname, 'seed.sql')],
  });
  const sessions = new Map<string, string>();
  const token = randomUUID();
  sessions.set(`session:${token}`, JSON.stringify(SESSION_USER));

  const platform = await servePlatform({
    DB: sqlite.db,
    SESSIONS: kvStub(sessions),
    ENVIRONMENT: 'development',
  });
  const tenant = await serveTenant({ DB: sqlite.db, ENVIRONMENT: 'test' });
  const origins = { platform: platform.origin, tenant: tenant.origin };
  const closeAll = async (): Promise<void> => {
    await platform.close();
    await tenant.close();
    sqlite.close();
  };

  // Fail before Chromium starts if the API is not serving the seed.
  const probe = await fetch(`${platform.origin}/api/jobs`, {
    headers: { cookie: `gp_session=${token}` },
  });
  const probeBody = (await probe.json()) as { data?: unknown[] };
  if (!probe.ok || (probeBody.data ?? []).length !== SEED.jobCount) {
    await closeAll();
    throw new Error(
      `GET /api/jobs answered ${probe.status} with ${
        (probeBody.data ?? []).length
      } jobs, expected ${SEED.jobCount} — the seed or the session is wrong`,
    );
  }

  // CAPTURE_PNG_DIR=<dir> also keeps the lossless capture of every shot,
  // for looking at a run without decoding WebP.
  const pngDir = process.env['CAPTURE_PNG_DIR'];
  if (pngDir) mkdirSync(pngDir, { recursive: true });

  let browser: Browser | undefined;
  const captured: { id: string; webp: Buffer }[] = [];
  try {
    browser = await chromium.launch({
      // Playwright's own download in CI; CHROMIUM_PATH for a sandbox that
      // ships its own build.
      ...(process.env['CHROMIUM_PATH']
        ? { executablePath: process.env['CHROMIUM_PATH'] }
        : {}),
    });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      timezoneId: TIMEZONE,
      locale: 'en-US',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    // The real session cookie for the real `requireAuth`. No password, no
    // passkey, and nothing that could reach a deployed environment.
    await context.addCookies([
      { name: 'gp_session', value: token, url: platform.origin },
    ]);

    const page = await context.newPage();
    // Where the WebP encode runs — see toWebp.
    const encoder = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    // A screen that cannot render the data never will; waiting the default
    // 30s per locator only makes a red run slower.
    page.setDefaultTimeout(15_000);

    for (const shot of SHOTS) {
      pageErrors.length = 0;
      await page.goto(`${origins[shot.origin]}${shot.path}`, {
        waitUntil: 'load',
      });
      try {
        await shot.prepare(page);
      } catch (err) {
        // A screen that threw while rendering times out here as "nothing
        // appeared"; the thrown message is the useful half, so lead with it.
        throw new Error(
          `${shot.id} (${shot.path}): ${
            pageErrors[0] ?? (err as Error).message
          }`,
          { cause: err },
        );
      }
      if (pageErrors.length > 0) {
        throw new Error(`${shot.id}: the screen threw — ${pageErrors[0]}`);
      }
      await assertNothingUnrendered(page, shot.id);
      // Both apps load their family from fonts.googleapis.com; capturing
      // before it lands photographs the fallback stack.
      await page.evaluate(() => document.fonts.ready);
      // A tab click leaves a focus ring on the tab, which is not what the
      // screen looks like at rest.
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
      const png = await page.screenshot({
        type: 'png',
        animations: 'disabled',
      });
      if (pngDir) writeFileSync(join(pngDir, `${shot.id}.png`), png);
      captured.push({ id: shot.id, webp: await toWebp(encoder, png) });
    }
    await context.close();
  } finally {
    await browser?.close();
    await closeAll();
  }

  // All or nothing: a features page with half its tiles filled in is worse
  // than one with none, so nothing is written until every shot has passed.
  mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  for (const { id, webp } of captured) {
    writeFileSync(join(OUT_DIR, `${id}.webp`), webp);
    total += webp.byteLength;
    console.log(
      `${id.padEnd(12)} ${String(webp.byteLength).padStart(7)} bytes`,
    );
  }
  console.log(`${'TOTAL'.padEnd(12)} ${String(total).padStart(7)} bytes`);
}

await main();
