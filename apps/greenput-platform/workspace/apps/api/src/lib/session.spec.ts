import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '../env';
import { createFakeKv } from '../test-helpers';
import {
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_MAX_IDLE_SECONDS,
  SESSION_RENEW_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
  applySessionRenewal,
  createSession,
  resetRenewalCoalescingForTests,
  revokeSession,
  revokedKey,
  sessionKey,
  stageSessionRenewal,
  touchSession,
  type SessionPrincipal,
} from './session';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SLOT_MS = SESSION_RENEW_AFTER_SECONDS * 1000;

const PRINCIPAL: SessionPrincipal = {
  id: 'u1',
  workspaceId: 'ws-1',
  email: 'owner@example.com',
  role: 'owner',
  firstName: 'Warren',
  lastName: 'Dugan',
};

function makeEnv(kv: KVNamespace, environment = 'production'): Env {
  return {
    ENVIRONMENT: environment,
    DB: {} as D1Database,
    SESSIONS: kv,
  } as Env;
}

function maxAgeOf(cookie: string): number {
  const match = cookie.match(/Max-Age=(\d+)/);
  if (!match) throw new Error(`no Max-Age in cookie: ${cookie}`);
  return Number(match[1]);
}

function renewalOf(touched: Awaited<ReturnType<typeof touchSession>>): string {
  if (touched.status !== 'active' || !touched.renewal) {
    throw new Error(`expected a renewal, got ${JSON.stringify(touched)}`);
  }
  return touched.renewal;
}

/**
 * Seed a record as though it were written a couple of minutes ago, so the
 * fake's one-write-per-second-per-key rule (and any read staleness) treats the
 * test's own setup as history rather than as a write racing the one under test.
 */
async function seedRaw(
  fake: ReturnType<typeof createFakeKv>,
  clock: { now: number },
  key: string,
  value: string,
  options: { expiration?: number; expirationTtl?: number },
): Promise<void> {
  const at = clock.now;
  clock.now -= 120_000;
  await fake.kv.put(key, value, options);
  clock.now = at;
  // The fixture is not part of what the test is counting.
  fake.forgetWrites();
}

async function seed(
  fake: ReturnType<typeof createFakeKv>,
  clock: { now: number },
  token: string,
  record: Record<string, unknown>,
): Promise<void> {
  await seedRaw(fake, clock, sessionKey(token), JSON.stringify(record), {
    expiration: Math.floor((record.expiresAt as number) / 1000),
  });
}

// The coalescing map in session.ts is per isolate and outlives a single test.
// Production tokens are UUIDs so they never collide; fixed tokens in tests do.
beforeEach(() => {
  resetRenewalCoalescingForTests();
});

describe('createSession', () => {
  it('writes the session under the key the middleware reads, with the idle window', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const session = await createSession(env, PRINCIPAL, clock.now);

    const stored = fake.stored(sessionKey(session.token));
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored?.value ?? '')).toEqual({
      ...PRINCIPAL,
      createdAt: clock.now,
      // Slot-0's expiry: a full idle window past the end of the slot the
      // sign-in falls in, so the very next request does not immediately find
      // the record short and rewrite it.
      expiresAt: clock.now + SESSION_MAX_IDLE_SECONDS * 1000,
    });
    // KV's own expiration is the record's expiresAt, not a TTL measured from
    // whenever the write happened to land.
    expect(stored?.expiresAt).toBe(clock.now + SESSION_MAX_IDLE_SECONDS * 1000);
    expect(maxAgeOf(session.cookie)).toBe(SESSION_MAX_IDLE_SECONDS);
    expect(session.cookie).toContain(`gp_session=${session.token}`);
    expect(session.cookie).toContain('HttpOnly');
  });

  it('fails loudly when KV will not store the session', async () => {
    const env = makeEnv({
      get: async () => null,
      put: async () => {
        throw new Error('KV unavailable');
      },
      delete: async () => undefined,
    } as unknown as KVNamespace);

    // A renewal is best-effort; minting is not. Handing out a cookie for a
    // session that was never stored is a sign-in that silently did nothing.
    await expect(createSession(env, PRINCIPAL)).rejects.toThrow(
      'KV unavailable',
    );
  });
});

