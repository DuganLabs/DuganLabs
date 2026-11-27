# Rollbacks

Hand-run down scripts for migrations in `migrations/`. **Nothing runs these
automatically.** `scripts/db/migrate.sh` and `check-migration-coverage.mjs`
only read `migrations/`; these live outside it on purpose so no migration tooling ever picks them up.

To roll a migration back on a long-lived database:

1. Revert the PR that added it and let that revert deploy. The deploy job
   re-applies `schema.sql` (`CREATE TABLE IF NOT EXISTS`), so if the PR's
   schema is still on main it would recreate whatever you drop.
2. Run the down script, e.g.
   `pnpm exec wrangler d1 execute greenput --remote --file=../../scripts/db/rollback/045-change-orders.down.sql`
   from `apps/api`.
3. The script also deletes the migration's `schema_migrations` row, so a
   later re-land applies it again.

Each down script is the exact inverse of its migration, so the database ends
up back where it was. Dropping a table or column discards whatever data it held.
