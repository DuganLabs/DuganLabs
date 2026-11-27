import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  UNAVAILABLE_WORKSPACE_SLUGS,
  isValidSlug,
  isWorkspaceSlugUnavailable,
} from '@greenput/shared/utils';
import { authRouter } from './auth';

// Against a real SQLite database, not a mocked one: /register's collision
// handling is built on a unique index firing, and a `vi.fn()` DB never parses
// the SQL it is handed — which is how PATCH /api/workspace shipped writing a
// column the table did not have and passed eleven tests doing it.
//
// AND against TWO database shapes, because one is not enough. The first
// revision of this file tested only schema.sql, where `slug` was declared
// `TEXT UNIQUE`. The live databases cannot have that constraint: they got the
// column from migrations/001-workspaces-slug.sql, a bare
// `ALTER TABLE workspaces ADD COLUMN slug TEXT`, and SQLite's ADD COLUMN cannot
// carry UNIQUE. So every test here passed while production had no uniqueness at
// all and two simultaneous signups of the same company name both wrote the same
// slug. `liveShape()` rebuilds that exact shape — table without the column, then
// the ALTER, then migrations/015's index — so the fixture proves the production
// behaviour instead of a stricter one.
const REPO = join(__dirname, '..', '..', '..', '..');
const SCHEMA = join(REPO, 'schema.sql');
const M001 = join(REPO, 'migrations', '001-workspaces-slug.sql');
const M015 = join(REPO, 'migrations', '015-workspaces-slug-unique.sql');

/** The `slug` column as schema.sql declares it, and the two indexes over it. */
const SLUG_COLUMN = /^ {2}slug {9}TEXT,\r?\n/m;
const SLUG_INDEX =
  /^CREATE (?:UNIQUE )?INDEX[^\n]*workspaces\(slug\)[^\n]*\n/gm;

/**
 * schema.sql rebuilt the way the long-lived databases were actually built: no
 * `slug` in the CREATE TABLE, the column appended by migrations/001, and the
 * uniqueness supplied by migrations/015 — or, with `unique: false`, by nothing
 * at all, which is the shape production was in before this change.
 *
 * EVERY index over `workspaces(slug)` that schema.sql declares is stripped, and
 * only the plain one is put back. So on this shape the unique index can come
 * from exactly one place: the migration file. Rewriting migrations/015 to a
 * no-op makes the race test below fail, which is how this fixture was checked —
 * the first draft re-appended schema.sql's own `CREATE UNIQUE INDEX` and
 * therefore passed with the migration gutted, proving nothing about it.
 *
 * Derived from the files rather than hard-coded so it cannot drift away from
 * them, and it throws rather than silently testing the wrong thing if either
 * file stops looking the way it is read here.
 */
function liveShape({ unique = true }: { unique?: boolean } = {}): string {
  const schema = readFileSync(SCHEMA, 'utf8');
  if (!SLUG_COLUMN.test(schema)) {
    throw new Error(
      'schema.sql no longer declares `  slug         TEXT,` on workspaces; this fixture can no longer reproduce the live shape',
    );
  }
  const indexes = schema.match(SLUG_INDEX) ?? [];
  if (indexes.length !== 2) {
    throw new Error(
      `expected schema.sql to declare 2 indexes over workspaces(slug), found ${indexes.length}`,
    );
  }
  let body = schema.replace(SLUG_COLUMN, '');
  for (const index of indexes) body = body.replace(index, '');
  return [
    body,
    readFileSync(M001, 'utf8'),
    ...(unique ? [readFileSync(M015, 'utf8')] : []),
    // schema.sql's plain index, which CI replays over the live database after
    // the migrations run. Moved after the ALTER because a CREATE INDEX on a
    // column that does not exist yet is the exact error that broke every main
    // deploy from PR #103 onward.
    ...indexes.filter((index) => !index.includes('UNIQUE')),
  ].join('\n');
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string | null;
}

interface Harness {
  sqlite: SqliteD1;
  env: Record<string, unknown>;
  register(
    workspaceName: string,
    email: string,
  ): Promise<{ status: number; slug?: string }>;
  slugs(): (string | null)[];
}

