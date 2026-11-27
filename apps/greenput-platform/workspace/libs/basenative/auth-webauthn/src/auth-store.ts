import { signal, computed, type Signal } from '@basenative/runtime';
import { ApiError, type ApiClient } from '@basenative/fetch';
import {
  isConditionalMediationAvailable,
  isWebAuthnAvailable,
} from './feature-detect.js';
import {
  createWebAuthnClient,
  type WebAuthnClient,
  type WebAuthnClientOptions,
} from './webauthn-client.js';
import { classifyAuthError, type AuthErrorKind } from './error-kind.js';
import { PASSKEY_PROMPT_TIMEOUT_MS, withTimeout } from './prompt-timeout.js';
import type { AuthUser } from './types.js';

export interface AuthStoreOptions<TUser = AuthUser> {
  readonly api: ApiClient;
  readonly webauthn?: WebAuthnClient<TUser>;
  readonly webauthnLoader?: WebAuthnClientOptions['loadSimpleWebAuthn'];
  readonly redirectAfterLogin?: (user: TUser) => void | Promise<void>;
  readonly redirectAfterLogout?: () => void | Promise<void>;
  readonly initials?: (user: TUser) => string;
  readonly displayName?: (user: TUser) => string;
}

/** Per-attempt knobs for the two calls that open a passkey sheet. */
export interface PasskeyAttemptOptions {
  /**
   * How long to wait for the sheet before giving up, in milliseconds.
   * Defaults to `PASSKEY_PROMPT_TIMEOUT_MS`. Pass `0` to wait forever — only
   * correct for conditional mediation, which the store never times out.
   */
  readonly timeoutMs?: number;
}

export interface AuthStore<TUser = AuthUser> {
  readonly user: Signal<TUser | null>;
  readonly isAuthenticated: Signal<boolean>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<string | null>;
  /**
   * Why the last attempt failed, in terms a screen can act on. `error` is the
   * raw transport message (useful in a console, not to a contractor); this is
   * the part a route should branch on. Null whenever `error` is null.
   */
  readonly errorKind: Signal<AuthErrorKind | null>;
  readonly sessionChecked: Signal<boolean>;
  readonly initials: Signal<string>;
  readonly displayName: Signal<string>;

  loginWithPasskey(options?: PasskeyAttemptOptions): Promise<boolean>;
  startConditionalPasskey(): Promise<boolean>;
  abortConditionalPasskey(): void;
  enrollPasskey(options?: PasskeyAttemptOptions): Promise<void>;
  logout(): Promise<void>;
  checkSession(): Promise<TUser | null>;
  /**
   * Re-read `/api/auth/me`, ignoring the cache `checkSession()` honours.
   *
   * `checkSession()` answers "have we ever asked?" and the router guard leans
   * on that to avoid a round-trip per navigation. It had no invalidation
   * path, so anything that created or destroyed a session *outside* the store
   * left it asserting the opposite of the truth — and the guard believed it.
   * That is the whole of the "Go to dashboard" bounce: the boot-time check
   * 401s on a fresh browser, caches `sessionChecked = true` with `user =
   * null`, and then `/api/auth/register` sets a perfectly good cookie that
   * nothing ever looks at again. Call this at the moment the session changes
   * under the store.
   */
  refreshSession(): Promise<TUser | null>;
  setUser(user: TUser | null): void;
  clearError(): void;
}

interface MeEnvelope<TUser> {
  data: { user: TUser };
}

function defaultInitials(user: AuthUser): string {
  const a = user.firstName?.[0] ?? '';
  const b = user.lastName?.[0] ?? '';
  return `${a}${b}`.toUpperCase();
}

function defaultDisplayName(user: AuthUser): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === 'string') return err;
  return fallback;
}

/**
 * Creates a signal-based authentication store backed by passkeys. Mirrors the
 * shape of the Angular `AuthStore` so feature components can swap to
 * BaseNative without changing call sites: `user()`, `isAuthenticated()`,
 * `loginWithPasskey()`, `enrollPasskey()`, `checkSession()`, `logout()`.
 */
