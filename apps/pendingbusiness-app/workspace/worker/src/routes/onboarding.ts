/**
 * Multi-tenant onboarding scaffold.
 *
 * Background: `pbUsers.create` (worker/src/auth/stores.ts) synthesizes
 *   email = handle@placeholder.invalid, filing_status = 'single', state = 'CA'
 * for any net-new user that registers a passkey. PB has been single-tenant
 * (just Warren) so this dormant code never mattered. As soon as a real
 * second user enrolls, that placeholder row is wrong and every downstream
 * tax/filing calc that reads it would silently use defaults.
 *
 * The flow:
 *   1. A brand-new user registers a passkey → users row written with placeholder.
 *      (Only possible for the one-time bootstrap on an empty users table —
 *      see auth/stores.ts `pbUsers.create` and routes/auth.ts enrolmentGate.)
 *   2. /api/auth/me on the frontend sees `onboardingRequired: true` and
 *      redirects to /welcome.html.
 *   3. /welcome.html collects real email + filing_status + state and POSTs
 *      to /api/auth/onboarding, which UPDATEs the row.
 *   4. requireAuth middleware blocks all other /api/* calls (other than
 *      /api/auth/* itself) with 403 onboarding-required until the row is
 *      reconciled.
 *
 * "Reconciled" = email no longer matches `*@placeholder.invalid` AND
 * filing_status, state are present. We use the placeholder-email check as
 * the canonical signal because it's set in exactly one place.
 */
import type { Env } from '../env.js';
import { sessionUserId, authRequired } from '../auth/session.js';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_DOMAIN = '@placeholder.invalid';

/**
 * Must be exactly the set the `users.filing_status` CHECK constraint permits
 * (migrations/0001_init.sql: `CHECK (filing_status IN ('single','mfj','mfs',
 * 'hoh','qw'))`) — anything else validates here and then throws a 500 out of
 * the UPDATE below. @pendingbusiness/core's `FilingStatus` type uses the same
 * short IRS codes; that's the vocabulary every downstream tax calculation
 * (bracket lookups, situation.ts) reads, so it — not this array — is the
 * source of truth. worker/test/schema-drift.test.ts asserts this array and
 * the live CHECK constraint never diverge again.
 */
export const FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh', 'qw'] as const;
const STATE_RX = /^[A-Z]{2}$/;

type FilingStatus = (typeof FILING_STATUSES)[number];

/**
 * Maps a DB column name — as it appears in a SQLite "CHECK constraint
 * failed: <column> ..." error — to the camelCase field name the client sent
 * it under, so a constraint violation can be reported against the right
 * form field instead of a raw snake_case column.
 */
const DB_COLUMN_TO_FIELD: Readonly<Record<string, string>> = {
  filing_status: 'filingStatus',
  state: 'state',
  email: 'email',
};

interface UserRow {
  id: number;
  email: string | null;
  filing_status: string | null;
  state: string | null;
}

/**
 * The one error envelope PB-authored routes answer with: `{ error: { code,
 * message, field? } }`. `message` is a complete sentence — the site surfaces
 * it verbatim (apps/site/src/lib/api-error.ts). Shared by the household,
 * income-source and liability routes so the shape cannot drift.
 */
export function jsonError(status: number, code: string, message: string, field?: string): Response {
  const body: Record<string, unknown> = { error: { code, message } };
  if (field) (body.error as Record<string, unknown>).field = field;
  return Response.json(body, { status });
}

/**
 * Pure predicate so middleware + handlers + tests share one definition.
 * A user is "onboarded" iff their email is real (not the placeholder
 * domain we synthesize at register time).
 */
export function isOnboarded(row: { email?: string | null } | null): boolean {
  if (!row || !row.email) return false;
  return !row.email.endsWith(PLACEHOLDER_DOMAIN);
}

