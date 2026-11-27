import { describe, it, expect } from 'vitest';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import worker, { PAGES } from '../src/index.js';
import type { Env } from '../src/env.js';

/**
 * End-to-end through the router: which pages are gated, where a visitor is
 * sent, and what status an unknown path gets. D1 is faked just enough for
 * adapter.currentUser (session → user 1, onboarded); ASSETS is a tiny
 * in-memory site so we can tell which file was served.
 */

/** What the fake ASSETS binding returns for each file, so a test can tell
 *  which file the worker actually served. Named for the asset, not the route:
 *  the route -> asset mapping is the worker's own PAGES table. */
const PAGE_BODY: Record<string, string> = {
  '/': 'LANDING',
  '/index.html': 'LANDING',
  '/app.html': 'APP',
  '/settings.html': 'SETTINGS',
  '/welcome.html': 'WELCOME',
  '/account.html': 'ACCOUNT',
  '/login.html': 'LOGIN',
  '/styles.css': 'CSS',
};

function fakeAssets(): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : (input as Request).url);
      const body = PAGE_BODY[url.pathname];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8',
          ETag: '"abc"',
        },
      });
    },
  } as unknown as Fetcher;
}

/** `usersCount` drives `SELECT COUNT(*) FROM users` — 0 models a fresh
 *  database whose one-time passkey bootstrap is still open. */
