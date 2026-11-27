#!/usr/bin/env bash
# Apply every unapplied migration in migrations/ to a D1 database, in order.
#
# This is the ONLY sanctioned way to change a long-lived GreenPut database.
# Production CI and scripts/staging/setup.sh both call it, so the two paths
# cannot drift apart — which is exactly how `custom_hostname` reached
# schema.sql with a migration in neither and broke every main deploy from
# PR #103 onward.
#
# Usage: scripts/db/migrate.sh <database-name> [--remote|--local]
#
# LEDGER
#   A `schema_migrations` table records what has run, so each migration is
#   applied exactly once. This matters: 002 and 007 rebuild a table by copying
#   it, dropping it and renaming the copy. Before the ledger those ran on every
#   single deploy, rebuilding `activity_log` and `lead_meter_events` each time
#   and leaving a window where a failure between DROP and RENAME loses the
#   table. Now they run once.
#
#   On a database that predates the ledger, it is created and pre-seeded from
#   migrations/000-applied-at-baseline.txt — the migrations already applied
#   when the baseline snapshot was taken. Without that seed the recreates would
#   run one unnecessary final time.
#
# FRESH DATABASES
#   If the database has no tables, migrations are skipped entirely. There is
#   nothing to ALTER yet; schema.sql creates every table complete. Every
#   migration is still recorded as applied, because schema.sql's output already
#   includes their effect.
#
# Migrations are append-only. Never edit one that has merged — a database that
# already ran it will not run it again. Add a new file instead.
set -uo pipefail

DB_NAME="${1:?usage: migrate.sh <database-name> [--remote|--local]}"
MODE="${2:---remote}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/migrations"
SEED_LIST="$MIGRATIONS_DIR/000-applied-at-baseline.txt"

[ -d "$MIGRATIONS_DIR" ] || { echo "ERROR: no migrations directory at $MIGRATIONS_DIR" >&2; exit 1; }

d1() { pnpm exec wrangler d1 execute "$DB_NAME" "$MODE" "$@" 2>&1; }

# Read a single column out of a D1 query as newline-separated values.
d1_values() {
  local sql="$1" out
  out="$(pnpm exec wrangler d1 execute "$DB_NAME" "$MODE" --command "$sql" --json 2>/dev/null)" || return 1
  node --no-warnings -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      // wrangler wraps the JSON payload in banner and warning lines, on both
      // sides, so neither "starts with [" nor "ends with ]" holds. Find every
      // "[", bracket-match it to its close, and take the first slice that
      // parses as the result array.
      let parsed = null;
      for (let i = 0; i < raw.length && !parsed; i++) {
        if (raw[i] !== "[") continue;
        let depth = 0, quote = false, esc = false;
        for (let j = i; j < raw.length; j++) {
          const c = raw[j];
          if (esc) { esc = false; continue; }
          if (quote) { if (c === "\\") esc = true; else if (c === "\"") quote = false; continue; }
          if (c === "\"") { quote = true; continue; }
          if (c === "[") depth++;
          else if (c === "]" && --depth === 0) {
            try { parsed = JSON.parse(raw.slice(i, j + 1)); } catch {}
            break;
          }
        }
      }
      if (!parsed) process.exit(0);
      for (const block of [].concat(parsed)) {
        for (const row of block?.results ?? []) {
          for (const v of Object.values(row)) if (v != null) console.log(v);
        }
      }
    });
  ' <<<"$out"
}

echo "==> Migrating '${DB_NAME}' (${MODE})"

# ── Is this a fresh database? ────────────────────────────────────────────────
table_count="$(d1_values "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%';" | head -n1)"
if [ -z "$table_count" ]; then
  echo "ERROR: could not read sqlite_master from '${DB_NAME}'. Aborting rather than guessing." >&2
  exit 1
fi
FRESH=0
if [ "$table_count" -eq 0 ]; then
  FRESH=1
  echo "  Database is empty — schema.sql will create every table complete."
  echo "  Recording all migrations as applied without running them."
fi

# ── Ledger ───────────────────────────────────────────────────────────────────
ledger_existed="$(d1_values "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations';" | head -n1)"
d1 --command "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));" >/dev/null

if [ "${ledger_existed:-0}" -eq 0 ] && [ "$FRESH" -eq 0 ] && [ -f "$SEED_LIST" ]; then
  echo "  First run on an existing database — seeding the ledger from $(basename "$SEED_LIST")"
  while IFS= read -r seed; do
    seed="${seed%%#*}"; seed="$(echo "$seed" | tr -d '[:space:]')"
    [ -n "$seed" ] || continue
    d1 --command "INSERT OR IGNORE INTO schema_migrations (name) VALUES ('${seed}');" >/dev/null
    echo "     pre-applied: ${seed}"
  done < "$SEED_LIST"
fi

applied_list="$(d1_values "SELECT name FROM schema_migrations;")"

is_applied() { grep -Fxq "$1" <<<"$applied_list"; }

# ── Apply ────────────────────────────────────────────────────────────────────
ran=0; already=0

record() { d1 --command "INSERT OR IGNORE INTO schema_migrations (name) VALUES ('$1');" >/dev/null; }

for file in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$file" ] || continue
  name="$(basename "$file")"

  if is_applied "$name"; then
    already=$((already + 1))
    continue
  fi

  if [ "$FRESH" -eq 1 ]; then
    record "$name"
    already=$((already + 1))
    continue
  fi

  echo "  → ${name}"

  if head -n1 "$file" | grep -q '@apply: per-statement'; then
    # Each statement applied separately. An additive migration MUST use this:
    # applied whole, a file of ten ALTERs aborts on the first column that
    # already exists and silently leaves the other nine unapplied.
    failed=0
    while IFS= read -r stmt; do
      [ -n "$stmt" ] || continue
      output="$(d1 --command "$stmt")"
      if [ $? -ne 0 ]; then
        if grep -qiE 'duplicate column name|already exists' <<<"$output"; then
          continue  # column already present — the point of per-statement mode
        fi
        echo "$output" >&2
        echo "ERROR: ${name} failed on: ${stmt}" >&2
        failed=1
        break
      fi
    done < <(sed 's/--.*$//' "$file" | tr -d '\n' | tr ';' '\n' \
             | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | sed 's/$/;/')
    [ "$failed" -eq 0 ] || exit 1
  else
    if ! output="$(pnpm exec wrangler d1 execute "$DB_NAME" --file="$file" "$MODE" 2>&1)"; then
      echo "$output" >&2
      echo "ERROR: migration ${name} failed." >&2
      exit 1
    fi
  fi

  record "$name"
  ran=$((ran + 1))
done

echo "==> Migrations complete: ${ran} applied now, ${already} already recorded"
