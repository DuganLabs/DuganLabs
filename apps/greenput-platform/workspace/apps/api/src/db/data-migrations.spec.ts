// ─────────────────────────────────────────────────────────────
// Data migrations, applied for real against the real schema.
//
// scripts/db/test-migrate.sh builds its database from
// migrations/000-baseline-columns.tsv — a column list, with no constraints —
// so foreign keys do not exist there and a cascade cannot be observed. D1
// enforces foreign keys. A migration that deletes rows is therefore exactly
// the kind that harness cannot check, which is what this file is for:
// createSqliteD1 builds the database from schema.sql itself, keys enforced,
// so an ordering mistake fails here rather than halfway through a production
// deploy.
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';

const SCHEMA = readFileSync(
  resolve(__dirname, '../../../../schema.sql'),
  'utf8',
);

const MIGRATION_024 = readFileSync(
  resolve(
    __dirname,
    '../../../../migrations/024-delete-owner-test-account.sql',
  ),
  'utf8',
);

/**
 * Split a migration into statements the way migrate.sh's runner does.
 *
 * Comment lines go first. Splitting on `;` without stripping them cuts a
 * statement in half the moment a comment contains one — which is how an
 * earlier version of this helper silently corrupted the SQL it was meant to
 * be proving correct.
 */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function apply(d1: SqliteD1, sql: string): Promise<void> {
  for (const statement of statements(sql)) {
    await d1.db.prepare(statement).run();
  }
}

/** The account the migration targets, its workspace, and a row it created. */
async function seedTestAccount(d1: SqliteD1): Promise<void> {
  await d1.db
    .prepare(
      `INSERT INTO workspaces (id, name, slug, trade, phone, email, created_at)
       VALUES ('ws-001', 'Green Electric Co.', 'green-electric', 'electrical',
               '+15125550142', 'hi@green.example', '2026-03-01T00:00:00Z')`,
    )
    .run();
  await d1.db
    .prepare(
      `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
       VALUES ('usr-001', 'ws-001', 'Warren', 'Dugan', 'owner@example.com',
               'owner', 'not-a-real-password')`,
    )
    .run();
  // `leads.created_by` is NOT NULL REFERENCES users(id) with no ON DELETE
  // clause — deleting the user before this row would violate it. A dozen
  // tables carry that same shape.
  await d1.db
    .prepare(
      `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, created_by)
       VALUES ('lead-1', 'ws-001', 'Ada', 'Byron', 'new', 'manual', 'usr-001')`,
    )
    .run();
}

/** A workspace the migration must not touch. */
async function seedBystander(d1: SqliteD1): Promise<void> {
  await d1.db
    .prepare(
      `INSERT INTO workspaces (id, name, slug, trade, phone, email, created_at)
       VALUES ('ws-002', 'Rivertown Electric', 'demo', 'electrical',
               '+15125550143', 'hi@rivertown.example', '2026-03-01T00:00:00Z')`,
    )
    .run();
  await d1.db
    .prepare(
      `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
       VALUES ('usr-002', 'ws-002', 'Dana', 'Reyes', 'demo@greenput.com',
               'owner', '')`,
    )
    .run();
}

describe('024-delete-owner-test-account', () => {
  let d1: SqliteD1;

  afterEach(() => d1?.close());

  async function build(): Promise<void> {
    d1 = createSqliteD1({ sql: [SCHEMA] });
    await seedTestAccount(d1);
    await seedBystander(d1);
  }

  it('removes the account, its workspace, and everything under it', async () => {
    await build();
    await apply(d1, MIGRATION_024);

    expect(d1.rows('users').map((u) => u['email'])).toEqual([
      'demo@greenput.com',
    ]);
    expect(d1.rows('workspaces').map((w) => w['id'])).toEqual(['ws-002']);
    // The cascade, not a separate DELETE: nothing in the migration mentions
    // leads.
    expect(d1.rows('leads')).toHaveLength(0);
  });

  it('deletes the workspace first, so no created_by reference is orphaned', async () => {
    await build();
    // The assertion is that this does not throw. Reversing the two statements
    // in the migration makes it throw FOREIGN KEY constraint failed, because
    // leads.created_by still points at usr-001 when the user row goes.
    await expect(apply(d1, MIGRATION_024)).resolves.toBeUndefined();
  });

  it('is idempotent — a second run matches nothing and changes nothing', async () => {
    await build();
    await apply(d1, MIGRATION_024);
    const after = JSON.stringify([d1.rows('users'), d1.rows('workspaces')]);

    await apply(d1, MIGRATION_024);

    expect(JSON.stringify([d1.rows('users'), d1.rows('workspaces')])).toEqual(
      after,
    );
  });

  it('leaves a workspace standing when the account is not its only member', async () => {
    await build();
    await d1.db
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
         VALUES ('usr-003', 'ws-001', 'Sam', 'Okafor', 'sam@green.example',
                 'admin', '')`,
      )
      .run();
    // Nothing that account created may remain, or the second statement would
    // hit the same NOT NULL reference the first one is ordered to avoid.
    await d1.db.prepare(`DELETE FROM leads WHERE created_by = 'usr-001'`).run();

    await apply(d1, MIGRATION_024);

    expect(
      d1
        .rows('workspaces')
        .map((w) => w['id'])
        .sort(),
    ).toEqual(['ws-001', 'ws-002']);
    expect(
      d1
        .rows('users')
        .map((u) => u['email'])
        .sort(),
    ).toEqual(['demo@greenput.com', 'sam@green.example']);
  });
});

const MIGRATION_026 = readFileSync(
  resolve(
    __dirname,
    '../../../../migrations/026-drop-the-orphan-greenput-workspace.sql',
  ),
  'utf8',
);

describe('026-drop-the-orphan-greenput-workspace', () => {
  let d1: SqliteD1;

  afterEach(() => d1?.close());

  /** The leak: a workspace that committed before its users insert failed. */
  async function seedOrphan(d1: SqliteD1): Promise<void> {
    await d1.db
      .prepare(
        `INSERT INTO workspaces (id, name, slug, trade, phone, email, created_at)
         VALUES ('ws-orphan', 'GreenPut', NULL, 'general', '', '', '2026-03-01T00:00:00Z')`,
      )
      .run();
  }

  /** A real workspace that has not chosen a slug yet — it has an owner. */
  async function seedSluglessWithOwner(d1: SqliteD1): Promise<void> {
    await d1.db
      .prepare(
        `INSERT INTO workspaces (id, name, slug, trade, phone, email, created_at)
         VALUES ('ws-new', 'Fresh Signup', NULL, 'plumbing', '', '', '2026-03-01T00:00:00Z')`,
      )
      .run();
    await d1.db
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
         VALUES ('usr-new', 'ws-new', 'Pat', 'Owner', 'pat@fresh.example', 'owner', '')`,
      )
      .run();
  }

  it('removes a workspace with no slug and no users, and nothing else', async () => {
    d1 = createSqliteD1({ sql: [SCHEMA] });
    await seedOrphan(d1);
    await seedSluglessWithOwner(d1);
    await seedBystander(d1);

    await apply(d1, MIGRATION_026);

    expect(
      d1
        .rows('workspaces')
        .map((w) => w['id'])
        .sort(),
    ).toEqual(['ws-002', 'ws-new']);
  });

  it('is idempotent — a second run matches nothing', async () => {
    d1 = createSqliteD1({ sql: [SCHEMA] });
    await seedOrphan(d1);
    await apply(d1, MIGRATION_026);
    expect(d1.rows('workspaces')).toHaveLength(0);
    await expect(apply(d1, MIGRATION_026)).resolves.toBeUndefined();
  });
});