function fakeDB(usersCount = 1): D1Database {
  function prepare(sql: string) {
    const s = sql.replace(/\s+/g, ' ').trim();
    let binds: unknown[] = [];
    const rows = (): unknown[] => {
      if (s.startsWith('SELECT COUNT(*) AS n FROM users')) return [{ n: usersCount }];
      if (s.startsWith('SELECT u.id AS id, u.handle AS handle')) {
        return binds[0] === 'valid'
          ? [{ id: 1, handle: 'warren', role: 'admin', expiresAt: 9999999999 }]
          : [];
      }
      if (s.startsWith('SELECT id, email, filing_status, state FROM users WHERE id = ?')) {
        return [{ id: 1, email: 'owner@example.com', filing_status: 'mfj', state: 'CA' }];
      }
      if (
        s.startsWith('SELECT email, display_name, filing_status, state FROM users WHERE id = ?')
      ) {
        return [
          {
            email: 'owner@example.com',
            display_name: 'Warren',
            filing_status: 'mfj',
            state: 'CA',
          },
        ];
      }
      return [];
    };
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      first: async () => rows()[0] ?? null,
      all: async () => ({ results: rows() }),
      run: async () => ({ success: true }),
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function env(usersCount = 1): Env {
  return {
    DB: fakeDB(usersCount),
    ASSETS: fakeAssets(),
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
  };
}

const ctx: ExecutionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
};

const SIGNED_IN = { Cookie: 'pb_auth=valid' };
const SIGNED_OUT = { Cookie: 'pb_auth=stale' };

function get(
  path: string,
  headers: Record<string, string> = {},
  usersCount = 1,
): Promise<Response> {
  return worker.fetch(
    new Request(`https://pendingbusiness.com${path}`, { headers }),
    env(usersCount),
    ctx,
  );
}

function location(res: Response): string {
  return new URL(res.headers.get('Location') ?? '', 'https://pendingbusiness.com').pathname;
}

/*
 * These iterate `PAGES` — the table the worker itself routes from — rather
 * than a second list written out here. The bug they replace was exactly that
 * drift: /settings.html was registered and gated while /settings was not
 * registered at all, so it fell through to the ASSETS catch-all and served
 * the authenticated settings chrome to a signed-out visitor. A list in the
 * test would have gone on passing, because it listed the spelling that
 * worked. Asserting over every entry means a page added under one spelling
 * is covered under both, automatically.
 */
const gated = Object.entries(PAGES).filter(([, p]) => p.gated);
const publicPages = Object.entries(PAGES).filter(([, p]) => !p.gated);

/*
 * An independent anchor for the tests below. Everything else here iterates
 * `PAGES`, which means dropping an entry also drops its own coverage — that
 * is exactly how /settings went unrouted while the suite stayed green. The
 * page files on disk are the one list the worker does not own, so they are
 * what the routing table gets checked against.
 */
describe('the routing table covers every page the site builds', () => {
  it('each src/*.html is either the landing page or routed by PAGES', async () => {
    const siteSrc = resolve(process.cwd(), '../apps/site/src');
    const files = (await readdir(siteSrc)).filter(f => f.endsWith('.html')).sort();
    const routedAssets = Object.values(PAGES).map(p => p.asset.replace(/^\//, ''));
    // index.html is served by the `/` handler, not from PAGES.
    expect([...routedAssets, 'index.html'].sort()).toEqual(files);
  });

  it('no two routes claim the same asset', () => {
    const assets = Object.values(PAGES).map(p => p.asset);
    expect(new Set(assets).size).toBe(assets.length);
  });
});

describe('every page answers on exactly one URL', () => {
  for (const [route, page] of Object.entries(PAGES)) {
    it(`${page.asset} permanently redirects to ${route}`, async () => {
      const res = await get(page.asset, SIGNED_IN);
      expect(res.status).toBe(301);
      expect(location(res)).toBe(route);
    });

    it(`${page.asset} redirects the same way signed out — the suffix never changes where you land`, async () => {
      const signedOut = await get(page.asset, SIGNED_OUT);
      expect(signedOut.status).toBe(301);
      expect(location(signedOut)).toBe(route);
    });
  }

  it('/index.html permanently redirects to /', async () => {
    const res = await get('/index.html');
    expect(res.status).toBe(301);
    expect(location(res)).toBe('/');
  });

  it('no page is reachable at its asset name with a 200', async () => {
    for (const [, page] of Object.entries(PAGES)) {
      for (const headers of [SIGNED_IN, SIGNED_OUT]) {
        expect((await get(page.asset, headers)).status, page.asset).not.toBe(200);
      }
    }
  });
});

describe('authenticated pages never render without a session', () => {
  for (const [route, page] of gated) {
    it(`${route} redirects a signed-out visitor to / without serving the page`, async () => {
      const res = await get(route, SIGNED_OUT);
      expect(res.status).toBe(302);
      expect(location(res)).toBe('/');
      expect(await res.text()).not.toMatch(/APP|SETTINGS|WELCOME/);
    });

    it(`${route} serves ${page.asset} to a signed-in user`, async () => {
      const res = await get(route, SIGNED_IN);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PAGE_BODY[page.asset]);
    });
  }
});

describe('public pages stay public', () => {
  for (const [route, page] of publicPages) {
    it(`${route} is served with no session (passkey enrolment / sign-in)`, async () => {
      const res = await get(route);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PAGE_BODY[page.asset]);
    });
  }
});

describe('unknown paths', () => {
  it('returns the landing page body with a real 404 for an extension-less miss', async () => {
    const res = await get('/some/deep/path');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    expect(await res.text()).toBe('LANDING');
  });

  it('a typo of /app is a 404, not the marketing page with 200', async () => {
    expect((await get('/apps')).status).toBe(404);
  });

  it('passes through the asset 404 for a missing file', async () => {
    const res = await get('/foo.png');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('not found');
  });

  it('/api/* misses are JSON 404s', async () => {
    const res = await get('/api/nope', SIGNED_IN);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});

describe('public landing', () => {
  it('serves / with 200 to a signed-out visitor', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('LANDING');
  });

  it('sends a signed-in visitor from / straight to /app', async () => {
    const res = await get('/', SIGNED_IN);
    expect(res.status).toBe(302);
    expect(location(res)).toBe('/app');
  });

  it('a stale cookie still gets the landing page', async () => {
    const res = await get('/', SIGNED_OUT);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('LANDING');
  });

  it('/api/auth/me carries the profile the dashboard header renders', async () => {
    const res = await get('/api/auth/me', SIGNED_IN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { handle: string };
      onboardingRequired: boolean;
      profile: { displayName: string; filingStatus: string; state: string } | null;
    };
    expect(body.user.handle).toBe('warren');
    expect(body.onboardingRequired).toBe(false);
    expect(body.profile).toEqual({ displayName: 'Warren', filingStatus: 'mfj', state: 'CA' });
  });

  it('/api/auth/me is { user: null, profile: null } when signed out', async () => {
    const body = (await (await get('/api/auth/me')).json()) as { user: null; profile: null };
    expect(body.user).toBeNull();
    expect(body.profile).toBeNull();
  });

  /*
   * /account is public on purpose (it is where the first passkey is ever
   * enrolled) and hides its enrolment form from strangers at runtime. The
   * one state where a signed-out visitor must still see that form is a
   * fresh database, and the worker is the only thing that knows — so /me
   * reports it, using the same emptiness check `enrolmentGate` applies.
   */
  it('/api/auth/me reports enrolment closed to a stranger once any user exists', async () => {
    const body = (await (await get('/api/auth/me')).json()) as { enrolmentOpen: boolean };
    expect(body.enrolmentOpen).toBe(false);
  });

  it('/api/auth/me reports enrolment open to a stranger while the users table is empty', async () => {
    const body = (await (await get('/api/auth/me', {}, 0)).json()) as { enrolmentOpen: boolean };
    expect(body.enrolmentOpen).toBe(true);
  });

  it('/api/auth/me never reports enrolment open to a signed-in user', async () => {
    const body = (await (await get('/api/auth/me', SIGNED_IN)).json()) as {
      enrolmentOpen: boolean;
    };
    expect(body.enrolmentOpen).toBe(false);
  });

  it('still serves robots.txt inline', async () => {
    const res = await get('/robots.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Disallow: /');
  });
});
