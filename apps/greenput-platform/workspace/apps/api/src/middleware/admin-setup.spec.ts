import { describe, it, expect } from 'vitest';
import type { IRequest } from 'itty-router';
import type { Env } from '../env';
import {
  requireAdminSetupToken,
  ADMIN_SETUP_TOKEN_HEADER,
  ADMIN_SETUP_TOKEN_MIN_LENGTH,
} from './admin-setup';

const TOKEN = 'a'.repeat(ADMIN_SETUP_TOKEN_MIN_LENGTH);

function req(token?: string): IRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers[ADMIN_SETUP_TOKEN_HEADER] = token;
  return new Request('https://api.greenput.com/api/admin/auth/setup', {
    method: 'POST',
    headers,
  }) as unknown as IRequest;
}

function env(token?: string): Env {
  return { ADMIN_SETUP_TOKEN: token } as unknown as Env;
}

/** The body the top-level router returns for a path that was never mounted. */
const UNMOUNTED_BODY = JSON.stringify({
  error: { code: 'NOT_FOUND', message: 'Not found' },
});

describe('requireAdminSetupToken', () => {
  it('passes through when the presented token matches', async () => {
    await expect(
      requireAdminSetupToken(req(TOKEN), env(TOKEN)),
    ).resolves.toBeUndefined();
  });

  it('rejects when no token is configured on the Worker', async () => {
    const res = await requireAdminSetupToken(req(TOKEN), env());
    expect(res?.status).toBe(404);
  });

  it('rejects when the configured token is the empty string', async () => {
    const res = await requireAdminSetupToken(req(''), env(''));
    expect(res?.status).toBe(404);
  });

  it('rejects a configured token one character below the minimum', async () => {
    const weak = 'b'.repeat(ADMIN_SETUP_TOKEN_MIN_LENGTH - 1);
    const res = await requireAdminSetupToken(req(weak), env(weak));
    expect(res?.status).toBe(404);
  });

  it('accepts a configured token exactly at the minimum', async () => {
    const exact = 'c'.repeat(ADMIN_SETUP_TOKEN_MIN_LENGTH);
    await expect(
      requireAdminSetupToken(req(exact), env(exact)),
    ).resolves.toBeUndefined();
  });

  it('rejects a missing header', async () => {
    const res = await requireAdminSetupToken(req(), env(TOKEN));
    expect(res?.status).toBe(404);
  });

  it('rejects a token that is a prefix of the configured one', async () => {
    const res = await requireAdminSetupToken(
      req(TOKEN.slice(0, -1)),
      env(TOKEN),
    );
    expect(res?.status).toBe(404);
  });

  it('rejects a token that merely extends the configured one', async () => {
    const res = await requireAdminSetupToken(req(`${TOKEN}b`), env(TOKEN));
    expect(res?.status).toBe(404);
  });

  it('rejects a non-string binding rather than skipping the length check', async () => {
    const weird = { ADMIN_SETUP_TOKEN: 32 } as unknown as Env;
    const res = await requireAdminSetupToken(req('32'), weird);
    expect(res?.status).toBe(404);
  });

  it('answers byte-identically whether the route is disabled or the token is wrong', async () => {
    const disabled = await requireAdminSetupToken(req(TOKEN), env());
    const wrong = await requireAdminSetupToken(req('x'.repeat(40)), env(TOKEN));

    expect(await disabled?.text()).toBe(UNMOUNTED_BODY);
    expect(await wrong?.text()).toBe(UNMOUNTED_BODY);
    expect(disabled?.status).toBe(wrong?.status);
  });
});
