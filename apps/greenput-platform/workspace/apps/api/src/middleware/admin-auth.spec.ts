import { describe, it, expect, vi } from 'vitest';
import { requireAdmin } from './admin-auth';

function makeEnv(sessionData: string | null = null) {
  return {
    DB: {},
    SESSIONS: {
      get: vi.fn().mockResolvedValue(sessionData),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ENVIRONMENT: 'development',
  };
}

function makeReq(cookie = '') {
  return new Request('https://admin.greenput.com/api/admin/test', {
    headers: cookie ? { Cookie: cookie } : {},
  }) as Request & { adminSession?: unknown };
}

describe('requireAdmin middleware', () => {
  it('exports requireAdmin function', async () => {
    const mod = await import('./admin-auth');
    expect(typeof mod.requireAdmin).toBe('function');
  });

  it('returns 401 when no cookie present', async () => {
    const env = makeEnv();
    const req = makeReq();
    const result = await requireAdmin(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns 401 when gp_admin_session cookie is missing', async () => {
    const env = makeEnv();
    const req = makeReq('other_cookie=abc123');
    const result = await requireAdmin(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns 401 when session not found in KV', async () => {
    const env = makeEnv(null);
    const req = makeReq('gp_admin_session=tok-123');
    const result = await requireAdmin(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(env.SESSIONS.get).toHaveBeenCalledWith('admin_session:tok-123');
  });

  it('returns 401 when session JSON is malformed', async () => {
    const env = makeEnv('not-valid-json');
    const req = makeReq('gp_admin_session=tok-bad');
    const result = await requireAdmin(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns 401 when session.isAdmin is false', async () => {
    const env = makeEnv(
      JSON.stringify({
        isAdmin: false,
        adminId: 'a1',
        email: 'admin@greenput.com',
      }),
    );
    const req = makeReq('gp_admin_session=tok-regular');
    const result = await requireAdmin(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns undefined and sets adminSession when valid', async () => {
    const session = {
      isAdmin: true,
      adminId: 'a1',
      email: 'admin@greenput.com',
    };
    const env = makeEnv(JSON.stringify(session));
    const req = makeReq('gp_admin_session=tok-valid');
    const result = await requireAdmin(req, env as never);
    expect(result).toBeUndefined();
    expect((req as Record<string, unknown>)['adminSession']).toEqual(session);
  });

  it('looks up session using cookie value as KV key suffix', async () => {
    const env = makeEnv(null);
    const req = makeReq('gp_admin_session=my-token-xyz');
    await requireAdmin(req, env as never);
    expect(env.SESSIONS.get).toHaveBeenCalledWith('admin_session:my-token-xyz');
  });

  it('handles URL-encoded cookie values', async () => {
    const env = makeEnv(null);
    const req = makeReq('gp_admin_session=tok%2F123');
    await requireAdmin(req, env as never);
    expect(env.SESSIONS.get).toHaveBeenCalledWith('admin_session:tok/123');
  });
});
