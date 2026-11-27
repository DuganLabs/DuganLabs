/**
 * Envelope encryption for the `client_id` / `secret` columns of
 * `plaid_credentials` (see migrations/0003_plaid.sql). These are the
 * operator's Plaid API key pair — app-level configuration, not per-user
 * data — but they are bearer credentials against a real bank-data API, so
 * they must never sit in D1 as plaintext.
 *
 * Envelope encryption, not "just AES-GCM with one key":
 *   - Each field gets its own random 256-bit Data Encryption Key (DEK).
 *   - The DEK encrypts the actual value (AES-GCM, random 96-bit IV).
 *   - The DEK is itself encrypted ("wrapped") by a root Key Encryption Key
 *     (KEK) that lives only in the Worker environment (AES-GCM, its own
 *     random IV).
 *   - Both ciphertexts, both IVs, and the KEK's version id are packed into
 *     one delimited string and stored in the existing TEXT column — no
 *     schema change needed.
 *
 * Why envelope (vs. encrypting the field directly with the KEK): rotating
 * the KEK only requires re-wrapping the tiny DEK (see `rewrapField`), never
 * re-encrypting the value itself. For this table that's academic (two
 * short strings), but it's the correct, boring pattern and it's what
 * "documented rotation path" below relies on.
 *
 * Wire format (all fields base64, joined by ':'):
 *   pbenc:v1:<kekVersion>:<wrapIv>:<wrappedDek>:<dataIv>:<ciphertext>
 *
 * Key configuration (Worker runtime secret, set outside CI by
 * scripts/set-plaid-secret.sh from the unsynced Doppler project
 * `pendingbusiness-runtime`; never in GitHub secrets, CI, or the repo.
 * See docs/PLAID-SECRETS.md):
 *   - PLAID_CREDENTIALS_KEKS         JSON object mapping key-version (string)
 *                                    -> base64-encoded 32-byte (256-bit) AES key.
 *                                    e.g. {"1": "<base64>"}
 *   - PLAID_CREDENTIALS_KEK_CURRENT  Which version new writes should wrap
 *                                    under, e.g. "1". Not secret by itself,
 *                                    but kept alongside PLAID_CREDENTIALS_KEKS
 *                                    for convenience.
 *
 * Rotation path:
 *   1. Generate a new key:            openssl rand -base64 32
 *   2. Update PLAID_CREDENTIALS_KEKS in Doppler `pendingbusiness-runtime/prd`
 *      to add the new version, keeping the old version(s) present — e.g.
 *      {"1": "<old>", "2": "<new>"}. Old rows must stay decryptable until
 *      step 4.
 *      Then run scripts/set-plaid-secret.sh to put it on the Worker.
 *   3. Bump PLAID_CREDENTIALS_KEK_CURRENT in wrangler.toml to the new
 *      version ("2") and deploy. New writes (postPlaidCredentials) now wrap
 *      under "2"; existing rows are untouched and still wrapped under "1".
 *   4. Run `worker/scripts/rewrap-plaid-credentials.ts` against the target
 *      D1 (see that file) to re-wrap every existing row's DEK under the
 *      new current version. This only touches the (small) wrapped-DEK
 *      field — the encrypted client_id/secret ciphertext is untouched.
 *   5. Once every row reports the new version (the script prints this),
 *      remove the retired version in Doppler and run
 *      scripts/set-plaid-secret.sh again.
 *
 * Failure mode: if a stored value carries the `pbenc:v1:` prefix but fails
 * to decrypt (wrong/missing key version, truncated value, tampering — the
 * AES-GCM auth tag won't verify), decryptField throws
 * CredentialDecryptionError. Callers must let this propagate as an error,
 * never fall back to treating the raw stored value as usable — see
 * worker/src/plaid.ts's readCredentialsRow.
 */

const SCHEME = 'pbenc';
const FORMAT_VERSION = 'v1';
const PREFIX = `${SCHEME}:${FORMAT_VERSION}:`;
const AES_GCM = 'AES-GCM';
const IV_BYTES = 12;
const DEK_BYTES = 32;

