import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import type { AdminSession } from '../middleware/admin-auth';
import { validate } from '../middleware/validate';
import { rpOriginRefusal } from '../lib/webauthn-origin';
import { requireAdminSetupToken } from '../middleware/admin-setup';
import { AdminSetupSchema } from '@greenput/shared/validators';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';

export const adminRouter = Router({ base: '/api/admin' });

const ADMIN_SESSION_TTL = 60 * 60 * 24; // 1 day
const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

/**
 * Determine admin WebAuthn RP config based on the request origin.
 *   - Pages preview: *.greenput-admin.pages.dev → rpID = greenput-admin.pages.dev
 *   - Staging:       admin.greenput.site        → rpID = greenput.site
 *   - Production:    admin.greenput.com         → rpID = greenput.com
 */
function adminRpConfig(
  env: Env,
  requestOrigin?: string,
): {
  rpID: string;
  rpName: string;
  origins: string[];
} {
  if (env.ENVIRONMENT === 'development') {
    return {
      rpID: 'localhost',
      rpName: 'Greenput Admin',
      origins: ['http://localhost:4200', 'http://localhost:4201'],
    };
  }

  if (requestOrigin) {
    // Pages preview: *.greenput-admin.pages.dev
    const pagesMatch = requestOrigin.match(
      /^https:\/\/[a-z0-9-]+\.(greenput-admin\.pages\.dev)$/,
    );
    if (pagesMatch) {
      return {
        rpID: pagesMatch[1],
        rpName: 'Greenput Admin',
        origins: [requestOrigin],
      };
    }

    // Staging
    if (/^https:\/\/admin\.greenput\.site$/.test(requestOrigin)) {
      return {
        rpID: 'greenput.site',
        rpName: 'Greenput Admin',
        origins: [requestOrigin],
      };
    }
  }

  // Production
  return {
    rpID: 'greenput.com',
    rpName: 'Greenput Admin',
    origins: ['https://admin.greenput.com'],
  };
}

function buildAdminSessionCookie(
  token: string,
  env: Env,
  maxAge: number,
): string {
  const parts = [
    `gp_admin_session=${token}`,
    'HttpOnly',
    'Secure',
    `Max-Age=${maxAge}`,
    'Path=/',
    'SameSite=Lax',
  ];

  if (env.ENVIRONMENT === 'production') {
    parts.push('Domain=.greenput.com');
  } else if (env.ENVIRONMENT === 'staging') {
    parts.push('Domain=.greenput.site');
  }

  return parts.join('; ');
}

// ── Admin Setup (first admin registration — only when no admins exist) ──
//
// Two independent conditions have to hold, and BOTH are enforced here rather
// than by the caller being friendly:
//
//   1. requireAdminSetupToken — the caller holds ADMIN_SETUP_TOKEN, pushed as
//      a Worker secret by the pipeline from a GitHub Actions secret of the
//      same name. (The org's policy is that secrets live in Doppler; Doppler
//      is not wired into this repo's ci.yml, so saying so here would send the
//      next person to the wrong place.) Absent on this Worker => the route 404s
//      as if it were never mounted. It runs before validate() so an
//      unauthenticated caller's body is never parsed.
//   2. The table is still empty. Checked by the INSERT itself, not by a SELECT
//      before it: two bootstraps racing each other could both read an empty
//      table and both insert.
//
// The route stays deployed rather than being compiled out once an admin exists,
// because a fresh environment (a rebuilt staging, a restored database) has to
// be bootstrappable without a hand-written row in a live database. What used to
// be "whoever arrives first" is now "whoever holds the secret, once".

