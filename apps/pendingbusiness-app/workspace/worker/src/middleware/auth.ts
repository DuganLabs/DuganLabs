/**
 * Passkey-session gate. Replaces the previous HTTP-Basic auth.
 *
 * Public endpoints (no session required):
 *   - /api/health
 *   - /api/waitlist
 *   - /api/auth/* (the passkey ceremony itself)
 *
 * Everything else requires a valid `pb_auth` cookie. The cookie is issued
 * by @basenative/auth-webauthn after a successful passkey login/registration.
 */
import type { Env } from '../env.js';
import { sessionUser } from '../auth/session.js';
import { checkOnboarding } from '../routes/onboarding.js';

const PUBLIC_PREFIXES = ['/api/health', '/api/waitlist', '/api/auth/'] as const;

export async function requireAuth(request: Request, env: Env): Promise<Response | void> {
  const url = new URL(request.url);
  if (isPublic(url.pathname)) return;

  // Static asset routes (anything outside /api) get handled by the catch-all
  // in index.ts; gating only applies to /api endpoints.
  if (!url.pathname.startsWith('/api/')) return;

  // Resolved once per Request (auth/session.ts memoises), so the route
  // handler's own sessionUserId() call reuses this lookup.
  const user = await sessionUser(request, env);
  if (!user) {
    return Response.json({ error: 'auth-required' }, { status: 401 });
  }

  // Onboarding gate: a user with the placeholder email synthesized at
  // register-time must complete /welcome before any other /api/* call
  // succeeds. /api/auth/* endpoints stay open inside checkOnboarding so the
  // user can still hit /me, /logout, and /onboarding itself.
  const blocked = await checkOnboarding(request, env, user.id);
  if (blocked) return blocked;
}

function isPublic(pathname: string): boolean {
  for (const p of PUBLIC_PREFIXES) {
    if (p.endsWith('/') ? pathname.startsWith(p) : pathname === p) return true;
  }
  return false;
}
