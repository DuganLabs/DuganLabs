import {
  signal,
  computed,
  effect,
  type EffectHandle,
  type Signal,
} from '@basenative/runtime';

export interface Resource<T> {
  readonly data: Signal<T | undefined>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<Error | null>;
  readonly stale: Signal<boolean>;
  reload(): Promise<T | undefined>;
  set(value: T): void;
  mutate(updater: (current: T | undefined) => T): void;
  dispose(): void;
}

export interface ResourceOptions<T> {
  readonly initialValue?: T;
  readonly auto?: boolean;
  readonly onError?: (error: unknown) => void;
}

/**
 * Creates a signal-backed async resource. The fetcher runs once on creation
 * (unless `auto: false`) and re-runs when any signals it reads change.
 *
 * The returned object exposes read-only signals for `data`, `loading`, and
 * `error`, plus imperative `reload()` / `set()` / `mutate()` for optimistic
 * updates and explicit refetches.
 */
export function createResource<T>(
  fetcher: () => Promise<T>,
  options: ResourceOptions<T> = {},
): Resource<T> {
  const _data: Signal<T | undefined> = signal<T | undefined>(
    options.initialValue,
  );
  const _loading = signal(false);
  const _error = signal<Error | null>(null);
  const _version = signal(0);
  const _initialised = signal(options.initialValue !== undefined);

  let runId = 0;
  let runner: EffectHandle | null = null;

  async function run(): Promise<T | undefined> {
    const id = ++runId;
    _loading.set(true);
    try {
      const next = await fetcher();
      if (id !== runId) return undefined;
      _data.set(next);
      _error.set(null);
      _initialised.set(true);
      return next;
    } catch (err) {
      if (id !== runId) return undefined;
      const error = err instanceof Error ? err : new Error(String(err));
      _error.set(error);
      options.onError?.(err);
      return undefined;
    } finally {
      if (id === runId) _loading.set(false);
    }
  }

  if (options.auto !== false) {
    runner = effect(() => {
      _version();
      void run();
    });
  }

  function reload(): Promise<T | undefined> {
    if (runner) {
      _version.set((n) => n + 1);
      return run();
    }
    return run();
  }

  function set(value: T): void {
    _data.set(value);
    _initialised.set(true);
  }

  function mutate(updater: (current: T | undefined) => T): void {
    _data.set((current) => updater(current));
    _initialised.set(true);
  }

  function dispose(): void {
    runner?.dispose();
    runner = null;
    runId++;
  }

  const stale = computed(() => !_initialised());

  return {
    data: _data,
    loading: _loading,
    error: _error,
    stale,
    reload,
    set,
    mutate,
    dispose,
  };
}
