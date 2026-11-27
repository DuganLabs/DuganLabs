# Migrations

`schema.sql` is the schema a **fresh** database gets: every table created
complete. This directory is how an **existing** database gets there.

GreenPut has two long-lived databases, `greenput` and `greenput-staging`. They
can only ever be changed by an `ALTER` here. Adding a column to a `CREATE TABLE`
body in `schema.sql` does nothing for them.

## The rule

> Every column in `schema.sql` needs a migration that can add it to a database
> that already exists.

`scripts/db/check-migration-coverage.mjs` enforces this in CI, offline, and
`deploy-staging` depends on it. A column added without a migration fails the
build in milliseconds.

## Adding one

1. Add the column to its `CREATE TABLE` in `schema.sql`.
2. Add `migrations/NNN-what-it-does.sql` with the matching `ALTER`.
3. Run `pnpm db:check`.

Migrations are **append-only**. Never edit one that has merged — a database
that already ran it will not run it again. Add a new file instead.

## Apply modes

A migration is applied as one unit by default. Put `-- @apply: per-statement`
on the first line and each statement is applied separately, with
already-present columns skipped and the rest still applied. **Additive column
migrations must use this.** Applied whole, a file of ten `ALTER`s aborts on the
first column that already exists and silently leaves the other nine unapplied,
reporting success over a half-migrated database.

Per-statement files must keep each statement on one line. The coverage check
rejects multi-line statements in them, because the runner splits on newlines.

## SQLite limits

`ALTER TABLE ... ADD COLUMN` cannot add a `NOT NULL` column with a `CHECK` to a
populated table. Add it nullable with a default and backfill with an `UPDATE`
(see `009-workspaces-custom-domain.sql`). The stricter constraint in
`schema.sql` then applies to fresh databases, and the application layer is the
enforcement point on migrated ones.

`ADD COLUMN` cannot carry a `UNIQUE` either — and unlike the `CHECK` case there
is a real fix, so there is no excuse for the divergence. Declare a
`CREATE UNIQUE INDEX IF NOT EXISTS` (partial, `WHERE col IS NOT NULL`, if NULLs
are legal) in `schema.sql` **and** create it in a migration: an index can be
added to a populated table, so both database shapes get the identical
guarantee. See `015-workspaces-slug-unique.sql`.

A column-level `UNIQUE` on an ALTER-added column now fails `pnpm db:check`.
It has to: `workspaces.slug TEXT UNIQUE` sat in `schema.sql` for months while
neither live database had it. `/api/auth/register` was written to let that
constraint arbitrate two simultaneous signups of the same company name, 28 tests
built from `schema.sql` agreed it worked, and in production both signups wrote
the same slug — with six tenant lookups of the form `WHERE slug = ? LIMIT 1`
then free to serve, and attribute inbound leads to, the wrong contractor. A test
fixture built from `schema.sql` must not be able to be stricter than production.

Widening a `CHECK` or changing a foreign key needs a table rewrite, which D1
cannot defer past an `ON DELETE RESTRICT` parent. See the note in
`006-leads-lifecycle.sql`.

## How it runs

`scripts/db/migrate.sh <database> --remote` is the only sanctioned way to
change a database. Production CI and `scripts/staging/setup.sh` both call it,
so they cannot drift apart. Preview skips it: it recreates its database empty,
so `schema.sql` alone gives it everything.

Nine tables in the live databases predate this and are tracked nowhere. See
[`docs/UNTRACKED-PRODUCTION-TABLES.md`](../docs/UNTRACKED-PRODUCTION-TABLES.md).

## Rebuilding a table

`002` and `007` add a constraint SQLite cannot add in place, so they copy the
table, drop the original and rename the copy. Two rules:

- **The copy uses `INSERT OR IGNORE`, which silently drops any row the new
  constraints reject.** A row that violates the new `NOT NULL` or `UNIQUE` is
  not an error — it just disappears, and the original is dropped straight
  after. Before merging a rebuild, count the rows that would be rejected on
  every live database and say so in the migration.
- **Rebuilds run once, not per deploy.** That is what the `schema_migrations`
  ledger is for. Before it existed these ran on every push to main, rebuilding
  the table each time and reopening the window where a failure between `DROP`
  and `RENAME` loses it outright.

`scripts/db/test-migrate.sh` asserts that a rebuild preserves its rows.