export interface KekEnv {
  PLAID_CREDENTIALS_KEKS?: string;
  PLAID_CREDENTIALS_KEK_CURRENT?: string;
}

export class CredentialConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialConfigError';
  }
}

export class CredentialDecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CredentialDecryptionError';
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function parseKeks(env: KekEnv): Record<string, string> {
  if (!env.PLAID_CREDENTIALS_KEKS) {
    throw new CredentialConfigError(
      'PLAID_CREDENTIALS_KEKS is not configured. Set it as a Worker secret ' +
        '(JSON map of key-version -> base64 32-byte AES-256 key) before ' +
        'reading or writing Plaid credentials.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.PLAID_CREDENTIALS_KEKS);
  } catch {
    throw new CredentialConfigError('PLAID_CREDENTIALS_KEKS is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CredentialConfigError(
      'PLAID_CREDENTIALS_KEKS must be a JSON object of {"version": "base64key"}.',
    );
  }
  return parsed as Record<string, string>;
}

async function importKek(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key);
  if (raw.length !== DEK_BYTES) {
    throw new CredentialConfigError(
      `Each PLAID_CREDENTIALS_KEKS value must be a base64-encoded ${DEK_BYTES}-byte (256-bit) AES key.`,
    );
  }
  return crypto.subtle.importKey('raw', raw, AES_GCM, false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: AES_GCM, iv }, key, plaintext);
  return { iv, ciphertext: new Uint8Array(ct) };
}

async function aesDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt({ name: AES_GCM, iv }, key, ciphertext);
  return new Uint8Array(pt);
}

function currentKek(
  env: KekEnv,
  keks: Record<string, string>,
): { version: string; base64: string } {
  const version = env.PLAID_CREDENTIALS_KEK_CURRENT;
  if (!version) {
    throw new CredentialConfigError('PLAID_CREDENTIALS_KEK_CURRENT is not configured.');
  }
  const base64 = keks[version];
  if (!base64) {
    throw new CredentialConfigError(
      `PLAID_CREDENTIALS_KEK_CURRENT points to version "${version}", which is not present in PLAID_CREDENTIALS_KEKS.`,
    );
  }
  return { version, base64 };
}

