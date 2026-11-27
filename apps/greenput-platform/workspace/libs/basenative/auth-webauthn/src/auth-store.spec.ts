import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, createApiClient } from '@basenative/fetch';
import { createAuthStore } from './auth-store.js';
import type { AuthUser } from './types.js';
import type { WebAuthnClient } from './webauthn-client.js';

const user: AuthUser = {
  id: 'user-1',
  email: 'jane@greenput.com',
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'owner',
  workspaceId: 'ws-1',
};

function fakeWebauthn(
  overrides: Partial<WebAuthnClient<AuthUser>> = {},
): WebAuthnClient<AuthUser> {
  return {
    authenticate: vi.fn(async () => user),
    authenticateConditional: vi.fn(async () => user),
    abortConditional: vi.fn(),
    register: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeApiClient(
  handler: (req: Request) => Response | Promise<Response>,
) {
  return createApiClient({
    baseUrl: 'https://api.test',
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      return handler(new Request(url, init));
    },
  });
}

beforeEach(() => {
  // Default: WebAuthn available so feature detection passes.
  (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
    isConditionalMediationAvailable: async () => true,
  };
});

describe('createAuthStore — initial state', () => {
  it('starts logged-out', () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn(),
    });

    expect(store.user()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.sessionChecked()).toBe(false);
    expect(store.initials()).toBe('');
    expect(store.displayName()).toBe('');
  });

  it('derives initials and displayName when a user is set', () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn(),
    });

    store.setUser(user);
    expect(store.initials()).toBe('JD');
    expect(store.displayName()).toBe('Jane Doe');
    expect(store.isAuthenticated()).toBe(true);
  });

  it('honours custom initials/displayName resolvers', () => {
    const store = createAuthStore<AuthUser & { handle: string }>({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn() as unknown as WebAuthnClient<
        AuthUser & { handle: string }
      >,
      initials: (u) => u.handle.slice(0, 2).toUpperCase(),
      displayName: (u) => u.handle,
    });

    store.setUser({ ...user, handle: 'janedoe' });
    expect(store.initials()).toBe('JA');
    expect(store.displayName()).toBe('janedoe');
  });

  it('clearError resets the error signal', () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        authenticate: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
    });

    return (async () => {
      await store.loginWithPasskey();
      expect(store.error()).toBe('boom');
      store.clearError();
      expect(store.error()).toBeNull();
    })();
  });
});

describe('createAuthStore — errorKind', () => {
  it('starts null and stays in lockstep with error', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        authenticate: vi.fn(async () => {
          throw new ApiError('Too many requests', {
            status: 429,
            code: 'RATE_LIMITED',
          });
        }),
      }),
    });

    expect(store.errorKind()).toBeNull();

    await store.loginWithPasskey();
    // Both halves set, or a screen branching on one while reading the other
    // renders a message for a failure that did not happen.
    expect(store.error()).not.toBeNull();
    expect(store.errorKind()).toBe('rate-limited');

    store.clearError();
    expect(store.error()).toBeNull();
    expect(store.errorKind()).toBeNull();
  });

  it('classifies a cancelled passkey prompt separately from a rate limit', async () => {
    const cancelled = new Error(
      'The operation either timed out or was not allowed.',
    );
    cancelled.name = 'NotAllowedError';

    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        authenticate: vi.fn(async () => {
          throw cancelled;
        }),
      }),
    });

    await store.loginWithPasskey();
    expect(store.errorKind()).toBe('cancelled');
  });

  it('clears the previous kind before a new attempt', async () => {
    let throwIt = true;
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        authenticate: vi.fn(async () => {
          if (throwIt) throw new ApiError('nope', { status: 401 });
          return user;
        }),
      }),
    });

    await store.loginWithPasskey();
    expect(store.errorKind()).toBe('no-credential');

    throwIt = false;
    await store.loginWithPasskey();
    expect(store.errorKind()).toBeNull();
  });

  it('records a kind for a failed enrolment too', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        register: vi.fn(async () => {
          throw new ApiError('Too many requests', { status: 429 });
        }),
      }),
    });

    await expect(store.enrollPasskey()).rejects.toThrow();
    expect(store.errorKind()).toBe('rate-limited');
  });
});

