import { describe, it, expect } from 'vitest';
import {
  encryptField,
  decryptField,
  rewrapField,
  isEncryptedField,
  encryptedFieldKekVersion,
  CredentialConfigError,
  CredentialDecryptionError,
  type KekEnv,
} from '../src/crypto/plaidCredentials.js';

/**
 * Envelope encryption for plaid_credentials.client_id/secret. The bug this
 * guards against: Plaid credentials sitting in D1 as plaintext. These tests
 * cover the three things the fix promises — round-trip, rejected
 * tampering, and fail-closed on a bad/unknown key — plus rotation.
 */

const KEY_V1 = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const KEY_V2 = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');

function env(overrides: Partial<KekEnv> = {}): KekEnv {
  return {
    PLAID_CREDENTIALS_KEKS: JSON.stringify({ '1': KEY_V1, '2': KEY_V2 }),
    PLAID_CREDENTIALS_KEK_CURRENT: '1',
    ...overrides,
  };
}

describe('isEncryptedField / encryptedFieldKekVersion', () => {
  it('recognizes legacy plaintext as not encrypted', () => {
    expect(isEncryptedField('sandbox-client-id-123')).toBe(false);
    expect(encryptedFieldKekVersion('sandbox-client-id-123')).toBeNull();
  });

  it('recognizes an encrypted value and reads its key version', async () => {
    const enc = await encryptField(env(), 'my-secret');
    expect(isEncryptedField(enc)).toBe(true);
    expect(encryptedFieldKekVersion(enc)).toBe('1');
  });
});

describe('encryptField / decryptField — round trip', () => {
  it('decrypts back to the exact original plaintext', async () => {
    const plaintext = 'sk_live_abcDEF123!@#';
    const enc = await encryptField(env(), plaintext);
    expect(enc.startsWith('pbenc:v1:')).toBe(true);
    expect(enc).not.toContain(plaintext);
    const dec = await decryptField(env(), enc);
    expect(dec).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext each time (random IV/DEK)', async () => {
    const a = await encryptField(env(), 'same-value');
    const b = await encryptField(env(), 'same-value');
    expect(a).not.toBe(b);
    expect(await decryptField(env(), a)).toBe('same-value');
    expect(await decryptField(env(), b)).toBe('same-value');
  });

  it('round-trips empty and unicode values', async () => {
    for (const value of ['', 'clé-sécrète-é€', '   padded   ']) {
      const enc = await encryptField(env(), value);
      expect(await decryptField(env(), enc)).toBe(value);
    }
  });

  it('is an identity function for legacy plaintext (not yet migrated)', async () => {
    expect(await decryptField(env(), 'plain-old-client-id')).toBe('plain-old-client-id');
  });
});

describe('decryptField — rejects tampering (fails closed)', () => {
  it('throws on a flipped character in the ciphertext', async () => {
    const enc = await encryptField(env(), 'top-secret');
    const parts = enc.split(':');
    const last = parts[6]!;
    parts[6] = (last[0] === 'A' ? 'B' : 'A') + last.slice(1);
    const tampered = parts.join(':');
    await expect(decryptField(env(), tampered)).rejects.toThrow(CredentialDecryptionError);
  });

  it('throws on a tampered wrapped-DEK', async () => {
    const enc = await encryptField(env(), 'top-secret');
    const parts = enc.split(':');
    const wrapped = parts[4]!;
    parts[4] = (wrapped[0] === 'A' ? 'B' : 'A') + wrapped.slice(1);
    await expect(decryptField(env(), parts.join(':'))).rejects.toThrow(CredentialDecryptionError);
  });

  it('throws on a malformed envelope (wrong number of fields)', async () => {
    await expect(decryptField(env(), 'pbenc:v1:1:onlyfourfields')).rejects.toThrow(
      CredentialDecryptionError,
    );
  });

  it('throws — not silently returns plaintext — when the key version is unknown (e.g. a retired key removed too early)', async () => {
    const enc = await encryptField(env({ PLAID_CREDENTIALS_KEK_CURRENT: '2' }), 'secret-under-v2');
    // Simulate v2 having been removed from the key map.
    await expect(
      decryptField(env({ PLAID_CREDENTIALS_KEKS: JSON.stringify({ '1': KEY_V1 }) }), enc),
    ).rejects.toThrow(CredentialDecryptionError);
  });
});

