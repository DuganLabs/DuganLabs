#!/usr/bin/env node
// Fail the build when schema.sql declares something that no migration can give
// to a database that already exists.
//
// GreenPut has two schema paths. Fresh databases get schema.sql, which CREATEs
// every table complete. Long-lived databases (`greenput`, `greenput-staging`)
// can only ever be changed by an ALTER in migrations/. When a column is added
// to a CREATE TABLE body and no migration adds it, fresh databases look fine
// and CI stays green — until schema.sql is replayed over a live database and
// hits an index on the column that isn't there. That is what
//   no such column: custom_hostname at offset 234: SQLITE_ERROR
// was, and it stopped every GreenPut production deploy from PR #103 onward.
// The same mistake had already been made once before, for
// workspaces.stripe_customer_id, and went unnoticed for months.
//
// Two checks run here, both offline — no Cloudflare credentials, no network:
//
//   1. COLUMN COVERAGE (static). Every column schema.sql declares on a table
//      that predates migrations/ must be in the frozen baseline snapshot or
//      added by an `ALTER TABLE ... ADD COLUMN` in migrations/.
//
//   2. INDEX RESOLUTION (executable). A minimal database is synthesised from
//      the baseline, the migrations are replayed against it, and then every
//      CREATE INDEX in schema.sql is executed. This reproduces the exact
//      production failure in milliseconds if it ever comes back.
//
// Usage: node scripts/db/check-migration-coverage.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = join(ROOT, 'migrations');
const BASELINE = join(MIGRATIONS, '000-baseline-columns.tsv');
const BASELINE_NOTNULL = join(MIGRATIONS, '000-baseline-notnull.tsv');

const errors = [];
const fail = (msg) => errors.push(msg);

