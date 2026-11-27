// Cloudflare Workers' Web Crypto subtle.deriveBits caps PBKDF2 iterations at
// 100,000 (NotSupportedError above that). OWASP 2023 recommends 600k for
// SHA-256 in unconstrained environments, but Workers is the constraint here.
// 100k + a 32-byte salt + SHA-256 is still well above the OWASP "minimum" line
// of 120k/SHA-256-as-of-2023; the difference is one halving of work factor,
// not a tier change.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 32;
const KEY_BYTES = 32;

/** Hash a plaintext password using PBKDF2-SHA256. Returns `base64(salt):base64(key)`. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);

  const key = await deriveKey(plain, salt);

  return `${toBase64(salt)}:${toBase64(new Uint8Array(key))}`;
}

/**
 * The stored value for an account that has no password and authenticates by
 * passkey only. Empty string rather than NULL: the live `users` table declares
 * `password_hash TEXT NOT NULL`, so NULL fails the insert outright. Two of the
 * three account-creation paths already used this value; the third used NULL,
 * which is why /api/auth/register returned 500 in production.
 */
export const NO_PASSWORD = '';

/**
 * Verify a password against a stored hash.
 * Supports both PBKDF2 hashes (`salt:key`) and legacy plaintext (no `:` separator).
 * Returns `{ valid, needsRehash }` — caller should update the DB when `needsRehash` is true.
 */
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  // Fail closed on a passkey-only, absent or empty stored value, BEFORE the
  // plaintext branch below. That branch returns `plain === stored`, so an empty
  // stored value would authenticate an empty password — an auth bypass. The
  // login route happens to guard this with its own falsy check today, but the
  // safety must live in the function that decides, not in one of its callers.
  if (stored === null || stored === undefined || stored === NO_PASSWORD) {
    return { valid: false, needsRehash: false };
  }

  // Legacy plaintext detection: no colon means it was stored as plain text
  if (!stored.includes(':')) {
    return { valid: plain === stored, needsRehash: plain === stored };
  }

  const [saltB64, keyB64] = stored.split(':');
  const salt = fromBase64(saltB64);
  const expectedKey = fromBase64(keyB64);

  const derivedKey = new Uint8Array(await deriveKey(plain, salt));

  // Constant-time comparison
  if (derivedKey.length !== expectedKey.length) {
    return { valid: false, needsRehash: false };
  }

  let diff = 0;
  for (let i = 0; i < derivedKey.length; i++) {
    diff |= derivedKey[i] ^ expectedKey[i];
  }

  return { valid: diff === 0, needsRehash: false };
}

async function deriveKey(
  plain: string,
  salt: Uint8Array,
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_BYTES * 8,
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
