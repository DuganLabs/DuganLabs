import { afterEach, describe, expect, it } from 'vitest';
import {
  RECOVER_MESSAGES,
  classifyRecoverError,
  renderRecoverRoute,
  type RecoverFailure,
} from './recover.js';
import { ROUTE_TABLE } from '../table.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';
import type { PlatformDeps } from '../../deps.js';

const USER = {
  id: 'user-1',
  email: 'owner@example.com',
  firstName: 'Warren',
  lastName: 'Dugan',
  role: 'owner',
  workspaceId: 'ws-1',
};

interface Mounted {
  readonly element: HTMLElement;
  readonly deps: PlatformDeps;
  readonly fake: FakeFetcher;
  dispose(): void;
}

let mounted: Mounted | null = null;

function mount(
  configure: (fake: FakeFetcher) => void = () => undefined,
): Mounted {
  const fake = createFakeFetch();
  configure(fake);
  const deps = buildTestDeps({ fetch: fake.fetch });
  const view = renderRecoverRoute(deps);
  document.body.append(view.element);
  mounted = {
    element: view.element,
    deps,
    fake,
    dispose: () => {
      view.dispose();
      view.element.remove();
    },
  };
  return mounted;
}

function q<T extends HTMLElement>(root: HTMLElement, testId: string): T {
  const node = root.querySelector<T>(`[data-testid="${testId}"]`);
  if (!node) throw new Error(`missing [data-testid="${testId}"]`);
  return node;
}