adminRouter.post(
  '/auth/setup',
  requireAdminSetupToken,
  validate(AdminSetupSchema),
  async (req: IRequest, env: Env) => {
    const body = (
      req as unknown as {
        validatedBody: { email: string; displayName: string };
      }
    ).validatedBody;

    const adminId = newId();
    // One statement, so "no admin exists yet" and "write the row" cannot be
    // interleaved by a concurrent request. Deliberately does not lean on
    // admin_users.email being UNIQUE: schema.sql and the live database are
    // known to disagree about column constraints, so the guard is the
    // WHERE NOT EXISTS, which is plain SQL semantics either way.
    await env.DB.prepare(
      `INSERT INTO admin_users (id, email, display_name)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_users)`,
    )
      .bind(adminId, body.email, body.displayName ?? '')
      .run();

    // Read the row back rather than trusting D1's meta.changes: if the insert
    // was suppressed there is already an admin, and no session may be minted.
    const inserted = await env.DB.prepare(
      'SELECT id FROM admin_users WHERE id = ?',
    )
      .bind(adminId)
      .first<{ id: string }>();

    if (!inserted) {
      return error('Admin already configured', 403, 'ADMIN_EXISTS');
    }

    // Create session so the admin can immediately register a passkey
    const sessionToken = newId();
    const sessionData: AdminSession = {
      isAdmin: true,
      adminId,
      email: body.email,
    };

    await env.SESSIONS.put(
      `admin_session:${sessionToken}`,
      JSON.stringify(sessionData),
      { expirationTtl: ADMIN_SESSION_TTL },
    );

    const response = json({
      data: {
        user: { id: adminId, email: body.email, isAdmin: true },
        needsPasskey: true,
      },
    });

    const headers = new Headers(response.headers);
    headers.append(
      'Set-Cookie',
      buildAdminSessionCookie(sessionToken, env, ADMIN_SESSION_TTL),
    );

    return new Response(response.body, { status: 201, headers });
  },
);

// ── Passkey Register: generate options ──────────────────────

adminRouter.post(
  '/auth/webauthn/register/options',
  async (req: IRequest, env: Env) => {
    const session = (req as unknown as { adminSession?: AdminSession })
      .adminSession;
    if (!session) return error('Unauthorized', 401, 'UNAUTHORIZED');

    const adminUser = await env.DB.prepare(
      'SELECT id, email, display_name FROM admin_users WHERE id = ?',
    )
      .bind(session.adminId)
      .first<{ id: string; email: string; display_name: string }>();

    if (!adminUser) return error('Admin user not found', 404, 'NOT_FOUND');

    const existingCreds = await env.DB.prepare(
      'SELECT credential_id, transports FROM admin_webauthn_credentials WHERE admin_user_id = ?',
    )
      .bind(adminUser.id)
      .all<{ credential_id: string; transports: string | null }>();

    const excludeCredentials = (existingCreds.results ?? []).map((c) => ({
      id: c.credential_id,
      transports: c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
        : undefined,
    }));

    const { rpID, rpName } = adminRpConfig(
      env,
      req.headers.get('origin') ?? undefined,
    );

    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      userID: new TextEncoder().encode(adminUser.id),
      userName: adminUser.email,
      userDisplayName: adminUser.display_name || adminUser.email,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await env.SESSIONS.put(
      `challenge:admin_reg:${adminUser.id}`,
      options.challenge,
      { expirationTtl: CHALLENGE_TTL_SECONDS },
    );

    return json({ data: options });
  },
);

// ── Passkey Register: verify response ───────────────────────

