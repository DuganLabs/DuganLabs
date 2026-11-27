// ── The origin refusal, against the REAL @simplewebauthn/server ──────────────
//
// webauthn.spec.ts and admin.spec.ts both `vi.mock('@simplewebauthn/server')`,
// so every assertion they make about "the library throws for an origin
// mismatch" is an assertion about a `mockRejectedValueOnce` this repo wrote. If
// upstream ever returned `verified: false` instead of throwing, those suites
// would stay green while production took a completely different branch.
//
// This file mocks NOTHING. It drives the real handlers, through the real
// withErrorHandler, against the real schema.sql in SQLite, with the real
// library doing the verification — on both passkey surfaces. It is the file
// that fails when the premise stops being true.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { webauthnRouter } from './webauthn';
import { adminRouter } from './admin';
import { withErrorHandler } from '../middleware/error-handler';
import type { Env } from '../env';

const SCHEMA = join(__dirname, '..', '..', '..', '..', 'schema.sql');

/** A clientDataJSON the way a browser signs one: base64url over JSON. */
function signedClientData(
  origin: string,
  type: 'webauthn.create' | 'webauthn.get',
  challenge: string,
): string {
  return Buffer.from(JSON.stringify({ type, challenge, origin })).toString(
    'base64url',
  );
}

/**
 * A body the real library accepts as far as the origin check and no further.
 *
 * The library validates in a fixed order: id present, `id === rawId`, credential
 * type, clientDataJSON, response type, challenge — and only then origin. Each of
 * those is satisfied here; `attestationObject` / `authenticatorData` are left
 * out deliberately, because they are read AFTER the origin check. That absence
 * is what makes the matching-origin control below meaningful.
 */
function responseBody(
  origin: string,
  type: 'webauthn.create' | 'webauthn.get',
  challenge: string,
) {
  return {
    id: 'dGVzdC1jcmVkZW50aWFs',
    rawId: 'dGVzdC1jcmVkZW50aWFs',
    type: 'public-key',
    response: { clientDataJSON: signedClientData(origin, type, challenge) },
    clientExtensionResults: {},
  };
}

const CHALLENGE = 'a-challenge-the-authenticator-signed';

let sqlite: SqliteD1;
let env: Env;
let kv: Map<string, string>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sqlite = createSqliteD1({ files: [SCHEMA] });
  sqlite.raw.exec(
    `INSERT INTO workspaces (id, name, slug) VALUES ('w1', 'Acme', 'acme');
     INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
       VALUES ('u1', 'w1', 'Ada', 'Byron', 'ada@acme.example', 'owner', '');
     INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key)
       VALUES ('c1', 'u1', 'dGVzdC1jcmVkZW50aWFs', 'AAAA');
     INSERT INTO admin_users (id, email, display_name) VALUES ('a1', 'root@greenput.com', 'Root');
     INSERT INTO admin_webauthn_credentials (id, admin_user_id, credential_id, public_key)
       VALUES ('ac1', 'a1', 'dGVzdC1jcmVkZW50aWFs', 'AAAA');`,
  );
  kv = new Map<string, string>();
  env = {
    DB: sqlite.db,
    SESSIONS: {
      get: (k: string) => Promise.resolve(kv.get(k) ?? null),
      put: (k: string, v: string) => {
        kv.set(k, v);
        return Promise.resolve();
      },
      delete: (k: string) => {
        kv.delete(k);
        return Promise.resolve();
      },
    },
    // Not 'development', so rpConfig/adminRpConfig take the production
    // fall-through: rpID 'greenput.com' with one accepted origin each.
    ENVIRONMENT: 'production',
  } as unknown as Env;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

interface ErrorLogRow {
  code: string;
  category: string;
  severity: string;
  status_code: number | null;
  request_id: string | null;
  path: string | null;
  method: string | null;
  metadata: string | null;
}

const errorLogs = () => sqlite.rows<ErrorLogRow>('error_logs');

/**
 * Send a request the way the Worker does: through withErrorHandler, so an
 * unhandled throw becomes the real 500 and X-Request-ID is the real one.
 */
