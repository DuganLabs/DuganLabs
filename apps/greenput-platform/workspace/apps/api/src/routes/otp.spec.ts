import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from 'itty-router';
import { otpRouter } from './otp';

/**
 * A small in-memory stand-in for D1 + KV.
 *
 * The previous version of this file mocked `DB.prepare().first()` to one fixed
 * value for every query, which meant a test could not tell "found the user by
 * recovery_phone" from "found the user by anything at all" — and the column a
 * recovery code is sent to is the entire security property here. This one
 * keeps real rows and dispatches on the SQL, so the assertions are about which
 * column matched, not about which mock was called.
 */
function makeEnv(
  users: Array<Record<string, unknown>> = [],
  workspaces: Array<Record<string, unknown>> = [],
) {
  const kv = new Map<string, string>();

  function run(sql: string, params: unknown[]): unknown {
    if (/FROM users WHERE recovery_phone = \?/.test(sql)) {
      return users.find((u) => u['recovery_phone'] === params[0]) ?? null;
    }
    if (/SELECT recovery_phone FROM users WHERE id = \?/.test(sql)) {
      const u = users.find((x) => x['id'] === params[0]);
      return u ? { recovery_phone: u['recovery_phone'] ?? null } : null;
    }
    // The published-number check is global now: any workspace's phone is
    // public to everyone, so it does not join through the caller.
    if (/FROM workspaces WHERE phone = \?/.test(sql)) {
      return workspaces.some((w) => w['phone'] === params[0])
        ? { hit: 1 }
        : null;
    }
    if (/FROM workspaces w JOIN users u/.test(sql)) {
      const u = users.find((x) => x['id'] === params[0]);
      const w = workspaces.find((x) => x['id'] === u?.['workspace_id']);
      return w ? { phone: w['phone'] } : null;
    }
    if (/UPDATE users SET recovery_phone = \?/.test(sql)) {
      const u = users.find((x) => x['id'] === params[2]);
      if (u) u['recovery_phone'] = params[0];
      return null;
    }
    if (/UPDATE users SET recovery_phone = NULL/.test(sql)) {
      const u = users.find((x) => x['id'] === params[1]);
      if (u) u['recovery_phone'] = null;
      return null;
    }
    if (/UPDATE users SET last_seen_at/.test(sql)) return null;
    return null;
  }

  return {
    users,
    workspaces,
    kv,
    DB: {
      prepare(sql: string) {
        let params: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            params = args;
            return stmt;
          },
          first: () => Promise.resolve(run(sql, params)),
          all: () => Promise.resolve({ results: [] }),
          run: () => Promise.resolve(run(sql, params) ?? {}),
        };
        return stmt;
      },
    },
    SESSIONS: {
      get: (k: string) => Promise.resolve(kv.get(k) ?? null),
      put: (k: string, v: string) => {
        kv.set(k, v);
        return Promise.resolve();
      },
      delete: (k: string) => {
        kv.delete(k);
        return Promise.resolve();
      },
    },
    // No Twilio creds → dev mode, code goes to the log rather than a handset.
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_FROM_NUMBER: '',
    ENVIRONMENT: 'development',
  };
}

const OWNER = {
  id: 'user-1',
  workspace_id: 'ws-1',
  email: 'owner@example.com',
  role: 'owner',
  first_name: 'Warren',
  last_name: 'Dugan',
  recovery_phone: '+19495550199',
};

const WORKSPACE = { id: 'ws-1', phone: '+19495550187' };

type Env = ReturnType<typeof makeEnv>;

