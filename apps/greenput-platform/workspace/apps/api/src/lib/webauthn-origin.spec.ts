// Unit-level edges of the origin refusal. The end-to-end behaviour — real
// library, real handlers, real withErrorHandler, real schema — is
// routes/webauthn-origin.spec.ts; this file covers the inputs that never get
// that far, chiefly "the body cannot be read", which must NOT be reported as an
// origin problem.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { signedOrigin, rpOriginRefusal } from './webauthn-origin';
import type { Env } from '../env';

const SCHEMA = join(__dirname, '..', '..', '..', '..', 'schema.sql');

const clientData = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

let sqlite: SqliteD1;
let env: Env;

beforeEach(() => {
  sqlite = createSqliteD1({ files: [SCHEMA] });
  env = { DB: sqlite.db, ENVIRONMENT: 'production' } as unknown as Env;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

const req = () =>
  new Request('https://api.greenput.com/api/auth/webauthn/register/verify', {
    method: 'POST',
  });

const refuse = (body: unknown) =>
  rpOriginRefusal({
    err: new Error('Unexpected registration response origin "x"'),
    body,
    origins: ['https://app.greenput.com'],
    rpID: 'greenput.com',
    env,
    req: req(),
    surface: 'contractor',
  });

describe('signedOrigin', () => {
  it('reads the origin the authenticator signed', () => {
    expect(
      signedOrigin({
        response: {
          clientDataJSON: clientData({
            type: 'webauthn.create',
            origin: 'https://acme.greenput.com',
          }),
        },
      }),
    ).toBe('https://acme.greenput.com');
  });

  it.each([
    ['a body that is not an object', 'not-a-body'],
    ['no body at all', undefined],
    ['no response', {}],
    ['a non-string clientDataJSON', { response: { clientDataJSON: 42 } }],
    [
      'base64url that is not JSON',
      { response: { clientDataJSON: 'bm90LWpzb24' } },
    ],
    [
      'JSON with no origin',
      { response: { clientDataJSON: clientData({ type: 'webauthn.create' }) } },
    ],
    [
      'an origin that is not a string',
      { response: { clientDataJSON: clientData({ origin: 7 }) } },
    ],
  ])('returns null for %s', (_label, body) => {
    expect(signedOrigin(body)).toBeNull();
  });
});

describe('rpOriginRefusal', () => {
  it('returns null when the signed origin cannot be read, so the caller rethrows', async () => {
    // A malformed body is a genuine fault. Calling it an origin mismatch would
    // answer 400 "passkeys are not set up for …" to a request that named no
    // hostname at all, and would hide the real error from error tracking.
    expect(await refuse({ response: { clientDataJSON: 'bm90LWpzb24' } })).toBe(
      null,
    );
    expect(sqlite.rows('error_logs')).toHaveLength(0);
  });

  it('returns null when the signed origin is one this surface accepts', async () => {
    expect(
      await refuse({
        response: {
          clientDataJSON: clientData({ origin: 'https://app.greenput.com' }),
        },
      }),
    ).toBe(null);
    expect(sqlite.rows('error_logs')).toHaveLength(0);
  });

  it('refuses an origin outside the accepted set, naming both halves', async () => {
    const res = await refuse({
      response: {
        clientDataJSON: clientData({ origin: 'https://acme.greenput.com' }),
      },
    });
    expect(res?.status).toBe(400);
    const body = (await res?.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('RP_ORIGIN_UNSUPPORTED');
    expect(body.error.message).toContain('https://acme.greenput.com');
    expect(body.error.message).toContain('https://app.greenput.com');
    expect(body.error.message).toContain('greenput.com');
  });

  it('compares the signed origin, not the Origin header', async () => {
    // The header is attacker-controlled and is not what the library checks; the
    // signed clientDataJSON is. An accepted header with an unaccepted signature
    // must still be refused.
    const res = await rpOriginRefusal({
      err: new Error('Unexpected registration response origin'),
      body: {
        response: {
          clientDataJSON: clientData({ origin: 'https://acme.greenput.com' }),
        },
      },
      origins: ['https://app.greenput.com'],
      rpID: 'greenput.com',
      env,
      req: new Request('https://api.greenput.com/api/auth/webauthn/x', {
        method: 'POST',
        headers: { origin: 'https://app.greenput.com' },
      }),
      surface: 'contractor',
    });
    expect(res?.status).toBe(400);
  });

  it('survives a D1 that rejects the insert, rather than turning a 400 into a 500', async () => {
    // trackError swallows its own persistence failures; this pins that the
    // refusal does too, so a broken error_logs cannot escalate the response.
    const broken = {
      DB: {
        prepare: () => ({
          bind: () => ({
            run: () => Promise.reject(new Error('D1_ERROR: no such table')),
          }),
        }),
      },
      ENVIRONMENT: 'production',
    } as unknown as Env;

    const res = await rpOriginRefusal({
      err: new Error('Unexpected registration response origin'),
      body: {
        response: {
          clientDataJSON: clientData({ origin: 'https://acme.greenput.com' }),
        },
      },
      origins: ['https://app.greenput.com'],
      rpID: 'greenput.com',
      env: broken,
      req: req(),
      surface: 'contractor',
    });
    expect(res?.status).toBe(400);
  });
});