export function createAuthStore<TUser extends AuthUser = AuthUser>(
  options: AuthStoreOptions<TUser>,
): AuthStore<TUser> {
  const _user: Signal<TUser | null> = signal<TUser | null>(null);
  const _loading: Signal<boolean> = signal(false);
  const _error: Signal<string | null> = signal<string | null>(null);
  const _errorKind: Signal<AuthErrorKind | null> = signal<AuthErrorKind | null>(
    null,
  );
  const _sessionChecked: Signal<boolean> = signal(false);

  /** Set both halves of the error state together so they can never disagree. */
  function setError(err: unknown, fallback: string): void {
    _error.set(errorMessage(err, fallback));
    _errorKind.set(classifyAuthError(err));
  }

  const webauthn =
    options.webauthn ??
    createWebAuthnClient<TUser>({
      api: options.api,
      loadSimpleWebAuthn: options.webauthnLoader,
    });

  const isAuthenticated = computed(() => _user() !== null);
  const initialsResolver =
    options.initials ?? (defaultInitials as (user: TUser) => string);
  const displayNameResolver =
    options.displayName ?? (defaultDisplayName as (user: TUser) => string);
  const initials = computed(() => {
    const u = _user();
    return u ? initialsResolver(u) : '';
  });
  const displayName = computed(() => {
    const u = _user();
    return u ? displayNameResolver(u) : '';
  });

  function setUser(user: TUser | null): void {
    _user.set(user);
  }

  function clearError(): void {
    _error.set(null);
    _errorKind.set(null);
  }

  async function afterLogin(user: TUser): Promise<void> {
    _user.set(user);
    if (options.redirectAfterLogin) await options.redirectAfterLogin(user);
  }

  async function loginWithPasskey(
    attempt: PasskeyAttemptOptions = {},
  ): Promise<boolean> {
    _loading.set(true);
    clearError();
    try {
      const user = await withTimeout(
        webauthn.authenticate(),
        attempt.timeoutMs ?? PASSKEY_PROMPT_TIMEOUT_MS,
        'No passkey prompt appeared.',
      );
      await afterLogin(user);
      return true;
    } catch (err) {
      setError(err, 'Passkey authentication failed.');
      return false;
    } finally {
      _loading.set(false);
    }
  }

  async function startConditionalPasskey(): Promise<boolean> {
    if (!isWebAuthnAvailable()) return false;
    if (!(await isConditionalMediationAvailable())) return false;
    try {
      const user = await webauthn.authenticateConditional();
      await afterLogin(user);
      return true;
    } catch {
      return false;
    }
  }

  function abortConditionalPasskey(): void {
    webauthn.abortConditional();
  }

  async function enrollPasskey(
    attempt: PasskeyAttemptOptions = {},
  ): Promise<void> {
    _loading.set(true);
    clearError();
    try {
      // The timeout is inside the store, not around the call site, so
      // `loading` and `error` always settle with it. A route that raced its
      // own timer against this promise would leave the store stuck on
      // `loading = true` and then set an error minutes later, over whatever
      // the user had moved on to.
      await withTimeout(
        webauthn.register(),
        attempt.timeoutMs ?? PASSKEY_PROMPT_TIMEOUT_MS,
        'No passkey prompt appeared.',
      );
    } catch (err) {
      setError(
        err,
        'Passkey enrollment failed. You can add one later from settings.',
      );
      throw err;
    } finally {
      _loading.set(false);
    }
  }

  async function logout(): Promise<void> {
    try {
      await options.api.post('/api/auth/logout', {});
    } catch {
      // Logout is best-effort; we always clear local state below.
    }
    _user.set(null);
    if (options.redirectAfterLogout) await options.redirectAfterLogout();
  }

  /** The actual round-trip. Always asks; always marks the cache filled. */
  /**
   * Read /api/auth/me, and be honest about the difference between "there is no
   * session" and "I could not find out".
   *
   * This used to swallow every failure into `_user = null` and set
   * `_sessionChecked = true` in a `finally`, so a 500 or a dropped connection
   * was recorded as an authoritative "signed out" — and the router guard, whose
   * whole job is to read those two signals, then bounced a signed-in user to
   * /login with nothing on screen to explain it. Reproduced: one injected 500
   * on the post-register /me, and a person who had just enrolled a passkey
   * pressed "Go to dashboard" and landed on the sign-in page.
   *
   * A 401/403 is an answer: the server looked and there is no session. Anything
   * else — 5xx, or `status === 0`, which @basenative/fetch uses for "no
   * response at all" — is not an answer, so the cache is left unset and the
   * next caller asks again rather than inheriting a guess.
   */
  async function readSession(): Promise<TUser | null> {
    try {
      const res = await options.api.get<MeEnvelope<TUser>>('/api/auth/me');
      _user.set(res.data.user);
      _sessionChecked.set(true);
      return res.data.user;
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const answered = status === 401 || status === 403;
      _user.set(null);
      if (answered) _sessionChecked.set(true);
      return null;
    }
  }

  async function checkSession(): Promise<TUser | null> {
    if (_sessionChecked()) return _user();
    return readSession();
  }

  async function refreshSession(): Promise<TUser | null> {
    return readSession();
  }

  return {
    user: _user,
    isAuthenticated,
    loading: _loading,
    error: _error,
    errorKind: _errorKind,
    sessionChecked: _sessionChecked,
    initials,
    displayName,
    loginWithPasskey,
    startConditionalPasskey,
    abortConditionalPasskey,
    enrollPasskey,
    logout,
    checkSession,
    refreshSession,
    setUser,
    clearError,
  };
}
