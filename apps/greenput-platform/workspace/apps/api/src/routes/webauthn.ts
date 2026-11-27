import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, unauthorized, newId } from '../lib/response';
import { createSession } from '../lib/session';
import { rpOriginRefusal } from '../lib/webauthn-origin';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';

export const webauthnRouter = Router({ base: '/api/auth/webauthn' });

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

/**
 * Determine the WebAuthn Relying Party config based on the request origin.
 *
 * RP ID must be a registrable domain suffix of the origin hostname.
 *   - Production:  app.greenput.com     → rpID = greenput.com
 *   - Staging:     app.greenput.site    → rpID = greenput.site
 *   - Pages:       abc.greenput-app.pages.dev → rpID = greenput-app.pages.dev
 *   - Dev:         localhost             → rpID = localhost
 */
function rpConfig(
  env: Env,
  requestOrigin?: string,
): { rpID: string; rpName: string; origins: string[] } {
  if (env.ENVIRONMENT === 'development') {
    return {
      rpID: 'localhost',
      rpName: 'Greenput',
      origins: ['http://localhost:4200'],
    };
  }

  if (requestOrigin) {
    // Pages preview: *.greenput-app.pages.dev → RP ID = greenput-app.pages.dev
    const pagesMatch = requestOrigin.match(
      /^https:\/\/[a-z0-9-]+\.(greenput-app\.pages\.dev)$/,
    );
    if (pagesMatch) {
      return {
        rpID: pagesMatch[1],
        rpName: 'Greenput',
        origins: [requestOrigin],
      };
    }

    // Staging: app.greenput.site → RP ID = greenput.site
    if (/^https:\/\/app\.greenput\.site$/.test(requestOrigin)) {
      return {
        rpID: 'greenput.site',
        rpName: 'Greenput',
        origins: [requestOrigin],
      };
    }
  }

  // Production
  return {
    rpID: 'greenput.com',
    rpName: 'Greenput',
    origins: ['https://app.greenput.com'],
  };
}

// ── How many ways back in does this account have? ───────────────

/**
 * GET /api/auth/webauthn/credentials — a count, and when each was added.
 *
 * There was no way to ask. Settings -> Security offered "Add a passkey" and
 * never said whether one existed, so the owner could not confirm an enrolment
 * had worked; and "Remove" on the recovery number answered "keep at least two
 * passkeys, or you can be locked out" to an account that had none, which is
 * advice for a situation the reader is not in.
 *
 * No credential_id or public_key: the count and the dates are what a person
 * needs, and the identifiers are not.
 */
webauthnRouter.get('/credentials', async (req: IRequest, env: Env) => {
  const user = (req as unknown as { user?: { id: string } }).user;
  if (!user) return error('Unauthorized', 401, 'UNAUTHORIZED');

  const rows = await env.DB.prepare(
    'SELECT id, device_type, backed_up, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at ASC',
  )
    .bind(user.id)
    .all<{
      id: string;
      device_type: string;
      backed_up: number;
      created_at: string;
    }>();

  const credentials = (rows.results ?? []).map((row) => ({
    id: row.id,
    deviceType: row.device_type,
    backedUp: Boolean(row.backed_up),
    createdAt: row.created_at,
  }));

  return json({ data: { count: credentials.length, credentials } });
});

/**
 * DELETE /api/auth/webauthn/credentials/:id — revoke one passkey.
 *
 * There was no way to. A passkey on a device you no longer have stayed valid
 * forever, and the only advice the product could offer was "keep at least two"
 * — which is not advice you can act on if you cannot remove the first.
 *
 * Refuses to remove the LAST way into an account. Deleting a lone passkey from
 * an account with no recovery number is not a revocation, it is a lockout, and
 * this endpoint is reached by someone holding a session that will end. The
 * caller is told which of the two to add first rather than being stopped
 * without a reason.
 */