describe('touchSession — sliding', () => {
  it('keeps a session used late in its window alive past its ORIGINAL expiry', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token, expiresAt: originalExpiry } = await createSession(
      env,
      PRINCIPAL,
      clock.now,
    );

    // Day 6: one request, inside the original window.
    clock.now += 6 * DAY_MS;
    const late = await touchSession(env, token, clock.now);
    expect(late.status).toBe('active');
    // The refreshed cookie carries the refreshed window, so the browser keeps
    // sending the token the KV entry is still there for — and never promises
    // less than the idle window nor more than its quantized ceiling.
    const maxAge = maxAgeOf(renewalOf(late));
    expect(maxAge).toBeGreaterThanOrEqual(SESSION_TTL_SECONDS);
    expect(maxAge).toBeLessThanOrEqual(SESSION_MAX_IDLE_SECONDS);
    // And KV agrees with the cookie to the second.
    expect(fake.stored(sessionKey(token))?.expiresAt).toBe(
      clock.now + maxAge * 1000,
    );

    // Day 10 — past the original expiry. Before this change the KV entry and
    // the cookie were both gone by now.
    clock.now += 4 * DAY_MS;
    expect(clock.now).toBeGreaterThan(originalExpiry);
    const after = await touchSession(env, token, clock.now);
    expect(after.status).toBe('active');
    expect(after.status === 'active' && after.user).toEqual(PRINCIPAL);
  });

  it('keeps a daily user signed in for weeks', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);

    for (let day = 1; day <= 20; day += 1) {
      clock.now += DAY_MS;
      const touched = await touchSession(env, token, clock.now);
      expect(touched.status, `day ${day}`).toBe('active');
    }
  });

  it('never writes an expiry KV would reject or that disagrees with the record', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);
    for (let day = 1; day <= 31; day += 1) {
      clock.now += DAY_MS;
      await touchSession(env, token, clock.now);
    }

    for (const write of fake.applied(sessionKey(token))) {
      if (write.op !== 'put') continue;
      const record = JSON.parse(write.value ?? '') as { expiresAt: number };
      // KV's expiration IS the record's expiresAt (to the second), which is
      // what makes duplicate writes indistinguishable and lets KV enforce the
      // absolute cap on its own.
      expect(write.expiresAt).toBe(Math.floor(record.expiresAt / 1000) * 1000);
    }
  });
});

