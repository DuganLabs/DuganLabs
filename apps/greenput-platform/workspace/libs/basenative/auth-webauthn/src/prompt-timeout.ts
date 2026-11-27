/**
 * A promise that is allowed to never settle, made to settle.
 *
 * `navigator.credentials.create()` and `.get()` carry no timeout of their
 * own, and on a device with nothing usable to offer some browsers show no
 * prompt and never reject — the call simply does not come back. Every screen
 * that awaited one therefore had a state it could enter and never leave:
 * Settings → Security sat on "Adding…" for as long as the tab stayed open,
 * telling someone who had no passkey that one was on its way.
 *
 * This lives next to the calls it guards, in the library, rather than in one
 * route, because the hang is a property of the WebAuthn call and not of any
 * particular screen. `createAuthStore` applies it to both modal calls so a
 * caller cannot forget to.
 */

/**
 * How long to wait for a passkey sheet before deciding one is not coming.
 *
 * A judgement call, not a security boundary. Touch ID, Windows Hello and a
 * phone-as-authenticator hand-off all resolve well inside this; the number is
 * chosen to be longer than a slow human and shorter than "forever", which is
 * what it replaced.
 */
export const PASSKEY_PROMPT_TIMEOUT_MS = 90_000;

/**
 * Rejection type for a passkey prompt that never appeared.
 *
 * A distinct type because it is a distinct thing to tell a user. A
 * `NotAllowedError` means the prompt appeared and nothing came of it; this
 * means no prompt appeared at all, which points at the device rather than at
 * the person. `classifyAuthError` maps it to `'no-prompt'`.
 */
export class PasskeyTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    // Set explicitly: the class name does not survive minification, and
    // `name` is what the classifier reads.
    this.name = 'PasskeyTimeoutError';
  }
}

/**
 * Resolve/reject with `promise`, or reject with a `PasskeyTimeoutError`
 * carrying `message` if it has not settled within `ms`.
 *
 * `ms <= 0` disables the timeout and returns `promise` untouched — the escape
 * hatch for conditional mediation, which is *supposed* to stay pending until
 * the user touches the autofill field.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  if (!(ms > 0)) return promise;
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new PasskeyTimeoutError(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}
