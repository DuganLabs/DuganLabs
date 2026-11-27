/**
 * Tests for the composition root — specifically for the router guard, which
 * had never been driven by a test and is where the "Go to dashboard lands on
 * /login" bug actually fired.
 *
 * The guard reads two signals and nothing else:
 *
 *     if (!auth.sessionChecked()) await auth.checkSession();
 *     if (!auth.isAuthenticated()) return { redirect: LOGIN_ROUTE };
 *
 * which is correct right up until something creates a session without telling
 * the store. Then `sessionChecked` is true, `user` is null, and no amount of
 * valid `gp_session` cookie will change either one — `checkSession()` short-
 * circuits on the cache it filled itself. These tests pin both halves: that
 * the guard still refuses a genuinely absent session, and that a session
 * arriving out of band is something the store can now be told about.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createDeps } from './deps.js';
import { createFakeFetch } from './test/helpers.js';

interface MeControl {
  status: number;
}

/**
 * A `/api/auth/me` stub whose answer can change between calls — the thing a
 * single `respond()` registration cannot express, and exactly the situation
 * under test: the first call 401s, then the user registers, then it 200s.
 */
function fakeWithMe(control: MeControl): ReturnType<typeof createFakeFetch> {
  const fake = createFakeFetch();
  fake.respond('/api/auth/me', () =>
    control.status === 200
      ? new Response(
          JSON.stringify({
            data: {
              user: {
                id: 'u1',
                email: 'alex@reed.com',
                firstName: 'Alex',
                lastName: 'Reed',
                role: 'owner',
                workspaceId: 'ws-1',
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      : new Response(
          JSON.stringify({
            error: { code: 'UNAUTHORIZED', message: 'No session' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
  );
  return fake;
}

describe('createDeps — the auth guard', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('redirects a guarded route to /login when there is no session', async () => {
    const control: MeControl = { status: 401 };
    const deps = createDeps({ fetch: fakeWithMe(control).fetch, baseUrl: '' });

    await deps.router.navigate('/dashboard');

    expect(deps.router.currentRoute().name).toBe('login');
  });

  it('does not re-ask /api/auth/me once the session has been checked', async () => {
    const control: MeControl = { status: 401 };
    const fake = fakeWithMe(control);
    const deps = createDeps({ fetch: fake.fetch, baseUrl: '' });

    await deps.router.navigate('/dashboard');
    await deps.router.navigate('/leads');

    // The cache is deliberate — a round-trip per navigation would be worse.
    // It is only wrong when nothing can invalidate it, which is the next test.
    const meCalls = fake.calls.filter((c) => c.url.includes('/api/auth/me'));
    expect(meCalls).toHaveLength(1);
  });

  it('lets a guarded route through after refreshSession() finds a session the store had not seen', async () => {
    const control: MeControl = { status: 401 };
    const deps = createDeps({ fetch: fakeWithMe(control).fetch, baseUrl: '' });

    // Boot-time check, as main.ts does it: no cookie yet, so this 401s and
    // caches the miss.
    await deps.auth.checkSession();
    expect(deps.auth.sessionChecked()).toBe(true);
    expect(deps.auth.isAuthenticated()).toBe(false);

    // Something outside the store creates a session — /api/auth/register in
    // the real flow. `checkSession()` cannot see it: it returns the cache.
    control.status = 200;
    await deps.auth.checkSession();
    expect(deps.auth.isAuthenticated()).toBe(false);

    // `refreshSession()` is the invalidation path that did not exist.
    await deps.auth.refreshSession();
    expect(deps.auth.isAuthenticated()).toBe(true);

    await deps.router.navigate('/dashboard');
    expect(deps.router.currentRoute().name).toBe('dashboard');
  });

  it('carries workspaceId onto the user, which the register response omits', async () => {
    const control: MeControl = { status: 200 };
    const deps = createDeps({ fetch: fakeWithMe(control).fetch, baseUrl: '' });

    const user = await deps.auth.refreshSession();

    expect(user).toMatchObject({ id: 'u1', workspaceId: 'ws-1' });
  });
});
