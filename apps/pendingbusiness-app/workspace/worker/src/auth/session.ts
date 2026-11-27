/**
 * The one place the worker answers "who is calling?".
 *
 * Every route that reads or writes per-user rows resolves the caller from
 * the `pb_auth` session cookie through `sessionUser` / `sessionUserId` and
 * binds that id into its SQL. Nothing else may decide which user's data a
 * request touches — there is no owner constant, no default user, and no
 * fallback to "user 1". A request without a resolvable session gets
 * `authRequired()` (401) from the route itself, on top of the
 * `requireAuth` middleware, so a handler can never run unscoped even if
 * the middleware's public-prefix list drifts.
 *
 * The lookup is memoised per `Request` (WeakMap) so the middleware and the
 * handler share a single D1 round-trip.
 */
import type { Env } from '../env.js';
import { getAdapter } from './adapter.js';

export interface SessionUser {
  id: number;
  handle: string;
  role: 'user' | 'moderator' | 'admin';
}

const resolved = new WeakMap<Request, Promise<SessionUser | null>>();

export function sessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  let pending = resolved.get(request);
  if (!pending) {
    pending = lookup(request, env);
    resolved.set(request, pending);
  }
  return pending;
}

export async function sessionUserId(request: Request, env: Env): Promise<number | null> {
  const user = await sessionUser(request, env);
  return user ? user.id : null;
}

/** Consistent 401 envelope for PB-authored routes. */
export function authRequired(): Response {
  return Response.json(
    { error: { code: 'AUTH_REQUIRED', message: 'Sign in required.' } },
    { status: 401 },
  );
}

async function lookup(request: Request, env: Env): Promise<SessionUser | null> {
  const user = await getAdapter(env).currentUser(request);
  if (!user) return null;
  const { id, handle, role } = user as { id: string; handle: string; role?: string };
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return {
    id: numeric,
    handle,
    role: role === 'admin' || role === 'moderator' ? role : 'user',
  };
}