describe('touchSession — the absolute cap', () => {
  it('does NOT let constant use push a session past the cap', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);
    const capDay = SESSION_ABSOLUTE_TTL_SECONDS / (24 * 60 * 60);

    const statuses: string[] = [];
    for (let day = 1; day <= capDay + 2; day += 1) {
      clock.now += DAY_MS;
      statuses.push((await touchSession(env, token, clock.now)).status);
    }

    // Used every single day, and still dead on day 30: active for days 1–29,
    // never again from the cap onwards.
    expect(statuses.slice(0, capDay - 1)).toEqual(
      Array.from({ length: capDay - 1 }, () => 'active'),
    );
    expect(statuses.slice(capDay - 1)).not.toContain('active');
    expect(fake.stored(sessionKey(token))).toBeNull();
  });

  it('refuses a session past the cap even when its KV entry is alive', async () => {
    // The stolen-cookie case, and the one KV's own expiration cannot cover: a
    // session renewed often enough that the entry is healthy, but whose first
    // sign-in was longer ago than the cap allows.
    const clock = { now: Date.parse('2026-10-20T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    await seed(fake, clock, 'over-cap', {
      ...PRINCIPAL,
      createdAt: clock.now - (SESSION_ABSOLUTE_TTL_SECONDS * 1000 + 1000),
      expiresAt: clock.now + 5 * DAY_MS,
    });

    const touched = await touchSession(env, 'over-cap', clock.now);
    expect(touched.status).toBe('expired');
    // And dropped, so the token is dead everywhere rather than for one request.
    expect(fake.stored(sessionKey('over-cap'))).toBeNull();
    expect((await touchSession(env, 'over-cap', clock.now)).status).toBe(
      'missing',
    );
  });

  it('does not 500 when two concurrent requests both find a session past the cap', async () => {
    // Both requests try to drop the same key in the same second. A delete is a
    // write, so KV 429s the second one — and an unguarded delete here would
    // turn a 401 into an HTTP 500 for the very page load that discovers the
    // session has aged out.
    const clock = { now: Date.parse('2026-10-20T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    await seed(fake, clock, 'over-cap', {
      ...PRINCIPAL,
      createdAt: clock.now - (SESSION_ABSOLUTE_TTL_SECONDS * 1000 + 1000),
      expiresAt: clock.now + 5 * DAY_MS,
    });

    const statuses = await Promise.all([
      touchSession(env, 'over-cap', clock.now),
      touchSession(env, 'over-cap', clock.now),
      touchSession(env, 'over-cap', clock.now),
    ]);

    expect(statuses.map((s) => s.status)).toEqual([
      'expired',
      'expired',
      'expired',
    ]);
    expect(fake.stored(sessionKey('over-cap'))).toBeNull();
    // KV really did reject the duplicate deletes — the fake is not being kind.
    expect(fake.rejected(sessionKey('over-cap')).length).toBeGreaterThan(0);
  });

  it('allows the same session one second before the cap', async () => {
    const clock = { now: Date.parse('2026-10-20T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    await seed(fake, clock, 'under-cap', {
      ...PRINCIPAL,
      createdAt: clock.now - (SESSION_ABSOLUTE_TTL_SECONDS * 1000 - 1000),
      expiresAt: clock.now + 5 * DAY_MS,
    });

    expect((await touchSession(env, 'under-cap', clock.now)).status).toBe(
      'active',
    );
  });

  it('stops writing once the cap is all that is left, and dies exactly there', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);
    const key = sessionKey(token);

    // Daily use through day 24 — by now the session's expiry has been pinned to
    // the cap, because a renewal can no longer buy a whole idle window.
    for (let day = 1; day <= 24; day += 1) {
      clock.now += DAY_MS;
      expect((await touchSession(env, token, clock.now)).status).toBe('active');
    }
    const capped = fake.parsed(key);
    expect(capped.expiresAt).toBe(
      (capped.createdAt as number) + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
    );
    const writesAtTail = fake.applied(key).length;

    // Hammer it for the rest of the month: not one further write, and no
    // further Set-Cookie either.
    for (let i = 0; i < 200; i += 1) {
      clock.now += 30 * 60 * 1000;
      const touched = await touchSession(env, token, clock.now);
      if (touched.status !== 'active') break;
      expect(touched.renewal).toBeUndefined();
    }
    expect(fake.applied(key).length).toBe(writesAtTail);

    // And it is dead at the cap, not a day either side of it.
    clock.now = Date.parse('2026-09-11T00:00:00Z') + 30 * DAY_MS - 1000;
    expect((await touchSession(env, token, clock.now)).status).toBe('active');
    clock.now += 1000;
    expect((await touchSession(env, token, clock.now)).status).not.toBe(
      'active',
    );
  });
});

