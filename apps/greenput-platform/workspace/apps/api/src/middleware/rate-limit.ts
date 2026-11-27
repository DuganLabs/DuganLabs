import type { IRequest } from 'itty-router';
import { error } from '../lib/response';

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyFn?: (req: IRequest) => string;
  /**
   * Namespace for this limiter's sliding window. Two limiters with different
   * budgets MUST NOT share one — see the note on `store` below.
   */
  name?: string;
}

interface WindowEntry {
  timestamps: number[];
}

/**
 * In-memory sliding window store (resets on worker cold start).
 *
 * Keyed by `<limiter namespace>:<client key>`, and the namespace half is not
 * decoration. Every entry used to be keyed by client IP alone, so all four
 * pre-configured limiters shared one bucket per caller while reading it
 * against different budgets. `/api/*` goes through `generalRateLimit` (60 a
 * minute) and pushes into the same bucket `authRateLimit` then measures
 * against 5 — so opening the dashboard, which fires several `/api/*` calls,
 * left the next sign-in attempt already over the auth limit. That is what
 * produced the 429s on /login: not abuse, ordinary navigation. Worse for
 * recovery, where an owner who cannot get in has to reach /api/auth/otp/*
 * through a budget the rest of the app had already spent.
 */
const store = new Map<string, WindowEntry>();

let anonymousLimiters = 0;

function defaultKeyFn(req: IRequest): string {
  return (
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('x-forwarded-for') ??
    'unknown'
  );
}

function cleanExpiredEntries(
  entry: WindowEntry,
  now: number,
  windowMs: number,
): number[] {
  const windowStart = now - windowMs;
  return entry.timestamps.filter((ts) => ts > windowStart);
}

/**
 * Creates a rate-limiting middleware using a sliding window algorithm.
 *
 * Storage is in-memory via a Map, which resets on worker cold start.
 * This is acceptable for basic abuse protection on Cloudflare Workers.
 */
export function rateLimit(options: RateLimitOptions) {
  const { maxRequests, windowMs, keyFn = defaultKeyFn } = options;
  const namespace = options.name ?? `anon${(anonymousLimiters += 1)}`;

  return (req: IRequest): Response | void => {
    const key = `${namespace}:${keyFn(req)}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    entry.timestamps = cleanExpiredEntries(entry, now, windowMs);

    if (entry.timestamps.length >= maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + windowMs - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      const response = error('Too many requests', 429, 'RATE_LIMITED');
      const headers = new Headers(response.headers);
      headers.set('Retry-After', String(retryAfterSeconds));
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    entry.timestamps.push(now);
  };
}

/** Exposed for testing — clears all tracked entries */
export function clearRateLimitStore(): void {
  store.clear();
}

// ── Pre-configured rate limiters ─────────────────────────────

/** 5 requests per minute — for login/register */
export const authRateLimit = rateLimit({
  name: 'auth',
  maxRequests: 5,
  windowMs: 60_000,
});

/**
 * 10 requests per minute — account recovery (/api/auth/otp/*), on its own
 * budget.
 *
 * Recovery is the path taken by someone who is already locked out, and one
 * honest attempt costs several requests: send a code, mistype it, verify,
 * ask for another, verify again. Sharing the 5-a-minute sign-in budget meant
 * the door out could be shut by the failed sign-in attempts that sent them to
 * it. Ten is not a weaker guard: a code dies after five wrong guesses
 * (MAX_ATTEMPTS in routes/otp.ts) regardless of how many requests reach it,
 * and /send only ever texts a number that is already somebody's recovery
 * number, so this cannot be used to fire SMS at strangers.
 */
export const otpRateLimit = rateLimit({
  name: 'otp',
  maxRequests: 10,
  windowMs: 60_000,
});

/** 20 requests per minute — for public lead forms */
export const publicRateLimit = rateLimit({
  name: 'public',
  maxRequests: 20,
  windowMs: 60_000,
});

/** 100 requests per minute — for API key authenticated requests */
export const apiKeyRateLimit = rateLimit({
  name: 'api-key',
  maxRequests: 100,
  windowMs: 60_000,
});

/** 60 requests per minute — for general authenticated requests */
export const generalRateLimit = rateLimit({
  name: 'general',
  maxRequests: 60,
  windowMs: 60_000,
});
