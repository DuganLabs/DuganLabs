import { error } from './response';

/**
 * A sliding window per client IP, in isolate memory.
 *
 * The same shape as `apps/api/src/middleware/rate-limit.ts`, without the
 * itty-router request type: this Worker has one route and no router. It is
 * a copy rather than an import because the two Workers must not share a
 * module graph — that is the whole point of this Worker existing (GP-108).
 *
 * 120 a minute, and a generous budget on purpose: these are `og:image`
 * fetches. A platform that gets a 429 for an `og:image` caches "this link has
 * no image", which is the exact failure this Worker exists to fix. The real
 * protection is not the counter: the render is cached, the response is
 * `immutable`, and an unknown slug costs one indexed SELECT and never reaches
 * the rasterizer.
 */
export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

const store = new Map<string, number[]>();

function clientKey(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('x-forwarded-for') ??
    'unknown'
  );
}

export function rateLimit(options: RateLimitOptions) {
  const { maxRequests, windowMs } = options;
  return (req: Request): Response | undefined => {
    const key = clientKey(req);
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (store.get(key) ?? []).filter((ts) => ts > windowStart);
    store.set(key, timestamps);

    if (timestamps.length >= maxRequests) {
      const retryAfterMs = timestamps[0] + windowMs - now;
      const response = error('Too many requests', 429, 'RATE_LIMITED');
      const headers = new Headers(response.headers);
      headers.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return new Response(response.body, { status: 429, headers });
    }

    timestamps.push(now);
    return undefined;
  };
}

/** Exposed for tests — forgets every client. */
export function clearRateLimitStore(): void {
  store.clear();
}

export const brandAssetRateLimit = rateLimit({
  maxRequests: 120,
  windowMs: 60_000,
});
