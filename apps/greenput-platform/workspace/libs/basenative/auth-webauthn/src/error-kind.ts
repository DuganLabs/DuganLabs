/**
 * Why a passkey attempt failed, in the only terms a sign-in screen can act
 * on. The store surfaces this alongside the raw message so a route can say
 * something true instead of guessing.
 *
 * `/login` used to render one sentence for every failure — "Check your
 * connection and try again." — which was a lie in four of these six cases.
 * The one it was most often a lie about was `rate-limited`: /login fires
 * login/options on every mount, authRateLimit allows five requests a minute
 * across all of /api/auth/*, and a user who reloads the page a few times
 * while trying to get in is told their network is broken and reloads again.
 */
export type AuthErrorKind =
  /** 429 from authRateLimit. Waiting is the fix; retrying is not. */
  | 'rate-limited'
  /** No response at all — offline, DNS, CORS, timeout. */
  | 'offline'
  /** The server rejected the credential, or has none for this user. */
  | 'no-credential'
  /** The user dismissed the prompt, or the device offered nothing to pick. */
  | 'cancelled'
  /**
   * No prompt appeared at all — the call was still pending when
   * `PASSKEY_PROMPT_TIMEOUT_MS` ran out. Distinct from `cancelled` because
   * nothing was ever shown to dismiss: this points at the device, not at the
   * person, and the useful next step is a different device rather than a
   * retry on this one.
   */
  | 'no-prompt'
  /** This browser cannot do WebAuthn at all. */
  | 'unsupported'
  /** The API failed in a way the client cannot interpret (5xx, bad shape). */
  | 'server'
  /** Anything else. */
  | 'unknown';

/** The two fields of `ApiError` this classification reads. */
interface TransportFailure {
  readonly status: number;
  readonly code?: string;
}

/**
 * Structural, not `instanceof ApiError`, on purpose. `@basenative/fetch` is
 * reached under two names in this workspace (see libs/basenative/fetch), so
 * an error thrown through one path and caught through the other would fail an
 * identity check while being exactly the object we mean. Shape is the honest
 * test here, and it also keeps this module free of a value import.
 */
function asTransportFailure(err: unknown): TransportFailure | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as { name?: unknown; status?: unknown; code?: unknown };
  if (candidate.name !== 'ApiError') return null;
  if (typeof candidate.status !== 'number') return null;
  return {
    status: candidate.status,
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
  };
}

/**
 * Classify a thrown value from a passkey or recovery call.
 *
 * Deliberately a pure function over the error, exported on its own: the
 * mapping from failure to message is the part that was wrong, so it is the
 * part that should be testable without a DOM, a store, or a fetch.
 */
export function classifyAuthError(err: unknown): AuthErrorKind {
  const failure = asTransportFailure(err);
  if (failure) {
    if (failure.status === 429 || failure.code === 'RATE_LIMITED') {
      return 'rate-limited';
    }
    // status 0 is the client's own "no response arrived" — network_error or
    // timeout. It is the only case where "check your connection" is honest.
    if (failure.status === 0) return 'offline';
    if (failure.status === 401 || failure.status === 403) {
      return 'no-credential';
    }
    if (failure.status >= 500) return 'server';
    return 'unknown';
  }

  // WebAuthn rejects through DOMException, whose `name` carries the meaning.
  // NotAllowedError covers both "the user closed the sheet" and "there was
  // nothing on this device to offer" — the browser refuses to distinguish
  // them, on purpose, so neither may we.
  const name = (err as { name?: unknown } | null)?.name;
  // Checked before the DOMException names: a prompt that never appeared is
  // not a prompt that was refused, and `withTimeout` is the only thing that
  // can tell the difference.
  if (name === 'PasskeyTimeoutError') return 'no-prompt';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  if (name === 'NotSupportedError' || name === 'SecurityError') {
    return 'unsupported';
  }

  return 'unknown';
}
