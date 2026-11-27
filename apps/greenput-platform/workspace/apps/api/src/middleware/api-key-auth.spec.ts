import { describe, it, expect, vi } from 'vitest';
import { hashApiKey, extractPrefix, apiKeyAuth } from './api-key-auth';

function makeEnv(row: Record<string, unknown> | null = null) {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(row),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
    SESSIONS: {},
    ENVIRONMENT: 'development',
  };
}

function makeReq(authHeader?: string) {
  return new Request('https://api.greenput.com/api/leads', {
    headers: authHeader ? { Authorization: authHeader } : {},
  }) as Request & { user?: unknown; workspaceId?: string; apiKey?: unknown };
}

describe('api-key-auth', () => {
  describe('hashApiKey', () => {
    it('returns a 64-character hex string', async () => {
      const hash = await hashApiKey('gp_testkey12345678901234567890ab');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces consistent hashes for the same input', async () => {
      const key = 'gp_abcdefgh12345678901234567890ab';
      const hash1 = await hashApiKey(key);
      const hash2 = await hashApiKey(key);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', async () => {
      const hash1 = await hashApiKey('gp_aaaaaaaa11111111111111111111aaaa');
      const hash2 = await hashApiKey('gp_bbbbbbbb22222222222222222222bbbb');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('extractPrefix', () => {
    it('extracts the first 8 chars after gp_', () => {
      expect(extractPrefix('gp_abcdefgh12345678901234567890ab')).toBe(
        'abcdefgh',
      );
    });

    it('works with minimum-length keys', () => {
      expect(extractPrefix('gp_12345678')).toBe('12345678');
    });
  });
});

describe('apiKeyAuth middleware', () => {
  it('falls through when no Authorization header', async () => {
    const env = makeEnv();
    const req = makeReq();
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeUndefined();
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it('falls through when Authorization header is not a gp_ Bearer token', async () => {
    const env = makeEnv();
    const req = makeReq('Bearer sk-openai-not-a-gp-token');
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeUndefined();
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it('falls through when Authorization header is not Bearer', async () => {
    const env = makeEnv();
    const req = makeReq('Basic gp_abcdefgh12345678');
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeUndefined();
  });

  it('returns 401 when key is too short', async () => {
    const env = makeEnv();
    const req = makeReq('Bearer gp_short');
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns 401 when key prefix not found in DB', async () => {
    const env = makeEnv(null);
    const req = makeReq('Bearer gp_abcdefgh12345678901234567890ab');
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns 401 when key is expired', async () => {
    const env = makeEnv({
      id: 'key-1',
      workspace_id: 'ws-1',
      name: 'Test Key',
      key_hash: 'wrong-hash',
      scopes: '["read"]',
      expires_at: '2020-01-01T00:00:00Z', // in the past
    });
    const req = makeReq('Bearer gp_abcdefgh12345678901234567890ab');
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns 401 when hash does not match', async () => {
    const env = makeEnv({
      id: 'key-1',
      workspace_id: 'ws-1',
      name: 'Test Key',
      key_hash: 'wrong-hash-value-not-matching',
      scopes: '["read"]',
      expires_at: null,
    });
    const req = makeReq('Bearer gp_abcdefgh12345678901234567890ab');
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns undefined and sets workspaceId/apiKey/user on valid key', async () => {
    const rawKey = 'gp_abcdefgh12345678901234567890ab';
    const keyHash = await hashApiKey(rawKey);
    const env = makeEnv({
      id: 'key-1',
      workspace_id: 'ws-1',
      name: 'My API Key',
      key_hash: keyHash,
      scopes: '["read","write"]',
      expires_at: null,
    });
    const req = makeReq(`Bearer ${rawKey}`);
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeUndefined();
    const typedReq = req as Record<string, unknown>;
    expect(typedReq['workspaceId']).toBe('ws-1');
    expect((typedReq['apiKey'] as { name: string }).name).toBe('My API Key');
    expect((typedReq['apiKey'] as { scopes: string[] }).scopes).toEqual([
      'read',
      'write',
    ]);
    expect((typedReq['user'] as { id: string }).id).toBe('apikey:key-1');
  });

  it('uses read scope fallback when scopes JSON is malformed', async () => {
    const rawKey = 'gp_abcdefgh12345678901234567890ab';
    const keyHash = await hashApiKey(rawKey);
    const env = makeEnv({
      id: 'key-1',
      workspace_id: 'ws-1',
      name: 'My Key',
      key_hash: keyHash,
      scopes: 'not-valid-json',
      expires_at: null,
    });
    const req = makeReq(`Bearer ${rawKey}`);
    await apiKeyAuth(req, env as never);
    const typedReq = req as Record<string, unknown>;
    expect((typedReq['apiKey'] as { scopes: string[] }).scopes).toEqual([
      'read',
    ]);
  });

  it('allows non-expired keys to pass', async () => {
    const rawKey = 'gp_abcdefgh12345678901234567890ab';
    const keyHash = await hashApiKey(rawKey);
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // tomorrow
    const env = makeEnv({
      id: 'key-1',
      workspace_id: 'ws-2',
      name: 'Future Key',
      key_hash: keyHash,
      scopes: '["read"]',
      expires_at: futureDate,
    });
    const req = makeReq(`Bearer ${rawKey}`);
    const result = await apiKeyAuth(req, env as never);
    expect(result).toBeUndefined();
    expect((req as Record<string, unknown>)['workspaceId']).toBe('ws-2');
  });
});
