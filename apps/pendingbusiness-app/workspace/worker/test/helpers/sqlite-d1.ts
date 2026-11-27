/**
 * A D1 binding over `node:sqlite`, with the real migrations applied.
 *
 * Every other worker test fakes `env.DB` by matching SQL prefixes and
 * answering with hand-shaped rows. That double answers a SELECT for a column
 * the migrations never created and accepts a value a CHECK would reject —
 * which is exactly how the onboarding 500 documented in schema-drift.test.ts
 * shipped. Handlers whose correctness is a property of the schema (a new
 * column, a CHECK bound, a RETURNING clause, a scoped UPDATE) run here
 * instead, against `migrations/*.sql` in order, so the test fails when the
 * migration is wrong and not only when the handler is.
 *
 * Only the surface the handlers use is implemented: `prepare().bind()` with
 * `first()`, `all()`, `run()` (reporting `meta.changes` / `last_row_id`) and
 * `batch()`. Booleans bind as 0/1 and `undefined` as NULL, as D1 does.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Vite 5's builtin list predates `node:sqlite`, so a static import fails to
// resolve under vitest; a Node-side require sidesteps the bundler entirely.
const { DatabaseSync: Database } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

type Bindable = null | number | bigint | string | Uint8Array;

function toSqlite(v: unknown): Bindable {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  throw new TypeError(`cannot bind a ${typeof v} into SQLite`);
}

export interface SqliteD1 {
  db: D1Database;
  /** The underlying connection, for seeding rows and asserting on state. */
  raw: DatabaseSync;
}

/** In-memory SQLite with every file in migrations/ applied, in name order. */
export function createSqliteD1(): SqliteD1 {
  const raw = new Database(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()) {
    raw.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }

  function prepare(sql: string) {
    let params: Bindable[] = [];
    const statement = () => raw.prepare(sql);
    const stmt = {
      bind(...values: unknown[]) {
        params = values.map(toSqlite);
        return stmt;
      },
      first: async <T = Record<string, unknown>>(column?: string): Promise<T | null> => {
        const row = statement().get(...params) as Record<string, unknown> | undefined;
        if (!row) return null;
        return (column ? row[column] : row) as T;
      },
      all: async <T = Record<string, unknown>>() => ({
        results: statement().all(...params) as T[],
        success: true,
        meta: {},
      }),
      run: async () => {
        const result = statement().run(...params);
        return {
          success: true,
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        };
      },
      raw: async () =>
        statement()
          .all(...params)
          .map(r => Object.values(r as object)),
    };
    return stmt;
  }

  const db = {
    prepare,
    batch: async (statements: Array<{ all: () => Promise<unknown> }>) =>
      Promise.all(statements.map(s => s.all())),
    exec: async (sql: string) => {
      raw.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;

  return { db, raw };
}

/**
 * A signed-in user. Inserts a `users` row (or reuses `id` when given, e.g. the
 * seeded user 1) and a `user_sessions` row for it, and returns the Cookie
 * header that resolves to that user through the real auth adapter.
 */
export function signIn(
  raw: DatabaseSync,
  user: { id?: number; handle: string; email?: string; filingStatus?: string; state?: string },
): { id: number; cookie: string } {
  let id = user.id;
  if (id === undefined) {
    const r = raw
      .prepare(
        'INSERT INTO users (email, display_name, filing_status, state, handle) VALUES (?, ?, ?, ?, ?) RETURNING id',
      )
      .get(
        user.email ?? `${user.handle}@example.com`,
        user.handle,
        user.filingStatus ?? 'mfj',
        user.state ?? 'CA',
        user.handle,
      ) as { id: number };
    id = r.id;
  }
  const token = `tok-${user.handle}`;
  raw
    .prepare('INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, id, 9_999_999_999);
  return { id, cookie: `pb_auth=${token}` };
}
