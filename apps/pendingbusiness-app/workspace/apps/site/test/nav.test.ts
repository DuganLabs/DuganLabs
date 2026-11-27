import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Vitest runs each package's tests from the package directory, so cwd is
// `apps/site`. We can't use `import.meta.url` here — under the jsdom env
// it's a synthetic non-file URL and `fileURLToPath` rejects it.
const SRC = resolve(process.cwd(), 'src');

async function load(file: string): Promise<Document> {
  const html = await readFile(resolve(SRC, file), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

interface NavExpectation {
  file: string;
  current: { text: string; href: string };
}

const PAGES: readonly NavExpectation[] = [
  { file: 'app.html', current: { text: 'Dashboard', href: '/app' } },
  { file: 'account.html', current: { text: 'Account', href: '/account' } },
  { file: 'settings.html', current: { text: 'Settings', href: '/settings' } },
];

/** Every page file, and the one URL it is served at. */
const ROUTES: Readonly<Record<string, string>> = {
  'index.html': '/',
  'app.html': '/app',
  'account.html': '/account',
  'settings.html': '/settings',
  'welcome.html': '/welcome',
  'login.html': '/login',
};

describe('aria-current="page" on dashboard nav', () => {
  for (const { file, current } of PAGES) {
    it(`${file} marks "${current.text}" as the current page`, async () => {
      const doc = await load(file);
      const marked = doc.querySelectorAll('header nav a[aria-current="page"]');
      expect(marked).toHaveLength(1);
      expect(marked[0]?.textContent?.trim()).toBe(current.text);
      expect(marked[0]?.getAttribute('href')).toBe(current.href);
    });
  }

  it('every dashboard page ships the same three section links in the same order', async () => {
    const labels = ['Dashboard', 'Account', 'Settings'];
    for (const { file } of PAGES) {
      const doc = await load(file);
      const links = [...doc.querySelectorAll('header nav ul[aria-label="sections"] > li > a')];
      expect(
        links.map(a => a.textContent?.trim()),
        `${file} nav order`,
      ).toEqual(labels);
    }
  });

  it('all dashboard pages link to /app, /account, /settings', async () => {
    const expectedHrefs = new Set(['/app', '/account', '/settings']);
    for (const { file } of PAGES) {
      const doc = await load(file);
      const hrefs = new Set(
        [...doc.querySelectorAll('header nav ul[aria-label="sections"] > li > a')].map(
          a => a.getAttribute('href') ?? '',
        ),
      );
      expect(hrefs, `${file} nav hrefs`).toEqual(expectedHrefs);
    }
  });
});

/*
 * One URL per page. The site used to link `/app` clean alongside
 * `/account.html` and `/settings.html`, so the address bar flipped spelling
 * depending on which link you clicked, and the worker answered the two forms
 * differently. These assert the property — no internal link anywhere names a
 * page by its `.html` asset — rather than listing today's hrefs, so a new
 * page or a new link cannot quietly reintroduce the second spelling.
 */
describe('internal links use the clean route, never the .html asset', () => {
  const PAGE_FILES = Object.keys(ROUTES);

  it('no internal href on any page ends in .html', async () => {
    for (const file of PAGE_FILES) {
      const doc = await load(file);
      const offenders = [...doc.querySelectorAll('a[href^="/"]')]
        .map(a => a.getAttribute('href') ?? '')
        .filter(href => /\.html(?:[?#]|$)/.test(href));
      expect(offenders, `${file} internal links`).toEqual([]);
    }
  });

  /*
   * The views build links too — a table's empty state carries the action that
   * fixes it ("Connect a bank via Plaid →"), and that href lives in a .ts
   * file where the DOM scan above cannot see it. Same contract, same failure
   * mode, so it gets the same assertion.
   */
  it('no href built in a view names a page by its .html asset', async () => {
    const { readdir } = await import('node:fs/promises');
    for (const dir of [SRC, resolve(SRC, 'lib')]) {
      for (const file of (await readdir(dir)).filter(f => f.endsWith('.ts'))) {
        const code = await readFile(resolve(dir, file), 'utf8');
        const offenders = [...code.matchAll(/['"`](\/[a-z0-9-]+\.html)['"`]/g)].map(m => m[1]);
        expect(offenders, `${file} builds an internal .html href`).toEqual([]);
      }
    }
  });

  it('every internal href points at a route the site actually serves', async () => {
    const known = new Set(Object.values(ROUTES));
    for (const file of PAGE_FILES) {
      const doc = await load(file);
      for (const a of doc.querySelectorAll('a[href^="/"]')) {
        const href = (a.getAttribute('href') ?? '').split(/[?#]/)[0]!;
        expect(known, `${file} -> ${href}`).toContain(href);
      }
    }
  });

  it('each page declares its own route as canonical, and og:url agrees', async () => {
    for (const [file, route] of Object.entries(ROUTES)) {
      const doc = await load(file);
      const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
      const ogUrl = doc.querySelector('meta[property="og:url"]')?.getAttribute('content');
      const expected = `https://pendingbusiness.com${route}`;
      expect(canonical, `${file} canonical`).toBe(expected);
      expect(ogUrl, `${file} og:url`).toBe(expected);
    }
  });
});

describe('dashboard header', () => {
  it('never hard-codes who is signed in — the line is a bindText target', async () => {
    const doc = await load('app.html');
    const line = doc.querySelector('header nav p small');
    expect(line?.id).toBe('me-line');
    expect(line?.textContent?.trim()).toBe('Signed in');
    // The owner's name / filing status / state must come from /api/auth/me,
    // never from the template (it was shown to anonymous visitors of /app.html).
    expect(doc.querySelector('header')?.textContent).not.toMatch(/Warren|MFJ|California/);
  });
});

describe('static HTML accessibility contracts', () => {
  it('every page has a <main> and a single <h1>', async () => {
    const files = [
      'index.html',
      'app.html',
      'account.html',
      'login.html',
      'welcome.html',
      'settings.html',
    ];
    for (const file of files) {
      const doc = await load(file);
      expect(doc.querySelector('main'), `${file} has <main>`).toBeTruthy();
      expect(doc.querySelectorAll('h1'), `${file} has exactly one <h1>`).toHaveLength(1);
    }
  });

  it('all status outputs are aria-live="polite"', async () => {
    const files = ['app.html', 'account.html', 'login.html', 'welcome.html', 'settings.html'];
    for (const file of files) {
      const doc = await load(file);
      const outputs = [...doc.querySelectorAll('output[id$="-status"]')];
      expect(outputs.length, `${file} has status outputs`).toBeGreaterThan(0);
      for (const o of outputs) {
        expect(o.getAttribute('aria-live'), `${file} ${o.id}`).toBe('polite');
      }
    }
  });

  it('every <section> has aria-labelledby pointing at a real heading id', async () => {
    const files = [
      'index.html',
      'app.html',
      'account.html',
      'login.html',
      'welcome.html',
      'settings.html',
    ];
    for (const file of files) {
      const doc = await load(file);
      const sections = [...doc.querySelectorAll('section')];
      for (const s of sections) {
        const id = s.getAttribute('aria-labelledby');
        expect(id, `${file} <section> aria-labelledby`).toBeTruthy();
        expect(doc.getElementById(id!), `${file} #${id}`).toBeTruthy();
      }
    }
  });
});

/*
 * /account is served to anonymous visitors on purpose — it is where the first
 * passkey on a fresh database gets enrolled — so what it *shows* them is a
 * runtime decision, not a routing one. These drive src/account.ts against the
 * real page markup under jsdom with a stubbed /api/auth/me, because the defect
 * lived in the bindings: the static HTML has always been fine, and no test of
 * it could see that nothing ever set `hidden` on the enrolment section.
 */
describe('/account renders its anonymous state from /api/auth/me', () => {
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
    const doc = await load('account.html');
    document.body.innerHTML = doc.body.innerHTML;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  /** Boot the page module with a canned /me, and wait for it to render. */
  async function boot(me: Record<string, unknown>, settled: string): Promise<void> {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) return Response.json(me);
      if (url.endsWith('/api/auth/credentials')) return Response.json({ credentials: [] });
      return Response.json({ error: { code: 'NOT_FOUND', message: url } }, { status: 404 });
    }) as typeof fetch;
    await import('../src/account.js');
    await vi.waitFor(() => expect(document.getElementById('me-status')?.textContent).toBe(settled));
  }

  const hidden = (id: string): boolean => document.getElementById(id)?.hidden === true;

  it('hides the enrolment section, Dashboard and Settings from a stranger', async () => {
    await boot({ user: null, profile: null, enrolmentOpen: false }, 'Not signed in.');
    expect(hidden('enroll-section')).toBe(true);
    expect(hidden('nav-app')).toBe(true);
    expect(hidden('nav-settings')).toBe(true);
    // The heading is one sentence in this state — never "Signed in as Not signed in."
    expect(document.getElementById('signed-in-heading')?.textContent?.trim()).toBe(
      'Not signed in.',
    );
    expect(hidden('link-login')).toBe(false);
  });

  it('keeps the enrolment section open while the users table is empty (first-deploy bootstrap)', async () => {
    await boot({ user: null, profile: null, enrolmentOpen: true }, 'Not signed in.');
    expect(hidden('enroll-section')).toBe(false);
    // Still nobody's dashboard: the nav stays trimmed until there is a session.
    expect(hidden('nav-app')).toBe(true);
    expect(hidden('nav-settings')).toBe(true);
  });

  it('shows the full shell, with a whole-sentence heading, to a signed-in member', async () => {
    await boot(
      {
        user: { handle: 'warren', role: 'admin', isAdmin: true },
        onboardingRequired: false,
        profile: null,
        enrolmentOpen: false,
      },
      'Signed in as warren · admin',
    );
    expect(hidden('enroll-section')).toBe(false);
    expect(hidden('nav-app')).toBe(false);
    expect(hidden('nav-settings')).toBe(false);
    expect(document.getElementById('signed-in-heading')?.textContent?.trim()).toBe(
      'Signed in as warren · admin',
    );
  });
});
