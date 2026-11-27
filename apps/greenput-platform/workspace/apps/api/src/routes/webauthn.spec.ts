import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
const SCHEMA = join(__dirname, '..', '..', '..', '..', 'schema.sql');

// Mock @simplewebauthn/server before importing the router
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-challenge',
    rp: { name: 'Greenput', id: 'localhost' },
    user: { id: 'dXNlci0x', name: 'test@test.com', displayName: 'Test User' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-123',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    },
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'auth-challenge',
    rpId: 'localhost',
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  }),
}));

import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { webauthnRouter } from './webauthn';

/** A clientDataJSON the way a browser signs one: base64url over JSON. */
function signedClientData(
  origin: string,
  type: 'webauthn.create' | 'webauthn.get',
  challenge = 'test-challenge',
) {
  return Buffer.from(JSON.stringify({ type, challenge, origin })).toString(
    'base64url',
  );
}

function makeEnv() {
  const kvStore = new Map<string, string>();
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
    SESSIONS: {
      put: vi.fn().mockImplementation((key: string, val: string) => {
        kvStore.set(key, val);
        return Promise.resolve();
      }),
      get: vi.fn().mockImplementation((key: string) => {
        return Promise.resolve(kvStore.get(key) ?? null);
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ENVIRONMENT: 'development',
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  user?: Record<string, unknown>,
) {
  const req = new Request(
    `https://api.greenput.com/api/auth/webauthn${path}`,
    init,
  );
  if (user) {
    (req as unknown as Record<string, unknown>)['user'] = user;
  }
  return req;
}

describe('webauthnRouter', () => {
  it('exports webauthnRouter with fetch', () => {
    expect(webauthnRouter).toBeDefined();
    expect(typeof webauthnRouter.fetch).toBe('function');
  });
});

describe('POST /api/auth/webauthn/register/options', () => {
  it('returns 401 when user is not authenticated', async () => {
    const env = makeEnv();
    const res = await webauthnRouter.fetch(
      makeReq('/register/options', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 with registration options when authenticated', async () => {
    const env = makeEnv();
    const res = await webauthnRouter.fetch(
      makeReq(
        '/register/options',
        { method: 'POST' },
        {
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'Test',
          lastName: 'User',
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { challenge: string } };
    expect(body.data.challenge).toBe('test-challenge');
  });

  it('stores challenge in KV with TTL', async () => {
    const env = makeEnv();
    await webauthnRouter.fetch(
      makeReq(
        '/register/options',
        { method: 'POST' },
        {
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'Test',
          lastName: 'User',
        },
      ),
      env,
    );
    expect(env.SESSIONS.put).toHaveBeenCalledWith(
      'challenge:reg:user-1',
      'test-challenge',
      { expirationTtl: 300 },
    );
  });

  it('demands a discoverable credential, because sign-in sends no allowCredentials', async () => {
    // These two halves have to agree or enrolment silently produces a key
    // that can never open the door. /login/options cannot name the credential
    // it wants — the user is anonymous there — so the authenticator has to be
    // able to offer it unprompted. Under residentKey 'preferred' it is free
    // not to, and free to say nothing about it: the row lands in
    // webauthn_credentials, the user believes they have a passkey, and
    // /login/options will never ask for it.
    const { generateRegistrationOptions, generateAuthenticationOptions } =
      await import('@simplewebauthn/server');
    const env = makeEnv();

    await webauthnRouter.fetch(
      makeReq(
        '/register/options',
        { method: 'POST' },
        {
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'Test',
          lastName: 'User',
        },
      ),
      env,
    );
    await webauthnRouter.fetch(
      makeReq('/login/options', { method: 'POST' }),
      env,
    );

    const regArgs = (generateRegistrationOptions as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    const authArgs = (generateAuthenticationOptions as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];

    expect(authArgs.allowCredentials).toBeUndefined();
    expect(regArgs.authenticatorSelection.residentKey).toBe('required');
    expect(regArgs.authenticatorSelection.requireResidentKey).toBe(true);
  });
});

describe('POST /api/auth/webauthn/register/verify', () => {
  it('returns 401 when user is not authenticated', async () => {
    const env = makeEnv();
    const res = await webauthnRouter.fetch(
      makeReq('/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'cred-id', type: 'public-key' }),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when challenge is not found', async () => {
    const env = makeEnv();
    // KV get returns null → challenge expired
    const res = await webauthnRouter.fetch(
      makeReq(
        '/register/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'cred-id', type: 'public-key' }),
        },
        { id: 'user-1' },
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CHALLENGE_EXPIRED');
  });

  it('returns 200 when registration is verified', async () => {
    const env = makeEnv();
    env.SESSIONS.get = vi.fn().mockResolvedValue('test-challenge');

    const res = await webauthnRouter.fetch(
      makeReq(
        '/register/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'cred-id',
            type: 'public-key',
            response: {},
          }),
        },
        { id: 'user-1' },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { verified: boolean } };
    expect(body.data.verified).toBe(true);
  });

  /**
   * An expected-origin mismatch, with the library mocked.
   *
   * THIS TEST ASSERTS THE HANDLER, NOT THE PREMISE. `@simplewebauthn/server` is
   * replaced wholesale at the top of this file, so the rejection below is one
   * this repo wrote; if upstream ever returned `verified: false` instead of
   * throwing, this would stay green while production took another branch. The
   * premise — that the real library throws, and throws before it decodes the
   * attestation — is verified against the unmocked library in
   * routes/webauthn-origin.spec.ts, which also covers admin.ts.
   *
   * `acme.greenput.com` is the shape that a browser can actually complete:
   * rpConfig's fall-through hands out rpID 'greenput.com', which IS a
   * registrable domain suffix of that host, so the ceremony succeeds and the
   * mismatch lands here. An earlier version of this test used bare
   * `greenput-app.pages.dev`, which never reaches this handler at all —
   * 'greenput.com' is not a suffix of it, so the browser refuses with
   * SecurityError first. See lib/webauthn-origin.ts for the full set.
   */
  it('answers an expected-origin mismatch with a 400 that names the hostname, not a 500', async () => {
    const env = { ...makeEnv(), ENVIRONMENT: 'production' };
    env.SESSIONS.get = vi.fn().mockResolvedValue('test-challenge');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // `acme.greenput.com`: allowed by corsHeaders() (its production pattern is
    // `([a-z0-9-]+\.)?greenput\.com`), unmatched by every rpConfig case, so
    // rpConfig falls through to production and expects app.greenput.com.
    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(
      new Error(
        'Unexpected registration response origin "https://acme.greenput.com", expected one of: https://app.greenput.com',
      ),
    );

    const res = await webauthnRouter.fetch(
      makeReq(
        '/register/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'cred-id',
            type: 'public-key',
            response: {
              clientDataJSON: signedClientData(
                'https://acme.greenput.com',
                'webauthn.create',
              ),
            },
          }),
        },
        { id: 'user-1' },
      ),
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('RP_ORIGIN_UNSUPPORTED');
    // Both halves of the mismatch, so the message is actionable on its own.
    expect(body.error.message).toContain('https://acme.greenput.com');
    expect(body.error.message).toContain('https://app.greenput.com');
    expect(body.error.message).toContain('greenput.com');
    // And it does not blame the server or promise that a retry will work.
    expect(body.error.message).not.toMatch(/our side|went wrong/i);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still lets a genuine fault be a 500, so withErrorHandler can track it', async () => {
    const env = makeEnv(); // development → origins ['http://localhost:4200']
    env.SESSIONS.get = vi.fn().mockResolvedValue('test-challenge');

    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(
      new Error('D1_ERROR: no such table: webauthn_credentials'),
    );

    // The signed origin IS one this RP accepts, so the throw is not an origin
    // problem and must not be dressed up as one.
    await expect(
      webauthnRouter.fetch(
        makeReq(
          '/register/verify',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: 'cred-id',
              type: 'public-key',
              response: {
                clientDataJSON: signedClientData(
                  'http://localhost:4200',
                  'webauthn.create',
                ),
              },
            }),
          },
          { id: 'user-1' },
        ),
        env,
      ),
    ).rejects.toThrow('D1_ERROR');
  });
});

describe('POST /api/auth/webauthn/login/options', () => {
  it('returns 200 with authentication options', async () => {
    const env = makeEnv();
    const res = await webauthnRouter.fetch(
      makeReq('/login/options', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { challenge: string } };
    expect(body.data.challenge).toBe('auth-challenge');
  });

  it('stores auth challenge in KV', async () => {
    const env = makeEnv();
    await webauthnRouter.fetch(
      makeReq('/login/options', { method: 'POST' }),
      env,
    );
    expect(env.SESSIONS.put).toHaveBeenCalledWith(
      'challenge:auth:auth-challenge',
      'pending',
      { expirationTtl: 300 },
    );
  });
});

describe('POST /api/auth/webauthn/login/verify', () => {
  it('returns 400 when credential ID is missing', async () => {
    const env = makeEnv();
    const res = await webauthnRouter.fetch(
      makeReq('/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'public-key' }), // missing id
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_CREDENTIAL');
  });

  it('returns 401 when credential is not found in DB', async () => {
    const env = makeEnv();
    // DB first() returns null → cred not found
    const clientData = Buffer.from(
      JSON.stringify({
        challenge: 'some-challenge',
        origin: 'http://localhost:4200',
        type: 'webauthn.get',
      }),
    ).toString('base64url');
    const res = await webauthnRouter.fetch(
      makeReq('/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'cred-123',
          type: 'public-key',
          response: { clientDataJSON: clientData },
        }),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when challenge is expired', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'cred-db-1',
      user_id: 'user-1',
      credential_id: 'cred-123',
      public_key: 'AQIDBA',
      counter: 0,
      transports: null,
    });
    // challenge not in KV → returns null
    const clientData = Buffer.from(
      JSON.stringify({
        challenge: 'some-challenge',
        origin: 'http://localhost:4200',
        type: 'webauthn.get',
      }),
    ).toString('base64url');
    const res = await webauthnRouter.fetch(
      makeReq('/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'cred-123',
          type: 'public-key',
          response: { clientDataJSON: clientData },
        }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CHALLENGE_EXPIRED');
  });

  /**
   * The same throw-not-false failure, one handler down — and the library is
   * mocked here too, so the same caveat applies: the premise lives in
   * routes/webauthn-origin.spec.ts.
   */
  it('answers an expected-origin mismatch with a 400 rather than a 500', async () => {
    const env = { ...makeEnv(), ENVIRONMENT: 'production' };
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'cred-db-1',
      user_id: 'user-1',
      credential_id: 'cred-123',
      public_key: 'AQIDBA',
      counter: 0,
      transports: null,
    });
    env.SESSIONS.get = vi.fn().mockResolvedValue('pending');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.mocked(verifyAuthenticationResponse).mockRejectedValueOnce(
      new Error(
        'Unexpected authentication response origin "https://acme.greenput.com", expected one of: https://app.greenput.com',
      ),
    );

    const res = await webauthnRouter.fetch(
      makeReq('/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'cred-123',
          type: 'public-key',
          response: {
            clientDataJSON: signedClientData(
              'https://acme.greenput.com',
              'webauthn.get',
            ),
          },
        }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('RP_ORIGIN_UNSUPPORTED');
    expect(body.error.message).toContain('https://acme.greenput.com');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * Against the real schema, not a mock.
 *
 * `makeEnv()` above returns one value for every query, which cannot express
 * "this credential belongs to someone else" or "this is the last one" — and
 * those two facts are the entire correctness of revocation. This is the same
 * blindness that let PATCH /api/workspace ship writing to a column that did
 * not exist, with eleven tests passing.
 */
describe('webauthn credentials, against the real schema', () => {
  function realEnv() {
    const sqlite = createSqliteD1({ files: [SCHEMA] });
    sqlite.raw.exec(
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws-1', 'Acme', 'acme')`,
    );
    for (const [id, email] of [
      ['user-1', 'a@example.com'],
      ['user-2', 'b@example.com'],
    ]) {
      sqlite.raw.exec(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
         VALUES ('${id}', 'ws-1', 'A', 'B', '${email}', 'owner', '')`,
      );
    }
    return {
      sqlite,
      env: { DB: sqlite.db, SESSIONS: {}, ENVIRONMENT: 'development' },
    };
  }

  function addCredential(sqlite: SqliteD1, id: string, userId: string) {
    sqlite.raw.exec(
      `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key)
       VALUES ('${id}', '${userId}', 'cred-${id}', 'pk')`,
    );
  }

  const del = (id: string, userId: string) =>
    makeReq(`/credentials/${id}`, { method: 'DELETE' }, { id: userId });

  it('counts what the account actually has', async () => {
    const { sqlite, env } = realEnv();
    try {
      addCredential(sqlite, 'c1', 'user-1');
      addCredential(sqlite, 'c2', 'user-1');
      addCredential(sqlite, 'c3', 'user-2');

      const res = await webauthnRouter.fetch(
        makeReq('/credentials', {}, { id: 'user-1' }),
        env,
      );
      const body = (await res.json()) as { data: { count: number } };
      expect(res.status).toBe(200);
      expect(body.data.count).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('refuses to remove the only way into an account', async () => {
    const { sqlite, env } = realEnv();
    try {
      addCredential(sqlite, 'c1', 'user-1');

      const res = await webauthnRouter.fetch(del('c1', 'user-1'), env);
      const body = (await res.json()) as { error: { code: string } };

      expect(res.status).toBe(409);
      expect(body.error.code).toBe('LAST_CREDENTIAL');
      expect(sqlite.rows('webauthn_credentials')).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });

  it('allows removing the last passkey once a recovery number exists', async () => {
    const { sqlite, env } = realEnv();
    try {
      addCredential(sqlite, 'c1', 'user-1');
      sqlite.raw.exec(
        `UPDATE users SET recovery_phone = '+19495550199' WHERE id = 'user-1'`,
      );

      const res = await webauthnRouter.fetch(del('c1', 'user-1'), env);
      expect(res.status).toBe(200);
      expect(sqlite.rows('webauthn_credentials')).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });

  it('cannot remove someone else’s passkey, and says "not found" rather than "forbidden"', async () => {
    const { sqlite, env } = realEnv();
    try {
      addCredential(sqlite, 'c1', 'user-1');
      addCredential(sqlite, 'c2', 'user-1');
      addCredential(sqlite, 'c3', 'user-2');

      const res = await webauthnRouter.fetch(del('c3', 'user-1'), env);

      // 404, not 403: a "forbidden" would confirm the id exists.
      expect(res.status).toBe(404);
      expect(sqlite.rows('webauthn_credentials')).toHaveLength(3);
    } finally {
      sqlite.close();
    }
  });
});