describe('touchSession — a quiet session still expires on time', () => {
  it('expires within the idle window when nothing uses it', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);

    // Nothing touches it — no dashboard load, no API call. Sliding is driven
    // entirely by use, so the idle window runs out. Quantizing rounds that
    // window UP, never down: the entry is still there at 7 days (checked
    // without touching it, because a touch is exactly what would slide it) and
    // gone at 8.75.
    clock.now += SESSION_TTL_SECONDS * 1000;
    expect(fake.stored(sessionKey(token))).not.toBeNull();

    clock.now =
      Date.parse('2026-09-11T00:00:00Z') + SESSION_MAX_IDLE_SECONDS * 1000;
    expect((await touchSession(env, token, clock.now)).status).toBe('missing');
    expect(fake.stored(sessionKey(token))).toBeNull();
  });

  it('does not extend a session whose only use was inside its first slot', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);
    const key = sessionKey(token);

    // Used one hour in — the same renewal slot as the sign-in, so this buys
    // nothing and writes nothing.
    clock.now += HOUR_MS;
    const before = fake.applied(key).length;
    expect((await touchSession(env, token, clock.now)).status).toBe('active');
    expect(fake.applied(key).length).toBe(before);

    // Then silence. It still dies on the original schedule, not 8.75 days from
    // that one request.
    clock.now =
      Date.parse('2026-09-11T00:00:00Z') + SESSION_MAX_IDLE_SECONDS * 1000;
    expect((await touchSession(env, token, clock.now)).status).toBe('missing');
  });
});

// ── The part that broke the last attempt: concurrency ───────────────────────
//
// Workers KV allows one write per second to a key and throws 429 past that, and
// the platform dashboard fires two authenticated requests in the same mount. A
// read-modify-write here therefore has to be safe against requests that land
// together and against reads that have not caught up yet.
describe('touchSession — concurrent requests on one session', () => {
  async function agedSession(
    clock: { now: number },
    options: { stalenessMs?: number } = {},
  ) {
    const fake = createFakeKv(clock, options);
    const env = makeEnv(fake.kv);
    const token = 'aged-tok';
    // Three days in: past a renewal slot, so the next request is renewal-due.
    await seed(fake, clock, token, {
      ...PRINCIPAL,
      createdAt: clock.now - 3 * DAY_MS,
      expiresAt: clock.now + 4 * DAY_MS,
    });
    return { fake, env, token };
  }

  it('serves a whole page load of concurrent requests with ONE write and no error', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const { fake, env, token } = await agedSession(clock);
    const key = sessionKey(token);
    const before = fake.applied(key).length;

    const touched = await Promise.all(
      Array.from({ length: 6 }, () => touchSession(env, token, clock.now)),
    );

    expect(touched.map((t) => t.status)).toEqual(Array(6).fill('active'));
    // One write for the page load, not six, and not one plus five 429s.
    expect(fake.applied(key).length - before).toBe(1);
    expect(fake.rejected(key)).toEqual([]);
    // Every request that reported a renewal reported the same window.
    const renewals = touched
      .filter((t) => t.status === 'active' && t.renewal)
      .map((t) => maxAgeOf(renewalOf(t)));
    expect(new Set(renewals).size).toBe(1);
    expect(renewals.length).toBeGreaterThan(0);
  });

  it('survives the 429 when the write really does lose the race', async () => {
    // The coalescing map only spans one isolate. Two isolates (or two colos)
    // racing is the case the try/catch exists for: the loser must report a live
    // session that did not slide, never an exception the error handler turns
    // into a 500 on someone's dashboard.
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const { fake, env, token } = await agedSession(clock, {
      stalenessMs: 60_000,
    });
    const key = sessionKey(token);

    const first = await touchSession(env, token, clock.now);
    expect(first.status === 'active' && first.renewal).toBeTruthy();

    resetRenewalCoalescingForTests(); // a second isolate, same second
    const second = await touchSession(env, token, clock.now);

    expect(second.status).toBe('active');
    expect(second.status === 'active' && second.user).toEqual(PRINCIPAL);
    // It did not pretend to have refreshed the cookie...
    expect(second.status === 'active' && second.renewal).toBeUndefined();
    // ...and KV really did reject it.
    expect(fake.rejected(key)).toHaveLength(1);
  });

  it('keeps serving the session when KV writes are failing outright', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const { fake, token } = await agedSession(clock);
    const env = makeEnv({
      get: fake.kv.get.bind(fake.kv),
      put: async () => {
        throw new Error('KV unavailable');
      },
      delete: async () => undefined,
    } as unknown as KVNamespace);

    const touched = await touchSession(env, token, clock.now);
    expect(touched.status).toBe('active');
    expect(touched.status === 'active' && touched.renewal).toBeUndefined();

    // And the failure is not cached as done: the next request tries again.
    const again = await touchSession(env, token, clock.now);
    expect(again.status).toBe('active');
  });

  it('writes the SAME bytes when reads have not caught up (KV is eventually consistent)', async () => {
    // Workers KV does not guarantee a written value is visible to reads for up
    // to 60 seconds. Every request in that window therefore re-decides that a
    // renewal is due. The decision has to be idempotent, or those requests
    // write a different expiry each time and the record wanders.
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const { fake, env, token } = await agedSession(clock, {
      stalenessMs: 60_000,
    });
    const key = sessionKey(token);

    for (let i = 0; i < 12; i += 1) {
      resetRenewalCoalescingForTests(); // worst case: every request a cold isolate
      const touched = await touchSession(env, token, clock.now);
      expect(touched.status).toBe('active');
      clock.now += 5000; // 5 seconds apart, so the hot-key limit never bites
    }

    // Reads were stale, so those requests did each attempt a write...
    expect(fake.applied(key).length).toBeGreaterThan(1);
    // ...but every one of them wrote the identical record, so the session's
    // expiry is exactly where a single write would have put it.
    expect(fake.distinctValues(key)).toHaveLength(1);
  });

  it('collapses a stale-read burst to one write inside a single isolate', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const { fake, env, token } = await agedSession(clock, {
      stalenessMs: 60_000,
    });
    const key = sessionKey(token);
    const before = fake.applied(key).length;

    for (let i = 0; i < 12; i += 1) {
      expect((await touchSession(env, token, clock.now)).status).toBe('active');
      clock.now += 5000;
    }

    expect(fake.applied(key).length - before).toBe(1);
  });
});

