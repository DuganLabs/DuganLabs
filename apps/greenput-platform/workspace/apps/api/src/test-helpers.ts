import { vi } from 'vitest';

/**
 * Create a mock D1 database for route handler tests.
 * Each method returns a chainable mock that can be configured per test.
 */
export function createMockDB() {
  const mockFirst = vi.fn().mockResolvedValue(null);
  const mockAll = vi.fn().mockResolvedValue({ results: [] });
  const mockRun = vi.fn().mockResolvedValue({});

  const mockBind = vi.fn().mockReturnValue({
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  });

  const mockPrepare = vi.fn().mockReturnValue({
    bind: mockBind,
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  });

  // D1's batch() runs its statements as one transaction. Routes that must not
  // half-commit use it — /api/auth/register, for one, where three separate
  // .run() calls leaked an orphan workspace whenever the user insert failed.
  // Resolves one result per statement, matching the real shape.
  const mockBatch = vi
    .fn()
    .mockImplementation(async (statements: unknown[]) =>
      statements.map(() => ({ success: true, results: [], meta: {} })),
    );

  return {
    prepare: mockPrepare,
    batch: mockBatch,
    _bind: mockBind,
    _first: mockFirst,
    _all: mockAll,
    _run: mockRun,
    _batch: mockBatch,
  };
}

/**
 * Create a mock Env object for tests.
 */
export function createMockEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: createMockDB(),
    SESSIONS: {} as unknown,
    CHAT_ROOM: {} as unknown,
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

/**
 * Create a mock IRequest-like object for itty-router handlers.
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    workspaceId?: string;
    user?: { id: string; role: string };
    params?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
) {
  const req = {
    url,
    method: options.method ?? 'GET',
    headers: new Map(Object.entries(options.headers ?? {})),
    params: options.params ?? {},
    workspaceId: options.workspaceId ?? 'ws-test-123',
    user: options.user ?? { id: 'user-test-123', role: 'owner' },
    validatedBody: options.body,
    json: vi.fn().mockResolvedValue(options.body ?? {}),
    text: vi.fn().mockResolvedValue(JSON.stringify(options.body ?? {})),
  };
  return req;
}

/**
 * Parse a Response body as JSON.
 */
export async function parseResponse<T = unknown>(
  response: Response,
): Promise<T> {
  return response.json() as Promise<T>;
}

// ── A KV fake that plays by Workers KV's documented rules ──────────────────
//
// A KV built from `vi.fn()` proves nothing about a read-modify-write, and a KV
// fake that only honours expirationTtl proves nothing about concurrency. This
// one enforces the three properties that actually broke the sliding session:
//
//   1. At most ONE write to the same key per second. Workers KV throws 429 past
//      that (https://developers.cloudflare.com/kv/api/write-key-value-pairs/,
//      "Limits to KV writes to the same key"), and a delete is a write.
//   2. An expiration must be at least 60 seconds in the future.
//   3. Optional read staleness: a written value is not guaranteed visible to
//      reads for up to 60 seconds, so `stalenessMs` serves reads from the newest
//      version written at least that long ago.
//
// The clock is the test's, because every question here is about when something
// stops existing.

export interface FakeKvOptions {
  /** Serve reads from the newest version written at least this long ago. */
  stalenessMs?: number;
  /** Enforce the one-write-per-second-per-key rule (on by default). */
  hotKeyLimit?: boolean;
}

interface FakeKvVersion {
  /** null means "deleted at this point in the key's history". */
  value: string | null;
  /** Epoch ms the entry expires, or null for no expiry. */
  expiresAt: number | null;
  writtenAt: number;
}

export interface FakeKvWrite {
  op: 'put' | 'delete';
  key: string;
  value?: string;
  /** Epoch ms this write said the entry should expire. */
  expiresAt: number | null;
  rejected: boolean;
}