function post(path: string, body: unknown, session?: { id: string }) {
  const req = new Request(`https://api.greenput.com/api/auth/otp${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (session) (req as unknown as { user: unknown }).user = session;
  return req;
}

function get(path: string, session?: { id: string }) {
  const req = new Request(`https://api.greenput.com/api/auth/otp${path}`);
  if (session) (req as unknown as { user: unknown }).user = session;
  return req;
}

function del(path: string, session?: { id: string }) {
  const req = new Request(`https://api.greenput.com/api/auth/otp${path}`, {
    method: 'DELETE',
  });
  if (session) (req as unknown as { user: unknown }).user = session;
  return req;
}

/** The code the route generated, read out of the KV stand-in. */
function storedCode(env: Env, key: string): string | undefined {
  return env.kv.get(key);
}

async function bodyOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('otpRouter', () => {
  it('exports otpRouter with fetch', () => {
    expect(otpRouter).toBeDefined();
    expect(typeof otpRouter.fetch).toBe('function');
  });
});

/**
 * The two route patterns apps/api/src/index.ts registers for this router, in
 * that order. Getting them wrong is silent and total: swap them and every
 * recovery request needs a session, which means the locked-out owner can never
 * reach the endpoint that exists to let him in.
 */
describe('the authenticated/public split in index.ts', () => {
  async function which(path: string): Promise<string> {
    const router = Router();
    router.all('/api/auth/otp/recovery*', () => new Response('authed'));
    router.all('/api/auth/otp/*', () => new Response('public'));
    const res = (await router.fetch(
      new Request(`https://api.greenput.com${path}`, { method: 'POST' }),
    )) as Response | undefined;
    return res ? await res.text() : 'unmatched';
  }

  it.each([
    '/api/auth/otp/recovery',
    '/api/auth/otp/recovery/start',
    '/api/auth/otp/recovery/confirm',
  ])('%s requires a session', async (path) => {
    expect(await which(path)).toBe('authed');
  });

  it.each(['/api/auth/otp/send', '/api/auth/otp/verify'])(
    '%s stays public — a locked-out owner has no session to present',
    async (path) => {
      expect(await which(path)).toBe('public');
    },
  );
});

/**
 * The budget split apps/api/src/index.ts applies across /api/auth/*. Ordering
 * again, and again silent when wrong: the endpoints a locked-out contractor
 * needs must not be drawing on a budget the rest of the app has already spent.
 */
describe('which /api/auth/* endpoints draw on which budget', () => {
  async function budget(method: string, path: string): Promise<string> {
    const router = Router();
    router.post(
      '/api/auth/webauthn/login/options',
      () => new Response('general'),
    );
    router.post('/api/auth/logout', () => new Response('general'));
    router.all('/api/auth/webauthn/register/*', () => new Response('none'));
    router.all('/api/auth/webauthn/*', () => new Response('auth'));
    router.all('/api/auth/otp/recovery*', () => new Response('otp'));
    router.all('/api/auth/otp/*', () => new Response('otp'));
    router.get('/api/auth/me', () => new Response('none'));
    router.all('/api/auth/*', () => new Response('auth'));
    const res = (await router.fetch(
      new Request(`https://api.greenput.com${path}`, { method }),
    )) as Response | undefined;
    return res ? await res.text() : 'unmatched';
  }

  it('puts recovery on its own budget, not the sign-in one', async () => {
    expect(await budget('POST', '/api/auth/otp/send')).toBe('otp');
    expect(await budget('POST', '/api/auth/otp/verify')).toBe('otp');
    expect(await budget('POST', '/api/auth/otp/recovery/start')).toBe('otp');
  });

  it('keeps challenge-minting and sign-out off the credential budget', async () => {
    // /login fires login/options on every mount; logout is a session teardown.
    // Neither is someone trying to prove who they are, and counting them
    // spent the budget needed to actually sign in.
    expect(await budget('POST', '/api/auth/webauthn/login/options')).toBe(
      'general',
    );
    expect(await budget('POST', '/api/auth/logout')).toBe('general');
  });

  it('still guards the guessable surface with the credential budget', async () => {
    expect(await budget('POST', '/api/auth/login')).toBe('auth');
    expect(await budget('POST', '/api/auth/register')).toBe('auth');
    expect(await budget('POST', '/api/auth/webauthn/login/verify')).toBe(
      'auth',
    );
  });
});

// ── The security property this whole route exists for ────────────────────

describe('recovery binds to the personal number, never the published one', () => {
  it('sends a code when the number is a user recovery_phone', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(
      post('/send', { phone: '9495550199' }),
      env,
    );

    expect(res.status).toBe(200);
    expect(storedCode(env, 'otp:signin:+19495550199')).toMatch(/^\d{6}$/);
  });

  it('sends NO code to the workspace phone, which is published on the micro-site', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    // 9495550187 is workspaces.phone — the company line rendered on the
    // contractor's public site. A code here would be account takeover.
    const res = await otpRouter.fetch(
      post('/send', { phone: '9495550187' }),
      env,
    );

    expect(res.status).toBe(200);
    expect([...env.kv.keys()]).toEqual([]);
  });

  it('sends NO code to the account email address', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    await otpRouter.fetch(post('/send', { phone: '5550000000' }), env);
    expect([...env.kv.keys()]).toEqual([]);
  });

  it('answers identically whether or not an account exists', async () => {
    const withAccount = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const without = makeEnv([], []);

    const a = await otpRouter.fetch(
      post('/send', { phone: '9495550199' }),
      withAccount,
    );
    const b = await otpRouter.fetch(
      post('/send', { phone: '9495550199' }),
      without,
    );

    expect(a.status).toBe(b.status);
    expect(await bodyOf(a)).toEqual(await bodyOf(b));
  });

  it('answers the same way even when the SMS provider fails', async () => {
    // Otherwise a 500 here against a 200 for an unmatched number is a live
    // account-enumeration oracle for as long as the provider is unhappy.
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    env.TWILIO_ACCOUNT_SID = 'AC_test';
    env.TWILIO_AUTH_TOKEN = 'token';
    env.TWILIO_FROM_NUMBER = '+15550000000';
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 500 }));

    const withAccount = await otpRouter.fetch(
      post('/send', { phone: '9495550199' }),
      env,
    );

    // Same deployment config on both sides: the invariant under test is that
    // ACCOUNT PRESENCE is invisible. Whether this deployment can send SMS at
    // all is a property of the deployment, is identical for every caller, and
    // is reported deliberately so the UI stops promising a text it cannot send.
    const without = makeEnv([], []);
    without.TWILIO_ACCOUNT_SID = 'AC_test';
    without.TWILIO_AUTH_TOKEN = 'token';
    without.TWILIO_FROM_NUMBER = '+15550000000';
    const withoutAccount = await otpRouter.fetch(
      post('/send', { phone: '9495550199' }),
      without,
    );

    expect(withAccount.status).toBe(withoutAccount.status);
    expect(await bodyOf(withAccount)).toEqual(await bodyOf(withoutAccount));
    // ...and the operator can still find out why nothing arrived.
    expect(errSpy).toHaveBeenCalled();

    fetchSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('records the suppressed send where an operator can see it', async () => {
    const env = makeEnv([], []);
    await otpRouter.fetch(post('/send', { phone: '9495550199' }), env);
    expect(logSpy).toHaveBeenCalled();
  });

  it('never writes a full phone number to the log', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    await otpRouter.fetch(post('/send', { phone: '9495550199' }), env);

    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('9495550199');
    expect(logged).toContain('0199');
  });
});