describe('touchSession — write amplification', () => {
  it('does not write KV on a burst of requests (a dashboard load)', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);
    const key = sessionKey(token);
    const before = fake.applied(key).length;

    for (let i = 0; i < 40; i += 1) {
      clock.now += 50; // 40 requests over two seconds
      const touched = await touchSession(env, token, clock.now);
      expect(touched.status).toBe('active');
      expect(touched.status === 'active' && touched.renewal).toBeUndefined();
    }

    expect(fake.applied(key).length).toBe(before);
  });

  it('writes once per renewal slot under continuous use', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);
    const key = sessionKey(token);
    const before = fake.applied(key).length;

    // Hourly use for 14 days: 336 authenticated requests.
    for (let hour = 1; hour <= 14 * 24; hour += 1) {
      clock.now += HOUR_MS;
      expect((await touchSession(env, token, clock.now)).status).toBe('active');
    }

    // 14 days / 1.75-day slot = 8 slot boundaries crossed, so 8 writes — not
    // 336, and not one per concurrent request either.
    expect(fake.applied(key).length - before).toBe(8);
  });

  it('costs one write per open for a contractor using the app all week', async () => {
    // The realistic shape: 8 opens a working day for 7 days, each open being
    // three concurrent authenticated requests on the same session.
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);
    const key = sessionKey(token);
    const before = fake.applied(key).length;

    for (let day = 0; day < 7; day += 1) {
      for (let open = 0; open < 8; open += 1) {
        clock.now += HOUR_MS;
        const statuses = await Promise.all([
          touchSession(env, token, clock.now),
          touchSession(env, token, clock.now),
          touchSession(env, token, clock.now),
        ]);
        expect(statuses.map((s) => s.status)).toEqual([
          'active',
          'active',
          'active',
        ]);
      }
      clock.now += 16 * HOUR_MS;
    }

    // Three renewal slots opened during working hours over those 7 days, so 3
    // writes out of 168 requests — and not a single 429.
    expect(fake.applied(key).length - before).toBe(3);
    expect(fake.rejected(key)).toEqual([]);
  });
});

