import { describe, it, expect } from 'vitest';
import { ApiError } from '@basenative/fetch';
import { classifyAuthError } from './error-kind.js';
import { PasskeyTimeoutError } from './prompt-timeout.js';

function apiError(init: {
  status: number;
  code?: string;
  message?: string;
}): ApiError {
  return new ApiError(init.message ?? 'boom', {
    status: init.status,
    code: init.code,
  });
}

/** Stand-in for the DOMException a browser throws out of WebAuthn. */
function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe('classifyAuthError', () => {
  it('calls a 429 a rate limit, not a network problem', () => {
    // The case /login got wrong in production: authRateLimit allows five
    // requests a minute across all of /api/auth/*, and /login fires
    // login/options on every mount. A user reloading to "fix" it makes it
    // worse, and the copy told them to.
    expect(classifyAuthError(apiError({ status: 429 }))).toBe('rate-limited');
  });

  it('recognises the rate limit by the envelope code too', () => {
    expect(
      classifyAuthError(apiError({ status: 429, code: 'RATE_LIMITED' })),
    ).toBe('rate-limited');
  });

  it('calls status 0 offline — the one case where "check your connection" is true', () => {
    expect(
      classifyAuthError(apiError({ status: 0, code: 'network_error' })),
    ).toBe('offline');
    expect(classifyAuthError(apiError({ status: 0, code: 'timeout' }))).toBe(
      'offline',
    );
  });

  it('calls a 401 or 403 a credential problem', () => {
    expect(classifyAuthError(apiError({ status: 401 }))).toBe('no-credential');
    expect(classifyAuthError(apiError({ status: 403 }))).toBe('no-credential');
  });

  it('calls a 5xx a server problem', () => {
    expect(classifyAuthError(apiError({ status: 500 }))).toBe('server');
    expect(classifyAuthError(apiError({ status: 503 }))).toBe('server');
  });

  it('distinguishes all four API failures from one another', () => {
    const kinds = [429, 0, 401, 500].map((status) =>
      classifyAuthError(apiError({ status })),
    );
    expect(new Set(kinds).size).toBe(4);
  });

  it('treats a dismissed or unanswerable passkey prompt as cancelled', () => {
    expect(classifyAuthError(domError('NotAllowedError'))).toBe('cancelled');
    expect(classifyAuthError(domError('AbortError'))).toBe('cancelled');
  });

  it('treats an unusable WebAuthn environment as unsupported', () => {
    expect(classifyAuthError(domError('NotSupportedError'))).toBe(
      'unsupported',
    );
    expect(classifyAuthError(domError('SecurityError'))).toBe('unsupported');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyAuthError(new Error('something else'))).toBe('unknown');
    expect(classifyAuthError('a string')).toBe('unknown');
    expect(classifyAuthError(null)).toBe('unknown');
    expect(classifyAuthError(undefined)).toBe('unknown');
    expect(classifyAuthError(apiError({ status: 418 }))).toBe('unknown');
  });
});

describe('classifyAuthError — a prompt that never appeared', () => {
  it('is no-prompt, not cancelled', () => {
    // The distinction matters to the person reading the result. `cancelled`
    // means a sheet appeared and nothing came of it, so "try again" is real
    // advice. `no-prompt` means nothing was ever shown, which points at the
    // device — and the advice is a different device.
    expect(classifyAuthError(new PasskeyTimeoutError('none came'))).toBe(
      'no-prompt',
    );
  });

  it('reads `name`, so a minified class name cannot break it', () => {
    expect(classifyAuthError({ name: 'PasskeyTimeoutError' })).toBe(
      'no-prompt',
    );
  });

  it('still prefers a transport failure when the call reached the server', () => {
    // Order check: a 429 that happened to be wrapped is a rate limit, and
    // waiting is the fix. Calling it "no prompt" would send someone hunting
    // for a hardware problem they do not have.
    expect(classifyAuthError(apiError({ status: 429 }))).toBe('rate-limited');
  });
});
