import { describe, expect, it, vi } from 'vitest';
import {
  PASSKEY_PROMPT_TIMEOUT_MS,
  PasskeyTimeoutError,
  withTimeout,
} from './prompt-timeout.js';
import { classifyAuthError } from './error-kind.js';

describe('withTimeout', () => {
  it('passes a resolution straight through', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'late')).resolves.toBe(
      'ok',
    );
  });

  it('passes a real rejection through rather than replacing it', async () => {
    // The failure that actually happened must survive. Reporting a timeout for
    // an authenticator that said "no" would send someone to buy a security key
    // they already have.
    await expect(
      withTimeout(Promise.reject(new Error('real failure')), 50, 'late'),
    ).rejects.toThrow('real failure');
  });

  it('rejects with the message when nothing settles in time', async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 5, 'no prompt appeared'),
    ).rejects.toThrow('no prompt appeared');
  });

  it('rejects with a PasskeyTimeoutError, which classifies as no-prompt', async () => {
    const err = await withTimeout(
      new Promise(() => undefined),
      5,
      'no prompt appeared',
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PasskeyTimeoutError);
    // Survives minification: `name` is set explicitly, and `name` is what the
    // classifier reads.
    expect((err as Error).name).toBe('PasskeyTimeoutError');
    expect(classifyAuthError(err)).toBe('no-prompt');
  });

  it('does not leave a timer behind after the promise settles', async () => {
    // A stray timer keeps a Worker or a test runner alive, and — worse — would
    // fire a rejection into a screen the user left minutes ago.
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 10_000, 'late');
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('waits forever when the timeout is zero or negative', async () => {
    // The escape hatch for conditional mediation, which is *supposed* to stay
    // pending until the user touches the autofill field. Timing that out would
    // abort the one passkey flow that is allowed to be slow.
    let settled = false;
    const pending = withTimeout(
      new Promise<string>((resolve) => setTimeout(() => resolve('later'), 20)),
      0,
      'late',
    );
    void pending.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    await expect(pending).resolves.toBe('later');
  });

  it('waits longer than a slow human but not forever', () => {
    // A judgement call, pinned so it cannot drift to something that is either
    // a security theatre timeout or no timeout at all.
    expect(PASSKEY_PROMPT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(PASSKEY_PROMPT_TIMEOUT_MS).toBeLessThanOrEqual(180_000);
  });
});