// ── Strip SQL comments without touching string literals ──────────────────────
function stripComments(sql) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < sql.length) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ── Baseline: the frozen column inventory of the live databases ──────────────
const baseline = new Map();
for (const line of readFileSync(BASELINE, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [table, cols] = line.split('\t');
  baseline.set(table, new Set(cols.split(',')));
}
if (baseline.size === 0) fail(`baseline snapshot ${BASELINE} parsed to zero tables`);

// ── Baseline: which columns the live databases declare NOT NULL ──────────────
const baselineNotNull = new Map();
for (const line of readFileSync(BASELINE_NOTNULL, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [table, cols] = line.split('\t');
  baselineNotNull.set(table, new Set(cols.split(',')));
}
if (baselineNotNull.size === 0) fail(`baseline snapshot ${BASELINE_NOTNULL} parsed to zero tables`);

// ── schema.sql: what the code believes the schema is ─────────────────────────
const schemaSrc = stripComments(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));

function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

const TABLE_CONSTRAINTS = new Set([
  'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'EXCLUDE',
]);

// Column declarations, with the two facts that matter beyond the name.
const schemaMeta = new Map(); // table -> Map(column -> {notNull, hasDefault})

function parseCreateTables(sql) {
  const tables = new Map();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    const body = sql.slice(re.lastIndex, i - 1);
    const cols = [];
    const meta = new Map();
    for (const part of splitTopLevel(body)) {
      const t = part.trim();
      if (!t) continue;
      const first = t.split(/\s+/)[0].replace(/["'`]/g, '');
      if (TABLE_CONSTRAINTS.has(first.toUpperCase().split('(')[0])) continue;
      cols.push(first);
      meta.set(first, {
        notNull: /\bNOT\s+NULL\b/i.test(t),
        hasDefault: /\bDEFAULT\b/i.test(t),
        unique: /\bUNIQUE\b/i.test(t),
        check: /\bCHECK\s*\(/i.test(t),
      });
    }
    tables.set(name, cols);
    schemaMeta.set(name, meta);
  }
  return tables;
}

const schemaTables = parseCreateTables(schemaSrc);
if (schemaTables.size === 0) fail('schema.sql parsed to zero tables — the parser is broken, not the schema');

// ── migrations: what an existing database can actually be given ──────────────
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
if (migrationFiles.length === 0) fail('migrations/ contains no .sql files');

const added = new Map(); // table -> Set(columns added by migrations)
const createdByMigration = new Set();

for (const file of migrationFiles) {
  const raw = readFileSync(join(MIGRATIONS, file), 'utf8');
  const perStatement = /^--\s*@apply:\s*per-statement/m.test(raw.split('\n')[0]);
  const sql = stripComments(raw);

  // A per-statement file is split on newlines by the runner, so a statement
  // that spans lines would be torn in half and applied as garbage.
  if (perStatement) {
    for (const stmt of sql.split(';')) {
      const t = stmt.trim();
      if (!t) continue;
      if (t.includes('\n')) {
        fail(`${file}: declares "@apply: per-statement" but has a statement spanning multiple lines:\n    ${t.replace(/\n/g, '\\n').slice(0, 120)}`);
      }
    }
  }

  for (const m of sql.matchAll(/ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+(?:COLUMN\s+)?["'`]?(\w+)["'`]?/gi)) {
    if (!added.has(m[1])) added.set(m[1], new Set());
    added.get(m[1]).add(m[2]);
  }
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)) {
    createdByMigration.add(m[1]);
  }
}

// ── Check 1: column coverage ─────────────────────────────────────────────────
for (const [table, cols] of schemaTables) {
  const base = baseline.get(table);
  if (!base) continue; // new table — CREATE TABLE gives a live database everything
  const reachable = new Set([...base, ...(added.get(table) ?? [])]);
  const missing = cols.filter((c) => !reachable.has(c));
  if (missing.length > 0) {
    fail(
      `schema.sql declares ${table}.{${missing.join(', ')}} but no migration adds ` +
      `${missing.length > 1 ? 'them' : 'it'}.\n` +
      `    A database created before migrations/ will never get ${missing.length > 1 ? 'these columns' : 'this column'}.\n` +
      `    Fix: add "ALTER TABLE ${table} ADD COLUMN ${missing[0]} ...;" to a new file in migrations/.`
    );
  }
}

// ── Check 1b: NOT NULL must agree between schema.sql and the live databases ──
//
// A column present on both sides can still disagree about whether NULL is
// allowed, and that disagreement is invisible until it 500s in production.
// schema.sql declared `users.password_hash TEXT` — nullable, for passwordless
// signup — while the live table declared it NOT NULL. Fresh databases worked.
// The real one rejected every attempt to create an account.
//
// SQLite cannot ALTER a column's nullability, so this is never resolved by
// editing the baseline: either the code stops writing NULL, or the table is
// rebuilt in a migration.
for (const [table, cols] of schemaTables) {
  const liveNotNull = baselineNotNull.get(table);
  if (!liveNotNull) continue; // new table — no live copy to disagree with
  const meta = schemaMeta.get(table) ?? new Map();
  const addedHere = added.get(table) ?? new Set();

  for (const col of cols) {
    const declaredNotNull = meta.get(col)?.notNull ?? false;
    const liveIsNotNull = liveNotNull.has(col);
    if (declaredNotNull === liveIsNotNull) continue;

    if (!declaredNotNull && liveIsNotNull) {
      fail(
        `${table}.${col} is nullable in schema.sql but NOT NULL in the live databases.\n` +
        `    Code written against schema.sql may write NULL here, and the insert will fail\n` +
        `    in production while passing against a fresh database. This is what broke\n` +
        `    /api/auth/register.\n` +
        `    Fix: write a real value instead of NULL, or rebuild the table in a migration.\n` +
        `    Do NOT "fix" it by editing migrations/000-baseline-notnull.tsv.`
      );
      continue;
    }

    // declaredNotNull && !liveIsNotNull
    if (addedHere.has(col) && meta.get(col)?.hasDefault) {
      // Expected and documented: ALTER TABLE ADD COLUMN cannot add NOT NULL with
      // a CHECK to a populated table, so additive migrations add the column
      // nullable with a default and backfill. schema.sql's stricter form applies
      // to fresh databases; the application layer enforces it on migrated ones.
      continue;
    }
    fail(
      `${table}.${col} is NOT NULL in schema.sql but nullable in the live databases.\n` +
      `    The live table may already hold NULLs that code reading schema.sql does not\n` +
      `    expect. If this is the documented ADD COLUMN limitation, the column must be\n` +
      `    added by a migration in migrations/ and declared with a DEFAULT in schema.sql.`
    );
  }
}

// ── Check 1c: a constraint ADD COLUMN cannot carry is not a constraint ───────
//
// SQLite's `ALTER TABLE ... ADD COLUMN` accepts NOT NULL-with-a-default and a
// DEFAULT, and nothing else: a column-level UNIQUE or CHECK in the ADD COLUMN
// is rejected outright. So when schema.sql declares one on a column that a
// migration adds, the constraint exists in fresh databases and in every test
// fixture built from schema.sql, and NOWHERE in `greenput` or
// `greenput-staging`. Tests then pass for a reason production does not have.
//
// That is exactly how `workspaces.slug TEXT UNIQUE` shipped: /api/auth/register
// was built to let that constraint arbitrate concurrent signups, 28 tests
// against schema.sql agreed, and on the live database two simultaneous signups
// of the same company name both wrote the same slug — with six tenant lookups
// of the form `WHERE slug = ? LIMIT 1` then free to serve the wrong contractor.
// Checks 1 and 1b did not see it: they track column presence and NOT NULL.
//
// THE FIX for UNIQUE is a `CREATE UNIQUE INDEX` (partial, if NULLs are legal),
// declared in schema.sql AND created by a migration — an index CAN be added to
// a populated table, so both database shapes get the identical guarantee. See
// idx_workspaces_slug_unique and migrations/015-workspaces-slug-unique.sql.
//
// THE FIX for CHECK is either a table rebuild in a migration or enforcement in
// the application layer. The three entries below are the pre-existing, known
// cases: each is enforced by a Zod validator and a route handler, and each is
// documented where it is declared. The list is frozen — it exists so a NEW
// unenforceable constraint fails the build instead of joining them silently.
const KNOWN_UNENFORCEABLE = new Set([
  'workspaces.billing_status:CHECK',
  'workspaces.custom_domain_status:CHECK',
  'workspaces.custom_domain_verification_method:CHECK',
  // 029 (GP-105): enforced by LEAD_WITHDRAWN_REASONS in libs/shared/models —
  // the validator on POST /api/leads/:id/withdraw and the tenant site's
  // cancel form both refuse anything outside the set before it reaches D1.
  'leads.withdrawn_reason:CHECK',
]);

for (const [table, cols] of schemaTables) {
  if (!baseline.has(table)) continue; // new table — CREATE TABLE carries it
  const meta = schemaMeta.get(table) ?? new Map();
  const addedHere = added.get(table) ?? new Set();
  for (const col of cols) {
    if (!addedHere.has(col)) continue; // in the baseline: the live shape is whatever it is
    for (const kind of ['UNIQUE', 'CHECK']) {
      const declared = kind === 'UNIQUE' ? meta.get(col)?.unique : meta.get(col)?.check;
      if (!declared) continue;
      if (KNOWN_UNENFORCEABLE.has(`${table}.${col}:${kind}`)) continue;
      fail(
        `schema.sql declares a column-level ${kind} on ${table}.${col}, but that column is ` +
        `added by an ALTER TABLE ADD COLUMN in migrations/.\n` +
        `    SQLite's ADD COLUMN cannot carry ${kind}, so the live databases do not have it and never will.\n` +
        `    Code and tests written against schema.sql would rely on a constraint production lacks.\n` +
        (kind === 'UNIQUE'
          ? `    Fix: drop the column-level UNIQUE and add "CREATE UNIQUE INDEX IF NOT EXISTS ... ON ${table}(${col})"\n` +
            `    (add "WHERE ${col} IS NOT NULL" if NULLs are legal) to schema.sql AND to a new file in migrations/.`
          : `    Fix: enforce it in the application layer and add it to KNOWN_UNENFORCEABLE here, or rebuild the table in a migration.`)
      );
    }
  }
}

// ── Check 2: every baseline table is still owned by schema.sql ───────────────
for (const table of baseline.keys()) {
  if (!schemaTables.has(table) && !createdByMigration.has(table)) {
    fail(
      `${table} exists in the live databases but schema.sql no longer declares it.\n` +
      `    Either restore its CREATE TABLE or write the migration that drops it.`
    );
  }
}

// ── Check 3: replay the real thing and execute schema.sql's indexes ──────────
// Synthesise the baseline as real tables (types don't matter for name
// resolution), replay the migrations, then run every index schema.sql declares.
if (errors.length === 0) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const [table, cols] of baseline) {
    db.exec(`CREATE TABLE ${table} (${[...cols].map((c) => `"${c}" TEXT`).join(', ')});`);
  }
  for (const file of migrationFiles) {
    const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
    for (const stmt of sql.split(';')) {
      const t = stmt.trim();
      if (!t) continue;
      try {
        db.exec(t + ';');
      } catch (e) {
        // Already-applied is the normal case against a live database; the
        // synthesised baseline makes some of these fire here too.
        if (!/duplicate column name|already exists|no such table/i.test(e.message)) {
          fail(`migrations/${file} is not replayable: ${e.message}\n    statement: ${t.slice(0, 140)}`);
        }
      }
    }
  }
  // Now the payload: the exact statements that broke production.
  for (const m of schemaSrc.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*;/gi)) {
    const stmt = m[0];
    const onTable = /\bON\s+["'`]?(\w+)["'`]?/i.exec(stmt)?.[1];
    if (!onTable || !baseline.has(onTable)) continue; // index on a new table
    try {
      db.exec(stmt);
    } catch (e) {
      if (/already exists/i.test(e.message)) continue;
      fail(
        `schema.sql cannot be replayed over a migrated database:\n` +
        `    ${stmt.replace(/\s+/g, ' ').slice(0, 160)}\n` +
        `    ${e.message}\n` +
        `    This is the failure that stopped production deploys. Add the missing migration.`
      );
    }
  }
  db.close();
}

// ── Report ───────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('\nSchema/migration drift detected:\n');
  for (const e of errors) console.error(`  ✗ ${e}\n`);
  console.error(
    `${errors.length} problem${errors.length > 1 ? 's' : ''}. ` +
    `Every column in schema.sql needs a migration that can add it to a database that already exists.\n`
  );
  process.exit(1);
}

console.log(
  `Schema/migration coverage OK — ${schemaTables.size} tables in schema.sql, ` +
  `${migrationFiles.length} migrations, ${baseline.size} baseline tables, ` +
  `all schema.sql indexes replay cleanly over a migrated database.`
);
