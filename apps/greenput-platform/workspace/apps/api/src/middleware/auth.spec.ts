import { describe, it, expect, vi, beforeEach } from 'vitest';
import { corsHeaders, requireAuth, type SessionUser } from './auth';
import {
  SESSION_MAX_IDLE_SECONDS,
  applySessionRenewal,
  resetRenewalCoalescingForTests,
} from '../lib/session';
import { createFakeKv } from '../test-helpers';
import type { Env } from '../env';

function makeEnv(environment: string): Env {
  return {
    ENVIRONMENT: environment,
    DB: {} as D1Database,
    SESSIONS: {} as KVNamespace,
  };
}

describe('corsHeaders', () => {
  describe('development', () => {
    it('returns localhost origin', () => {
      const headers = corsHeaders(
        'http://localhost:4200',
        makeEnv('development'),
      );
      expect(headers['Access-Control-Allow-Origin']).toBe(
        'http://localhost:4200',
      );
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    });
  });

  describe('preview', () => {
    it('allows Pages preview deploy origins', () => {
      const env = makeEnv('preview');
      expect(
        corsHeaders('https://pr-42.greenput-app.pages.dev', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://pr-42.greenput-app.pages.dev');
    });

    it('allows admin preview origins', () => {
      const env = makeEnv('preview');
      expect(
        corsHeaders('https://pr-42.greenput-admin.pages.dev', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://pr-42.greenput-admin.pages.dev');
    });

    it('allows staging origins', () => {
      const env = makeEnv('preview');
      expect(
        corsHeaders('https://app.greenput.site', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://app.greenput.site');
    });
  });

  describe('production', () => {
    const env = makeEnv('production');

    it('allows greenput.com root', () => {
      expect(
        corsHeaders('https://greenput.com', env)['Access-Control-Allow-Origin'],
      ).toBe('https://greenput.com');
    });

    it('allows app.greenput.com', () => {
      expect(
        corsHeaders('https://app.greenput.com', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://app.greenput.com');
    });

    it('allows admin.greenput.com', () => {
      expect(
        corsHeaders('https://admin.greenput.com', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://admin.greenput.com');
    });

    it('allows tenant subdomain', () => {
      expect(
        corsHeaders('https://demo-electric.greenput.com', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://demo-electric.greenput.com');
    });

    it('rejects unknown origins', () => {
      expect(
        corsHeaders('https://evil.com', env)['Access-Control-Allow-Origin'],
      ).toBe('https://greenput.com');
    });

    it('rejects origins that look similar but are not greenput.com', () => {
      expect(
        corsHeaders('https://notgreenput.com', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://greenput.com');
    });
  });

  describe('staging (from production env)', () => {
    const env = makeEnv('production');

    it('allows greenput.site root', () => {
      expect(
        corsHeaders('https://greenput.site', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://greenput.site');
    });

    it('allows app.greenput.site', () => {
      expect(
        corsHeaders('https://app.greenput.site', env)[
          'Access-Control-Allow-Origin'
        ],
      ).toBe('https://app.greenput.site');
    });
  });

  it('always includes credentials header', () => {
    const headers = corsHeaders(
      'https://app.greenput.com',
      makeEnv('production'),
    );
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers['Vary']).toBe('Origin');
  });
});

describe('requireAuth', () => {
  // Key-aware on purpose: touchSession reads the session record AND the
  // `revoked:` tombstone, and a mock that answers every key with the same value
  // would report a live session as signed out.
  function makeEnvWithSession(
    sessionData: string | null,
    revoked: string | null = null,
  ) {
    return {
      ENVIRONMENT: 'test',
      DB: {} as D1Database,
      SESSIONS: {
        get: vi
          .fn()
          .mockImplementation(async (key: string) =>
            key.startsWith('revoked:') ? revoked : sessionData,
          ),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace,
    };
  }

  it('returns 401 when no session cookie is present', async () => {
    const env = makeEnvWithSession(null);
    const req = new Request('https://api.greenput.com/api/test');
    const result = await requireAuth(req, env as Env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns 401 when session not found in KV', async () => {
    const env = makeEnvWithSession(null);
    const req = new Request('https://api.greenput.com/api/test', {
      headers: { Cookie: 'gp_session=tok-missing' },
    });
    const result = await requireAuth(req, env as Env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(env.SESSIONS.get).toHaveBeenCalledWith('session:tok-missing');
  });

  it('returns 401 when session JSON is malformed', async () => {
    const env = makeEnvWithSession('not-valid-json');
    const req = new Request('https://api.greenput.com/api/test', {
      headers: { Cookie: 'gp_session=tok-bad' },
    });
    const result = await requireAuth(req, env as Env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('sets user and workspaceId on request when session is valid', async () => {
    const session = {
      id: 'u1',
      workspaceId: 'ws-1',
      email: 'user@greenput.com',
      role: 'owner',
      firstName: 'Test',
      lastName: 'User',
    };
    const env = makeEnvWithSession(JSON.stringify(session));
    const req = new Request('https://api.greenput.com/api/test', {
      headers: { Cookie: 'gp_session=tok-valid' },
    }) as Request & { user?: unknown; workspaceId?: string };
    const result = await requireAuth(req, env as Env);
    expect(result).toBeUndefined();
    expect(req.user).toEqual(session);
    expect(req.workspaceId).toBe('ws-1');
  });

  it('skips session check when user + workspaceId already set', async () => {
    const env = makeEnvWithSession(null);
    const req = new Request('https://api.greenput.com/api/test') as Request & {
      user?: unknown;
      workspaceId?: string;
    };
    req.user = { id: 'u1', role: 'admin' };
    req.workspaceId = 'ws-2';
    const result = await requireAuth(req, env as Env);
    expect(result).toBeUndefined();
    expect(env.SESSIONS.get).not.toHaveBeenCalled();
  });
});

describe('corsHeaders additional', () => {
  it('always includes Access-Control-Allow-Methods', () => {
    const headers = corsHeaders(
      'https://app.greenput.com',
      makeEnv('production'),
    );
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Methods']).toContain('DELETE');
  });

  it('always includes Content-Type in allowed headers', () => {
    const headers = corsHeaders(
      'https://app.greenput.com',
      makeEnv('production'),
    );
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
  });

  it('development returns localhost regardless of origin', () => {
    const headers = corsHeaders('https://evil.com', makeEnv('development'));
    expect(headers['Access-Control-Allow-Origin']).toBe(
      'http://localhost:4200',
    );
  });

  it('allows production Pages domains', () => {
    const env = makeEnv('production');
    expect(
      corsHeaders('https://greenput-app.pages.dev', env)[
        'Access-Control-Allow-Origin'
      ],
    ).toBe('https://greenput-app.pages.dev');
  });
});

// ── Sliding session: what requireAuth itself is responsible for ────────────
//
// The composition — itty dispatch, the drain, the header rebuilds, the error
// handler — is tested against the REAL exported worker in apps/api/src/index.spec.ts.
// Replicating that chain by hand here is what let the previous attempt pass its
// suite while returning 500s in production, so these tests only assert the
// contract of the middleware itself.
describe('requireAuth — sliding session', () => {
  const PRINCIPAL = {
    id: 'u1',
    workspaceId: 'ws-1',
    email: 'owner@example.com',
    role: 'owner',
    firstName: 'Warren',
    lastName: 'Dugan',
  };
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    resetRenewalCoalescingForTests();
  });

  async function requestWith(
    record: Record<string, unknown> | null,
    options: { revoked?: boolean } = {},
  ) {
    const clock = { now: Date.now() };
    const fake = createFakeKv(clock);
    const env = {
      ENVIRONMENT: 'production',
      DB: {} as D1Database,
      SESSIONS: fake.kv,
    } as unknown as Env;

    clock.now -= 120_000;
    if (record) {
      await fake.kv.put('session:tok', JSON.stringify(record), {
        expiration: Math.floor((record.expiresAt as number) / 1000),
      });
    }
    if (options.revoked) {
      await fake.kv.put('revoked:tok', '1', { expirationTtl: 3600 });
    }
    clock.now += 120_000;
    fake.forgetWrites();

    const request = new Request('https://api.greenput.com/api/leads', {
      headers: { Cookie: 'gp_session=tok' },
    }) as Request & { user?: SessionUser; workspaceId?: string };
    const result = await requireAuth(request, env);
    return { request, result, fake };
  }

  it('stages a refreshed cookie on the request when the session has aged', async () => {
    const now = Date.now();
    const { request, result, fake } = await requestWith({
      ...PRINCIPAL,
      createdAt: now - 3 * DAY_MS,
      expiresAt: now + 4 * DAY_MS,
    });

    expect(result).toBeUndefined();
    expect(request.user).toEqual(PRINCIPAL);
    expect(request.workspaceId).toBe('ws-1');

    const headers = new Headers();
    expect(applySessionRenewal(request, headers)).toBe(true);
    const cookie = headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('gp_session=tok');
    expect(cookie).toContain('HttpOnly');
    expect(fake.applied('session:tok')).toHaveLength(1);
  });

  it('stages nothing for a session that has barely aged', async () => {
    const now = Date.now();
    const { request, result, fake } = await requestWith({
      ...PRINCIPAL,
      // Exactly what createSession would have written a minute ago.
      createdAt: now - 60_000,
      expiresAt: now - 60_000 + SESSION_MAX_IDLE_SECONDS * 1000,
    });

    expect(result).toBeUndefined();
    expect(applySessionRenewal(request, new Headers())).toBe(false);
    expect(fake.applied('session:tok')).toEqual([]);
  });

  it('401s and clears the cookie past the absolute cap', async () => {
    const now = Date.now();
    const { result } = await requestWith({
      ...PRINCIPAL,
      createdAt: now - 31 * DAY_MS,
      expiresAt: now + 4 * DAY_MS,
    });

    expect((result as Response).status).toBe(401);
    expect((result as Response).headers.get('Set-Cookie')).toContain(
      'Max-Age=0',
    );
  });

  it('401s and clears the cookie for a revoked token, live record or not', async () => {
    const now = Date.now();
    const { result } = await requestWith(
      {
        ...PRINCIPAL,
        createdAt: now - 3 * DAY_MS,
        expiresAt: now + 4 * DAY_MS,
      },
      { revoked: true },
    );

    expect((result as Response).status).toBe(401);
    expect((result as Response).headers.get('Set-Cookie')).toContain(
      'Max-Age=0',
    );
  });

  it('never leaks the lifetime stamps into request.user', async () => {
    const now = Date.now();
    const { request } = await requestWith({
      ...PRINCIPAL,
      createdAt: now - 3 * DAY_MS,
      expiresAt: now + 4 * DAY_MS,
    });

    // /api/auth/me echoes request.user straight back to the client.
    expect(request.user).toEqual(PRINCIPAL);
    expect(Object.keys(request.user ?? {})).not.toContain('createdAt');
  });
});
