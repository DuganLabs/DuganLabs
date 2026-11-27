import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, resolveNextPath } from '../src/lib/auth-fetch.js';

describe('resolveNextPath — open-redirect protection', () => {
  it('defaults to the dashboard (/app) when there is no next param', () => {
    expect(resolveNextPath('')).toBe('/app');
    expect(resolveNextPath('?other=x')).toBe('/app');
  });

  it('returns the next path when valid', () => {
    expect(resolveNextPath('?next=/app')).toBe('/app');
    expect(resolveNextPath('?next=/account.html')).toBe('/account.html');
    expect(resolveNextPath('?next=/app%3Ftab%3Dincome')).toBe('/app?tab=income');
  });

  it('rejects protocol-relative URLs', () => {
    expect(resolveNextPath('?next=//evil.example/foo')).toBe('/app');
  });

  it('rejects absolute URLs with a scheme', () => {
    expect(resolveNextPath('?next=https://evil.example')).toBe('/app');
    expect(resolveNextPath('?next=http://evil.example/path')).toBe('/app');
  });

  it('rejects javascript: pseudo-URLs', () => {
    expect(resolveNextPath('?next=javascript:alert(1)')).toBe('/app');
    expect(resolveNextPath('?next=JavaScript:alert(1)')).toBe('/app');
  });

  it('rejects relative paths that do not start with /', () => {
    expect(resolveNextPath('?next=app')).toBe('/app');
    expect(resolveNextPath('?next=../etc/passwd')).toBe('/app');
  });
});

describe('apiFetch — request timeout', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('aborts after the default timeout fires', async () => {
    // Fake fetch that never resolves until aborted.
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;

    // Catch eagerly so the rejection always has a handler — otherwise
    // advancing timers can race ahead of the test awaiting the promise
    // and Node logs an unhandled rejection.
    const settled = apiFetch('/api/situation').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_001);
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/timed out/i);
  });

  it('forwards a non-timeout abort from the caller', async () => {
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;

    const ctrl = new AbortController();
    const settled = apiFetch('/api/situation', { signal: ctrl.signal }).catch((e: unknown) => e);
    ctrl.abort();
    const err = (await settled) as { name?: string; message?: string };
    // The error should be the caller's AbortError (DOMException), NOT our timeout error.
    expect(err.name).toBe('AbortError');
    expect(err.message ?? '').not.toMatch(/timed out/i);
  });

  it('passes through a successful response unchanged', async () => {
    globalThis.fetch = (async () => new Response('"ok"', { status: 200 })) as typeof fetch;
    const res = await apiFetch('/api/health');
    expect(res.status).toBe(200);
  });
});
