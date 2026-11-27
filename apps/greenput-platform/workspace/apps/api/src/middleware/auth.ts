import type { Env } from '../env';
import { buildSessionCookie, unauthorized } from '../lib/response';
import {
  stageSessionRenewal,
  touchSession,
  type SessionPrincipal,
} from '../lib/session';

export type SessionUser = SessionPrincipal;

declare module 'itty-router' {
  interface IRequest {
    user?: SessionUser;
    workspaceId?: string;
  }
}

export async function requireAuth(
  request: Request & { user?: SessionUser; workspaceId?: string },
  env: Env,
): Promise<Response | void> {
  // If already authenticated (e.g. via API key middleware), skip session check
  if (request.user && request.workspaceId) {
    return;
  }

  const sessionToken = getCookieValue(
    request.headers.get('cookie') ?? '',
    'gp_session',
  );

  if (!sessionToken) {
    return unauthorized();
  }

  // Reads the session AND slides it forward once it has aged into a new renewal
  // slot. apps/api/src/lib/session.ts holds the idle window, the absolute cap
  // from first sign-in, why a renewal is best-effort rather than something that
  // can 500 a page load, and why revocation has a signal of its own.
  const touched = await touchSession(env, sessionToken);

  if (touched.status === 'expired' || touched.status === 'revoked') {
    // Past the absolute cap, or signed out. Either way the token can never work
    // again, so tell the browser to stop sending it — which also clears a
    // cookie that a renewal in flight at logout time managed to re-issue.
    const response = unauthorized();
    response.headers.append('Set-Cookie', buildSessionCookie('', env, 0));
    return response;
  }

  if (touched.status !== 'active') {
    return unauthorized();
  }

  request.user = touched.user;
  request.workspaceId = touched.user.workspaceId;

  if (touched.renewal) {
    // Middleware cannot touch the handler's response — it returns void or a
    // rejection — so the refreshed cookie is staged against the request and
    // drained by routerFetch in apps/api/src/index.ts, the one place every
    // response's headers are assembled.
    stageSessionRenewal(request, touched.renewal);
  }
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Attach CORS headers — same-origin only in production */
export function corsHeaders(origin: string, env: Env): Record<string, string> {
  const allowedOrigin = getAllowedOrigin(origin, env);

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

// WS-0 (PRD v1.5): the request-aware CORS widening that used to live
// here — echoing a verified workspace custom domain on the two public
// deposit endpoints — is gone with those endpoints. The homeowner
// deposit-confirmation surface was removed when the booking-deposit
// model was revoked (2026-10-20), so no foreign-origin case remains:
// every request gets exactly the static policy in `corsHeaders` above.

function getAllowedOrigin(origin: string, env: Env): string {
  if (env.ENVIRONMENT === 'development') {
    return 'http://localhost:4200';
  }

  // Preview / Pages deployments — allow all preview and staging origins
  const previewPatterns = [
    /^https:\/\/[a-z0-9-]+\.greenput-app\.pages\.dev$/,
    /^https:\/\/[a-z0-9-]+\.greenput-admin\.pages\.dev$/,
    /^https:\/\/[a-z0-9-]+\.greenput\.pages\.dev$/,
    /^https:\/\/[a-z0-9-]+\.greenput-app-staging\.pages\.dev$/,
    /^https:\/\/[a-z0-9-]+\.greenput-admin-staging\.pages\.dev$/,
    /^https:\/\/[a-z0-9-]+\.greenput\.site$/,
  ];
  if (previewPatterns.some((p) => p.test(origin))) {
    return origin;
  }

  // Production: allow greenput.com and all subdomains (app, admin, api, tenant slugs)
  const prodPattern = /^https:\/\/([a-z0-9-]+\.)?greenput\.com$/;
  if (prodPattern.test(origin)) {
    return origin;
  }

  // Staging: allow *.greenput.site
  const stagingPattern = /^https:\/\/([a-z0-9-]+\.)?greenput\.site$/;
  if (stagingPattern.test(origin)) {
    return origin;
  }

  // Production Pages domains (before custom domains are configured)
  const pagesOrigins = [
    'https://greenput-app.pages.dev',
    'https://greenput-admin.pages.dev',
  ];
  if (pagesOrigins.includes(origin)) {
    return origin;
  }

  return 'https://greenput.com';
}
