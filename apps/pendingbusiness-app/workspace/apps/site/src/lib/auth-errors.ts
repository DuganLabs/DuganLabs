/**
 * Plain-language descriptions for passkey ceremony failures.
 *
 * `@basenative/auth-webauthn/client` throws `Error(msg)` where `msg` is the
 * worker's `{ error }` code verbatim (`user-not-found`, `bad-handle`, …),
 * and the browser's WebAuthn layer throws `DOMException`s whose messages
 * are written for developers ("The authenticator was previously
 * registered"). Neither is fit to show a person as-is, so every status
 * line on /login and /account runs through `describeAuthError`.
 */

const CODES: Readonly<Record<string, string>> = {
  'user-not-found':
    'No passkey is enrolled for that handle. Leave it blank to pick one from your device, or set one up on the Account page.',
  'enrollment-closed':
    'No account exists for that handle. PendingBusiness is invitation-only — use the handle you were given.',
  'bad-handle': 'Handle must be 2-24 chars: a-z, 0-9, _, -',
  'challenge-not-found': 'That attempt expired. Try again.',
  'not-verified': "Couldn't verify that passkey. Try again.",
  'missing-attestation': "Couldn't read the passkey response. Try again.",
  'missing-assertion': "Couldn't read the passkey response. Try again.",
};

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/previously registered/i, 'This device already has a passkey for this account.'],
  [/^verification-failed/i, "Couldn't verify that passkey. Try again."],
  [/^request-failed-(\d+)$/i, 'The server returned an error (HTTP $1). Try again.'],
  [/timed out/i, 'Request timed out. Check your connection and try again.'],
];

/** Browser-side cancellation / timeout of the OS passkey prompt. */
const CANCELLED = 'Passkey prompt was cancelled or timed out. Try again.';

export function describeAuthError(err: unknown, fallback: string): string {
  // Duck-type rather than `instanceof Error`: a DOMException raised inside
  // the WebAuthn layer (or across a realm boundary) still carries
  // `message` / `name` but need not share our Error prototype.
  const { message, name } = readError(err);
  if (message === null) return fallback;
  const code = CODES[message];
  if (code) return code;
  // A cancelled / timed-out OS prompt is identified by its DOMException
  // name; its message also mentions "timed out", so decide on the name
  // before the generic text patterns get a look.
  if (name === 'NotAllowedError' || name === 'AbortError') return CANCELLED;
  for (const [rx, text] of PATTERNS) {
    const match = rx.exec(message);
    // The whole message is replaced; `$1` in `text` receives the capture.
    if (match) return text.replace('$1', match[1] ?? '');
  }
  return fallback;
}

function readError(err: unknown): { message: string | null; name: string } {
  if (typeof err !== 'object' || err === null) return { message: null, name: '' };
  const { message, name } = err as { message?: unknown; name?: unknown };
  return {
    message: typeof message === 'string' ? message.trim() : null,
    name: typeof name === 'string' ? name : '',
  };
}