adminRouter.post(
  '/auth/webauthn/register/verify',
  async (req: IRequest, env: Env) => {
    const session = (req as unknown as { adminSession?: AdminSession })
      .adminSession;
    if (!session) return error('Unauthorized', 401, 'UNAUTHORIZED');

    const body = await req.json();
    const expectedChallenge = await env.SESSIONS.get(
      `challenge:admin_reg:${session.adminId}`,
    );

    if (!expectedChallenge) {
      return error('Challenge expired or not found', 400, 'CHALLENGE_EXPIRED');
    }

    const { rpID, origins } = adminRpConfig(
      env,
      req.headers.get('origin') ?? undefined,
    );

    // The same throw-not-false failure as the contractor surface: an origin
    // adminRpConfig does not recognise falls through to rpID 'greenput.com'
    // with origins ['https://admin.greenput.com'], and the library throws
    // rather than returning verified:false — which used to escape to
    // withErrorHandler as a 500 INTERNAL. adminRpConfig is a near-verbatim copy
    // of rpConfig, so it had a near-verbatim copy of the bug; the refusal lives
    // in lib/webauthn-origin.ts precisely so it cannot be fixed on one surface
    // and forgotten on the other.
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
        surface: 'admin',
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
      `INSERT INTO admin_webauthn_credentials
       (id, admin_user_id, credential_id, public_key, counter, device_type, backed_up, transports)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId(),
        session.adminId,
        credential.id,
        Buffer.from(credential.publicKey).toString('base64url'),
        credential.counter,
        credentialDeviceType,
        credentialBackedUp ? 1 : 0,
        JSON.stringify(credential.transports ?? []),
      )
      .run();

    await env.SESSIONS.delete(`challenge:admin_reg:${session.adminId}`);

    return json({ data: { verified: true } });
  },
);

// ── Passkey Login: generate options ─────────────────────────

adminRouter.post(
  '/auth/webauthn/login/options',
  async (req: IRequest, env: Env) => {
    const { rpID } = adminRpConfig(env, req.headers.get('origin') ?? undefined);

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });

    await env.SESSIONS.put(
      `challenge:admin_auth:${options.challenge}`,
      'pending',
      { expirationTtl: CHALLENGE_TTL_SECONDS },
    );

    return json({ data: options });
  },
);

// ── Passkey Login: verify response ──────────────────────────

adminRouter.post(
  '/auth/webauthn/login/verify',
  async (req: IRequest, env: Env) => {
    const body = await req.json();
    const credentialId = body.id;

    if (!credentialId) {
      return error('Missing credential ID', 400, 'MISSING_CREDENTIAL');
    }

    const cred = await env.DB.prepare(
      'SELECT * FROM admin_webauthn_credentials WHERE credential_id = ?',
    )
      .bind(credentialId)
      .first<{
        id: string;
        admin_user_id: string;
        credential_id: string;
        public_key: string;
        counter: number;
        transports: string | null;
      }>();

    if (!cred) {
      return error('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const clientData = JSON.parse(
      Buffer.from(body.response.clientDataJSON, 'base64url').toString('utf-8'),
    );
    const expectedChallenge = clientData.challenge;

    const challengeExists = await env.SESSIONS.get(
      `challenge:admin_auth:${expectedChallenge}`,
    );
    if (!challengeExists) {
      return error('Challenge expired or not found', 400, 'CHALLENGE_EXPIRED');
    }

    const { rpID, origins } = adminRpConfig(
      env,
      req.headers.get('origin') ?? undefined,
    );

    const publicKeyBytes = Uint8Array.from(
      Buffer.from(cred.public_key, 'base64url'),
    );

    // Same refusal on the admin sign-in half — see the note in
    // register/verify above.
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
        surface: 'admin',
      });
      if (refusal) return refusal;
      throw err;
    }

    if (!verification.verified) {
      return error('Unauthorized', 401, 'UNAUTHORIZED');
    }

    await env.DB.prepare(
      'UPDATE admin_webauthn_credentials SET counter = ? WHERE id = ?',
    )
      .bind(verification.authenticationInfo.newCounter, cred.id)
      .run();

    await env.SESSIONS.delete(`challenge:admin_auth:${expectedChallenge}`);

    const adminUser = await env.DB.prepare(
      'SELECT id, email, display_name FROM admin_users WHERE id = ?',
    )
      .bind(cred.admin_user_id)
      .first<{ id: string; email: string; display_name: string }>();

    if (!adminUser) {
      return error('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const sessionToken = newId();
    const sessionData: AdminSession = {
      isAdmin: true,
      adminId: adminUser.id,
      email: adminUser.email,
    };

    await env.SESSIONS.put(
      `admin_session:${sessionToken}`,
      JSON.stringify(sessionData),
      { expirationTtl: ADMIN_SESSION_TTL },
    );

    const response = json({
      data: {
        user: {
          id: adminUser.id,
          email: adminUser.email,
          displayName: adminUser.display_name,
          isAdmin: true,
        },
      },
    });

    const headers = new Headers(response.headers);
    headers.append(
      'Set-Cookie',
      buildAdminSessionCookie(sessionToken, env, ADMIN_SESSION_TTL),
    );

    return new Response(response.body, { status: 200, headers });
  },
);

// ── Check setup status ──────────────────────────────────────

adminRouter.get('/auth/status', async (_req: IRequest, env: Env) => {
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM admin_users',
  ).first<{ cnt: number }>();

  return json({
    data: {
      configured: (count?.cnt ?? 0) > 0,
    },
  });
});

// ── Logout ──────────────────────────────────────────────────

adminRouter.post('/auth/logout', async (req: IRequest, env: Env) => {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)gp_admin_session=([^;]*)/);
  const token = match ? decodeURIComponent(match[1]) : null;

  if (token) {
    await env.SESSIONS.delete(`admin_session:${token}`);
  }

  const response = json({ data: { ok: true } });
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', buildAdminSessionCookie('', env, 0));

  return new Response(response.body, { status: 200, headers });
});

// ── Me ──────────────────────────────────────────────────────

adminRouter.get('/auth/me', async (req: IRequest, _env: Env) => {
  const session = (req as unknown as { adminSession?: AdminSession })
    .adminSession;
  if (!session) return error('Unauthorized', 401, 'UNAUTHORIZED');
  return json({
    data: {
      user: { id: session.adminId, email: session.email, isAdmin: true },
    },
  });
});

// ── Metrics ───────────────────────────────────────────────────

adminRouter.get('/metrics', async (_req: IRequest, env: Env) => {
  const [workspaces, users, leads, jobs, revenue] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS cnt FROM workspaces').first<{
      cnt: number;
    }>(),
    env.DB.prepare('SELECT COUNT(*) AS cnt FROM users').first<{
      cnt: number;
    }>(),
    env.DB.prepare('SELECT COUNT(*) AS cnt FROM leads').first<{
      cnt: number;
    }>(),
    env.DB.prepare('SELECT COUNT(*) AS cnt FROM jobs').first<{
      cnt: number;
    }>(),
    env.DB.prepare('SELECT COALESCE(SUM(total), 0) AS total FROM jobs').first<{
      total: number;
    }>(),
  ]);

  return json({
    data: {
      workspaces: workspaces?.cnt ?? 0,
      users: users?.cnt ?? 0,
      leads: leads?.cnt ?? 0,
      jobs: jobs?.cnt ?? 0,
      revenue: revenue?.total ?? 0,
    },
  });
});

// ── Workspaces ────────────────────────────────────────────────

adminRouter.get('/workspaces', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const q = url.searchParams.get('q');

  let where = '';
  const params: unknown[] = [];

  if (q) {
    where = 'WHERE w.name LIKE ? OR w.email LIKE ?';
    const like = `%${q}%`;
    params.push(like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT w.*,
              (SELECT COUNT(*) FROM users u WHERE u.workspace_id = w.id) AS user_count,
              (SELECT COUNT(*) FROM leads l WHERE l.workspace_id = w.id) AS lead_count,
              (SELECT COUNT(*) FROM jobs j WHERE j.workspace_id = w.id) AS job_count
       FROM workspaces w
       ${where}
       ORDER BY w.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM workspaces w ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return json({
    data: rows.results,
    meta: { total: countRow?.total ?? 0, page, perPage: limit },
  });
});

adminRouter.get('/workspaces/:id', async (req: IRequest, env: Env) => {
  const workspace = await env.DB.prepare(
    'SELECT * FROM workspaces WHERE id = ?',
  )
    .bind(req.params!['id'])
    .first();

  if (!workspace) return notFound('Workspace');

  const users = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, role, avatar_initials, last_seen_at, created_at
     FROM users WHERE workspace_id = ?`,
  )
    .bind(req.params!['id'])
    .all();

  return json({ data: { ...workspace, users: users.results } });
});

adminRouter.delete('/workspaces/:id', async (req: IRequest, env: Env) => {
  const id = req.params!['id'];
  const existing = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE id = ?',
  )
    .bind(id)
    .first();

  if (!existing) return notFound('Workspace');

  await env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(id).run();

  return json({ data: { deleted: true } });
});

// ── Users ─────────────────────────────────────────────────────

adminRouter.get('/users', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const q = url.searchParams.get('q');

  let where = '';
  const params: unknown[] = [];

  if (q) {
    where = 'WHERE u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role,
              u.avatar_initials, u.last_seen_at, u.created_at,
              w.name AS workspace_name
       FROM users u
       LEFT JOIN workspaces w ON w.id = u.workspace_id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM users u ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return json({
    data: rows.results,
    meta: { total: countRow?.total ?? 0, page, perPage: limit },
  });
});

// ── Activity ──────────────────────────────────────────────────

adminRouter.get('/activity', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT a.*, u.first_name, u.last_name, w.name AS workspace_name
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN workspaces w ON w.id = a.workspace_id
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM activity_log').first<{
      total: number;
    }>(),
  ]);

  return json({
    data: rows.results,
    meta: { total: countRow?.total ?? 0, page, perPage: limit },
  });
});
