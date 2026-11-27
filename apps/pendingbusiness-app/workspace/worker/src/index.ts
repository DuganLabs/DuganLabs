/**
 * PendingBusiness worker entry — BaseNative runtime edition.
 *
 * The HTTP routing layer is the in-house `createApiRouter` (see ./router.ts)
 * which wraps `@basenative/router`'s server-safe `resolveRoute`. The
 * previous itty-router implementation has been retired — DuganLabs uses
 * BaseNative for everything, including server-side path matching.
 *
 * What stayed:
 *   - All route handlers (now (request, env, ctx, params)-shaped instead of
 *     itty's (request, env)).
 *   - The auth gate (`requireAuth`) and security-headers finalizer.
 *   - The `env.ASSETS` static-asset catch-all for the SSR'd site.
 */
import { createApiRouter } from './router.js';
import type { Env } from './env.js';
import { requireAuth } from './middleware/auth.js';
import { sessionUser } from './auth/session.js';
import { applySecurityHeaders } from './middleware/security.js';
import { health } from './routes/health.js';
import { postWaitlist } from './routes/waitlist.js';
import { getSituation } from './routes/situation.js';
import { postScenario, listScenarios, deleteScenario } from './routes/scenario.js';
import { getHousehold, patchHousehold } from './routes/household.js';
import {
  listIncomeSources,
  postIncomeSource,
  patchIncomeSource,
  deleteIncomeSource,
} from './routes/income.js';
import {
  listLiabilities,
  postLiability,
  patchLiability,
  deleteLiability,
} from './routes/liabilities.js';
import {
  getPlaidCredentials,
  postPlaidCredentials,
  postLinkToken,
  postExchange,
  listAccounts,
  postSync,
} from './routes/plaid.js';
import {
  postRegisterOptions,
  postRegisterVerify,
  postLoginOptions,
  postLoginVerify,
  getMe,
  postLogout,
} from './routes/auth.js';
import { listCredentials, renameCredential, revokeCredential } from './routes/credentials.js';
import { postOnboarding } from './routes/onboarding.js';

const router = createApiRouter<Env>({
  before: [requireAuth],
  finally: [applySecurityHeaders],
  fallback: async (request, env) => {
    const url = new URL(request.url);

    // /robots.txt is the one inline static response.
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // /api/* miss → 404 JSON. Anything else falls through to ASSETS.
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    }

    const response = await serveAsset(env, request, url.pathname + url.search);
    if (response.status !== 404) return response;
    if (!url.pathname.includes('.')) {
      // Unknown extension-less path (/some/deep/path, a typo of /app): show
      // the landing page so a person has somewhere to go, but keep the 404
      // status so browsers, crawlers and uptime checks see a real miss
      // instead of a soft-404.
      const landing = await serveAsset(env, request, '/index.html');
      return new Response(landing.body, { status: 404, headers: landing.headers });
    }
    return response;
  },
});

/** Fetch a static asset from the ASSETS binding on behalf of `request`. */
function serveAsset(env: Env, request: Request, asset: string): Promise<Response> {
  return env.ASSETS.fetch(
    new Request(new URL(asset, request.url).toString(), {
      method: request.method,
      headers: request.headers,
    }),
  );
}

router.get('/api/health', health);
router.post('/api/waitlist', postWaitlist);

// The public landing has no link to the dashboard on purpose (it is the
// marketing page for people without a passkey). A visitor whose session
// cookie resolves has nothing to do there, so send them straight to /app.
router.get('/', async (request, env) => {
  if (await sessionUser(request, env)) {
    return Response.redirect(new URL('/app', request.url).toString(), 302);
  }
  return serveAsset(env, request, '/index.html');
});

// Passkey auth ceremony — see @basenative/auth-webauthn.
router.post('/api/auth/register-options', postRegisterOptions);
router.post('/api/auth/register-verify', postRegisterVerify);
router.post('/api/auth/login-options', postLoginOptions);
router.post('/api/auth/login-verify', postLoginVerify);
router.get('/api/auth/me', getMe);
router.post('/api/auth/logout', postLogout);

// Per-credential management (passkey list/rename/revoke).
router.get('/api/auth/credentials', listCredentials);
router.patch('/api/auth/credentials/:id', renameCredential);
router.delete('/api/auth/credentials/:id', revokeCredential);

// Multi-tenant onboarding completion (collects real email + filing/state).
router.post('/api/auth/onboarding', postOnboarding);

router.get('/api/situation', getSituation);
// The user's own numbers — what /api/situation is computed from.
router.get('/api/household', getHousehold);
router.patch('/api/household', patchHousehold);
router.get('/api/income-sources', listIncomeSources);
router.post('/api/income-sources', postIncomeSource);
router.patch('/api/income-sources/:id', patchIncomeSource);
router.delete('/api/income-sources/:id', deleteIncomeSource);
router.get('/api/liabilities', listLiabilities);
router.post('/api/liabilities', postLiability);
router.patch('/api/liabilities/:id', patchLiability);
router.delete('/api/liabilities/:id', deleteLiability);
router.post('/api/scenario', postScenario);
router.get('/api/scenarios', listScenarios);
router.delete('/api/scenarios/:id', deleteScenario);
router.get('/api/plaid/credentials', getPlaidCredentials);
router.post('/api/plaid/credentials', postPlaidCredentials);
router.post('/api/plaid/link-token', postLinkToken);
router.post('/api/plaid/exchange', postExchange);
router.get('/api/plaid/accounts', listAccounts);
router.post('/api/plaid/sync', postSync);

/**
 * Pages. Every page has exactly one URL — the extension-less one — and its
 * raw `.html` asset name permanently redirects to it.
 *
 * The previous table listed some pages under their clean route and some under
 * their asset name, and the two halves behaved differently. `/settings.html`
 * was gated but `/settings` was not registered at all, so it fell through to
 * the ASSETS catch-all and served the authenticated settings chrome to a
 * signed-out visitor, which then client-side bounced to /login.html. Same for
 * `/welcome`. That contradicted this file's own rule that authenticated chrome
 * must never render without a valid session, even briefly — and it meant the
 * same page had two URLs that answered differently depending on the suffix.
 *
 * Deriving both routes from one entry is what stops that recurring: a page
 * cannot now be registered under one spelling and forgotten under the other.
 *
 * `gated: false` is deliberate for /account (where passkeys get enrolled) and
 * /login — both have to work for someone with no session.
 */
export interface Page {
  asset: string;
  gated: boolean;
}

/** Exported so test/routing.test.ts can assert over every page there is,
 *  rather than over a second list that can fall out of step with this one. */
export const PAGES: Readonly<Record<string, Page>> = {
  '/app': { asset: '/app.html', gated: true },
  '/settings': { asset: '/settings.html', gated: true },
  '/welcome': { asset: '/welcome.html', gated: true },
  '/account': { asset: '/account.html', gated: false },
  '/login': { asset: '/login.html', gated: false },
};

for (const [route, page] of Object.entries(PAGES)) {
  router.get(route, async (request, env) => {
    if (page.gated && !(await sessionUser(request, env))) {
      return Response.redirect(new URL('/', request.url).toString(), 302);
    }
    return serveAsset(env, request, page.asset);
  });

  // The asset name is a build artifact, not an address. 301, because the
  // clean route is the canonical one and this is not coming back.
  router.get(page.asset, request => Response.redirect(new URL(route, request.url).toString(), 301));
}

// The landing page's own asset name, for the same reason.
router.get('/index.html', request => Response.redirect(new URL('/', request.url).toString(), 301));

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>;
