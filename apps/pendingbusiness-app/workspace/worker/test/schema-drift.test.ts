/**
 * Schema-drift guard.
 *
 * The production incident this repairs: worker/src/routes/onboarding.ts
 * validated `filingStatus` against ['single','married_jointly',
 * 'married_separately','head_of_household'] while the live `users` table
 * (migrations/0001_init.sql) has always constrained the same column to
 * ('single','mfj','mfs','hoh','qw'). Every status except 'single' passed
 * this endpoint's validation and then violated the DB's CHECK constraint,
 * which onboarding.ts's catch block turned into a generic 500 — "Failed to
 * save onboarding." for the owner, on production.
 *
 * That drift was invisible to every existing test because none of them
 * compared the API's allow-list to the schema that actually enforces it —
 * they were two hand-maintained lists that quietly disagreed for months.
 * These tests read both sides live (the exported constant, and the actual
 * migration SQL on disk) so a future edit to either one that isn't mirrored
 * in the other fails CI instead of production.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { FILING_STATUSES } from '../src/routes/onboarding.js';
import { HOUSEHOLD_COLUMNS, HOUSEHOLD_BOUNDS } from '../src/routes/household.js';
import { INCOME_TYPES, LIABILITY_TYPES } from '@pendingbusiness/core';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

function loadAllMigrationsSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  expect(files.length).toBeGreaterThan(0); // sanity: we actually found the dir
  return files.map(f => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
}

/**
 * Extracts the quoted values from a `CHECK (<column> IN ('a','b',...))`
 * constraint for `column`, wherever in the migration history it was
 * defined (CREATE TABLE or ALTER TABLE ... ADD COLUMN ... CHECK). Each
 * constrained column is defined exactly once across the migration set —
 * SQLite can't ALTER a CHECK in place — so there's never more than one
 * match to worry about reconciling.
 */
function checkedValuesFor(sql: string, column: string): string[] {
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]+)\\)\\s*\\)`, 'i');
  const match = re.exec(sql);
  if (!match) {
    throw new Error(`No CHECK (${column} IN (...)) constraint found in the migration SQL.`);
  }
  return match[1].split(',').map(v => v.trim().replace(/^'(.*)'$/, '$1'));
}

describe('schema drift guard', () => {
  const migrationsSql = loadAllMigrationsSql();

  it('FILING_STATUSES (worker/src/routes/onboarding.ts) is exactly what users.filing_status permits', () => {
    const dbPermitted = checkedValuesFor(migrationsSql, 'filing_status');
    expect(new Set(FILING_STATUSES)).toEqual(new Set(dbPermitted));
    // Also catch accidental duplicates in the source array itself.
    expect(FILING_STATUSES.length).toBe(dbPermitted.length);
  });

  it('the roles the app ever assigns match exactly what users.role permits', () => {
    // No single exported constant enumerates this today (roles are seeded
    // via ADMIN_HANDLES → 'admin', or default to 'user' — see
    // worker/src/auth/stores.ts pbUsers.create / worker/src/routes/auth.ts
    // seedRoles). 'moderator' is reserved for future use. If the DB's role
    // vocabulary ever changes, this fails and tells you exactly what to fix
    // instead of leaving another silent drift for a future onboarding-style
    // 500.
    const dbPermitted = checkedValuesFor(migrationsSql, 'role');
    expect(new Set(dbPermitted)).toEqual(new Set(['user', 'moderator', 'admin']));
  });

  it('users.state has no CHECK constraint to drift from (documents the invariant, not a false pass)', () => {
    // state is validated only by the app (worker/src/routes/onboarding.ts
    // STATE_RX: two letters). Confirms nobody has added a DB-level CHECK
    // that the app doesn't know about — if they do, this test starts
    // failing and should grow a real assertion like the ones above.
    expect(() => checkedValuesFor(migrationsSql, 'state')).toThrow();
  });

  /*
   * PB-025: the household route reads six `users.*` columns that only exist
   * if 0006_household_profile.sql adds them. situation.test.ts fakes D1 and
   * would happily answer a SELECT for a column no migration created — this
   * is the assertion standing between that fix and a 500 on production.
   */
  it('every column /api/household reads is added to users by a migration, with a bound the route mirrors', () => {
    for (const [field, column] of Object.entries(HOUSEHOLD_COLUMNS)) {
      const add = new RegExp(
        `ALTER TABLE users ADD COLUMN ${column}\\s+(REAL|INTEGER)\\s+NOT NULL\\s+DEFAULT\\s+([0-9.]+)[^;]*CHECK\\s*\\(([^;]*)\\)`,
        'i',
      );
      const m = add.exec(migrationsSql);
      expect(
        m,
        `${column} must be ADDed to users with NOT NULL, a DEFAULT and a CHECK`,
      ).not.toBeNull();
      const [, type, def, check] = m!;
      const bounds = HOUSEHOLD_BOUNDS[field as keyof typeof HOUSEHOLD_BOUNDS];
      // Integer fields are INTEGER columns; amounts and fractions are REAL.
      expect(type!.toUpperCase(), column).toBe(bounds.integer ? 'INTEGER' : 'REAL');
      // The default is inside the route's accepted range, so a fresh row is
      // never one the route itself would refuse to write back.
      expect(Number(def), `${column} default`).toBeGreaterThanOrEqual(bounds.min);
      expect(Number(def), `${column} default`).toBeLessThanOrEqual(bounds.max);
      // The CHECK names the column and refuses negatives at least.
      expect(check, column).toContain(`${column} >= 0`);
    }
  });

  it('household defaults are 0 — not the old literals — except the conventional 50/50 salary split', () => {
    for (const column of Object.values(HOUSEHOLD_COLUMNS)) {
      const def = new RegExp(`ADD COLUMN ${column}[^;]*DEFAULT\\s+([0-9.]+)`, 'i').exec(
        migrationsSql,
      )?.[1];
      expect(Number(def), column).toBe(column === 'scorp_salary_split' ? 0.5 : 0);
    }
  });

  it('INCOME_TYPES (core) is exactly what income_sources.type permits', () => {
    const block = /CREATE TABLE IF NOT EXISTS income_sources[^;]*;/i.exec(migrationsSql)?.[0] ?? '';
    expect(new Set(INCOME_TYPES)).toEqual(new Set(checkedValuesFor(block, 'type')));
  });

  it('LIABILITY_TYPES (core) is exactly what liabilities.type permits', () => {
    const block = /CREATE TABLE IF NOT EXISTS liabilities[^;]*;/i.exec(migrationsSql)?.[0] ?? '';
    expect(new Set(LIABILITY_TYPES)).toEqual(new Set(checkedValuesFor(block, 'type')));
  });
});
