import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, NO_PASSWORD } from './password';

describe('password', () => {
  describe('hashPassword', () => {
    it('produces a salt:key format', async () => {
      const hash = await hashPassword('test-password');
      expect(hash).toContain(':');
      const [salt, key] = hash.split(':');
      expect(salt.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    });

    it('produces different hashes for the same password', async () => {
      const h1 = await hashPassword('same-password');
      const h2 = await hashPassword('same-password');
      expect(h1).not.toBe(h2);
    });

    it('produces exactly two colon-separated parts', async () => {
      const hash = await hashPassword('password');
      const parts = hash.split(':');
      expect(parts.length).toBe(2);
    });

    it('both parts are valid base64', async () => {
      const hash = await hashPassword('password');
      const [salt, key] = hash.split(':');
      expect(() => atob(salt)).not.toThrow();
      expect(() => atob(key)).not.toThrow();
    });

    it('handles empty string password', async () => {
      const hash = await hashPassword('');
      expect(hash).toContain(':');
      const result = await verifyPassword('', hash);
      expect(result.valid).toBe(true);
    });

    it('handles unicode password', async () => {
      const unicode = 'p@$$w0rd🔑Ünïcödé';
      const hash = await hashPassword(unicode);
      const result = await verifyPassword(unicode, hash);
      expect(result.valid).toBe(true);
    });

    it('handles a very long password', async () => {
      const longPwd = 'a'.repeat(10000);
      const hash = await hashPassword(longPwd);
      const result = await verifyPassword(longPwd, hash);
      expect(result.valid).toBe(true);
    });
  });

  describe('verifyPassword', () => {
    it('verifies a correct password', async () => {
      const hash = await hashPassword('my-secret');
      const result = await verifyPassword('my-secret', hash);
      expect(result.valid).toBe(true);
      expect(result.needsRehash).toBe(false);
    });

    it('rejects an incorrect password', async () => {
      const hash = await hashPassword('my-secret');
      const result = await verifyPassword('wrong-password', hash);
      expect(result.valid).toBe(false);
    });

    it('handles legacy plaintext passwords', async () => {
      const result = await verifyPassword('plaintext123', 'plaintext123');
      expect(result.valid).toBe(true);
      expect(result.needsRehash).toBe(true);
    });

    it('rejects wrong legacy plaintext passwords', async () => {
      const result = await verifyPassword('wrong', 'plaintext123');
      expect(result.valid).toBe(false);
      expect(result.needsRehash).toBe(false);
    });

    it('always returns needsRehash=false for PBKDF2 hashed passwords', async () => {
      const hash = await hashPassword('secure-pass');
      const result = await verifyPassword('secure-pass', hash);
      expect(result.needsRehash).toBe(false);
    });

    it('is case-sensitive for PBKDF2 passwords', async () => {
      const hash = await hashPassword('Secret123');
      const result = await verifyPassword('secret123', hash);
      expect(result.valid).toBe(false);
    });

    it('different passwords produce different verified states', async () => {
      const hash = await hashPassword('alpha');
      const r1 = await verifyPassword('alpha', hash);
      const r2 = await verifyPassword('beta', hash);
      expect(r1.valid).toBe(true);
      expect(r2.valid).toBe(false);
    });
  });
});

// A passkey-only account stores NO_PASSWORD. Nothing may ever authenticate
// against it.
//
// The danger is real rather than theoretical: verifyPassword's legacy-plaintext
// branch returns `plain === stored` for any stored value without a colon, so an
// empty stored value would have matched an empty submitted password. The login
// route happened to reject falsy hashes before calling in, but the safety
// belongs in the function that decides, not in one of its callers.
describe('verifyPassword fails closed on passkey-only accounts', () => {
  const cases: Array<[string, string | null | undefined]> = [
    ['the NO_PASSWORD sentinel', NO_PASSWORD],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ];

  for (const [label, stored] of cases) {
    it(`rejects an empty password against ${label}`, async () => {
      const r = await verifyPassword('', stored);
      expect(r.valid).toBe(false);
      expect(r.needsRehash).toBe(false);
    });

    it(`rejects a non-empty password against ${label}`, async () => {
      const r = await verifyPassword('hunter2', stored);
      expect(r.valid).toBe(false);
      expect(r.needsRehash).toBe(false);
    });
  }

  it('still verifies a real hash', async () => {
    const hash = await hashPassword('correct horse');
    expect((await verifyPassword('correct horse', hash)).valid).toBe(true);
    expect((await verifyPassword('wrong', hash)).valid).toBe(false);
  });
});
