import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  rateLimit,
  clearRateLimitStore,
  authRateLimit,
  publicRateLimit,
  apiKeyRateLimit,
  generalRateLimit,
  otpRateLimit,
} from './rate-limit';
import type { IRequest } from 'itty-router';

function makeRequest(ip = '1.2.3.4'): IRequest {
  const headers = new Headers({ 'CF-Connecting-IP': ip });
  return {
    headers,
    url: 'https://api.greenput.com/api/test',
    method: 'GET',
  } as unknown as IRequest;
}

describe('rateLimit', () => {
  beforeEach(() => {
    clearRateLimitStore();
    vi.restoreAllMocks();
  });

  it('allows requests under the limit', () => {
    const middleware = rateLimit({ maxRequests: 3, windowMs: 60_000 });
    const req = makeRequest();

    expect(middleware(req)).toBeUndefined();
    expect(middleware(req)).toBeUndefined();
    expect(middleware(req)).toBeUndefined();
  });

  it('returns 429 when limit is exceeded', async () => {
    const middleware = rateLimit({ maxRequests: 2, windowMs: 60_000 });
    const req = makeRequest();

    expect(middleware(req)).toBeUndefined();
    expect(middleware(req)).toBeUndefined();

    const response = middleware(req);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(429);

    const body = await (response as Response).json();
    expect(body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    });
  });

  it('includes Retry-After header on 429 response', () => {
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60_000 });
    const req = makeRequest();

    middleware(req);
    const response = middleware(req) as Response;

    expect(response.headers.get('Retry-After')).toBeTruthy();
    const retryAfter = parseInt(response.headers.get('Retry-After')!, 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('resets window after expiry', () => {
    vi.useFakeTimers();
    const windowMs = 1000;
    const middleware = rateLimit({ maxRequests: 2, windowMs });
    const req = makeRequest();

    expect(middleware(req)).toBeUndefined();
    expect(middleware(req)).toBeUndefined();
    expect(middleware(req)).toBeInstanceOf(Response);

    // Advance past window
    vi.advanceTimersByTime(windowMs + 1);

    expect(middleware(req)).toBeUndefined();
    expect(middleware(req)).toBeUndefined();

    vi.useRealTimers();
  });

  it('tracks different keys independently', () => {
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60_000 });

    const reqA = makeRequest('10.0.0.1');
    const reqB = makeRequest('10.0.0.2');

    expect(middleware(reqA)).toBeUndefined();
    expect(middleware(reqB)).toBeUndefined();

    // A is over limit, B should also be over limit independently
    expect(middleware(reqA)).toBeInstanceOf(Response);
    expect(middleware(reqB)).toBeInstanceOf(Response);
  });

  it('uses custom key function when provided', () => {
    const middleware = rateLimit({
      maxRequests: 1,
      windowMs: 60_000,
      keyFn: (req) => req.headers.get('x-api-key') ?? 'unknown',
    });

    const headers1 = new Headers({
      'CF-Connecting-IP': '1.1.1.1',
      'x-api-key': 'key-a',
    });
    const headers2 = new Headers({
      'CF-Connecting-IP': '1.1.1.1',
      'x-api-key': 'key-b',
    });

    const reqA = {
      headers: headers1,
      url: 'https://api.greenput.com/test',
      method: 'GET',
    } as unknown as IRequest;
    const reqB = {
      headers: headers2,
      url: 'https://api.greenput.com/test',
      method: 'GET',
    } as unknown as IRequest;

    expect(middleware(reqA)).toBeUndefined();
    // Same IP but different key — should be allowed
    expect(middleware(reqB)).toBeUndefined();
    // key-a is now over limit
    expect(middleware(reqA)).toBeInstanceOf(Response);
  });

  it('falls back to x-forwarded-for when CF-Connecting-IP is absent', () => {
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60_000 });

    const headers = new Headers({ 'x-forwarded-for': '9.9.9.9' });
    const req = {
      headers,
      url: 'https://api.greenput.com/test',
      method: 'GET',
    } as unknown as IRequest;

    expect(middleware(req)).toBeUndefined();
    expect(middleware(req)).toBeInstanceOf(Response);
  });

  it('falls back to unknown when no IP headers present', () => {
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60_000 });

    const req = {
      headers: new Headers(),
      url: 'https://api.greenput.com/test',
      method: 'GET',
    } as unknown as IRequest;

    expect(middleware(req)).toBeUndefined();
    expect(middleware(req)).toBeInstanceOf(Response);
  });

  it('allows exactly maxRequests before blocking', () => {
    const max = 5;
    const middleware = rateLimit({ maxRequests: max, windowMs: 60_000 });
    const req = makeRequest('5.5.5.5');

    for (let i = 0; i < max; i++) {
      expect(middleware(req)).toBeUndefined();
    }
    // One more should be blocked
    expect(middleware(req)).toBeInstanceOf(Response);
  });
});