function harness(make: () => SqliteD1): Harness {
  const sqlite = make();
  const env: Record<string, unknown> = {
    DB: sqlite.db,
    SESSIONS: {
      put: async () => undefined,
      get: async () => null,
      delete: async () => undefined,
    },
    ENVIRONMENT: 'test',
  };
  return {
    sqlite,
    env,
    async register(workspaceName: string, email: string) {
      const res = await authRouter.fetch(
        new Request('https://api.greenput.com/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: 'Jane',
            lastName: 'Smith',
            email,
            workspaceName,
            trade: 'electrician',
            phone: '9495550187',
          }),
        }),
        env,
      );
      const body = (await res.json()) as {
        data?: { workspace?: { slug?: string } };
      };
      return { status: res.status, slug: body.data?.workspace?.slug };
    },
    slugs: () =>
      sqlite
        .rows<WorkspaceRow>('workspaces')
        .map((row) => row.slug)
        .sort(),
  };
}

/**
 * Force the "which of these candidates are taken" pre-filter to come back
 * empty. That is exactly what a concurrent signup a millisecond earlier looks
 * like: the SELECT saw a free slug, and by the time the INSERT runs it is not.
 * Only the database can catch it from here.
 */
function withStaleTakenCheck(h: Harness): void {
  const real = h.sqlite.db;
  h.env['DB'] = {
    ...real,
    prepare: (sql: string) => {
      const statement = real.prepare(sql);
      if (!sql.startsWith('SELECT slug FROM workspaces WHERE slug IN')) {
        return statement;
      }
      return {
        ...statement,
        bind: () => ({
          ...statement,
          all: async () => ({ results: [], success: true, meta: {} }),
        }),
      };
    },
    batch: real.batch.bind(real),
  };
}

const SHAPES: [string, () => SqliteD1][] = [
  ['schema.sql (a fresh database)', () => createSqliteD1({ files: [SCHEMA] })],
  [
    'the live shape (ALTER-added column + migrations/015)',
    () => createSqliteD1({ sql: [liveShape()] }),
  ],
];

describe('the live-shape fixture really is the production shape', () => {
  it('has slug appended by ALTER, with no column-level UNIQUE', () => {
    const sqlite = createSqliteD1({ sql: [liveShape()] });
    try {
      const ddl = sqlite.raw
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='workspaces'",
        )
        .get() as { sql: string };
      // The live `greenput` DDL, read on 2026-09-11, ends
      // `... created_at TEXT NOT NULL DEFAULT (datetime('now'))\n, slug TEXT,
      // billing_status ...` — the column appended by 001, not declared in the
      // body, and with no UNIQUE anywhere on it.
      expect(ddl.sql).toContain('slug TEXT');
      expect(ddl.sql).not.toMatch(/slug\s+TEXT\s+UNIQUE/i);
      const columns = sqlite.raw
        .prepare("SELECT name FROM pragma_table_info('workspaces')")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(columns.indexOf('slug')).toBeGreaterThan(
        columns.indexOf('created_at'),
      );
      // No implicit unique index — the only uniqueness is the named one.
      const indexes = sqlite.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='workspaces'",
        )
        .all()
        .map((row) => (row as { name: string }).name);
      expect(indexes).not.toContain('sqlite_autoindex_workspaces_2');
      expect(indexes).toContain('idx_workspaces_slug_unique');
    } finally {
      sqlite.close();
    }
  });

  it('rejects a duplicate non-NULL slug and accepts many NULLs', () => {
    const sqlite = createSqliteD1({ sql: [liveShape()] });
    try {
      const insert = (id: string, slug: string | null) =>
        sqlite.raw
          .prepare(
            'INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(id, 'Acme', slug, '2026-01-01');
      insert('w1', 'acme');
      expect(() => insert('w2', 'acme')).toThrow(/UNIQUE constraint failed/i);
      // A workspace with no micro-site address is normal: five rows in the live
      // `greenput` carry slug NULL. The index is partial so they all fit.
      insert('w3', null);
      insert('w4', null);
      expect(sqlite.rows('workspaces')).toHaveLength(3);
    } finally {
      sqlite.close();
    }
  });
});

