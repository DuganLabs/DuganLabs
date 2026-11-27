import type { Env } from '../env';
import { buildSessionCookie, newId } from './response';

/**
 * Session lifetime lives here, once, for every door that mints a session
 * (password login, register, passkey login, recovery-code sign-in) and for the
 * middleware that reads one back.
 *
 * IDLE window — SESSION_TTL_SECONDS (7 days). How long a session survives
 * WITHOUT being used. Using the product pushes it forward, so a daily user
 * stays signed in. Before this, the KV entry and the cookie both died exactly 7
 * days after sign-in however much the account was used.
 *
 * ABSOLUTE cap — SESSION_ABSOLUTE_TTL_SECONDS (30 days from first sign-in).
 * Sliding without a cap is a worse bug than not sliding: a session that renews
 * forever can never be aged out, so a cookie lifted from a daily user becomes a
 * permanent credential that no password change or passkey revocation reaches.
 * The cap is measured from `createdAt`, stamped at sign-in and never moved, and
 * — because every write sets KV's own `expiration` to the record's `expiresAt`,
 * which is itself clamped to the cap — KV expires the entry at the cap even if
 * this code is wrong about it.
 *
 * RENEW slot — SESSION_RENEW_AFTER_SECONDS (1.75 days, a quarter of the idle
 * window). A renewal is a KV write, and Workers KV allows at most ONE write per
 * second to the same key (429 past that) and does not guarantee a written value
 * is visible to reads for up to 60 seconds. A CRM page load is several
 * concurrent authenticated requests on one session key, so a naive
 * read-modify-write here is neither safe nor rate-limited: the concurrent
 * requests all read the pre-renewal value, all decide to write, and all but one
 * get a 429; and for the next minute every further request re-decides the same
 * way because its read is stale.
 *
 * Three things make that safe, and all three matter:
 *
 *  1. The written value is QUANTIZED, so it is idempotent. Time is cut into
 *     1.75-day slots anchored on `createdAt`, and a session used anywhere in a
 *     slot gets `expiresAt = <end of that slot> + 7 days`. That number is a
 *     pure function of (createdAt, slot) — not of `now` — so concurrent
 *     requests, and stale-read requests inside the 60-second window, all
 *     compute the SAME record and the SAME KV expiration. Duplicate writes are
 *     byte-identical, so a lost update cannot lose anything, and the number of
 *     DISTINCT values written is exactly one per slot.
 *  2. A renewal is BEST-EFFORT. Every KV mutation on the read path is wrapped:
 *     a 429 from losing a write race, or KV being unreachable, means "this
 *     request did not slide the session", not an exception that the error
 *     handler turns into a 500 on somebody's dashboard.
 *  3. Renewals are COALESCED per isolate, so the common case never has to rely
 *     on (2). Requests that arrive together share one in-flight put instead of
 *     racing, and an isolate that has already pushed a token to a given expiry
 *     does not write it again when its next read is stale.
 *
 * The cost of quantizing is that the idle window rounds UP: a session survives
 * at least 7 and at most 8.75 days of silence, never less than advertised.
 * SESSION_MAX_IDLE_SECONDS is that ceiling.
 *
 * REVOCATION has its own signal. Logout used to mean "delete the record", and
 * absence cannot express revocation once anything else writes the key: a
 * renewal already in flight put the record straight back and re-issued the
 * cookie, so the person who pressed Log out was still signed in. Logout now
 * writes a `revoked:<token>` tombstone that every read consults, so a
 * resurrected record is inert and logout is final. The tombstone outlives the
 * longest-lived entry any racing renewal could still write (8.75 days plus an
 * hour), and only a token that was explicitly signed out costs one.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_ABSOLUTE_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_RENEW_AFTER_SECONDS = SESSION_TTL_SECONDS / 4;

/**
 * The longest a session can sit unused and still work: the idle window plus the
 * slot it is rounded up to. This is what a freshly issued cookie's Max-Age is.
 */
export const SESSION_MAX_IDLE_SECONDS =
  SESSION_TTL_SECONDS + SESSION_RENEW_AFTER_SECONDS;

/**
 * How long a logout tombstone lives. It has to outlive any entry a renewal that
 * was already in flight could still write: such a request's `now` is at most
 * KV's 60-second read-staleness window past the logout, and the expiry it
 * computes is at most SESSION_MAX_IDLE_SECONDS past its own `now`. An hour of
 * slack covers request duration and clock skew between colos.
 */