describe('createAuthStore — loginWithPasskey', () => {
  it('sets user and runs redirectAfterLogin on success', async () => {
    const redirectAfterLogin = vi.fn();
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn(),
      redirectAfterLogin,
    });

    const ok = await store.loginWithPasskey();

    expect(ok).toBe(true);
    expect(store.user()).toEqual(user);
    expect(redirectAfterLogin).toHaveBeenCalledWith(user);
  });

  it('captures error message on failure', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        authenticate: vi.fn(async () => {
          throw new Error('user cancelled');
        }),
      }),
    });

    const ok = await store.loginWithPasskey();
    expect(ok).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.error()).toBe('user cancelled');
  });

  it('flips loading on and off around the passkey call', async () => {
    let resolveAuth: (u: AuthUser) => void = () => undefined;
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        authenticate: () =>
          new Promise<AuthUser>((r) => {
            resolveAuth = r;
          }),
      }),
    });

    const promise = store.loginWithPasskey();
    expect(store.loading()).toBe(true);
    resolveAuth(user);
    await promise;
    expect(store.loading()).toBe(false);
  });

  it('uses default fallback message when error is non-string', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        authenticate: vi.fn(async () => {
          throw { code: 42 };
        }),
      }),
    });

    await store.loginWithPasskey();
    expect(store.error()).toBe('Passkey authentication failed.');
  });
});

describe('createAuthStore — startConditionalPasskey', () => {
  it('returns false when WebAuthn is unavailable', async () => {
    delete (globalThis as { PublicKeyCredential?: unknown })
      .PublicKeyCredential;
    const wa = fakeWebauthn();
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: wa,
    });

    const ok = await store.startConditionalPasskey();
    expect(ok).toBe(false);
    expect(wa.authenticateConditional).not.toHaveBeenCalled();
  });

  it('returns false when conditional mediation is unavailable', async () => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {};
    const wa = fakeWebauthn();
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: wa,
    });

    const ok = await store.startConditionalPasskey();
    expect(ok).toBe(false);
    expect(wa.authenticateConditional).not.toHaveBeenCalled();
  });

  it('logs in the user on success', async () => {
    const redirectAfterLogin = vi.fn();
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn(),
      redirectAfterLogin,
    });

    const ok = await store.startConditionalPasskey();
    expect(ok).toBe(true);
    expect(store.user()).toEqual(user);
    expect(redirectAfterLogin).toHaveBeenCalled();
  });

  it('swallows conditional errors silently', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        authenticateConditional: vi.fn(async () => {
          throw new Error('aborted');
        }),
      }),
    });

    const ok = await store.startConditionalPasskey();
    expect(ok).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('abortConditionalPasskey delegates to the webauthn client', () => {
    const wa = fakeWebauthn();
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: wa,
    });

    store.abortConditionalPasskey();
    expect(wa.abortConditional).toHaveBeenCalled();
  });
});

describe('createAuthStore — enrollPasskey', () => {
  it('runs webauthn.register without surfacing an error on success', async () => {
    const register = vi.fn(async () => undefined);
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({ register }),
    });

    await store.enrollPasskey();
    expect(register).toHaveBeenCalledOnce();
    expect(store.error()).toBeNull();
  });

  it('records the error and rethrows on failure', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        register: vi.fn(async () => {
          throw new Error('declined');
        }),
      }),
    });

    await expect(store.enrollPasskey()).rejects.toThrow('declined');
    expect(store.error()).toBe('declined');
  });
});