webauthnRouter.delete('/credentials/:id', async (req: IRequest, env: Env) => {
  const user = (req as unknown as { user?: { id: string } }).user;
  if (!user) return error('Unauthorized', 401, 'UNAUTHORIZED');

  const id = (req as unknown as { params?: { id?: string } }).params?.id;
  if (!id) return error('Missing credential id', 400, 'MISSING_ID');

  // Scoped to the caller: an id belonging to someone else must read as absent,
  // not as forbidden, so this cannot confirm that an id exists.
  const owned = await env.DB.prepare(
    'SELECT id FROM webauthn_credentials WHERE id = ? AND user_id = ?',
  )
    .bind(id, user.id)
    .first<{ id: string }>();
  if (!owned) return error('Passkey not found', 404, 'NOT_FOUND');

  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = ?1) AS passkeys,
       (SELECT recovery_phone FROM users WHERE id = ?1) AS recovery`,
  )
    .bind(user.id)
    .first<{ passkeys: number; recovery: string | null }>();

  if ((counts?.passkeys ?? 0) <= 1 && !counts?.recovery) {
    return error(
      'This is the only way into this account. Add a second passkey, or a recovery phone number, before removing this one.',
      409,
      'LAST_CREDENTIAL',
    );
  }

  await env.DB.prepare(
    'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?',
  )
    .bind(id, user.id)
    .run();

  return json({ data: { removed: id } });
});

// ── Register: generate options ──────────────────────────────────

webauthnRouter.post('/register/options', async (req: IRequest, env: Env) => {
  const user = (
    req as unknown as {
      user?: { id: string; email: string; firstName: string; lastName: string };
    }
  ).user;
  if (!user) return unauthorized();

  const existingCreds = await env.DB.prepare(
    'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?',
  )
    .bind(user.id)
    .all<{ credential_id: string; transports: string | null }>();

  const excludeCredentials = (existingCreds.results ?? []).map((c) => ({
    id: c.credential_id,
    transports: c.transports
      ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
      : undefined,
  }));

  const origin = req.headers.get('origin') ?? undefined;
  const { rpID, rpName } = rpConfig(env, origin);

  const options = await generateRegistrationOptions({
    rpID,
    rpName,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: `${user.firstName} ${user.lastName}`,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      // 'required', not 'preferred', and this is an account-lockout fix.
      //
      // /login/options sends no `allowCredentials` — it cannot, because the
      // user is anonymous at that point, so sign-in only works with a
      // DISCOVERABLE credential the authenticator can offer unprompted. Under
      // 'preferred' an authenticator is free to enrol a non-discoverable one
      // instead, and it is allowed to say nothing about having done so. The
      // enrolment succeeds, the row lands in webauthn_credentials, and the
      // credential can never sign in: /login/options will never ask for it.
      //
      // 'required' makes the two halves agree. An authenticator that cannot
      // store a discoverable credential now fails enrolment loudly, at the
      // moment the user is standing there able to try another device, instead
      // of silently handing them a key to a lock it does not fit.
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'preferred',
    },
  });

  await env.SESSIONS.put(`challenge:reg:${user.id}`, options.challenge, {
    expirationTtl: CHALLENGE_TTL_SECONDS,
  });

  return json({ data: options });
});

// ── Register: verify response ───────────────────────────────────

webauthnRouter.post('/register/verify', async (req: IRequest, env: Env) => {
  const user = (req as unknown as { user?: { id: string } }).user;
  if (!user) return unauthorized();

  const body = await req.json();
  const expectedChallenge = await env.SESSIONS.get(`challenge:reg:${user.id}`);

  if (!expectedChallenge) {
    return error('Challenge expired or not found', 400, 'CHALLENGE_EXPIRED');
  }

  const origin = req.headers.get('origin') ?? undefined;
  const { rpID, origins } = rpConfig(env, origin);

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
    });
  } catch (err) {
    const refusal = await rpOriginRefusal({
      err,
      body,
      origins,
      rpID,
      env,
      req: req as unknown as Request,
      surface: 'contractor',
    });
    if (refusal) return refusal;
    throw err;
  }

  if (!verification.verified || !verification.registrationInfo) {
    return error(
      'Registration verification failed',
      400,
      'VERIFICATION_FAILED',
    );
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  await env.DB.prepare(
    `
    INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      newId(),
      user.id,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      JSON.stringify(credential.transports ?? []),
    )
    .run();

  await env.SESSIONS.delete(`challenge:reg:${user.id}`);

  return json({ data: { verified: true } });
});