export const SESSION_REVOCATION_TTL_SECONDS = SESSION_MAX_IDLE_SECONDS + 3600;

/** Cloudflare KV refuses an expiration less than 60 seconds away. */
const KV_MIN_TTL_SECONDS = 60;

const IDLE_MS = SESSION_TTL_SECONDS * 1000;
const CAP_MS = SESSION_ABSOLUTE_TTL_SECONDS * 1000;
const SLOT_MS = SESSION_RENEW_AFTER_SECONDS * 1000;

/** Body of a tombstone. A constant, so two logouts write identical bytes. */
const REVOKED_MARKER = '1';

/** Exactly what `/api/auth/me` and every handler sees as `request.user`. */
export interface SessionPrincipal {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
}

/** What actually sits in KV: the principal plus the two lifetime stamps. */
interface StoredSession extends SessionPrincipal {
  /** Epoch ms of first sign-in. Never moves — this is what the cap measures. */
  createdAt: number;
  /** Epoch ms this session currently dies. Slides forward with use. */
  expiresAt: number;
}

export type SessionTouch =
  | {
      status: 'active';
      user: SessionPrincipal;
      /** Set only when the session was renewed: a refreshed `Set-Cookie`. */
      renewal?: string;
    }
  /** No such session, or a record we cannot read. */
  | { status: 'missing' }
  /** Past the absolute cap — the KV entry has been dropped. */
  | { status: 'expired' }
  /** Signed out. The tombstone says so even if the record came back. */
  | { status: 'revoked' };

export function sessionKey(token: string): string {
  return `session:${token}`;
}

export function revokedKey(token: string): string {
  return `revoked:${token}`;
}

/**
 * The expiry a session used at `now` carries. Quantized to the renewal slot so
 * that every request in the same slot — concurrent, or reading a value KV has
 * not caught up on yet — computes the same number, which is what makes the
 * renewal write idempotent. Always at least `now + IDLE`, never past the cap.
 */
function targetExpiry(createdAt: number, now: number): number {
  const slot = Math.floor((now - createdAt) / SLOT_MS);
  const slotEnd = createdAt + (slot + 1) * SLOT_MS;
  return Math.min(slotEnd + IDLE_MS, createdAt + CAP_MS);
}

/**
 * The one way to start a session. Writes the KV entry and returns the cookie
 * to append — callers never build either half themselves, so the four sign-in
 * doors cannot drift apart on lifetime, key shape, or cookie attributes.
 *
 * This put is deliberately NOT best-effort: handing out a cookie for a session
 * that was never stored would be a sign-in that silently did nothing.
 */
export async function createSession(
  env: Env,
  principal: SessionPrincipal,
  now: number = Date.now(),
): Promise<{ token: string; cookie: string; expiresAt: number }> {
  const token = newId();
  // The slot-0 target, so the first request after sign-in does not immediately
  // find the record short of where this slot says it should be and rewrite it.
  const expiresAt = targetExpiry(now, now);
  const record: StoredSession = { ...principal, createdAt: now, expiresAt };

  await env.SESSIONS.put(sessionKey(token), JSON.stringify(record), {
    expiration: Math.floor(expiresAt / 1000),
  });

  return {
    token,
    cookie: buildSessionCookie(
      token,
      env,
      Math.floor((expiresAt - now) / 1000),
    ),
    expiresAt,
  };
}

/**
 * Sign out, for good.
 *
 * Deleting the record is not enough on its own: a renewal that was already in
 * flight writes it back, and the refreshed cookie rides out with it, so the
 * person who pressed Log out stays signed in with a fresh window. The tombstone
 * is the part that makes it final — `touchSession` refuses a token whose
 * tombstone exists no matter what the record says, and sweeps the resurrected
 * record when it sees one.
 *
 * Returns whether THE TOMBSTONE landed — not whether either write did. The two
 * are not interchangeable: the delete alone is exactly the case this function
 * exists to defeat, because an in-flight renewal writes the record back and
 * re-issues a working cookie, and with no tombstone nothing outranks it. A
 * caller told `true` on a bare delete would report "signed out" over a session
 * that is still live, which is the one lie logout must never tell.
 *
 * The delete is best-effort cleanup. If it fails while the tombstone lands, the
 * session is still revoked — `touchSession` refuses the token and sweeps the
 * orphaned record the next time it sees it.
 */