describe('createAuthStore — checkSession', () => {
  it('hydrates the user from /api/auth/me', async () => {
    const store = createAuthStore({
      api: makeApiClient(
        () =>
          new Response(JSON.stringify({ data: { user } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
      webauthn: fakeWebauthn(),
    });

    const result = await store.checkSession();
    expect(result).toEqual(user);
    expect(store.user()).toEqual(user);
    expect(store.sessionChecked()).toBe(true);
  });

  it('returns null and clears user when /me 401s', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response('Unauthorized', { status: 401 })),
      webauthn: fakeWebauthn(),
    });

    const result = await store.checkSession();
    expect(result).toBeNull();
    expect(store.user()).toBeNull();
    expect(store.sessionChecked()).toBe(true);
  });

  // A 5xx or a dropped connection is not an answer, and recording it as one
  // is how a signed-in user gets bounced to /login with nothing on screen: the
  // router guard reads exactly these two signals. Reproduced in a browser with
  // a single injected 500 on the post-register /me.
  it('does not record a 500 as "signed out"', async () => {
    let calls = 0;
    const store = createAuthStore({
      api: makeApiClient(() => {
        calls += 1;
        return calls === 1
          ? new Response('boom', { status: 500 })
          : new Response(JSON.stringify({ data: { user } }), {
              headers: { 'content-type': 'application/json' },
            });
      }),
      webauthn: fakeWebauthn(),
    });

    expect(await store.checkSession()).toBeNull();
    expect(store.sessionChecked()).toBe(false);

    // The next caller asks again instead of inheriting the guess.
    expect(await store.checkSession()).toEqual(user);
    expect(store.sessionChecked()).toBe(true);
    expect(calls).toBe(2);
  });

  it('does not record a network failure as "signed out"', async () => {
    const store = createAuthStore({
      api: createApiClient({
        baseUrl: 'https://api.test',
        fetch: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
      webauthn: fakeWebauthn(),
    });

    expect(await store.checkSession()).toBeNull();
    expect(store.sessionChecked()).toBe(false);
  });

  it('does not hit /me twice once sessionChecked is true', async () => {
    let calls = 0;
    const store = createAuthStore({
      api: makeApiClient(() => {
        calls++;
        return new Response(JSON.stringify({ data: { user } }), {
          headers: { 'content-type': 'application/json' },
        });
      }),
      webauthn: fakeWebauthn(),
    });

    await store.checkSession();
    await store.checkSession();
    expect(calls).toBe(1);
  });
});

describe('createAuthStore — logout', () => {
  it('POSTs /api/auth/logout, clears user, runs redirectAfterLogout', async () => {
    let logoutCalled = false;
    const redirectAfterLogout = vi.fn();
    const store = createAuthStore({
      api: makeApiClient((req) => {
        if (req.url.endsWith('/api/auth/logout')) {
          logoutCalled = true;
          return new Response(null, { status: 204 });
        }
        return new Response('not found', { status: 404 });
      }),
      webauthn: fakeWebauthn(),
      redirectAfterLogout,
    });

    store.setUser(user);
    await store.logout();

    expect(logoutCalled).toBe(true);
    expect(store.user()).toBeNull();
    expect(redirectAfterLogout).toHaveBeenCalled();
  });

  it('clears user even when logout request fails', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response('boom', { status: 500 })),
      webauthn: fakeWebauthn(),
    });

    store.setUser(user);
    await store.logout();
    expect(store.user()).toBeNull();
  });
});