describe('fail-closed configuration errors', () => {
  it('encryptField throws if no KEKS are configured', async () => {
    await expect(encryptField({}, 'value')).rejects.toThrow(CredentialConfigError);
  });

  it('encryptField throws if PLAID_CREDENTIALS_KEK_CURRENT is unset', async () => {
    await expect(
      encryptField({ PLAID_CREDENTIALS_KEKS: JSON.stringify({ '1': KEY_V1 }) }, 'value'),
    ).rejects.toThrow(CredentialConfigError);
  });

  it('encryptField throws if the current version key is missing from the map', async () => {
    await expect(
      encryptField(env({ PLAID_CREDENTIALS_KEK_CURRENT: '99' }), 'value'),
    ).rejects.toThrow(CredentialConfigError);
  });

  it('encryptField throws if a key is not 32 bytes when decoded', async () => {
    await expect(
      encryptField(
        env({ PLAID_CREDENTIALS_KEKS: JSON.stringify({ '1': 'dG9vc2hvcnQ=' }) }),
        'value',
      ),
    ).rejects.toThrow(CredentialConfigError);
  });

  it('encryptField throws on invalid JSON in PLAID_CREDENTIALS_KEKS', async () => {
    await expect(
      encryptField(
        { PLAID_CREDENTIALS_KEKS: '{not json', PLAID_CREDENTIALS_KEK_CURRENT: '1' },
        'v',
      ),
    ).rejects.toThrow(CredentialConfigError);
  });
});

describe('rewrapField — key rotation', () => {
  it('re-wraps the DEK under the new current version without changing the decrypted value', async () => {
    const enc = await encryptField(env(), 'rotate-me');
    expect(encryptedFieldKekVersion(enc)).toBe('1');

    const rotatedEnv = env({ PLAID_CREDENTIALS_KEK_CURRENT: '2' });
    const rewrapped = await rewrapField(rotatedEnv, enc);
    expect(encryptedFieldKekVersion(rewrapped)).toBe('2');
    expect(await decryptField(rotatedEnv, rewrapped)).toBe('rotate-me');
  });

  it('leaves the ciphertext (data IV + ciphertext) untouched — only the wrapped DEK changes', async () => {
    const enc = await encryptField(env(), 'rotate-me');
    const [, , , , , dataIv, ciphertext] = enc.split(':');

    const rotatedEnv = env({ PLAID_CREDENTIALS_KEK_CURRENT: '2' });
    const rewrapped = await rewrapField(rotatedEnv, enc);
    const [, , , , , newDataIv, newCiphertext] = rewrapped.split(':');

    expect(newDataIv).toBe(dataIv);
    expect(newCiphertext).toBe(ciphertext);
  });

  it('is a no-op when already wrapped under the current version', async () => {
    const enc = await encryptField(env(), 'already-current');
    const rewrapped = await rewrapField(env(), enc);
    expect(rewrapped).toBe(enc);
  });

  it('throws if the retired key version needed to unwrap is no longer configured', async () => {
    const enc = await encryptField(env(), 'orphaned');
    const rotatedEnvMissingOld = env({
      PLAID_CREDENTIALS_KEKS: JSON.stringify({ '2': KEY_V2 }),
      PLAID_CREDENTIALS_KEK_CURRENT: '2',
    });
    await expect(rewrapField(rotatedEnvMissingOld, enc)).rejects.toThrow(CredentialDecryptionError);
  });
});
