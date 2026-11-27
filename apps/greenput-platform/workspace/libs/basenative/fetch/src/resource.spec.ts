import { describe, it, expect, vi } from 'vitest';
import { signal } from '@basenative/runtime';
import { createResource } from './resource.js';

function tick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('createResource', () => {
  it('runs the fetcher on creation and exposes the result', async () => {
    const fetcher = vi.fn(async () => ({ count: 1 }));
    const resource = createResource(fetcher);

    expect(resource.loading()).toBe(true);
    await tick();

    expect(resource.loading()).toBe(false);
    expect(resource.data()).toEqual({ count: 1 });
    expect(resource.error()).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    resource.dispose();
  });

  it('skips the initial run when auto is false', async () => {
    const fetcher = vi.fn(async () => 1);
    const resource = createResource(fetcher, { auto: false });

    await tick();
    expect(fetcher).not.toHaveBeenCalled();

    await resource.reload();
    expect(fetcher).toHaveBeenCalledOnce();
    resource.dispose();
  });

  it('exposes initialValue immediately', () => {
    const resource = createResource(async () => 99, {
      initialValue: 1,
      auto: false,
    });
    expect(resource.data()).toBe(1);
    expect(resource.stale()).toBe(false);
    resource.dispose();
  });

  it('captures errors into the error signal', async () => {
    const resource = createResource(async () => {
      throw new Error('boom');
    });

    await tick();
    expect(resource.error()?.message).toBe('boom');
    expect(resource.loading()).toBe(false);
    resource.dispose();
  });

  it('coerces non-Error throws into Error', async () => {
    const resource = createResource(async () => {
      throw 'plain string';
    });
    await tick();
    expect(resource.error()).toBeInstanceOf(Error);
    expect(resource.error()?.message).toBe('plain string');
    resource.dispose();
  });

  it('reload re-runs the fetcher and clears prior error', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error('first');
      return 'ok';
    });

    const resource = createResource(fetcher);
    await tick();
    expect(resource.error()).not.toBeNull();

    await resource.reload();
    expect(resource.data()).toBe('ok');
    expect(resource.error()).toBeNull();
    resource.dispose();
  });

  it('refetches when a tracked signal changes', async () => {
    const id = signal(1);
    const fetcher = vi.fn(async () => `id:${id()}`);

    const resource = createResource(fetcher);
    await tick();
    expect(resource.data()).toBe('id:1');

    id.set(2);
    await tick();
    expect(resource.data()).toBe('id:2');
    expect(fetcher).toHaveBeenCalledTimes(2);
    resource.dispose();
  });

  it('set() updates data without running the fetcher', () => {
    const resource = createResource(async () => 1, { auto: false });
    resource.set(42);
    expect(resource.data()).toBe(42);
    expect(resource.stale()).toBe(false);
    resource.dispose();
  });

  it('mutate() updates data based on current value', () => {
    const resource = createResource(async () => 1, {
      initialValue: 5,
      auto: false,
    });
    resource.mutate((current) => (current ?? 0) + 1);
    expect(resource.data()).toBe(6);
    resource.dispose();
  });

  it('dispose stops auto re-runs', async () => {
    const id = signal(1);
    const fetcher = vi.fn(async () => id());
    const resource = createResource(fetcher);
    await tick();

    resource.dispose();
    id.set(2);
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('discards stale results when reload races', async () => {
    let resolveFirst: (v: number) => void = () => undefined;
    let callIndex = 0;
    const fetcher = () =>
      new Promise<number>((resolve) => {
        callIndex++;
        if (callIndex === 1) {
          resolveFirst = resolve;
        } else {
          resolve(2);
        }
      });

    const resource = createResource(fetcher, { auto: false });
    const first = resource.reload();
    const second = resource.reload();
    resolveFirst(1);
    await Promise.all([first, second]);

    expect(resource.data()).toBe(2);
    resource.dispose();
  });

  it('forwards onError callbacks', async () => {
    const onError = vi.fn();
    const resource = createResource(
      async () => {
        throw new Error('x');
      },
      { onError },
    );

    await tick();
    expect(onError).toHaveBeenCalledOnce();
    resource.dispose();
  });
});
