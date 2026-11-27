// ── WebAuthn relying-party origin refusal ─────────────────────
// Shared by BOTH passkey surfaces: routes/webauthn.ts (the contractor app) and
// routes/admin.ts (the admin app). Each builds its own near-identical RP config
// — rpConfig and adminRpConfig — and each calls the same two library functions,
// so each had the same unhandled throw. One helper, so fixing one cannot leave
// the other behind again.

import type { Env } from '../env';
import { error } from './response';
import { trackError } from './error-tracker';

/** Which passkey surface asked — recorded on the log line and the D1 row. */
export type RpSurface = 'contractor' | 'admin';

export interface RpOriginRefusalInput {
  /** The error the library threw. Rethrown by the caller if this returns null. */
  err: unknown;
  /** The parsed request body handed to verifyRegistration/AuthenticationResponse. */
  body: unknown;
  /** The origins this surface accepts — rpConfig/adminRpConfig's `origins`. */
  origins: string[];
  /** The relying-party ID this surface handed the browser. */
  rpID: string;
  env: Env;
  req: Request;
  surface: RpSurface;
}

/**
 * The origin the browser actually signed, or null if it cannot be read.
 *
 * This — not the `Origin` header — is what `@simplewebauthn/server` compares
 * against `expectedOrigin`, so it is what has to be compared here to tell an
 * origin mismatch apart from a genuine fault.
 */
export function signedOrigin(body: unknown): string | null {
  try {
    const clientDataJSON = (body as { response?: { clientDataJSON?: unknown } })
      ?.response?.clientDataJSON;
    if (typeof clientDataJSON !== 'string') return null;
    const decoded = JSON.parse(
      Buffer.from(clientDataJSON, 'base64url').toString('utf-8'),
    ) as { origin?: unknown };
    return typeof decoded.origin === 'string' ? decoded.origin : null;
  } catch {
    return null;
  }
}

/**
 * Turn an expected-origin mismatch into a 400 that names the hostname, or
 * return null so the caller rethrows.
 *
 * Neither rpConfig nor adminRpConfig has a "no match" answer: an origin none of
 * its cases recognise falls through to the production branch and is handed
 * rpID 'greenput.com' with `origins` of exactly one host. The library does not
 * report a mismatch as `verified: false` — it THROWS, and it throws before it
 * decodes the attestation object (@simplewebauthn/server 14.0.1,
 * esm/registration/verifyRegistrationResponse.js, origin check after the
 * id/rawId, credential-type, response-type and challenge checks and before
 * `decodeAttestationObject`):
 *
 *   Unexpected registration response origin "https://acme.greenput.com",
 *   expected one of: https://app.greenput.com
 *
 * So the `!verification.verified` branch never saw it, the Error escaped the
 * handler, and withErrorHandler answered 500 INTERNAL and filed an
 * `UNKNOWN_ERROR` row — a server telling the caller that the server broke,
 * about the one fault where the server is merely misconfigured and can say
 * exactly how.
 *
 * WHO ACTUALLY REACHES THIS, stated carefully, because an earlier version of
 * this comment named two origins that cannot:
 *
 *  - A caller that is not a browser. login/verify needs no session — only a
 *    known credential_id and a live challenge — so a replay of a captured
 *    response, or any native/CLI client, reaches the library with whatever
 *    origin it signed. This is the path that is live today.
 *  - A development server on a port other than the one `origins` lists. rpID
 *    'localhost' is valid for every port, so the ceremony completes and the
 *    verify call mismatches. (The developer still sees a CORS error rather
 *    than this body: middleware/auth.ts pins Access-Control-Allow-Origin to
 *    http://localhost:4200 in development. The server-side difference — a
 *    labelled 400 instead of a 500 and an UNKNOWN_ERROR row — is the whole
 *    gain there.)
 *  - Any future passkey client served on a greenput.com host that is not the
 *    one host its surface lists: https://greenput.com itself, or a
 *    <slug>.greenput.com tenant micro-site (CLAUDE.md §3). Nothing in this repo
 *    serves the passkey client from such a host today, so this is the
 *    fall-through's hazard rather than a live incident — but it is one
 *    deploy away, and `corsHeaders()` already allows every one of those hosts.
 *
 * And who does NOT, contrary to what this PR first claimed: bare
 * https://greenput-app.pages.dev (rpConfig's Pages pattern requires a
 * subdomain label) and every *.greenput.site that is not app.greenput.site.
 * Those fall through to rpID 'greenput.com', and WebAuthn requires rp.id to
 * equal — or be a registrable domain suffix of — the caller's effective domain,
 * so navigator.credentials.create()/get() throws SecurityError and no verify
 * request is ever sent. Their users see "This browser refused to create a
 * passkey at all", and nothing here changes that; refusing early in
 * register/options is what would (not done, see the PR body).
 *
 * Decided by comparing the SIGNED clientDataJSON origin against `origins`, not
 * by matching the library's message text, so a reworded upstream error cannot
 * quietly restore the 500 — and nothing here restates either rpConfig's
 * patterns: `origins` IS the set that surface accepts, and the library's own
 * predicate is the same `expectedOrigin.includes(origin)`.
 *
 * Anything else rethrows, so a genuine fault stays a 500 and withErrorHandler
 * still tracks it.
 */
export async function rpOriginRefusal(
  input: RpOriginRefusalInput,
): Promise<Response | null> {
  const { err, body, origins, rpID, env, req, surface } = input;
  const seen = signedOrigin(body);
  if (!seen || origins.includes(seen)) return null;

  // withErrorHandler stamps this on the request and returns the same value as
  // X-Request-ID, so the D1 row and the log line correlate with what the caller
  // was handed. Undefined when a handler is driven directly, as in unit tests.
  const requestId = (req as Request & { requestId?: string }).requestId;
  let path: string | undefined;
  try {
    path = new URL(req.url).pathname;
  } catch {
    path = undefined;
  }

  console.warn('webauthn: relying-party origin mismatch', {
    surface,
    seen,
    expected: origins,
    rpID,
    requestId,
    path,
    method: req.method,
    error: err instanceof Error ? err.message : String(err),
  });

  // A lockout that stops a whole hostname enrolling or using a passkey has to
  // be findable afterwards, not just tail-able at the time. The original error
  // is passed so its stack points at the library's throw site; severity and
  // category are stated rather than guessed, because classifyError reads
  // message prose and would file the registration and authentication halves of
  // one fault under two different categories.
  await trackError(env, err, {
    requestId,
    path,
    method: req.method,
    statusCode: 400,
    // 'error', not the 'warning' classifyError gives a routine auth rejection:
    // nobody can enrol or use a passkey on this hostname until a person changes
    // the configuration, which is not a normal event.
    severity: 'error',
    category: 'auth',
    code: 'RP_ORIGIN_UNSUPPORTED',
    metadata: { surface, seenOrigin: seen, expectedOrigins: origins, rpID },
  });

  return error(
    `Passkeys are not set up for ${seen}. This deployment can only register ` +
      `and verify passkeys on ${origins.join(', ')} — relying party "${rpID}". ` +
      `Retrying will not help: either open Greenput on one of those hostnames, ` +
      `or add this one to the API's relying-party configuration.`,
    400,
    'RP_ORIGIN_UNSUPPORTED',
  );
}
