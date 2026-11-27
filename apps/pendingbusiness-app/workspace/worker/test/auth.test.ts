import { describe, it, expect } from 'vitest';
import { requireAuth } from '../src/middleware/auth.js';
import type { Env } from '../src/env.js';

/**
 * The middleware now relies on @basenative/auth-webauthn's adapter, which
 * needs a D1 binding. We fake just enough of D1 to let `currentUser`
 * resolve to null (no cookie → no lookup, but the adapter still constructs).
 */
function fakeEnv(): Env {
  const stmt = {
    bind() {
      return stmt;
    },
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({}),
  };
  return {
    DB: { prepare: () => stmt } as unknown as D1Database,
    ASSETS: {} as Fetcher,
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
  };
}

function reqFor(pathname: string, cookie?: string): Request {
  const init: RequestInit = cookie ? { headers: { Cookie: cookie } } : {};
  return new Request(`https://pendingbusiness.com${pathname}`, init);
}

describe('requireAuth (passkey session gate)', () => {
  const env = fakeEnv();

  it('allows /api/health without a session', async () => {
    const result = await requireAuth(reqFor('/api/health'), env);
    expect(result).toBeUndefined();
  });

  it('allows /api/waitlist without a session', async () => {
    const result = await requireAuth(reqFor('/api/waitlist'), env);
    expect(result).toBeUndefined();
  });

  it('allows /api/auth/* (passkey ceremony) without a session', async () => {
    const result = await requireAuth(reqFor('/api/auth/login-options'), env);
    expect(result).toBeUndefined();
  });

  it('does not gate non-/api routes (handled by the static asset catch-all)', async () => {
    const result = await requireAuth(reqFor('/index.html'), env);
    expect(result).toBeUndefined();
  });

  it('rejects /api/* without a session cookie with 401', async () => {
    const result = await requireAuth(reqFor('/api/situation'), env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('rejects /api/* with an unknown session cookie with 401', async () => {
    const result = await requireAuth(reqFor('/api/situation', 'pb_auth=does-not-exist'), env);
    expect((result as Response).status).toBe(401);
  });
});
