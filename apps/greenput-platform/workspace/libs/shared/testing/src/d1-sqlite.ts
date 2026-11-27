/// <reference types="@cloudflare/workers-types" />
import { readFileSync } from 'node:fs';
// Type-only, so nothing in this file's module graph names `node:sqlite` as a
// runtime specifier. That matters: apps/platform's vitest environment is
// happy-dom, which Vite resolves as a *client* environment and where it refuses
// to bundle a Node built-in — a static `import { DatabaseSync } from
// 'node:sqlite'` makes this helper unloadable from
// apps/platform/src/contract/reads-the-real-api.spec.ts, the one test that runs
// the real Worker routers and the platform's renderers against each other.
// `process.getBuiltinModule` reaches the same module at runtime without giving
// a bundler anything to resolve (Node >= 22.3; CI and wrangler both run 22).
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

type DatabaseSync = DatabaseSyncType;

function loadSqlite(): { DatabaseSync: new (path: string) => DatabaseSync } {
  const mod = process.getBuiltinModule?.('node:sqlite') as
    { DatabaseSync: new (path: string) => DatabaseSync } | undefined;
  if (!mod?.DatabaseSync) {
    throw new Error(
      'node:sqlite is unavailable — createSqliteD1 needs Node 22.3 or newer',
    );
  }
  return mod;
}

export interface SqliteD1Options {
  /** SQL files to execute in order (e.g. schema.sql, then a seed). */
  files?: string[];
  /** Raw SQL strings to execute after `files`. */
  sql?: string[];
}

export interface SqliteD1 {
  /** A `D1Database`-compatible handle for the code under test. */
  db: D1Database;
  /** The underlying SQLite connection, for asserting on rows directly. */
  raw: DatabaseSync;
  /** Rows of `SELECT * FROM <table>` as plain objects. */
  rows<T = Record<string, unknown>>(table: string): T[];
  close(): void;
}

type SqlValue = null | number | bigint | string | Uint8Array;

/**
 * An in-memory SQLite database that speaks D1's `prepare().bind().run()`
 * surface. Worker handlers can run unmodified against the real `schema.sql`,
 * so NOT NULL / CHECK / FOREIGN KEY drift between the schema and a query is
 * caught by the unit test instead of by production.
 *
 * Mirrors D1 semantics that matter for correctness:
 * - foreign keys are enforced (D1 turns `PRAGMA foreign_keys` on);
 * - binding `undefined` throws (D1 rejects it with D1_TYPE_ERROR);
 * - `first()` resolves to `null` when there is no row.
 */
export function createSqliteD1(options: SqliteD1Options = {}): SqliteD1 {
  const raw = new (loadSqlite().DatabaseSync)(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const file of options.files ?? []) {
    raw.exec(readFileSync(file, 'utf8'));
  }
  for (const sql of options.sql ?? []) {
    raw.exec(sql);
  }

  const db = {
    prepare: (sql: string) => makeStatement(raw, sql, []),
    // D1 runs a batch as one transaction: if any statement fails, none of them
    // took effect. Reproduced here with a real BEGIN/COMMIT, because without it
    // a test that asserts "nothing was half-written after the batch was
    // rejected" passes whenever the failing statement happens to be the first
    // one and proves nothing about rollback.
    batch: async (statements: D1PreparedStatement[]) => {
      raw.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec('COMMIT');
        return results;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    exec: (sql: string) => {
      raw.exec(sql);
      return Promise.resolve({ count: 0, duration: 0 });
    },
  } as unknown as D1Database;

  return {
    db,
    raw,
    rows<T = Record<string, unknown>>(table: string): T[] {
      return raw
        .prepare(`SELECT * FROM ${table}`)
        .all()
        .map((row) => ({ ...row }) as T);
    },
    close: () => raw.close(),
  };
}

function makeStatement(
  raw: DatabaseSync,
  sql: string,
  values: SqlValue[],
): D1PreparedStatement {
  const meta = { duration: 0, changes: 0, last_row_id: 0 };
  const statement = {
    bind: (...next: unknown[]) => {
      for (const value of next) {
        if (value === undefined) {
          throw new Error(
            'D1_TYPE_ERROR: Type "undefined" not supported for value "undefined"',
          );
        }
      }
      return makeStatement(raw, sql, next as SqlValue[]);
    },
    // Each method is async so a SQLite constraint error surfaces as a
    // rejected promise, exactly as D1 reports it.
    first: async (column?: string) => {
      const row = raw.prepare(sql).get(...values);
      if (row === undefined) return null;
      const plain = { ...row } as Record<string, unknown>;
      return column ? (plain[column] ?? null) : plain;
    },
    all: async () => {
      const results = raw
        .prepare(sql)
        .all(...values)
        .map((row) => ({ ...row }));
      return { results, success: true, meta };
    },
    run: async () => {
      const result = raw.prepare(sql).run(...values);
      return {
        results: [],
        success: true,
        meta: {
          ...meta,
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
      };
    },
    raw: async () =>
      raw
        .prepare(sql)
        .all(...values)
        .map((row) => Object.values(row)),
  };
  return statement as unknown as D1PreparedStatement;
}