async function loadUser(env: Env, userId: number): Promise<UserRow | null> {
  const r = await env.DB.prepare('SELECT id, email, filing_status, state FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRow>();
  return r ?? null;
}

/**
 * POST /api/auth/onboarding
 * Body: { email, filingStatus, state }
 *
 * Idempotent: re-POSTing while already onboarded simply updates the row.
 * That's fine — the welcome page should never redirect back, but if a user
 * hand-crafts the request we'd rather not 409 them.
 */
export async function postOnboarding(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Body must be JSON.');
  }
  if (typeof body !== 'object' || body === null) {
    return jsonError(400, 'INVALID_BODY', 'Expected { email, filingStatus, state }.');
  }
  const { email, filingStatus, state } = body as {
    email?: unknown;
    filingStatus?: unknown;
    state?: unknown;
  };

  if (typeof email !== 'string' || !EMAIL_RX.test(email.trim())) {
    return jsonError(400, 'INVALID_EMAIL', 'A valid email is required.', 'email');
  }
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail.endsWith(PLACEHOLDER_DOMAIN)) {
    return jsonError(
      400,
      'PLACEHOLDER_EMAIL',
      'Use a real email, not the placeholder domain.',
      'email',
    );
  }
  if (typeof filingStatus !== 'string' || !FILING_STATUSES.includes(filingStatus as FilingStatus)) {
    return jsonError(
      400,
      'INVALID_FILING_STATUS',
      `filingStatus must be one of: ${FILING_STATUSES.join(', ')}`,
      'filingStatus',
    );
  }
  if (typeof state !== 'string' || !STATE_RX.test(state.trim().toUpperCase())) {
    return jsonError(400, 'INVALID_STATE', 'state must be a US two-letter code.', 'state');
  }
  const cleanState = state.trim().toUpperCase();

  try {
    await env.DB.prepare('UPDATE users SET email = ?, filing_status = ?, state = ? WHERE id = ?')
      .bind(cleanEmail, filingStatus, cleanState, userId)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Always log the real cause server-side. The client only ever gets a
    // generic, safe message below — this line is what makes the *next*
    // schema/validation drift diagnosable in minutes instead of by reading
    // D1 source.
    console.error(`postOnboarding: UPDATE users failed for user ${userId}: ${msg}`);

    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return jsonError(409, 'EMAIL_TAKEN', 'That email is already registered.', 'email');
    }

    // A CHECK constraint violation means the DB rejected a value this
    // handler thought was valid — i.e. its allow-list has drifted from the
    // table's CHECK. That's exactly what happened here: filingStatus was
    // validated against the wrong vocabulary and this UPDATE threw, which
    // used to fall through to the generic 500 below with no indication of
    // which field or why. Surface it as a 400 naming the offending field
    // instead, so it's fixable from the response alone.
    const checkedColumn = /CHECK constraint failed:\s*([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(msg)?.[1];
    if (checkedColumn) {
      const field = DB_COLUMN_TO_FIELD[checkedColumn] ?? checkedColumn;
      return jsonError(
        400,
        'CONSTRAINT_VIOLATION',
        `The value provided for "${field}" is not permitted.`,
        field,
      );
    }

    return jsonError(500, 'DB_ERROR', 'Failed to save onboarding.');
  }

  return Response.json({ ok: true, email: cleanEmail, filingStatus, state: cleanState });
}

/**
 * Middleware predicate. Returns null when the request should pass, or a
 * 403 Response when onboarding is required.
 */
export async function checkOnboarding(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response | null> {
  const url = new URL(request.url);
  // The onboarding endpoint itself + the /api/auth/* family stay open so
  // the user can actually onboard, fetch /me, and log out.
  if (url.pathname === '/api/auth/onboarding') return null;
  if (url.pathname.startsWith('/api/auth/')) return null;

  const row = await loadUser(env, userId);
  if (isOnboarded(row)) return null;
  return jsonError(403, 'onboarding-required', 'Complete onboarding before using the app.');
}