describe('pre-configured rate limiters', () => {
  it('authRateLimit is defined', () => {
    expect(typeof authRateLimit).toBe('function');
  });

  it('publicRateLimit is defined', () => {
    expect(typeof publicRateLimit).toBe('function');
  });

  it('apiKeyRateLimit is defined', () => {
    expect(typeof apiKeyRateLimit).toBe('function');
  });

  it('generalRateLimit is defined', () => {
    expect(typeof generalRateLimit).toBe('function');
  });
});

describe('limiters do not share a bucket', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('spending the general budget does not close the auth budget', () => {
    // The bug this pins: every limiter keyed its sliding window by client IP
    // alone, so `/api/*` traffic through generalRateLimit (60 a minute) landed
    // in the same bucket authRateLimit then measured against 5. Opening the
    // dashboard fires several `/api/*` calls, so the next sign-in attempt was
    // already over the limit — and /login told the user their network was
    // broken. Ordinary navigation, reported as abuse.
    const req = makeRequest('9.9.9.9');
    for (let i = 0; i < 30; i++) {
      expect(generalRateLimit(req)).toBeUndefined();
    }
    expect(authRateLimit(req)).toBeUndefined();
  });

  it('gives recovery its own budget, separate from sign-in', () => {
    // Someone using /recover is already locked out. The failed sign-in
    // attempts that sent them there must not be able to shut the door out.
    const req = makeRequest('9.9.9.8');
    for (let i = 0; i < 5; i++) authRateLimit(req);
    expect(authRateLimit(req)).toBeInstanceOf(Response);

    expect(otpRateLimit(req)).toBeUndefined();
  });

  it('still enforces each budget on its own', () => {
    const req = makeRequest('9.9.9.7');
    for (let i = 0; i < 10; i++) {
      expect(otpRateLimit(req)).toBeUndefined();
    }
    expect(otpRateLimit(req)).toBeInstanceOf(Response);
  });

  it('allows a whole honest recovery attempt within the budget', () => {
    // send, wrong code, verify, resend, verify, and a couple of page loads.
    const req = makeRequest('9.9.9.6');
    for (let i = 0; i < 6; i++) {
      expect(otpRateLimit(req)).toBeUndefined();
    }
  });

  it('keeps every limiter independent of every other', () => {
    const req = makeRequest('9.9.9.5');
    const limiters = [
      authRateLimit,
      otpRateLimit,
      publicRateLimit,
      apiKeyRateLimit,
      generalRateLimit,
    ];
    // Exhaust auth, and nothing else should notice.
    for (let i = 0; i < 6; i++) authRateLimit(req);
    for (const limiter of limiters.slice(1)) {
      expect(limiter(req)).toBeUndefined();
    }
  });

  it('still separates callers within one limiter', () => {
    const a = makeRequest('1.1.1.1');
    const b = makeRequest('2.2.2.2');
    for (let i = 0; i < 5; i++) authRateLimit(a);
    expect(authRateLimit(a)).toBeInstanceOf(Response);
    expect(authRateLimit(b)).toBeUndefined();
  });

  it('does not let two anonymous limiters collide either', () => {
    const req = makeRequest('3.3.3.3');
    const one = rateLimit({ maxRequests: 1, windowMs: 60_000 });
    const two = rateLimit({ maxRequests: 1, windowMs: 60_000 });
    expect(one(req)).toBeUndefined();
    expect(two(req)).toBeUndefined();
    expect(one(req)).toBeInstanceOf(Response);
  });
});
