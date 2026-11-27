import { afterEach, describe, expect, it } from 'vitest';
import type { AuthErrorKind } from '@basenative/auth-webauthn';
import { LOGIN_MESSAGES, renderLoginRoute } from './login.js';
import { ROUTE_TABLE } from '../table.js';
import type { PlatformDeps } from '../../deps.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

/** Drive the store's two error signals the way a real failure would. */
function setAuthError(
  deps: PlatformDeps,
  message: string,
  kind: AuthErrorKind,
): void {
  const mutable = deps.auth as unknown as {
    error: { set(v: string | null): void };
    errorKind: { set(v: AuthErrorKind | null): void };
  };
  mutable.errorKind.set(kind);
  mutable.error.set(message);
}

describe('renderLoginRoute', () => {
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders the brand, sign-in copy, and primary action', () => {
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLoginRoute(deps);
    dispose = view.dispose;

    document.body.append(view.element);

    expect(view.element.querySelector('h1')?.textContent).toBe('Greenput');
    expect(view.element.querySelector('p')?.textContent).toMatch(
      /Sign in with your passkey/,
    );
    const button = view.element.querySelector(
      '[data-testid="login-passkey-button"]',
    );
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('Sign in with passkey');
  });

  it('never shows the raw transport message in the inline alert', () => {
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLoginRoute(deps);
    dispose = view.dispose;

    const errorBanner = view.element.querySelector('[data-bn-error]');
    expect(errorBanner?.hasAttribute('hidden')).toBe(true);

    deps.auth.setUser(null);
    // Simulate the auth store surfacing a raw transport error (e.g. the API
    // 404ing) — the banner must never show that text verbatim.
    setAuthError(deps, 'Not Found', 'unknown');

    expect(errorBanner?.hasAttribute('hidden')).toBe(false);
    expect(errorBanner?.textContent).not.toBe('Not Found');
    expect(errorBanner?.textContent?.length).toBeGreaterThan(20);
  });

  it('tells a rate limit apart from a network failure', () => {
    // The bug this replaces: one sentence — "Check your connection and try
    // again." — for every failure. It was a lie for a 429, and worse, the
    // advice it gave (retry, reload) is the one thing that keeps a
    // rate-limited user locked out.
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLoginRoute(deps);
    dispose = view.dispose;
    const banner = view.element.querySelector('[data-bn-error]');

    setAuthError(deps, 'Too many requests', 'rate-limited');
    const rateLimited = banner?.textContent ?? '';

    setAuthError(deps, 'Failed to fetch', 'offline');
    const offline = banner?.textContent ?? '';

    expect(rateLimited).not.toBe(offline);
    expect(rateLimited).not.toMatch(/connection/i);
    expect(offline).toMatch(/connection/i);
  });

  it('gives every failure kind its own sentence', () => {
    // If two kinds collapsed onto one message, the classification would be
    // decorative. Distinctness is the property worth pinning — not the words.
    const messages = Object.values(LOGIN_MESSAGES);
    expect(new Set(messages).size).toBe(messages.length);
    for (const message of messages) {
      expect(message.trim().length).toBeGreaterThan(20);
    }
  });

  it('offers a route back in that does not need a passkey', () => {
    // Without this link the passkey screen is a closed door: a contractor
    // whose device is gone has no session, so every other entry point is
    // behind the guard that just sent them here.
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLoginRoute(deps);
    dispose = view.dispose;

    const link = view.element.querySelector<HTMLAnchorElement>(
      '[data-testid="login-recover-link"]',
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/recover');

    const recoverRoute = ROUTE_TABLE.find((r) => r.path === '/recover');
    expect(recoverRoute).toBeDefined();
    expect(recoverRoute?.meta?.requiresAuth).toBeFalsy();
  });

  it('disables the button while loading', () => {
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLoginRoute(deps);
    dispose = view.dispose;

    const button = view.element.querySelector(
      '[data-testid="login-passkey-button"]',
    ) as HTMLButtonElement;
    expect(button.hasAttribute('disabled')).toBe(false);

    type Mutable = { loading: { set(v: boolean): void } };
    (deps.auth as unknown as Mutable).loading.set(true);

    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('Signing in…');
  });

  it('triggers loginWithPasskey on click', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/auth/webauthn/login/options', () =>
      jsonResponse({ data: { challenge: 'abc' } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLoginRoute(deps);
    dispose = view.dispose;

    const button = view.element.querySelector(
      '[data-testid="login-passkey-button"]',
    ) as HTMLButtonElement;
    button.click();
    await tick();

    expect(
      fake.calls.some((c) =>
        c.url.endsWith('/api/auth/webauthn/login/options'),
      ),
    ).toBe(true);
  });
});