/** True if `value` is already in our envelope-encrypted wire format. */
export function isEncryptedField(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Returns the KEK version a stored value was wrapped under, or null if it isn't encrypted. */
export function encryptedFieldKekVersion(value: string): string | null {
  if (!isEncryptedField(value)) return null;
  const parts = value.split(':');
  return parts.length === 7 ? parts[2]! : null;
}

interface Envelope {
  kekVersion: string;
  wrapIv: string;
  wrappedDek: string;
  dataIv: string;
  ciphertext: string;
}

function parseEnvelope(value: string): Envelope {
  const parts = value.split(':');
  if (parts.length !== 7 || parts[0] !== SCHEME || parts[1] !== FORMAT_VERSION) {
    throw new CredentialDecryptionError(
      'Stored Plaid credential has an unrecognized envelope format.',
    );
  }
  const [, , kekVersion, wrapIv, wrappedDek, dataIv, ciphertext] = parts;
  return {
    kekVersion: kekVersion!,
    wrapIv: wrapIv!,
    wrappedDek: wrappedDek!,
    dataIv: dataIv!,
    ciphertext: ciphertext!,
  };
}

/**
 * Encrypt a plaintext field under the current KEK version, generating a
 * fresh per-value DEK. Fails closed (throws) if no key is configured —
 * callers must never fall back to storing the plaintext.
 */
export async function encryptField(env: KekEnv, plaintext: string): Promise<string> {
  const keks = parseKeks(env);
  const { version, base64 } = currentKek(env, keks);
  const kek = await importKek(base64);

  const dekRaw = crypto.getRandomValues(new Uint8Array(DEK_BYTES));
  const dek = await crypto.subtle.importKey('raw', dekRaw, AES_GCM, false, ['encrypt', 'decrypt']);

  const data = await aesEncrypt(dek, new TextEncoder().encode(plaintext));
  const wrap = await aesEncrypt(kek, dekRaw);

  return [
    SCHEME,
    FORMAT_VERSION,
    version,
    bytesToBase64(wrap.iv),
    bytesToBase64(wrap.ciphertext),
    bytesToBase64(data.iv),
    bytesToBase64(data.ciphertext),
  ].join(':');
}

/**
 * Decrypt a stored field. If `stored` predates encryption (no `pbenc:v1:`
 * prefix), it is returned unchanged — callers are responsible for treating
 * that as a legacy-plaintext row and migrating it (see
 * worker/src/plaid.ts's readCredentialsRow).
 *
 * If `stored` IS tagged as encrypted but fails to decrypt — wrong/retired
 * key version, truncated value, or a failed AES-GCM auth tag (tampering) —
 * this throws CredentialDecryptionError. That failure must propagate as an
 * error response, never as a silent plaintext fallback.
 */
export async function decryptField(env: KekEnv, stored: string): Promise<string> {
  if (!isEncryptedField(stored)) return stored;

  const envelope = parseEnvelope(stored);
  const keks = parseKeks(env);
  const kekB64 = keks[envelope.kekVersion];
  if (!kekB64) {
    throw new CredentialDecryptionError(
      `Cannot decrypt stored Plaid credential: key version "${envelope.kekVersion}" is not present in ` +
        'PLAID_CREDENTIALS_KEKS. If you rotated keys, keep retired versions configured until every row has been re-wrapped.',
    );
  }

  try {
    const kek = await importKek(kekB64);
    const dekRaw = await aesDecrypt(
      kek,
      base64ToBytes(envelope.wrapIv),
      base64ToBytes(envelope.wrappedDek),
    );
    const dek = await crypto.subtle.importKey('raw', dekRaw, AES_GCM, false, [
      'encrypt',
      'decrypt',
    ]);
    const plaintext = await aesDecrypt(
      dek,
      base64ToBytes(envelope.dataIv),
      base64ToBytes(envelope.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch (err) {
    if (err instanceof CredentialConfigError) throw err;
    throw new CredentialDecryptionError(
      'Failed to decrypt stored Plaid credential — it may be corrupted, tampered with, or encrypted under a key ' +
        'that is no longer configured.',
      { cause: err },
    );
  }
}

/**
 * Re-wrap an already-encrypted field's DEK under the current KEK version,
 * without touching the encrypted value itself. A no-op if the field is
 * already wrapped under the current version. Used by the key-rotation
 * script (worker/scripts/rewrap-plaid-credentials.ts) — never called from
 * request-handling code.
 */
export async function rewrapField(env: KekEnv, stored: string): Promise<string> {
  const envelope = parseEnvelope(stored);
  const keks = parseKeks(env);
  const { version: currentVersion, base64: newKekB64 } = currentKek(env, keks);
  if (envelope.kekVersion === currentVersion) return stored;

  const oldKekB64 = keks[envelope.kekVersion];
  if (!oldKekB64) {
    throw new CredentialDecryptionError(
      `Cannot rewrap: retired key version "${envelope.kekVersion}" is not present in PLAID_CREDENTIALS_KEKS.`,
    );
  }

  let dekRaw: Uint8Array;
  try {
    const oldKek = await importKek(oldKekB64);
    dekRaw = await aesDecrypt(
      oldKek,
      base64ToBytes(envelope.wrapIv),
      base64ToBytes(envelope.wrappedDek),
    );
  } catch (err) {
    throw new CredentialDecryptionError(
      'Failed to unwrap DEK during rotation — check the retired key value.',
      {
        cause: err,
      },
    );
  }

  const newKek = await importKek(newKekB64);
  const wrap = await aesEncrypt(newKek, dekRaw);

  return [
    SCHEME,
    FORMAT_VERSION,
    currentVersion,
    bytesToBase64(wrap.iv),
    bytesToBase64(wrap.ciphertext),
    envelope.dataIv,
    envelope.ciphertext,
  ].join(':');
}