// ── Login: generate options ─────────────────────────────────────

webauthnRouter.post('/login/options', async (req: IRequest, env: Env) => {
  const origin = req.headers.get('origin') ?? undefined;
  const { rpID } = rpConfig(env, origin);

  // Discoverable credentials: no need to specify allowCredentials
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });

  // Store challenge keyed by the challenge itself (since we don't know the user yet)
  await env.SESSIONS.put(`challenge:auth:${options.challenge}`, 'pending', {
    expirationTtl: CHALLENGE_TTL_SECONDS,
  });

  return json({ data: options });
});

// ── Login: verify response ──────────────────────────────────────

webauthnRouter.post('/login/verify', async (req: IRequest, env: Env) => {
  const body = await req.json();
  const credentialId = body.id;

  if (!credentialId) {
    return error('Missing credential ID', 400, 'MISSING_CREDENTIAL');
  }

  // Look up credential in DB
  const cred = await env.DB.prepare(
    'SELECT * FROM webauthn_credentials WHERE credential_id = ?',
  )
    .bind(credentialId)
    .first<{
      id: string;
      user_id: string;
      credential_id: string;
      public_key: string;
      counter: number;
      transports: string | null;
    }>();

  if (!cred) {
    return unauthorized();
  }

  // Retrieve the challenge from body
  const clientData = JSON.parse(
    Buffer.from(body.response.clientDataJSON, 'base64url').toString('utf-8'),
  );
  const expectedChallenge = clientData.challenge;

  const challengeExists = await env.SESSIONS.get(
    `challenge:auth:${expectedChallenge}`,
  );
  if (!challengeExists) {
    return error('Challenge expired or not found', 400, 'CHALLENGE_EXPIRED');
  }

  const origin = req.headers.get('origin') ?? undefined;
  const { rpID, origins } = rpConfig(env, origin);

  const publicKeyBytes = Uint8Array.from(
    Buffer.from(cred.public_key, 'base64url'),
  );

  // Same throw-not-false failure as register/verify, one handler down: an
  // origin outside rpConfig's cases cannot sign in either, and 500 was the
  // least useful way to say so. lib/webauthn-origin.ts carries the rationale
  // and the exact set of callers this can refuse.
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: publicKeyBytes,
        counter: cred.counter,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    });
  } catch (err) {
    const refusal = await rpOriginRefusal({
      err,
      body,
      origins,
      rpID,
      env,
      req: req as unknown as Request,
      surface: 'contractor',
    });
    if (refusal) return refusal;
    throw err;
  }

  if (!verification.verified) {
    return unauthorized();
  }

  // Update counter
  await env.DB.prepare(
    'UPDATE webauthn_credentials SET counter = ? WHERE id = ?',
  )
    .bind(verification.authenticationInfo.newCounter, cred.id)
    .run();

  // Clean up challenge
  await env.SESSIONS.delete(`challenge:auth:${expectedChallenge}`);

  // Look up user
  const user = await env.DB.prepare(
    'SELECT id, workspace_id, email, role, first_name, last_name FROM users WHERE id = ?',
  )
    .bind(cred.user_id)
    .first<{
      id: string;
      workspace_id: string;
      email: string;
      role: string;
      first_name: string;
      last_name: string;
    }>();

  if (!user) return unauthorized();

  // Create session (same helper as password login and recovery sign-in)
  const session = await createSession(env, {
    id: user.id,
    workspaceId: user.workspace_id,
    email: user.email,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
  });

  await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  const response = json({
    data: {
      user: {
        id: user.id,
        workspaceId: user.workspace_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
      },
    },
  });

  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', session.cookie);

  return new Response(response.body, { status: 200, headers });
});