// ── Logout has to be final ─────────────────────────────────────────────────
describe('revokeSession', () => {
  it('makes a live session dead, and clears the cookie on the next request', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const { token } = await createSession(env, PRINCIPAL, clock.now);
    expect((await touchSession(env, token, clock.now)).status).toBe('active');

    expect(await revokeSession(env, token)).toBe(true);
    expect((await touchSession(env, token, clock.now)).status).toBe('revoked');
  });

  it('reports failure when the tombstone does not land, even if the delete does', async () => {
    // The tombstone is the SOLE revocation signal touchSession consults, so
    // "either write landed" is the wrong success condition: a bare delete is
    // exactly the case revocation exists to defeat, because an in-flight
    // renewal writes the record back and nothing outranks it. Reporting true
    // there makes logout answer 200 over a session that is still live.
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const token = 'tombstone-fails';

    await seed(fake, clock, token, {
      ...PRINCIPAL,
      createdAt: clock.now - 3 * DAY_MS,
      expiresAt: clock.now + 4 * DAY_MS,
    });

    // Only the tombstone write fails; the delete is left working.
    const realPut = fake.kv.put.bind(fake.kv);
    const env = makeEnv({
      ...fake.kv,
      put: async (
        key: string,
        value: string,
        opts?: { expirationTtl?: number; expiration?: number },
      ) => {
        if (key === revokedKey(token)) throw new Error('KV PUT failed: 500');
        return realPut(key, value, opts);
      },
    } as unknown as Parameters<typeof makeEnv>[0]);

    expect(await revokeSession(env, token)).toBe(false);

    // And the reason it must be false: the record is gone, but the token is
    // still usable the moment anything writes it back.
    expect(fake.stored(sessionKey(token))).toBeNull();
    // A round trip later, so the write is not refused by KV's one-per-second
    // hot-key limit — this is the in-flight renewal landing, not a burst.
    clock.now += 1500;
    await fake.kv.put(
      sessionKey(token),
      JSON.stringify({
        ...PRINCIPAL,
        createdAt: clock.now - 3 * DAY_MS,
        expiresAt: clock.now + 4 * DAY_MS,
      }),
    );
    clock.now += 2000;
    expect((await touchSession(env, token, clock.now)).status).toBe('active');
  });

  it('is NOT undone by a renewal that was already in flight', async () => {
    // The defect this exists for: requireAuth read the record, decided to
    // renew, and its put landed after logout's delete — putting the session
    // back AND re-issuing a 7-day cookie, so the person who pressed Log out was
    // still signed in.
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);
    const token = 'in-flight-tok';
    const key = sessionKey(token);

    await seed(fake, clock, token, {
      ...PRINCIPAL,
      createdAt: clock.now - 3 * DAY_MS,
      expiresAt: clock.now + 4 * DAY_MS,
    });

    // A renewal-due request whose KV write is held open, the way an ordinary
    // round trip is in flight while the person clicks Log out.
    const release = fake.holdNextWrite({ key, op: 'put' });
    const inFlight = touchSession(env, token, clock.now);

    expect(await revokeSession(env, token)).toBe(true);
    expect(fake.stored(key)).toBeNull(); // gone, for the moment

    clock.now += 1500; // the in-flight write comes back a round trip later
    release();
    const touched = await inFlight;
    expect(touched.status).toBe('active'); // it had already been authorised

    // The record really was resurrected — this is not a test of the write
    // failing to land.
    expect(fake.stored(key)).not.toBeNull();

    // And it buys nothing: the tombstone outranks the record.
    expect((await touchSession(env, token, clock.now)).status).toBe('revoked');

    // The resurrected record is swept too, as soon as KV will take the delete —
    // the first attempt lands inside a second of the resurrection, so KV refuses
    // it, which changes nothing because the tombstone is the authority.
    clock.now += 2000;
    expect((await touchSession(env, token, clock.now)).status).toBe('revoked');
    expect(fake.stored(key)).toBeNull();
  });

  it('is final even when KV rate-limits the delete itself', async () => {
    // A renewal wrote the session key moments ago, so logout's delete is the
    // second write to that key inside a second and KV throws. Before the
    // tombstone that left the record live and 500'd the logout.
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);
    const token = 'hot-key-tok';
    const key = sessionKey(token);

    // Seeded at this very instant on purpose: the logout that follows is then
    // the second write to this key inside a second.
    await fake.kv.put(
      key,
      JSON.stringify({
        ...PRINCIPAL,
        createdAt: clock.now - 3 * DAY_MS,
        expiresAt: clock.now + 4 * DAY_MS,
      }),
      { expiration: Math.floor((clock.now + 4 * DAY_MS) / 1000) },
    );

    expect(await revokeSession(env, token)).toBe(true);
    expect(fake.rejected(key)).toHaveLength(1); // the delete really was refused
    expect(fake.stored(key)).not.toBeNull(); // the record is still there
    // And the session is dead anyway.
    expect((await touchSession(env, token, clock.now)).status).toBe('revoked');
  });

  it('reports failure when nothing could be revoked', async () => {
    const env = makeEnv({
      get: async () => null,
      put: async () => {
        throw new Error('KV unavailable');
      },
      delete: async () => {
        throw new Error('KV unavailable');
      },
    } as unknown as KVNamespace);

    expect(await revokeSession(env, 'tok')).toBe(false);
  });

  it('keeps the tombstone longer than any renewal could keep the record', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    await revokeSession(env, 'tok');
    const tombstone = fake.stored(revokedKey('tok'));
    const longestRenewal = clock.now + SESSION_MAX_IDLE_SECONDS * 1000;
    expect(tombstone?.expiresAt ?? 0).toBeGreaterThan(longestRenewal);
  });

  it('does not revoke anyone else', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    const mine = await createSession(env, PRINCIPAL, clock.now);
    const theirs = await createSession(env, PRINCIPAL, clock.now);

    await revokeSession(env, mine.token);

    expect((await touchSession(env, mine.token, clock.now)).status).toBe(
      'revoked',
    );
    expect((await touchSession(env, theirs.token, clock.now)).status).toBe(
      'active',
    );
  });
});

