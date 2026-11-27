/**
 * Authenticated `fetch` wrapper for the PB site.
 *
 * Why: the worker gates every `/api/*` call behind a passkey session. A
 * fresh visitor (or a user whose cookie has expired) hits the dashboard,
 * which calls /api/situation, which 401s — and the page just shows an
 * error toast. We want them on /login instead.
 *
 * `apiFetch` wraps `fetch`, intercepts 401s on `/api/*` responses, and
 * navigates the browser to /login with `?next=<original URL>` so the
 * login flow can return them where they came from after success.
 *
 * It also intercepts 403 + `error.code === 'onboarding-required'` and
 * routes to /welcome for the multi-tenant onboarding flow.
 *
 * Use:
 *
 *     import { apiFetch } from './lib/auth-fetch.js';
 *     const res = await apiFetch('/api/situation');
 *
 * The wrapper preserves all `fetch` semantics — same args, same return —
 * except that on 401/403-onboarding it returns a `Promise` that never
 * resolves (because we're navigating away). Callers can keep their
 * `if (!res.ok)` paths; they just won't run on the redirect cases.
 */

const REDIRECT_TARGETS = {
  unauthenticated: '/login',
  onboarding: '/welcome',
} as const;

/**
 * Time we'll wait for the worker before aborting. Every PB API endpoint
 * answers in well under a second; 15s is the threshold above which a
 * caller should give up and tell the user the network is unhealthy.
 * Callers can still pass their own AbortSignal via `init.signal` — we
 * compose them so either side can cancel.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

let redirecting = false;

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEFAULT_TIMEOUT_MS);

  // Compose the caller's signal with our timeout signal so either fires.
  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort(init.signal.reason);
    } else {
      init.signal.addEventListener('abort', () => controller.abort(init.signal?.reason), {
        once: true,
      });
    }
  }

  let res: Response;
  try {
    res = await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (timedOut) {
      throw new Error(
        `Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s. Check your connection.`,
      );
    }
    throw err;
  }
  clearTimeout(timeoutId);

  // Only intercept on /api/* — static asset 401s (which shouldn't happen)
  // would otherwise loop us back to login forever.
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const isApi =
    url.startsWith('/api/') || (url.includes('://') && new URL(url).pathname.startsWith('/api/'));
  if (!isApi) return res;

  if (res.status === 401) {
    redirectToLogin();
    // Return a never-resolving promise so callers don't run their post-fetch
    // logic (they'd be racing with the navigation anyway).
    return new Promise<Response>(() => {
      /* navigation in flight */
    });
  }

  if (res.status === 403) {
    // Peek at the body to check for the onboarding-required reason without
    // consuming it for the caller. Cloning is cheap.
    try {
      const body = (await res.clone().json()) as { error?: { code?: string } | string };
      const code = typeof body.error === 'string' ? body.error : body.error?.code;
      if (code === 'onboarding-required') {
        redirectToOnboarding();
        return new Promise<Response>(() => {
          /* navigation in flight */
        });
      }
    } catch {
      // Non-JSON 403 — pass through to caller.
    }
  }

  return res;
}

function redirectToLogin(): void {
  if (redirecting) return;
  redirecting = true;
  // Don't loop if we're already on the login page.
  if (window.location.pathname === REDIRECT_TARGETS.unauthenticated) return;
  const next = window.location.pathname + window.location.search;
  const target = `${REDIRECT_TARGETS.unauthenticated}?next=${encodeURIComponent(next)}`;
  navigateNow(target);
}

function redirectToOnboarding(): void {
  if (redirecting) return;
  redirecting = true;
  if (window.location.pathname === REDIRECT_TARGETS.onboarding) return;
  navigateNow(REDIRECT_TARGETS.onboarding);
}

/**
 * Navigate away immediately, deferring past `DOMContentLoaded` if the
 * document is still parsing. A 401/403 interception can fire this during
 * initial page load (a signed-out visit to /app or /welcome) —
 * assigning `location.href` at that point raced the page's
 * `@view-transition { navigation: auto }` opt-in and threw an uncaught
 * `InvalidStateError` (see styles.css's `prefers-reduced-motion` guard for
 * the other half of this fix). `replace` also keeps the auth bounce out of
 * history, so back doesn't return to the page that never rendered.
 * Exported so other load-time redirects (welcome.ts's onboarding bootstrap)
 * share the same guard.
 */
export function navigateNow(path: string): void {
  const go = (): void => window.location.replace(path);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go, { once: true });
  } else {
    go();
  }
}

/** Where a signed-in user lands when nothing more specific was requested. */
export const DEFAULT_SIGNED_IN_PATH = '/app';

/**
 * Resolve a `?next=` parameter to a safe same-origin path. Defaults to the
 * dashboard (`/app`) — the public landing page has no link to it, so
 * sending a freshly signed-in user to `/` left them stranded. Used by the
 * login flow to return users to where they came from.
 */
export function resolveNextPath(search: string = window.location.search): string {
  const params = new URLSearchParams(search);
  const next = params.get('next');
  if (!next) return DEFAULT_SIGNED_IN_PATH;
  // Reject absolute URLs / protocol-relative URLs to prevent open-redirect.
  if (next.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(next)) return DEFAULT_SIGNED_IN_PATH;
  if (!next.startsWith('/')) return DEFAULT_SIGNED_IN_PATH;
  return next;
}