export async function revokeSession(env: Env, token: string): Promise<boolean> {
  const [tombstone] = await Promise.allSettled([
    env.SESSIONS.put(revokedKey(token), REVOKED_MARKER, {
      expirationTtl: SESSION_REVOCATION_TTL_SECONDS,
    }),
    env.SESSIONS.delete(sessionKey(token)),
  ]);
  return tombstone.status === 'fulfilled';
}

/**
 * Read a session and, if it has aged into a new renewal slot, slide it forward
 * — both the KV expiration and (via the returned cookie) the browser's
 * Max-Age. Extending one without the other buys nothing: a live KV entry is
 * unreachable once the browser stops sending the cookie.
 */
export async function touchSession(
  env: Env,
  token: string,
  now: number = Date.now(),
): Promise<SessionTouch> {
  const key = sessionKey(token);

  // One round trip for both: the record, and the tombstone that outranks it.
  const [raw, revoked] = await Promise.all([
    env.SESSIONS.get(key),
    env.SESSIONS.get(revokedKey(token)),
  ]);

  if (revoked !== null) {
    // Signed out. If a renewal that was in flight at the time put the record
    // back, drop it again — best-effort, because the tombstone alone already
    // makes the token dead.
    if (raw !== null) await deleteQuietly(env, key);
    return { status: 'revoked' };
  }

  if (!raw) return { status: 'missing' };

  let parsed: Partial<StoredSession>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredSession>;
  } catch {
    return { status: 'missing' };
  }
  if (!parsed || typeof parsed.id !== 'string') return { status: 'missing' };

  const { createdAt, expiresAt } = normalizeStamps(parsed, now);

  const absoluteDeadline = createdAt + CAP_MS;
  if (now >= absoluteDeadline || now > expiresAt) {
    // Past the cap (or past an expiry KV has not yet swept). Drop the entry so
    // the token is dead everywhere, not just for this request. No tombstone is
    // needed: the cap is derived from an immutable `createdAt`, so a record
    // that a racing renewal resurrects is refused again by the next read.
    await deleteQuietly(env, key);
    return { status: 'expired' };
  }

  const user: SessionPrincipal = {
    id: parsed.id,
    workspaceId: parsed.workspaceId ?? '',
    email: parsed.email ?? '',
    role: parsed.role ?? '',
    firstName: parsed.firstName ?? '',
    lastName: parsed.lastName ?? '',
  };

  const target = targetExpiry(createdAt, now);
  const secondsLeft = Math.floor((target - now) / 1000);

  // Nothing to buy: this slot's expiry is already what the record holds. The
  // steady state for every request between slot boundaries.
  if (target <= expiresAt || secondsLeft < KV_MIN_TTL_SECONDS) {
    return { status: 'active', user };
  }

  const renewed: StoredSession = { ...user, createdAt, expiresAt: target };
  const stored = await renewOnce(env, token, key, renewed, target);
  if (!stored) {
    // The write did not land (a lost race, or KV unavailable). The session is
    // untouched and still valid — it simply did not slide, and the next request
    // tries again. Do NOT send a refreshed cookie: a Max-Age the KV entry does
    // not back is the asymmetry this whole file exists to avoid.
    return { status: 'active', user };
  }

  return {
    status: 'active',
    user,
    renewal: buildSessionCookie(token, env, secondsLeft),
  };
}

/**
 * Per-isolate renewal coalescing.
 *
 * The platform dashboard fires two authenticated requests in the same mount, so
 * the production shape is concurrent requests on one session key. They read the
 * same record, compute the same target (see targetExpiry) and would each issue
 * a put — and KV throws 429 on the second write to a key within a second.
 * Sharing one in-flight put per token collapses them into a single write, and
 * remembering the expiry this isolate has already stored stops the next 60
 * seconds of stale reads from re-deciding to write it again.
 *
 * This is an optimisation and never a correctness dependency: a cold isolate,
 * or a request served in another colo, simply writes — and if that write loses
 * a race, writeRenewal catches it and the session keeps the expiry it has.
 */
const inFlightRenewals = new Map<
  string,
  { target: number; stored: Promise<boolean> }
>();

