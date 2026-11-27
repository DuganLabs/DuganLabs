/**
 * Passkey (WebAuthn) auth endpoints — wraps @basenative/auth-webauthn's
 * Pages-Functions-shaped handlers for itty-router.
 *
 * Endpoints:
 *   POST /api/auth/register-options
 *   POST /api/auth/register-verify
 *   POST /api/auth/login-options
 *   POST /api/auth/login-verify
 *   GET  /api/auth/me
 *   POST /api/auth/logout
 */
import {
  registerOptionsHandler,
  registerVerifyHandler,
  loginOptionsHandler,
  loginVerifyHandler,
  meHandler,
  logoutHandler,
} from '@basenative/auth-webauthn/handlers';
import {
  seedRoles,
  parseHandleList,
  type AdapterFactory,
  type CFHandler,
  type UserRecord,
} from '@basenative/auth-webauthn';
import type { Env } from '../env.js';
import { getAdapter } from '../auth/adapter.js';
import {
  pbWebAuthnStores,
  normalizeHandle,
  isValidHandle,
  usersTableIsEmpty,
} from '../auth/stores.js';

// The package's handler factories accept an AdapterFactory typed as
// `(env: Record<string, unknown>) => WebAuthnAdapter`. PB's Env interface
// is stricter; coerce at the boundary.
const factory: AdapterFactory = env => getAdapter(env as unknown as Env);

// Our BN-router handlers receive (request, env, ctx, params); the package's
// CFHandler expects `({ request, env })`. Trivially adapt.
const wrap =
  (h: CFHandler) =>
  async (request: Request, env: Env): Promise<Response> =>
    h({ request, env: env as unknown as Record<string, unknown> });

const baseRegisterOptions = wrap(registerOptionsHandler(factory));

/**
 * POST /api/auth/register-options — with enrolment closed.
 *
 * The package handler creates a users row for any unknown handle. PB is a
 * single-user product, so we answer first: a handle that already exists may
 * add another passkey; an unknown handle is refused with 403
 * `enrollment-closed` — unless the users table is empty, the one-time
 * bootstrap of a fresh database. (`pbUsers.create` enforces the same rule
 * a second time at the store, so no other path can create a user either.)
 *
 * Error shape is the package's `{ error: '<code>' }` string envelope
 * because @basenative/auth-webauthn/client surfaces `error` verbatim.
 */
export const postRegisterOptions = async (request: Request, env: Env): Promise<Response> => {
  const refusal = await enrolmentGate(request.clone(), env);
  if (refusal) return refusal;
  return baseRegisterOptions(request, env);
};

async function enrolmentGate(request: Request, env: Env): Promise<Response | null> {
  let body: { handle?: unknown } = {};
  try {
    body = (await request.json()) as { handle?: unknown };
  } catch {
    /* the base handler reports bad-handle for an unreadable body */
  }
  const handle = normalizeHandle(typeof body.handle === 'string' ? body.handle : '');
  if (!isValidHandle(handle)) return null;

  const stores = pbWebAuthnStores(env.DB);
  if (await stores.users.getByHandle(handle)) return null;
  if (await usersTableIsEmpty(env.DB)) return null;

  return Response.json(
    { error: 'enrollment-closed' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const postRegisterVerify = wrap(
  registerVerifyHandler(factory, {
    // Seed admin role on first successful registration too — keeps Warren
    // an admin if the migration backfill runs after a fresh enrollment.
    onLogin: async ({ env, userId }) => {
      const stores = pbWebAuthnStores((env as unknown as Env).DB);
      const user = await stores.users.getById(userId);
      if (user) {
        await seedRoles({
          stores,
          user,
          seedMap: parseHandleList((env as unknown as Env).ADMIN_HANDLES, 'admin'),
          changedBy: 'seed:ADMIN_HANDLES',
        });
      }
    },
  }),
);

export const postLoginOptions = wrap(loginOptionsHandler(factory));

export const postLoginVerify = wrap(
  loginVerifyHandler(factory, {
    onLogin: async ({ env, user }: { env: Record<string, unknown>; user?: UserRecord | null }) => {
      if (!user) return;
      const stores = pbWebAuthnStores((env as unknown as Env).DB);
      await seedRoles({
        stores,
        user,
        seedMap: parseHandleList((env as unknown as Env).ADMIN_HANDLES, 'admin'),
        changedBy: 'seed:ADMIN_HANDLES',
      });
    },
  }),
);

// PB customizes /me so the frontend can decide whether to redirect a fresh
// passkey-enrollee to /welcome.html, and so the dashboard header can show
// who is signed in. The base meHandler returns just { user }; we add
// `onboardingRequired` (from the email column) and `profile` (display
// name, filing status, state) from the same users row.
//
// Signed out, it also reports `enrolmentOpen`: true only while the `users`
// table is empty — the same one-time bootstrap `enrolmentGate` honours — so
// /account can hide its enrolment form from a stranger without bricking the
// first passkey on a fresh database. Signed in, it is always false.
const baseMe = wrap(meHandler(factory));
export const getMe = async (request: Request, env: Env): Promise<Response> => {
  const res = await baseMe(request, env);
  if (!res.ok) return res;
  let body: { user: { id?: string } | null };
  try {
    body = (await res.clone().json()) as { user: { id?: string } | null };
  } catch {
    return res;
  }
  if (!body.user || !body.user.id) {
    return Response.json({
      ...body,
      onboardingRequired: false,
      profile: null,
      enrolmentOpen: await usersTableIsEmpty(env.DB),
    });
  }
  const numericId = Number(body.user.id);
  let onboardingRequired = false;
  let profile: {
    displayName: string | null;
    filingStatus: string | null;
    state: string | null;
  } | null = null;
  if (Number.isFinite(numericId)) {
    const row = await env.DB.prepare(
      'SELECT email, display_name, filing_status, state FROM users WHERE id = ?',
    )
      .bind(numericId)
      .first<{
        email: string | null;
        display_name: string | null;
        filing_status: string | null;
        state: string | null;
      }>();
    onboardingRequired = !row || !row.email || row.email.endsWith('@placeholder.invalid');
    if (row) {
      profile = {
        displayName: row.display_name,
        filingStatus: row.filing_status,
        state: row.state,
      };
    }
  }
  return Response.json({ ...body, onboardingRequired, profile, enrolmentOpen: false });
};

export const postLogout = wrap(logoutHandler(factory));