function step(root: HTMLElement, name: 'phone' | 'code'): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-bn-auth-step="${name}"]`);
  if (!node) throw new Error(`missing step ${name}`);
  return node;
}

async function submitPhone(m: Mounted, value: string): Promise<void> {
  q<HTMLInputElement>(m.element, 'recover-phone-input').value = value;
  step(m.element, 'phone').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await tick();
}

async function submitCode(m: Mounted, value: string): Promise<void> {
  q<HTMLInputElement>(m.element, 'recover-code-input').value = value;
  step(m.element, 'code').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await tick();
}

function errorText(m: Mounted): string {
  return q(m.element, 'recover-error').textContent ?? '';
}

afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

// ── The route has to be reachable without a session ──────────────────────

describe('/recover is reachable by someone who cannot sign in', () => {
  it('is registered and does not require auth', () => {
    const route = ROUTE_TABLE.find((r) => r.path === '/recover');
    expect(route).toBeDefined();
    expect(route?.meta?.requiresAuth).toBeFalsy();
    // Bare layout: the shell's nav is useless to a signed-out visitor, and
    // rendering it would imply a session they do not have.
    expect(route?.meta?.bareLayout).toBe(true);
  });
});

// ── Step 1 ───────────────────────────────────────────────────────────────

describe('asking for a code', () => {
  it('starts on the phone step with the code step hidden', () => {
    const m = mount();
    expect(step(m.element, 'phone').hidden).toBe(false);
    expect(step(m.element, 'code').hidden).toBe(true);
  });

  it('says which number to use, and which not to', () => {
    // A contractor who types their business number and gets nothing will
    // conclude the product is broken. The distinction has to be on the page.
    const m = mount();
    const copy = step(m.element, 'phone').textContent ?? '';
    expect(copy).toMatch(/personal/i);
    expect(copy).toMatch(/business/i);
  });

  it('rejects a malformed number without spending a request', async () => {
    // authRateLimit allows five requests a minute per IP across all of
    // /api/auth/*. A typo must not cost one of them.
    const m = mount();
    await submitPhone(m, '12345');

    expect(m.fake.calls).toHaveLength(0);
    expect(errorText(m)).toBe(RECOVER_MESSAGES['invalid-phone']);
    expect(step(m.element, 'code').hidden).toBe(true);
  });

  it('tells a caller with a trunk-prefixed number to add the country code, not an area code (GP-056)', async () => {
    // "020 7946 0958" already carries its area code. toE164 refuses it
    // because the leading 0 is a trunk prefix for a country it cannot know;
    // the only advice that is true and actionable is "add the country code".
    const m = mount();
    await submitPhone(m, '020 7946 0958');

    expect(m.fake.calls).toHaveLength(0);
    const text = errorText(m);
    expect(text).toBe(RECOVER_MESSAGES['invalid-phone']);
    expect(text).not.toContain('area code');
    expect(text).toContain('country code');
    expect(text).toContain('+');
    // One NANP example and one non-NANP one, so the sentence is true for
    // whoever is reading it.
    expect(text).toContain('+1 949 555 0199');
    expect(text).toContain('+44 20 7946 0958');
  });

  it('normalises the number to E.164 before sending it', async () => {
    const m = mount((fake) =>
      fake.respond('/api/auth/otp/send', () =>
        jsonResponse({ data: { sent: true } }),
      ),
    );
    await submitPhone(m, '(949) 555-0199');

    const call = m.fake.calls.find((c) => c.url.endsWith('/api/auth/otp/send'));
    expect(call?.body).toEqual({ phone: '+19495550199' });
  });

  it('advances to the code step', async () => {
    const m = mount((fake) =>
      fake.respond('/api/auth/otp/send', () =>
        jsonResponse({ data: { sent: true } }),
      ),
    );
    await submitPhone(m, '9495550199');

    expect(step(m.element, 'phone').hidden).toBe(true);
    expect(step(m.element, 'code').hidden).toBe(false);
  });

  it('does not claim a code was sent', async () => {
    // The API answers identically whether or not the number is on an
    // account, so that it cannot be used to test who has one. Saying "code
    // sent" would throw that property away at the last step.
    const m = mount((fake) =>
      fake.respond('/api/auth/otp/send', () =>
        jsonResponse({ data: { sent: true } }),
      ),
    );
    await submitPhone(m, '9495550199');

    const notice = q(m.element, 'recover-sent-notice').textContent ?? '';
    expect(notice).toMatch(/if that number/i);
  });

  it('resends to the same number without retyping it', async () => {
    const m = mount((fake) =>
      fake.respond('/api/auth/otp/send', () =>
        jsonResponse({ data: { sent: true } }),
      ),
    );
    await submitPhone(m, '(949) 555-0199');
    q<HTMLButtonElement>(m.element, 'recover-resend').click();
    await tick();

    const sends = m.fake.calls.filter((c) =>
      c.url.endsWith('/api/auth/otp/send'),
    );
    expect(sends).toHaveLength(2);
    expect(sends[1]?.body).toEqual({ phone: '+19495550199' });
  });

  it('goes back to the phone step on "use a different number"', async () => {
    const m = mount((fake) =>
      fake.respond('/api/auth/otp/send', () =>
        jsonResponse({ data: { sent: true } }),
      ),
    );
    await submitPhone(m, '9495550199');
    q<HTMLButtonElement>(m.element, 'recover-start-over').click();
    await tick();

    expect(step(m.element, 'phone').hidden).toBe(false);
    expect(step(m.element, 'code').hidden).toBe(true);
  });
});

// ── Step 2 ───────────────────────────────────────────────────────────────

describe('exchanging the code for a session', () => {
  async function reachCodeStep(configure: (f: FakeFetcher) => void) {
    const m = mount((fake) => {
      fake.respond('/api/auth/otp/send', () =>
        jsonResponse({ data: { sent: true } }),
      );
      configure(fake);
    });
    await submitPhone(m, '9495550199');
    return m;
  }

  it('posts the normalised number alongside the code', async () => {
    const m = await reachCodeStep((fake) =>
      fake.respond('/api/auth/otp/verify', () =>
        jsonResponse({ data: { user: USER } }),
      ),
    );
    await submitCode(m, '123456');

    const call = m.fake.calls.find((c) =>
      c.url.endsWith('/api/auth/otp/verify'),
    );
    expect(call?.body).toEqual({ phone: '+19495550199', code: '123456' });
  });

  it('hydrates the auth store from the response, workspaceId included', async () => {
    // If the store were left empty the route guard would bounce the user
    // straight back to /login — which is precisely the dead end this screen
    // exists to end.
    const m = await reachCodeStep((fake) =>
      fake.respond('/api/auth/otp/verify', () =>
        jsonResponse({ data: { user: USER } }),
      ),
    );
    await submitCode(m, '123456');

    expect(m.deps.auth.isAuthenticated()).toBe(true);
    expect(m.deps.auth.user()?.workspaceId).toBe('ws-1');
  });

  it('leaves the browser on /dashboard, not /login', async () => {
    const m = await reachCodeStep((fake) =>
      fake.respond('/api/auth/otp/verify', () =>
        jsonResponse({ data: { user: USER } }),
      ),
    );
    await submitCode(m, '123456');
    await tick();

    expect(m.deps.router.pathname()).toBe('/dashboard');
  });

  it('refuses a short code locally rather than spending a request', async () => {
    const m = await reachCodeStep(() => undefined);
    const before = m.fake.calls.length;
    await submitCode(m, '123');

    expect(m.fake.calls).toHaveLength(before);
    expect(errorText(m)).toBe(RECOVER_MESSAGES['bad-code']);
  });

  it('stays on the code step after a wrong code', async () => {
    const m = await reachCodeStep((fake) =>
      fake.respond('/api/auth/otp/verify', () =>
        jsonResponse(
          { error: { code: 'INVALID_OTP', message: 'Invalid' } },
          { status: 401 },
        ),
      ),
    );
    await submitCode(m, '000000');

    expect(step(m.element, 'code').hidden).toBe(false);
    expect(m.deps.auth.isAuthenticated()).toBe(false);
    expect(errorText(m)).toBe(RECOVER_MESSAGES['bad-code']);
  });

  it('says the code was cancelled after too many wrong guesses', async () => {
    const m = await reachCodeStep((fake) =>
      fake.respond('/api/auth/otp/verify', () =>
        jsonResponse(
          { error: { code: 'OTP_LOCKED', message: 'Too many' } },
          { status: 429 },
        ),
      ),
    );
    await submitCode(m, '000000');

    expect(errorText(m)).toBe(RECOVER_MESSAGES['locked']);
    expect(errorText(m)).not.toBe(RECOVER_MESSAGES['rate-limited']);
  });
});

// ── Saying something true about each failure ─────────────────────────────

describe('classifyRecoverError', () => {
  /** The shape `@basenative/fetch` throws — name + status + code. */
  function api(status: number, code?: string) {
    return { name: 'ApiError', message: 'boom', status, code };
  }

  const cases: Array<[string, ReturnType<typeof api>, RecoverFailure]> = [
    ['the IP rate limiter', api(429, 'RATE_LIMITED'), 'rate-limited'],
    ['the per-code lockout', api(429, 'OTP_LOCKED'), 'locked'],
    ['no response at all', api(0, 'network_error'), 'offline'],
    ['a malformed number', api(400, 'INVALID_PHONE'), 'invalid-phone'],
    ['a wrong code', api(401, 'INVALID_OTP'), 'bad-code'],
    ['no such account', api(401, 'NO_RECOVERY_ACCOUNT'), 'no-account'],
    ['our own fault', api(503), 'server'],
  ];

  it.each(cases)('recognises %s', (_label, err, expected) => {
    expect(classifyRecoverError(err)).toBe(expected);
  });

  it('ignores an error that only looks like one', () => {
    // The guard is structural, so say out loud what it will not accept.
    expect(classifyRecoverError({ status: 429 })).toBe('unknown');
    expect(classifyRecoverError({ name: 'ApiError' })).toBe('unknown');
  });

  it('tells the two 429s apart — they need different advice', () => {
    // "wait a minute" versus "request a new code" are not interchangeable.
    expect(classifyRecoverError(api(429, 'RATE_LIMITED'))).not.toBe(
      classifyRecoverError(api(429, 'OTP_LOCKED')),
    );
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyRecoverError(new Error('???'))).toBe('unknown');
    expect(classifyRecoverError(null)).toBe('unknown');
  });

  it('has a distinct, non-empty sentence for every failure', () => {
    const messages = Object.values(RECOVER_MESSAGES);
    expect(new Set(messages).size).toBe(messages.length);
    for (const message of messages) {
      expect(message.trim().length).toBeGreaterThan(20);
    }
  });

  it('only blames the connection when the connection is the problem', () => {
    const blamesConnection = Object.entries(RECOVER_MESSAGES)
      .filter(([, text]) => /connection/i.test(text))
      .map(([kind]) => kind);
    expect(blamesConnection).toEqual(['offline']);
  });
});