async function send(
  router: { fetch: (req: Request, env: Env) => Promise<Response> },
  url: string,
  body: unknown,
  attach: Record<string, unknown> = {},
): Promise<Response> {
  const req = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  Object.assign(req as unknown as Record<string, unknown>, attach);
  const handler = withErrorHandler((request, e) =>
    router.fetch(request as Request, e),
  );
  return handler(req, env, {
    waitUntil: (p: Promise<unknown>) => void p,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext);
}

// ── The premise, asserted against upstream directly ──────────────────────────

describe('@simplewebauthn/server, unmocked', () => {
  it('throws for an origin mismatch rather than returning verified:false', async () => {
    await expect(
      verifyRegistrationResponse({
        response: responseBody(
          'https://acme.greenput.com',
          'webauthn.create',
          CHALLENGE,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any,
        expectedChallenge: CHALLENGE,
        expectedOrigin: ['https://app.greenput.com'],
        expectedRPID: 'greenput.com',
      }),
    ).rejects.toThrow(/Unexpected registration response origin/);

    await expect(
      verifyAuthenticationResponse({
        response: responseBody(
          'https://acme.greenput.com',
          'webauthn.get',
          CHALLENGE,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any,
        expectedChallenge: CHALLENGE,
        expectedOrigin: ['https://app.greenput.com'],
        expectedRPID: 'greenput.com',
        credential: {
          id: 'dGVzdC1jcmVkZW50aWFs',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
        },
      }),
    ).rejects.toThrow(/Unexpected authentication response origin/);
  });

  it('reaches the origin check before it touches the attestation', async () => {
    // Same attestation-less body, accepted origin: it still fails, but about the
    // missing attestation rather than the origin. That ordering is why the
    // `!verification.verified` branch never saw a mismatch, and it is the one
    // fact the mocked suites take on faith. Captured rather than matched with
    // `rejects.not.toThrow`, so "it resolved" cannot pass as "it did not throw
    // about the origin".
    const caught = await verifyRegistrationResponse({
      response: responseBody(
        'https://app.greenput.com',
        'webauthn.create',
        CHALLENGE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
      expectedChallenge: CHALLENGE,
      expectedOrigin: ['https://app.greenput.com'],
      expectedRPID: 'greenput.com',
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toMatch(/origin/i);
  });
});

// ── The contractor surface: apps/api/src/routes/webauthn.ts ──────────────────

describe('POST /api/auth/webauthn/register/verify, real library', () => {
  const url = 'https://api.greenput.com/api/auth/webauthn/register/verify';

  beforeEach(() => {
    kv.set('challenge:reg:u1', CHALLENGE);
  });

  it('answers a signed-origin mismatch with a 400 naming both hostnames', async () => {
    const res = await send(
      webauthnRouter,
      url,
      responseBody('https://acme.greenput.com', 'webauthn.create', CHALLENGE),
      { user: { id: 'u1' } },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('RP_ORIGIN_UNSUPPORTED');
    expect(body.error.message).toContain('https://acme.greenput.com');
    expect(body.error.message).toContain('https://app.greenput.com');
    expect(body.error.message).not.toMatch(/our side|went wrong/i);
    expect(warn).toHaveBeenCalled();
  });

  it('files one error_logs row that correlates with the X-Request-ID it returned', async () => {
    const res = await send(
      webauthnRouter,
      url,
      responseBody('https://acme.greenput.com', 'webauthn.create', CHALLENGE),
      { user: { id: 'u1' } },
    );

    const rows = errorLogs();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.code).toBe('RP_ORIGIN_UNSUPPORTED');
    expect(row.category).toBe('auth');
    expect(row.severity).toBe('error');
    expect(row.status_code).toBe(400);
    expect(row.path).toBe('/api/auth/webauthn/register/verify');
    expect(row.method).toBe('POST');
    // The point of the row: it can be found from what the caller was handed.
    expect(row.request_id).toBe(res.headers.get('X-Request-ID'));
    expect(row.request_id).toBeTruthy();
    expect(JSON.parse(row.metadata ?? '{}')).toMatchObject({
      surface: 'contractor',
      seenOrigin: 'https://acme.greenput.com',
      expectedOrigins: ['https://app.greenput.com'],
      rpID: 'greenput.com',
    });
  });

  it('leaves an accepted origin as a 500, so a genuine fault is still tracked', async () => {
    const res = await send(
      webauthnRouter,
      url,
      responseBody('https://app.greenput.com', 'webauthn.create', CHALLENGE),
      { user: { id: 'u1' } },
    );

    expect(res.status).toBe(500);
    const rows = errorLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0].code).not.toBe('RP_ORIGIN_UNSUPPORTED');
    expect(rows[0].status_code).toBe(500);
  });

  it('keeps the challenge, so a refusal costs the caller no replay window', async () => {
    await send(
      webauthnRouter,
      url,
      responseBody('https://acme.greenput.com', 'webauthn.create', CHALLENGE),
      { user: { id: 'u1' } },
    );
    expect(kv.get('challenge:reg:u1')).toBe(CHALLENGE);
  });
});

describe('POST /api/auth/webauthn/login/verify, real library', () => {
  const url = 'https://api.greenput.com/api/auth/webauthn/login/verify';

  beforeEach(() => {
    kv.set(`challenge:auth:${CHALLENGE}`, 'pending');
  });

  it('answers a signed-origin mismatch with a 400 rather than a 500', async () => {
    const res = await send(
      webauthnRouter,
      url,
      responseBody('https://acme.greenput.com', 'webauthn.get', CHALLENGE),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RP_ORIGIN_UNSUPPORTED');
    expect(errorLogs()[0].code).toBe('RP_ORIGIN_UNSUPPORTED');
  });

  it('leaves an accepted origin as a 500', async () => {
    const res = await send(
      webauthnRouter,
      url,
      responseBody('https://app.greenput.com', 'webauthn.get', CHALLENGE),
    );
    expect(res.status).toBe(500);
  });
});

// ── The admin surface: apps/api/src/routes/admin.ts ──────────────────────────
// PR #133 as first written fixed only webauthn.ts and said "same throw, same
// file". admin.ts carries a near-verbatim copy of rpConfig and two more bare
// verify calls, so it 500'd on the identical fault. These are the tests that
// would have caught that, and they run the real library too.

describe('POST /api/admin/auth/webauthn/register/verify, real library', () => {
  const url =
    'https://api.greenput.com/api/admin/auth/webauthn/register/verify';

  beforeEach(() => {
    kv.set('challenge:admin_reg:a1', CHALLENGE);
  });

  it('answers a signed-origin mismatch with a 400 naming both hostnames', async () => {
    const res = await send(
      adminRouter,
      url,
      responseBody('https://app.greenput.com', 'webauthn.create', CHALLENGE),
      { adminSession: { isAdmin: true, adminId: 'a1', email: 'r@g.com' } },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('RP_ORIGIN_UNSUPPORTED');
    // The admin surface accepts admin.greenput.com — app.greenput.com is the
    // mismatch here, which is the copy of the bug the PR first left behind.
    expect(body.error.message).toContain('https://app.greenput.com');
    expect(body.error.message).toContain('https://admin.greenput.com');
  });

  it('files an admin-labelled error_logs row with the returned request id', async () => {
    const res = await send(
      adminRouter,
      url,
      responseBody('https://app.greenput.com', 'webauthn.create', CHALLENGE),
      { adminSession: { isAdmin: true, adminId: 'a1', email: 'r@g.com' } },
    );

    const rows = errorLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('RP_ORIGIN_UNSUPPORTED');
    expect(rows[0].status_code).toBe(400);
    expect(rows[0].request_id).toBe(res.headers.get('X-Request-ID'));
    expect(JSON.parse(rows[0].metadata ?? '{}')).toMatchObject({
      surface: 'admin',
      expectedOrigins: ['https://admin.greenput.com'],
    });
  });

  it('leaves an accepted origin as a 500, so a genuine fault is still tracked', async () => {
    const res = await send(
      adminRouter,
      url,
      responseBody('https://admin.greenput.com', 'webauthn.create', CHALLENGE),
      { adminSession: { isAdmin: true, adminId: 'a1', email: 'r@g.com' } },
    );
    expect(res.status).toBe(500);
    expect(errorLogs()[0].code).not.toBe('RP_ORIGIN_UNSUPPORTED');
  });
});

describe('POST /api/admin/auth/webauthn/login/verify, real library', () => {
  const url = 'https://api.greenput.com/api/admin/auth/webauthn/login/verify';

  beforeEach(() => {
    kv.set(`challenge:admin_auth:${CHALLENGE}`, 'pending');
  });

  it('answers a signed-origin mismatch with a 400 rather than a 500', async () => {
    const res = await send(
      adminRouter,
      url,
      responseBody('https://app.greenput.com', 'webauthn.get', CHALLENGE),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RP_ORIGIN_UNSUPPORTED');
    expect(errorLogs()[0].code).toBe('RP_ORIGIN_UNSUPPORTED');
  });

  it('leaves an accepted origin as a 500', async () => {
    const res = await send(
      adminRouter,
      url,
      responseBody('https://admin.greenput.com', 'webauthn.get', CHALLENGE),
    );
    expect(res.status).toBe(500);
  });

  it('keeps the admin challenge, so a refusal costs no replay window', async () => {
    await send(
      adminRouter,
      url,
      responseBody('https://app.greenput.com', 'webauthn.get', CHALLENGE),
    );
    expect(kv.get(`challenge:admin_auth:${CHALLENGE}`)).toBe('pending');
  });
});