export function createFakeKv(
  clock: { now: number },
  options: FakeKvOptions = {},
) {
  const stalenessMs = options.stalenessMs ?? 0;
  const hotKeyLimit = options.hotKeyLimit ?? true;

  const history = new Map<string, FakeKvVersion[]>();
  const lastAppliedWriteAt = new Map<string, number>();
  const writes: FakeKvWrite[] = [];
  let heldRelease: (() => void) | null = null;
  let hold: { key?: string; op?: 'put' | 'delete' } | null = null;

  function visible(key: string): FakeKvVersion | null {
    const versions = history.get(key);
    if (!versions) return null;
    const cutoff = clock.now - stalenessMs;
    let seen: FakeKvVersion | null = null;
    for (const version of versions) {
      if (version.writtenAt <= cutoff) seen = version;
    }
    if (!seen || seen.value === null) return null;
    if (seen.expiresAt !== null && clock.now >= seen.expiresAt) return null;
    return seen;
  }

  function append(key: string, version: FakeKvVersion) {
    const versions = history.get(key) ?? [];
    versions.push(version);
    history.set(key, versions);
  }

  async function gate(key: string, op: 'put' | 'delete'): Promise<void> {
    if (!hold) return;
    if (hold.key !== undefined && hold.key !== key) return;
    if (hold.op !== undefined && hold.op !== op) return;
    hold = null;
    await new Promise<void>((resolve) => {
      heldRelease = resolve;
    });
  }

  function hotKeyRejects(key: string, write: FakeKvWrite): boolean {
    if (!hotKeyLimit) return false;
    const previous = lastAppliedWriteAt.get(key);
    if (previous === undefined || clock.now - previous >= 1000) return false;
    write.rejected = true;
    writes.push(write);
    return true;
  }

  const kv = {
    async get(key: string): Promise<string | null> {
      return visible(key)?.value ?? null;
    },
    async put(
      key: string,
      value: string,
      opts?: { expirationTtl?: number; expiration?: number },
    ): Promise<void> {
      await gate(key, 'put');

      let expiresAt: number | null = null;
      if (opts?.expiration !== undefined) {
        expiresAt = opts.expiration * 1000;
        if (expiresAt - clock.now < 60_000) {
          throw new Error(
            `KV rejects an expiration less than 60s out (got ${Math.round(
              (expiresAt - clock.now) / 1000,
            )}s)`,
          );
        }
      } else if (opts?.expirationTtl !== undefined) {
        if (opts.expirationTtl < 60) {
          throw new Error(
            `KV rejects expirationTtl below 60s (got ${opts.expirationTtl})`,
          );
        }
        expiresAt = clock.now + opts.expirationTtl * 1000;
      }

      const write: FakeKvWrite = {
        op: 'put',
        key,
        value,
        expiresAt,
        rejected: false,
      };
      if (hotKeyRejects(key, write)) {
        throw new Error('KV PUT failed: 429 Too Many Requests');
      }

      writes.push(write);
      lastAppliedWriteAt.set(key, clock.now);
      append(key, { value, expiresAt, writtenAt: clock.now });
    },
    async delete(key: string): Promise<void> {
      await gate(key, 'delete');
      const write: FakeKvWrite = {
        op: 'delete',
        key,
        expiresAt: null,
        rejected: false,
      };
      if (hotKeyRejects(key, write)) {
        throw new Error('KV DELETE failed: 429 Too Many Requests');
      }
      writes.push(write);
      lastAppliedWriteAt.set(key, clock.now);
      append(key, { value: null, expiresAt: null, writtenAt: clock.now });
    },
  };

  return {
    kv: kv as unknown as KVNamespace,
    writes,
    /**
     * Forget the write log, keeping the stored data. Called after a test seeds
     * its fixtures so that every counter below measures only the code under
     * test — the one-write-per-second rule still remembers the seed.
     */
    forgetWrites(): void {
      writes.length = 0;
    },
    /** Writes KV accepted. */
    applied(key?: string): FakeKvWrite[] {
      return writes.filter(
        (write) => !write.rejected && (key === undefined || write.key === key),
      );
    },
    /** Writes KV threw a 429 for. */
    rejected(key?: string): FakeKvWrite[] {
      return writes.filter(
        (write) => write.rejected && (key === undefined || write.key === key),
      );
    },
    /** How many DIFFERENT bodies were written to a key — 1 means idempotent. */
    distinctValues(key: string): string[] {
      return [
        ...new Set(
          this.applied(key)
            .filter((write) => write.op === 'put')
            .map((write) => write.value as string),
        ),
      ];
    },
    /** What a read sees right now, staleness and expiry included. */
    read(key: string): string | null {
      return visible(key)?.value ?? null;
    },
    /** What is really stored, ignoring read staleness. */
    stored(key: string): { value: string; expiresAt: number | null } | null {
      const versions = history.get(key);
      const latest = versions?.[versions.length - 1];
      if (!latest || latest.value === null) return null;
      if (latest.expiresAt !== null && clock.now >= latest.expiresAt)
        return null;
      return { value: latest.value, expiresAt: latest.expiresAt };
    },
    parsed(key: string): Record<string, unknown> {
      const entry = this.stored(key);
      if (!entry) throw new Error(`no KV entry for ${key}`);
      return JSON.parse(entry.value) as Record<string, unknown>;
    },
    /**
     * Hold the next write inside KV until the returned release() is called,
     * optionally only the next write matching a key and/or an operation — which
     * is how a test models one request's put still being in flight while
     * another request's writes land.
     */
    holdNextWrite(
      match: { key?: string; op?: 'put' | 'delete' } = {},
    ): () => void {
      hold = match;
      return () => {
        const release = heldRelease;
        heldRelease = null;
        if (!release) throw new Error('no write is being held');
        release();
      };
    },
  };
}