describe('createAuthStore — refreshSession', () => {
  /**
   * `checkSession()`'s cache is deliberate: the router guard calls it on every
   * navigation and a round-trip each time would be worse. What was missing was
   * any way to say "that answer is stale now" — so a session created outside
   * the store (registration, OTP recovery, a sign-in in another tab) left it
   * asserting the opposite of the truth, permanently, and the guard believed
   * it.
   */
  function countingApi(responses: Array<() => Response>): {
    api: ReturnType<typeof makeApiClient>;
    calls: () => number;
  } {
    let n = 0;
    const api = makeApiClient(() => {
      const next = responses[Math.min(n, responses.length - 1)];
      n += 1;
      return next();
    });
    return { api, calls: () => n };
  }

  const unauthorized = (): Response =>
    new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });

  const authorized = (): Response =>
    new Response(JSON.stringify({ data: { user } }), {
      headers: { 'content-type': 'application/json' },
    });

  it('sees a session that appeared after checkSession() cached a miss', async () => {
    const { api } = countingApi([unauthorized, authorized]);
    const store = createAuthStore({ api, webauthn: fakeWebauthn() });

    expect(await store.checkSession()).toBeNull();
    expect(store.sessionChecked()).toBe(true);
    // The cache answers, without asking.
    expect(await store.checkSession()).toBeNull();

    expect(await store.refreshSession()).toMatchObject({ id: user.id });
    expect(store.isAuthenticated()).toBe(true);
  });

  it('asks every time it is called, unlike checkSession()', async () => {
    const { api, calls } = countingApi([authorized]);
    const store = createAuthStore({ api, webauthn: fakeWebauthn() });

    await store.checkSession();
    await store.checkSession();
    expect(calls()).toBe(1);

    await store.refreshSession();
    await store.refreshSession();
    expect(calls()).toBe(3);
  });

  it('clears the user when the session has gone away', async () => {
    const { api } = countingApi([authorized, unauthorized]);
    const store = createAuthStore({ api, webauthn: fakeWebauthn() });

    await store.refreshSession();
    expect(store.isAuthenticated()).toBe(true);

    await store.refreshSession();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.sessionChecked()).toBe(true);
  });
});

describe('createAuthStore — the prompt that never comes', () => {
  /**
   * `navigator.credentials.create()` is allowed to stay pending forever, and on
   * a device with no usable authenticator some browsers do exactly that: no
   * sheet, no rejection, nothing. Every screen that awaited it had a state it
   * could enter and never leave — /settings → Security sat on "Adding…" for as
   * long as the tab stayed open. The guard is in the store so `loading` and
   * `error` settle with it; a route racing its own timer against this promise
   * would leave the store stuck on `loading` and then write an error minutes
   * later over whatever the user had moved on to.
   */
  const never = (): Promise<never> => new Promise(() => undefined);

  it('gives up on enrolment and classifies it as no-prompt', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({ register: vi.fn(never) }),
    });

    await expect(store.enrollPasskey({ timeoutMs: 5 })).rejects.toThrow();
    expect(store.errorKind()).toBe('no-prompt');
    // The half that made it a dead end: the button read "Adding…" because
    // this never went back to false.
    expect(store.loading()).toBe(false);
  });

  it('gives up on sign-in the same way', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({ authenticate: vi.fn(never) }),
    });

    expect(await store.loginWithPasskey({ timeoutMs: 5 })).toBe(false);
    expect(store.errorKind()).toBe('no-prompt');
    expect(store.loading()).toBe(false);
  });

  it('does not time out a prompt that is simply being read slowly', async () => {
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({
        register: vi.fn(
          () => new Promise<void>((resolve) => setTimeout(resolve, 20)),
        ),
      }),
    });

    await expect(
      store.enrollPasskey({ timeoutMs: 500 }),
    ).resolves.toBeUndefined();
    expect(store.error()).toBeNull();
  });

  it('leaves conditional mediation alone, which is allowed to pend forever', async () => {
    // It waits for the user to focus the autofill field. Timing it out would
    // abort the one passkey flow that is meant to be slow.
    const authenticateConditional = vi.fn(never);
    const store = createAuthStore({
      api: makeApiClient(() => new Response(null, { status: 204 })),
      webauthn: fakeWebauthn({ authenticateConditional }),
    });

    let settled = false;
    void store.startConditionalPasskey().then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(authenticateConditional).toHaveBeenCalled();
    expect(settled).toBe(false);
  });
});