/**
 * Cap on the coalescing map. Dropping the whole map when it grows past this
 * costs at most a few duplicate (byte-identical) writes.
 */
const RENEWAL_MAP_MAX = 2000;

async function renewOnce(
  env: Env,
  token: string,
  key: string,
  record: StoredSession,
  target: number,
): Promise<boolean> {
  const pending = inFlightRenewals.get(token);
  if (pending && pending.target >= target) return pending.stored;

  // Registered synchronously, before the first await, so requests that arrive
  // together find it instead of issuing a second put.
  const entry = { target, stored: writeRenewal(env, key, record, target) };
  if (inFlightRenewals.size >= RENEWAL_MAP_MAX) inFlightRenewals.clear();
  inFlightRenewals.set(token, entry);

  const stored = await entry.stored;
  // A write that failed must not be remembered as done, or this isolate would
  // never retry it.
  if (!stored && inFlightRenewals.get(token) === entry) {
    inFlightRenewals.delete(token);
  }
  return stored;
}

async function writeRenewal(
  env: Env,
  key: string,
  record: StoredSession,
  target: number,
): Promise<boolean> {
  try {
    await env.SESSIONS.put(key, JSON.stringify(record), {
      // Absolute, not a TTL: the KV entry then dies exactly when the record
      // says it does, whenever the write happens to land, which is the last
      // piece of making duplicate writes indistinguishable.
      expiration: Math.floor(target / 1000),
    });
    return true;
  } catch {
    return false;
  }
}

/** A KV delete is a write too: it can 429, and it must never be a 500. */
async function deleteQuietly(env: Env, key: string): Promise<void> {
  try {
    await env.SESSIONS.delete(key);
  } catch {
    // The caller is already refusing this session; failing to tidy up KV does
    // not change that, and the entry's own expiration still bounds it.
  }
}

/**
 * Sessions minted before this change carry no stamps. Treat such a record as
 * the OLDEST it could possibly be — a full idle window back — because KV's own
 * 7-day TTL is the only proof of age we have. That is the conservative reading
 * for the cap (it can only shorten the remaining absolute lifetime, never
 * extend it) while still letting the session slide from here: an `expiresAt` of
 * `now` makes it due for its first stamp on the very next request, and the live
 * KV entry is what proves it is still valid at all.
 *
 * The synthesised `createdAt` is quantized to the slot grid for the same reason
 * the target is: concurrent first requests on a legacy record must agree on it,
 * or they would each stamp a slightly different one and write different bytes.
 *
 * A `createdAt` in the future is not believed either. Only this file writes
 * these records, so it should not happen, but the cap is the one thing standing
 * between a stolen cookie and a permanent credential, and it must not be
 * possible to push it out by storing a start date that has not happened yet.
 */
function normalizeStamps(
  parsed: Partial<StoredSession>,
  now: number,
): { createdAt: number; expiresAt: number } {
  const stamped =
    typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)
      ? Math.min(parsed.createdAt, now)
      : Math.floor((now - IDLE_MS) / SLOT_MS) * SLOT_MS;
  const expiresAt =
    typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)
      ? parsed.expiresAt
      : now;
  return { createdAt: stamped, expiresAt };
}

/**
 * The seam. `requireAuth` cannot touch the handler's response — itty-router
 * middleware returns void or a rejection — so a renewal is staged against the
 * request object here and drained in the Worker's entry point
 * (apps/api/src/index.ts), which is the ONE place that assembles headers for
 * every response including the ones the error handler builds from scratch. A
 * WeakMap keyed on the request keeps this off the request's own shape; itty
 * passes handlers the same request object `router.fetch` was given, which is
 * what `request.user` already relies on.
 */
const stagedRenewals = new WeakMap<object, string>();

export function stageSessionRenewal(request: object, cookie: string): void {
  stagedRenewals.set(request, cookie);
}

/** Append any staged renewal cookie. Returns true if one was appended. */
export function applySessionRenewal(
  request: object,
  headers: Headers,
): boolean {
  const cookie = stagedRenewals.get(request);
  if (!cookie) return false;
  stagedRenewals.delete(request);
  headers.append('Set-Cookie', cookie);
  return true;
}

/** Test seam: drop the per-isolate renewal coalescing state. */
export function resetRenewalCoalescingForTests(): void {
  inFlightRenewals.clear();
}