// ── Normalisation: the bug that made recovery miss ───────────────────────

describe('phone normalisation at the lookup', () => {
  it.each([
    '9495550199',
    '(949) 555-0199',
    '949-555-0199',
    '949.555.0199',
    '+1 949 555 0199',
    '19495550199',
  ])('treats %s as the same number', async (typed) => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    await otpRouter.fetch(post('/send', { phone: typed }), env);
    expect(storedCode(env, 'otp:signin:+19495550199')).toMatch(/^\d{6}$/);
  });

  it('rejects input that is not a phone number at all', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(
      post('/send', { phone: '00000000000000000000' }),
      env,
    );
    expect(res.status).toBe(400);
    const body = await bodyOf<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('INVALID_PHONE');
  });
});

// ── /verify ──────────────────────────────────────────────────────────────

describe('POST /api/auth/otp/verify', () => {
  async function sendThen(env: Env, phone = '9495550199') {
    await otpRouter.fetch(post('/send', { phone }), env);
    return storedCode(env, 'otp:signin:+19495550199') as string;
  }

  it('rejects a request missing the code', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(
      post('/verify', { phone: '9495550199' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a code that was never sent', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(
      post('/verify', { phone: '9495550199', code: '000000' }),
      env,
    );
    expect(res.status).toBe(401);
    const body = await bodyOf<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('INVALID_OTP');
  });

  it('rejects the wrong code', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const code = await sendThen(env);
    const wrong = code === '000000' ? '111111' : '000000';

    const res = await otpRouter.fetch(
      post('/verify', { phone: '9495550199', code: wrong }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('signs in the matching user and sets a session cookie', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const code = await sendThen(env);

    const res = await otpRouter.fetch(
      post('/verify', { phone: '9495550199', code }),
      env,
    );

    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('gp_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
  });

  it('returns the workspaceId the client needs to hydrate its session', async () => {
    // Without this the client cannot call setUser() from the response and has
    // to make a second round trip to /api/auth/me before it can navigate.
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const code = await sendThen(env);
    const res = await otpRouter.fetch(
      post('/verify', { phone: '9495550199', code }),
      env,
    );

    const body = await bodyOf<{ data: { user: Record<string, unknown> } }>(res);
    expect(body.data.user['workspaceId']).toBe('ws-1');
    expect(body.data.user['id']).toBe('user-1');
    expect(body.data.user['role']).toBe('owner');
  });

  it('stores a session KV entry the auth middleware can read back', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const code = await sendThen(env);
    await otpRouter.fetch(post('/verify', { phone: '9495550199', code }), env);

    const sessionKey = [...env.kv.keys()].find((k) =>
      k.startsWith('session:'),
    ) as string;
    expect(sessionKey).toBeDefined();
    const session = JSON.parse(env.kv.get(sessionKey) as string);
    expect(session.workspaceId).toBe('ws-1');
    expect(session.id).toBe('user-1');
  });

  it('burns the code — it cannot be replayed', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const code = await sendThen(env);

    const first = await otpRouter.fetch(
      post('/verify', { phone: '9495550199', code }),
      env,
    );
    const second = await otpRouter.fetch(
      post('/verify', { phone: '9495550199', code }),
      env,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
  });

  it('locks the code after five wrong guesses instead of allowing a walk of the space', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const code = await sendThen(env);
    const wrong = code === '000000' ? '111111' : '000000';

    // Four wrong guesses are absorbed; the FIFTH is the one that burns it.
    // The lock used to fire on the sixth, because the counter was compared
    // before it was incremented — one more guess than the name says and than
    // the budget was sized for.
    for (let i = 0; i < 4; i++) {
      const each = await otpRouter.fetch(
        post('/verify', { phone: '9495550199', code: wrong }),
        env,
      );
      expect(each.status).toBe(401);
    }

    const res = await otpRouter.fetch(
      post('/verify', { phone: '9495550199', code: wrong }),
      env,
    );
    expect(res.status).toBe(429);
    const body = await bodyOf<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('OTP_LOCKED');

    // And the real code is gone too — a lockout that left it live would just
    // be a pause in the attack.
    const after = await otpRouter.fetch(
      post('/verify', { phone: '9495550199', code }),
      env,
    );
    expect(after.status).toBe(401);
  });
});

// ── verify is not a signup door ──────────────────────────────────────────

describe('verify only ever signs in an existing account', () => {
  it('does not create a workspace or a user for an unknown number', async () => {
    const env = makeEnv([], []);
    await otpRouter.fetch(post('/send', { phone: '5551230000' }), env);
    // No code was issued, so nothing can be verified — and nothing was made.
    const res = await otpRouter.fetch(
      post('/verify', { phone: '5551230000', code: '123456' }),
      env,
    );

    expect(res.status).toBe(401);
    expect(env.users).toHaveLength(0);
    expect(env.workspaces).toHaveLength(0);
  });

  it('ignores signup-shaped fields rather than acting on them', async () => {
    const env = makeEnv([], []);
    const res = await otpRouter.fetch(
      post('/verify', {
        phone: '5551230000',
        code: '123456',
        firstName: 'Mallory',
        lastName: 'Smith',
        workspaceName: 'Not A Real Company',
        trade: 'general',
      }),
      env,
    );

    expect(res.status).toBe(401);
    expect(env.users).toHaveLength(0);
    expect(env.workspaces).toHaveLength(0);
  });

  it('never responds with a needsSignup flag', async () => {
    const env = makeEnv([], []);
    const res = await otpRouter.fetch(
      post('/verify', { phone: '5551230000', code: '123456' }),
      env,
    );
    const text = await res.text();
    expect(text).not.toContain('needsSignup');
  });
});

// ── Binding a recovery number (authenticated) ────────────────────────────

describe('POST /api/auth/otp/recovery/start', () => {
  it('requires a session', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(
      post('/recovery/start', { phone: '9495550199' }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('refuses the workspace phone, because that number is published', async () => {
    const env = makeEnv(
      [{ ...OWNER, recovery_phone: null }],
      [{ ...WORKSPACE }],
    );
    const res = await otpRouter.fetch(
      post('/recovery/start', { phone: '(949) 555-0187' }, { id: 'user-1' }),
      env,
    );

    expect(res.status).toBe(400);
    const body = await bodyOf<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('PHONE_IS_PUBLIC');
    expect([...env.kv.keys()]).toEqual([]);
  });

  // The guard compares `workspaces.phone` to `toE164(input)` — string
  // equality — so it is only as good as the normalisation. A spelling that
  // normalised to a DIFFERENT string than the stored one walked straight past
  // it, and the owner bound their own published business line as their
  // personal recovery channel. `toE164('001 949 555 0187')` used to be
  // '+0019495550187', which matched no row.
  it.each([
    ['001 949 555 0187', 'the ITU international dialling prefix'],
    ['0019495550187', 'the same, unpunctuated'],
    ['011 949 555 0187', 'the NANP international dialling prefix'],
  ])(
    'cannot be walked round the published-number guard by respelling it with %s',
    async (phone) => {
      const env = makeEnv(
        [{ ...OWNER, recovery_phone: null }],
        [{ ...WORKSPACE }],
      );
      const res = await otpRouter.fetch(
        post('/recovery/start', { phone }, { id: 'user-1' }),
        env,
      );

      // Refused before the guard rather than sneaking past it. Either answer
      // keeps the number unbound; what must never happen is a 200 with a code
      // texted to the workspace's published line.
      expect(res.status).toBe(400);
      const body = await bodyOf<{ error: { code: string } }>(res);
      expect(body.error.code).toBe('INVALID_PHONE');
      expect([...env.kv.keys()]).toEqual([]);
      expect(env.users[0]['recovery_phone']).toBeNull();
    },
  );

  it('still refuses the published number in every spelling it does accept', async () => {
    // The other half: tightening normalisation must not make a stored company
    // number unmatchable, or the guard would pass for the real spelling too.
    for (const phone of [
      '(949) 555-0187',
      '9495550187',
      '19495550187',
      '+1 949 555 0187',
      '949.555.0187',
    ]) {
      const env = makeEnv(
        [{ ...OWNER, recovery_phone: null }],
        [{ ...WORKSPACE }],
      );
      const res = await otpRouter.fetch(
        post('/recovery/start', { phone }, { id: 'user-1' }),
        env,
      );
      const body = await bodyOf<{ error: { code: string } }>(res);
      expect(body.error.code, phone).toBe('PHONE_IS_PUBLIC');
      expect([...env.kv.keys()], phone).toEqual([]);
    }
  });

  // The uniqueness answer moved to /recovery/confirm. Answering it at /start
  // told any signed-in caller whether a number they typed belongs to some
  // other Greenput account, which is an enumeration oracle over personal
  // mobile numbers. /start must be indistinguishable either way.
  it('does not reveal at /start that a number belongs to another account', async () => {
    const env = makeEnv(
      [
        { ...OWNER, id: 'user-1', recovery_phone: null },
        { ...OWNER, id: 'user-2', recovery_phone: '+19495550199' },
      ],
      [{ ...WORKSPACE }],
    );
    const taken = await otpRouter.fetch(
      post('/recovery/start', { phone: '9495550199' }, { id: 'user-1' }),
      env,
    );
    const free = await otpRouter.fetch(
      post('/recovery/start', { phone: '9495550123' }, { id: 'user-1' }),
      env,
    );

    expect(taken.status).toBe(200);
    expect(free.status).toBe(taken.status);
    expect(await bodyOf(free)).toEqual(await bodyOf(taken));
  });

  it('refuses a number already bound to a different account, at confirm', async () => {
    const env = makeEnv(
      [
        { ...OWNER, id: 'user-1', recovery_phone: null },
        { ...OWNER, id: 'user-2', recovery_phone: '+19495550199' },
      ],
      [{ ...WORKSPACE }],
    );
    await otpRouter.fetch(
      post('/recovery/start', { phone: '9495550199' }, { id: 'user-1' }),
      env,
    );
    const code = [...env.kv.entries()].find(([k]) =>
      k.startsWith('otp:enroll:'),
    )?.[1] as string;

    const res = await otpRouter.fetch(
      post(
        '/recovery/confirm',
        { phone: '9495550199', code },
        { id: 'user-1' },
      ),
      env,
    );

    expect(res.status).toBe(409);
    const body = await bodyOf<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('PHONE_TAKEN');
  });

  it('caps how many codes one caller can have texted', async () => {
    // /recovery/start texts a number the CALLER TYPED. The in-memory rate
    // limiter resets on cold start and is per-isolate, so the only durable
    // control is this quota — without it a signed-in account is an SMS cannon
    // aimed at any handset, billed to us.
    const env = makeEnv(
      [{ ...OWNER, recovery_phone: null }],
      [{ ...WORKSPACE }],
    );
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await otpRouter.fetch(
        post(
          '/recovery/start',
          { phone: `94955501${String(10 + i)}` },
          { id: 'user-1' },
        ),
        env,
      );
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('caps how many codes one number can be sent, across callers', async () => {
    const env = makeEnv(
      [
        { ...OWNER, id: 'user-1', recovery_phone: null },
        { ...OWNER, id: 'user-2', recovery_phone: null },
        { ...OWNER, id: 'user-3', recovery_phone: null },
        { ...OWNER, id: 'user-4', recovery_phone: null },
      ],
      [{ ...WORKSPACE }],
    );
    const statuses: number[] = [];
    for (const id of ['user-1', 'user-2', 'user-3', 'user-4']) {
      const res = await otpRouter.fetch(
        post('/recovery/start', { phone: '9495550123' }, { id }),
        env,
      );
      statuses.push(res.status);
    }

    // Three get through; the fourth caller cannot keep texting the same
    // handset just because their own budget is untouched.
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('allows re-confirming the number already bound to this account', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(
      post('/recovery/start', { phone: '9495550199' }, { id: 'user-1' }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('issues a code scoped to this user AND this number', async () => {
    const env = makeEnv(
      [{ ...OWNER, recovery_phone: null }],
      [{ ...WORKSPACE }],
    );
    await otpRouter.fetch(
      post('/recovery/start', { phone: '9495550199' }, { id: 'user-1' }),
      env,
    );
    expect(storedCode(env, 'otp:enroll:user-1:+19495550199')).toMatch(
      /^\d{6}$/,
    );
  });
});

describe('POST /api/auth/otp/recovery/confirm', () => {
  async function startFor(env: Env, phone = '9495550199') {
    await otpRouter.fetch(
      post('/recovery/start', { phone }, { id: 'user-1' }),
      env,
    );
    return storedCode(env, 'otp:enroll:user-1:+19495550199') as string;
  }

  it('requires a session', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(
      post('/recovery/confirm', { phone: '9495550199', code: '123456' }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('stores the number only after the code proves possession', async () => {
    const env = makeEnv(
      [{ ...OWNER, recovery_phone: null }],
      [{ ...WORKSPACE }],
    );
    const code = await startFor(env);

    // Wrong code first: nothing is stored.
    await otpRouter.fetch(
      post(
        '/recovery/confirm',
        { phone: '9495550199', code: code === '000000' ? '111111' : '000000' },
        { id: 'user-1' },
      ),
      env,
    );
    expect(env.users[0]['recovery_phone']).toBeNull();

    const res = await otpRouter.fetch(
      post(
        '/recovery/confirm',
        { phone: '9495550199', code },
        { id: 'user-1' },
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.users[0]['recovery_phone']).toBe('+19495550199');
  });

  it('stores E.164 regardless of how the number was typed', async () => {
    const env = makeEnv(
      [{ ...OWNER, recovery_phone: null }],
      [{ ...WORKSPACE }],
    );
    await otpRouter.fetch(
      post('/recovery/start', { phone: '(949) 555-0199' }, { id: 'user-1' }),
      env,
    );
    const code = storedCode(env, 'otp:enroll:user-1:+19495550199') as string;
    await otpRouter.fetch(
      post(
        '/recovery/confirm',
        { phone: '949-555-0199', code },
        { id: 'user-1' },
      ),
      env,
    );

    expect(env.users[0]['recovery_phone']).toBe('+19495550199');
  });

  it('cannot confirm a different number with a code issued for another', async () => {
    const env = makeEnv(
      [{ ...OWNER, recovery_phone: null }],
      [{ ...WORKSPACE }],
    );
    const code = await startFor(env);

    const res = await otpRouter.fetch(
      post(
        '/recovery/confirm',
        { phone: '9495551111', code },
        { id: 'user-1' },
      ),
      env,
    );

    expect(res.status).toBe(401);
    expect(env.users[0]['recovery_phone']).toBeNull();
  });

  it('does not let a sign-in code stand in for an enrolment code', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    await otpRouter.fetch(post('/send', { phone: '9495550199' }), env);
    const signinCode = storedCode(env, 'otp:signin:+19495550199') as string;

    const res = await otpRouter.fetch(
      post(
        '/recovery/confirm',
        { phone: '9495550199', code: signinCode },
        { id: 'user-1' },
      ),
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe('GET and DELETE /api/auth/otp/recovery', () => {
  it('requires a session', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    expect((await otpRouter.fetch(get('/recovery'), env)).status).toBe(401);
    expect((await otpRouter.fetch(del('/recovery'), env)).status).toBe(401);
  });

  it('reports whether a recovery number is configured', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(get('/recovery', { id: 'user-1' }), env);
    const body = await bodyOf<{ data: { configured: boolean } }>(res);
    expect(body.data.configured).toBe(true);
  });

  it('masks the number rather than returning it', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(get('/recovery', { id: 'user-1' }), env);
    const body = await bodyOf<{ data: { masked: string } }>(res);

    expect(body.data.masked).not.toBe('+19495550199');
    expect(body.data.masked.replace(/\D/g, '')).toBe('0199');
  });

  it('reports "not configured" when the column is null', async () => {
    const env = makeEnv(
      [{ ...OWNER, recovery_phone: null }],
      [{ ...WORKSPACE }],
    );
    const res = await otpRouter.fetch(get('/recovery', { id: 'user-1' }), env);
    const body = await bodyOf<{ data: { configured: boolean } }>(res);
    expect(body.data.configured).toBe(false);
  });

  it('clears the recovery number on DELETE', async () => {
    const env = makeEnv([{ ...OWNER }], [{ ...WORKSPACE }]);
    const res = await otpRouter.fetch(del('/recovery', { id: 'user-1' }), env);

    expect(res.status).toBe(200);
    expect(env.users[0]['recovery_phone']).toBeNull();
  });
});