describe('touchSession — sessions minted before the stamps existed', () => {
  const legacy = JSON.stringify(PRINCIPAL); // exactly what production holds

  it('slides such a session instead of treating it as ancient', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const start = clock.now;
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    // Stamped by the OLD code: no createdAt, no expiresAt, 7-day KV TTL.
    await seedRaw(fake, clock, sessionKey('legacy-tok'), legacy, {
      expirationTtl: SESSION_TTL_SECONDS,
    });

    const touched = await touchSession(env, 'legacy-tok', clock.now);
    expect(touched.status).toBe('active');
    expect(touched.status === 'active' && touched.user).toEqual(PRINCIPAL);
    expect(touched.status === 'active' && touched.renewal).toBeTruthy();

    // It now carries stamps, and the cap is measured from the oldest it could
    // possibly be — a full idle window ago, rounded down to the slot grid so
    // that concurrent first requests agree on the number. Never from the epoch,
    // and never later than a full idle window back.
    const record = fake.parsed(sessionKey('legacy-tok'));
    const createdAt = record.createdAt as number;
    expect(createdAt).toBeLessThanOrEqual(start - SESSION_TTL_SECONDS * 1000);
    expect(createdAt).toBeGreaterThan(
      start - SESSION_TTL_SECONDS * 1000 - SLOT_MS,
    );

    // Which means daily use keeps it working well past the 7-day death it was
    // originally handed — and still stops at the cap, 30 days from the inferred
    // first sign-in, i.e. about three weeks from here. Not forever.
    const deadline = createdAt + SESSION_ABSOLUTE_TTL_SECONDS * 1000;
    const statuses: string[] = [];
    for (let day = 1; day <= 25; day += 1) {
      clock.now += DAY_MS;
      statuses.push((await touchSession(env, 'legacy-tok', clock.now)).status);
    }
    for (let day = 1; day <= 25; day += 1) {
      const expected =
        start + day * DAY_MS < deadline ? 'active' : 'not-active';
      const actual = statuses[day - 1] === 'active' ? 'active' : 'not-active';
      expect(actual, `day ${day}`).toBe(expected);
    }
    // Concretely: three more weeks of runway, and gone inside four.
    expect(statuses.slice(0, 21)).toEqual(
      Array.from({ length: 21 }, () => 'active'),
    );
    expect(statuses[23]).not.toBe('active');
  });

  it('agrees on the synthesised start date across concurrent first requests', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    await seedRaw(fake, clock, sessionKey('legacy-tok'), legacy, {
      expirationTtl: SESSION_TTL_SECONDS,
    });

    // Different isolates, milliseconds apart: if the synthesised createdAt came
    // from a raw `now`, each would stamp a different one and the writes would
    // not be idempotent.
    for (const offset of [0, 1, 250, 999]) {
      resetRenewalCoalescingForTests();
      const touched = await touchSession(env, 'legacy-tok', clock.now + offset);
      expect(touched.status).toBe('active');
    }

    expect(fake.distinctValues(sessionKey('legacy-tok'))).toHaveLength(1);
  });

  it('rejects garbage and records with no identity', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    await seedRaw(fake, clock, sessionKey('bad-json'), 'not-json', {
      expirationTtl: SESSION_TTL_SECONDS,
    });
    await seedRaw(
      fake,
      clock,
      sessionKey('no-id'),
      JSON.stringify({ role: 'owner' }),
      { expirationTtl: SESSION_TTL_SECONDS },
    );

    expect((await touchSession(env, 'bad-json', clock.now)).status).toBe(
      'missing',
    );
    expect((await touchSession(env, 'no-id', clock.now)).status).toBe(
      'missing',
    );
  });

  it('does not believe a start date in the future', async () => {
    const clock = { now: Date.parse('2026-09-11T00:00:00Z') };
    const fake = createFakeKv(clock);
    const env = makeEnv(fake.kv);

    // Only this module writes these records, but the cap is the one thing
    // between a stolen cookie and a permanent credential: it must not be
    // possible to push it out with a start date that has not happened yet.
    await seed(fake, clock, 'future-tok', {
      ...PRINCIPAL,
      createdAt: clock.now + 365 * DAY_MS,
      expiresAt: clock.now + 4 * DAY_MS,
    });

    await touchSession(env, 'future-tok', clock.now);
    const record = fake.parsed(sessionKey('future-tok'));
    expect(record.createdAt).toBeLessThanOrEqual(clock.now);

    // So the cap still bites 30 days from now, not 30 days from next year.
    clock.now += SESSION_ABSOLUTE_TTL_SECONDS * 1000;
    expect((await touchSession(env, 'future-tok', clock.now)).status).not.toBe(
      'active',
    );
  });
});

describe('renewal staging', () => {
  it('appends a staged cookie exactly once', () => {
    const request = new Request('https://api.greenput.com/api/leads');
    const headers = new Headers();

    expect(applySessionRenewal(request, headers)).toBe(false);

    stageSessionRenewal(request, 'gp_session=abc; Max-Age=604800');
    expect(applySessionRenewal(request, headers)).toBe(true);
    expect(headers.getSetCookie()).toEqual(['gp_session=abc; Max-Age=604800']);

    // Draining is idempotent — a second response cannot re-send it.
    expect(applySessionRenewal(request, headers)).toBe(false);
    expect(headers.getSetCookie()).toHaveLength(1);
  });

  it('keeps staged cookies separate per request', () => {
    const a = new Request('https://api.greenput.com/api/leads');
    const b = new Request('https://api.greenput.com/api/jobs');
    stageSessionRenewal(a, 'gp_session=a');

    const headersB = new Headers();
    expect(applySessionRenewal(b, headersB)).toBe(false);
    expect(headersB.getSetCookie()).toEqual([]);
  });
});
