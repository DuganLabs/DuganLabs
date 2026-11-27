import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from './timing-safe';

describe('timingSafeEqual', () => {
  it('accepts two identical strings', async () => {
    await expect(timingSafeEqual('a'.repeat(48), 'a'.repeat(48))).resolves.toBe(
      true,
    );
  });

  it('rejects a one-character difference at the end', async () => {
    const secret = `${'a'.repeat(47)}b`;
    await expect(timingSafeEqual(secret, 'a'.repeat(48))).resolves.toBe(false);
  });

  it('rejects a correct prefix of the secret', async () => {
    await expect(timingSafeEqual('a'.repeat(48), 'a'.repeat(47))).resolves.toBe(
      false,
    );
  });

  it('rejects strings of different lengths without throwing', async () => {
    await expect(timingSafeEqual('short', 'a'.repeat(4096))).resolves.toBe(
      false,
    );
  });

  it('treats two empty strings as equal (callers must gate on length)', async () => {
    await expect(timingSafeEqual('', '')).resolves.toBe(true);
  });

  it('rejects an empty candidate against a real secret', async () => {
    await expect(timingSafeEqual('a'.repeat(48), '')).resolves.toBe(false);
  });

  it('is case- and byte-exact', async () => {
    await expect(timingSafeEqual('Token-ÅBC', 'token-åbc')).resolves.toBe(
      false,
    );
    await expect(timingSafeEqual('Token-ÅBC', 'Token-ÅBC')).resolves.toBe(true);
  });

  it('uses a fresh key per call, so the verdict is still stable', async () => {
    const results = await Promise.all([
      timingSafeEqual('same', 'same'),
      timingSafeEqual('same', 'same'),
      timingSafeEqual('same', 'diff'),
    ]);
    expect(results).toEqual([true, true, false]);
  });
});
