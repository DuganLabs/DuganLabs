import { beforeEach, describe, expect, it } from 'vitest';
import { clearRateLimitStore, rateLimit } from './rate-limit';

function requestFrom(ip: string): Request {
  return new Request('https://brand.greenput.com/x/deadbeef/card.png', {
    headers: { 'CF-Connecting-IP': ip },
  });
}

describe('rateLimit', () => {
  beforeEach(() => clearRateLimitStore());

  it('lets a client through up to the budget, then answers 429 with Retry-After', () => {
    const limit = rateLimit({ maxRequests: 3, windowMs: 60_000 });
    expect(limit(requestFrom('203.0.113.7'))).toBeUndefined();
    expect(limit(requestFrom('203.0.113.7'))).toBeUndefined();
    expect(limit(requestFrom('203.0.113.7'))).toBeUndefined();
    const refused = limit(requestFrom('203.0.113.7'));
    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(refused?.headers.get('Cache-Control')).toBe('no-store');
  });

  it('counts clients separately', () => {
    const limit = rateLimit({ maxRequests: 1, windowMs: 60_000 });
    expect(limit(requestFrom('203.0.113.7'))).toBeUndefined();
    expect(limit(requestFrom('203.0.113.7'))?.status).toBe(429);
    expect(limit(requestFrom('203.0.113.8'))).toBeUndefined();
  });

  it('forgets a client once the window has slid past', () => {
    const limit = rateLimit({ maxRequests: 1, windowMs: 1 });
    expect(limit(requestFrom('203.0.113.7'))).toBeUndefined();
    const start = Date.now();
    while (Date.now() - start < 3) {
      // spin past the 1 ms window
    }
    expect(limit(requestFrom('203.0.113.7'))).toBeUndefined();
  });
});