describe.each(SHAPES)(
  'POST /api/auth/register — micro-site slug, on %s',
  (_label, make) => {
    let h: Harness;

    beforeEach(() => {
      h = harness(make);
    });

    afterEach(() => h.sqlite.close());

    it('gives a new workspace a slug derived from the company name', async () => {
      const { status, slug } = await h.register(
        'Acme Electric',
        'a@example.com',
      );
      expect(status).toBe(201);
      expect(slug).toBe('acme-electric');
      expect(h.slugs()).toEqual(['acme-electric']);
    });

    it('makes the workspace resolvable by the query apps/tenant-site uses', async () => {
      await h.register('Acme Electric', 'a@example.com');
      // Exactly the lookup in apps/tenant-site/src/index.ts and
      // /api/public/workspace/:slug.
      const found = await h.sqlite.db
        .prepare('SELECT id, name, slug FROM workspaces WHERE slug = ? LIMIT 1')
        .bind('acme-electric')
        .first<WorkspaceRow>();
      expect(found?.name).toBe('Acme Electric');
    });

    it('lets two contractors with the same company name both register', async () => {
      const first = await h.register('Acme Electric', 'one@example.com');
      const second = await h.register('Acme Electric', 'two@example.com');

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.slug).toBe('acme-electric');
      expect(second.slug).toMatch(/^acme-electric-[a-z0-9]+$/);
      expect(second.slug).not.toBe(first.slug);
      expect(new Set(h.slugs()).size).toBe(2);
    });

    it('recovers when the slug is claimed between the check and the insert', async () => {
      await h.register('Acme Electric', 'one@example.com');
      withStaleTakenCheck(h);

      // THE TEST THIS FILE EXISTS FOR. On the live shape it fails outright
      // unless migrations/015 has created the index: without it the INSERT
      // succeeds and both rows hold `acme-electric`, and six lookups of the
      // form `WHERE slug = ? LIMIT 1` then serve whichever row SQLite returns
      // first — the wrong contractor's phone number, address and licence, and
      // inbound leads attributed to the wrong workspace.
      const second = await h.register('Acme Electric', 'two@example.com');
      expect(second.status).toBe(201);
      expect(second.slug).toMatch(/^acme-electric-[a-z0-9]+$/);
      expect(new Set(h.slugs()).size).toBe(2);
      expect(h.sqlite.rows('workspaces')).toHaveLength(2);
      expect(h.sqlite.rows('users')).toHaveLength(2);
    });

    it('leaves nothing half-written when an attempt is rejected', async () => {
      await h.register('Acme Electric', 'one@example.com');
      withStaleTakenCheck(h);
      await h.register('Acme Electric', 'two@example.com');
      // The rejected attempt fails on the FIRST statement of the batch, so row
      // counts alone would come out right with or without a rollback. Assert
      // on a statement that runs after the failing one instead: the users row
      // of the rejected attempt must not survive, and the retry must not
      // duplicate it. (libs/shared/testing's batch() is a real BEGIN/COMMIT,
      // as D1's is.)
      expect(h.sqlite.rows('workspaces')).toHaveLength(2);
      expect(h.sqlite.rows('users')).toHaveLength(2);
      expect(h.sqlite.rows('activity_log')).toHaveLength(2);
    });

    it('survives a third and fourth contractor of the same name', async () => {
      for (const n of [1, 2, 3, 4]) {
        const { status } = await h.register(
          'Acme Electric',
          `acme-${n}@example.com`,
        );
        expect(status).toBe(201);
      }
      const all = h.slugs();
      expect(new Set(all).size).toBe(4);
      for (const slug of all) expect(isValidSlug(slug as string)).toBe(true);
    });

    it.each([...UNAVAILABLE_WORKSPACE_SLUGS])(
      'never hands out %s, even to a company of that name',
      async (unavailable) => {
        // The infrastructure hostnames apps/tenant-site refuses to resolve,
        // plus `demo` (Greenput's showcase tenant, the one tenant hostname
        // bound in production) and `greenput` (what the tenant Worker derives
        // for a request to greenput.com).
        const { status, slug } = await h.register(
          unavailable,
          `${unavailable}@example.com`,
        );
        expect(status).toBe(201);
        expect(slug).not.toBe(unavailable);
        expect(isWorkspaceSlugUnavailable(slug as string)).toBe(false);
        expect(slug).toMatch(new RegExp(`^${unavailable}-[a-z0-9]+$`));
      },
    );

    it.each([
      // Every one of these used to end up as a generic fallback or a mangled
      // word. They are ordinary company names, not hostile input: the curly
      // apostrophe is the default on every iOS and macOS keyboard.
      ["Bob's Plumbing & Co.", 'bobs-plumbing-co'], // straight apostrophe
      ['Bob’s Plumbing & Co.', 'bobs-plumbing-co'], // curly apostrophe
      ['O’Brien Electric', 'obrien-electric'],
      ['Café Électrique', 'cafe-electrique'],
      ['Müller Elektro', 'muller-elektro'],
      ['Père & Fils Électricité', 'pere-fils-electricite'],
      ['ACME – Electric', 'acme-electric'], // en dash
      ['ACME ‐ Electric', 'acme-electric'], // U+2010 hyphen
      ['Acme™ Electric', 'acme-electric'], // trademark sign
      ['Acme® Electric', 'acme-electric'],
      ['Blåbær Strøm', 'blabaer-strom'],
      ['Straße Elektro', 'strasse-elektro'],
      ['Łukasz Wiring', 'lukasz-wiring'],
      ['Smith & Sons HVAC, Inc.', 'smith-sons-hvac-inc'],
      ['A&B $ Electric', 'a-b-electric'],
      ['Acme\tElectric', 'acme-electric'],
      ['Acme\nElectric', 'acme-electric'],
    ])(
      'keeps an ordinary company name readable: %s -> %s',
      async (name, expected) => {
        const { status, slug } = await h.register(name, 'name@example.com');
        expect(status).toBe(201);
        expect(slug).toBe(expected);
      },
    );

    it.each([
      ['punctuation only', '!!!'],
      ['a script this cannot transliterate', '株式会社テスト'],
      ['one character', 'A'],
      ['whitespace only', '   '],
    ])(
      'still produces a usable slug for a company name that is %s',
      async (_label, workspaceName) => {
        const { status, slug } = await h.register(
          workspaceName,
          'empty@example.com',
        );
        expect(status).toBe(201);
        expect(slug).toBeTruthy();
        expect(isValidSlug(slug as string)).toBe(true);
        expect(isWorkspaceSlugUnavailable(slug as string)).toBe(false);
        expect(h.slugs()).toEqual([slug]);
      },
    );

    it('keeps the slug inside one DNS label', async () => {
      const { slug } = await h.register(
        'The Extremely Long Name Of A Very Thorough Electrical Contracting Company',
        'long@example.com',
      );
      expect((slug as string).length).toBeLessThanOrEqual(63);
      expect(isValidSlug(slug as string)).toBe(true);
    });
  },
);

describe('without migrations/015 — the shape production was in', () => {
  // Not a wish: this is what the two live databases did until this change, and
  // it is why the index is the fix rather than the SELECT. If this test ever
  // starts passing the slug the way the shapes above do, the test above has
  // stopped depending on the index and is no longer evidence of anything.
  let h: Harness;

  beforeEach(() => {
    h = harness(() => createSqliteD1({ sql: [liveShape({ unique: false })] }));
  });

  afterEach(() => h.sqlite.close());

  it('duplicates the slug when the taken-check is stale', async () => {
    await h.register('Acme Electric', 'one@example.com');
    withStaleTakenCheck(h);
    const second = await h.register('Acme Electric', 'two@example.com');

    expect(second.status).toBe(201);
    expect(second.slug).toBe('acme-electric');
    expect(h.slugs()).toEqual(['acme-electric', 'acme-electric']);

    // And the blast radius, made explicit: the tenant lookup returns one of
    // the two rows and there is no way to say which.
    const found = await h.sqlite.db
      .prepare('SELECT id, name, slug FROM workspaces WHERE slug = ? LIMIT 1')
      .bind('acme-electric')
      .first<WorkspaceRow>();
    expect(found).not.toBeNull();
    expect(h.sqlite.rows('workspaces')).toHaveLength(2);
  });
});
