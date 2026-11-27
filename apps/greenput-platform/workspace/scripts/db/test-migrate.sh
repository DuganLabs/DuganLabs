#!/usr/bin/env bash
# Test scripts/db/migrate.sh against a real SQLite database, offline.
#
# wrangler is replaced by a stub that runs the SQL through node:sqlite, so the
# runner's actual logic — fresh-database detection, ledger seeding,
# per-statement application, idempotence — is exercised without Cloudflare
# credentials or a network.
#
# The database under test is built from migrations/000-baseline-columns.tsv,
# so it has exactly the columns the live databases had on 2026-09-11. If a
# migration would fail or lose data in production, it fails here first. That is
# not hypothetical: writing this test is what caught 006 and 007 being wrongly
# listed as already applied.
#
# Usage: scripts/db/test-migrate.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TESTDIR="$(mktemp -d)"
export TESTDIR
trap 'rm -rf "$TESTDIR"' EXIT
mkdir -p "$TESTDIR/bin"

pass=0
fail=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
    pass=$((pass + 1))
  else
    echo "  FAIL $1 — got '$2', want '$3'"
    fail=$((fail + 1))
  fi
}

# ── wrangler stub ────────────────────────────────────────────────────────────
cat > "$TESTDIR/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
# Stands in for `pnpm exec wrangler d1 execute`, backed by node:sqlite.
shift 4   # exec wrangler d1 execute
DB="$1"; shift
JSON=0; SQL=""; FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON=1 ;;
    --command) shift; SQL="$1" ;;
    --file=*) FILE="${1#--file=}" ;;
  esac
  shift
done
export STUB_DB="$TESTDIR/$DB.sqlite" STUB_SQL="$SQL" STUB_FILE="$FILE" STUB_JSON="$JSON"
# Banner lines on both sides, because real wrangler prints them and the runner
# has to find the JSON payload in among them.
echo "⛅️ wrangler (stub)"
node --no-warnings -e '
const {DatabaseSync} = require("node:sqlite");
const fs = require("fs");
const db = new DatabaseSync(process.env.STUB_DB);
const sql = process.env.STUB_FILE ? fs.readFileSync(process.env.STUB_FILE, "utf8") : process.env.STUB_SQL;
try {
  if (process.env.STUB_JSON === "1") {
    console.log(JSON.stringify([{ results: db.prepare(sql).all(), success: true }]));
  } else {
    db.exec(sql);
  }
} catch (e) { console.error(e.message); process.exit(1); }
'
status=$?
echo "🌀 done (stub)"
exit $status
STUB
chmod +x "$TESTDIR/bin/pnpm"
export PATH="$TESTDIR/bin:$PATH"

sq() { # sq <db> <sql> -> single scalar
  STUB_DB="$TESTDIR/$1.sqlite" STUB_Q="$2" node --no-warnings -e '
    const {DatabaseSync} = require("node:sqlite");
    const db = new DatabaseSync(process.env.STUB_DB);
    const row = db.prepare(process.env.STUB_Q).get();
    console.log(row ? String(Object.values(row)[0]) : "");
  '
}

build_prodsim() { # a database shaped like the live ones before migrating
  STUB_DB="$TESTDIR/${1:-prodsim}.sqlite" ROOT="$REPO_ROOT" node --no-warnings -e '
    const {DatabaseSync} = require("node:sqlite");
    const fs = require("fs");
    const db = new DatabaseSync(process.env.STUB_DB);
    const tsv = fs.readFileSync(process.env.ROOT + "/migrations/000-baseline-columns.tsv", "utf8");
    for (const line of tsv.split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [t, c] = line.split("\t");
      const cols = c.split(",").map((x) => (x === "id" ? `"id" TEXT PRIMARY KEY` : `"${x}" TEXT`));
      db.exec(`CREATE TABLE ${t} (${cols.join(", ")});`);
    }
    // created_at is set on every workspace, because it is NOT NULL on both
    // live databases (000-baseline-notnull.tsv) and 013 backfills updated_at
    // from it. Distinct per row, so a backfill that stamped one value over
    // everything — or "now" — would not pass by coincidence.
    db.prepare("INSERT INTO workspaces (id,name,slug,phone,created_at) VALUES (?,?,?,?,?)").run("w1", "Acme Electric", "acme", "(949) 555-0187", "2026-08-01T00:00:00Z");
    // 012 normalises stored phones. Three shapes, to prove it converts what it
    // should and leaves alone what it should not.
    db.prepare("INSERT INTO workspaces (id,name,slug,phone,created_at) VALUES (?,?,?,?,?)").run("w2", "Already Normal", "norm", "+18005550100", "2026-08-02T00:00:00Z");
    db.prepare("INSERT INTO workspaces (id,name,slug,phone,created_at) VALUES (?,?,?,?,?)").run("w3", "Odd Phone", "odd", "ext 0187", "2026-08-03T00:00:00Z");
    db.prepare("INSERT INTO workspaces (id,name,slug,phone,created_at) VALUES (?,?,?,?,?)").run("w4", "Blank Phone", "blank", "", "2026-08-04T00:00:00Z");
    db.prepare("INSERT INTO users (id,workspace_id,first_name,last_name,email,role,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("u1", "w1", "Ada", "Byron", "ada@acme.example", "owner", "", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
    db.prepare("INSERT INTO leads (id,workspace_id,first_name) VALUES (?,?,?)").run("l1", "w1", "Alexander");
    db.prepare("INSERT INTO lead_meter_events (id,workspace_id,lead_id,vertical,service_type,price_usd,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("m1", "w1", "l1", "electrical", "ev_charger", "85", "pending", "", "2026-09-01T00:00:00Z");
    db.prepare("INSERT INTO activity_log (id,workspace_id,entity_type,entity_id,action,created_at) VALUES (?,?,?,?,?,?)")
      .run("a1", "w1", "lead", "l1", "created", "2026-09-01T00:00:00Z");
    // 028 backfills job_slots from the jobs that exist. Four shapes: two
    // clean jobs (a 2.5-hour one and a zero-length GP-037-era one), a pair
    // that genuinely overlaps, and a cancelled job that must claim nothing.
    const job = db.prepare("INSERT INTO jobs (id,workspace_id,opportunity_id,customer_id,job_number,title,status,scheduled_start,scheduled_end,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    job.run("j1", "w1", "o1", "c1", "#1001", "Panel", "scheduled", "2026-10-05T09:00:00.000Z", "2026-10-05T11:30:00.000Z", "2026-09-01T00:00:00Z", "u1");
    job.run("j2", "w1", "o1", "c1", "#1002", "Convert-to-job zero length", "scheduled", "2026-10-06T14:00:00.000Z", "2026-10-06T14:00:00.000Z", "2026-09-02T00:00:00Z", "u1");
    job.run("j3", "w1", "o1", "c1", "#1003", "Overlaps j1 from 11:00", "in_progress", "2026-10-05T11:00:00.000Z", "2026-10-05T12:00:00.000Z", "2026-09-03T00:00:00Z", "u1");
    job.run("j4", "w1", "o1", "c1", "#1004", "Cancelled", "cancelled", "2026-10-07T09:00:00.000Z", "2026-10-07T10:00:00.000Z", "2026-09-04T00:00:00Z", "u1");
  '
}

echo "== migrate.sh =="

MIGRATION_COUNT="$(find "$REPO_ROOT/migrations" -name '*.sql' | wc -l | tr -d ' ')"

# ── 1. A fresh database must skip every migration and record them all ────────
"$REPO_ROOT/scripts/db/migrate.sh" freshdb --remote >/dev/null 2>&1
check "fresh database records all migrations without running them" \
  "$(sq freshdb 'SELECT COUNT(*) n FROM schema_migrations')" "$MIGRATION_COUNT"
check "fresh database gains no tables beyond the ledger" \
  "$(sq freshdb "SELECT COUNT(*) n FROM sqlite_master WHERE type='table'")" "1"

# ── 2. A live-shaped database gets exactly the unapplied migrations ──────────
build_prodsim
out="$("$REPO_ROOT/scripts/db/migrate.sh" prodsim --remote 2>&1)"
check "ledger seeded from 000-applied-at-baseline.txt" \
  "$(grep -c 'pre-applied:' <<<"$out")" "5"
check "the four unapplied migrations run" \
  "$(grep -cE '^  → 0(06|07|08|09)' <<<"$out")" "4"

# ── 3. Every column production was missing must now exist ────────────────────
for col in stripe_customer_id stripe_account_id custom_hostname custom_domain_status \
           custom_domain_verification_method custom_domain_verification_token \
           custom_domain_cf_hostname_id custom_domain_failure_reason \
           custom_domain_requested_at custom_domain_verified_at \
           custom_domain_last_checked_at custom_domain_setup_fee_paid_at; do
  check "workspaces.$col added" \
    "$(sq prodsim "SELECT COUNT(*) n FROM pragma_table_info('workspaces') WHERE name='$col'")" "1"
done
for col in qualified_at accepted_at withdrawn_at withdrawn_reason; do
  check "leads.$col added" \
    "$(sq prodsim "SELECT COUNT(*) n FROM pragma_table_info('leads') WHERE name='$col'")" "1"
done
check "customers.stripe_customer_id added" \
  "$(sq prodsim "SELECT COUNT(*) n FROM pragma_table_info('customers') WHERE name='stripe_customer_id'")" "1"
# 033 (GP-039): the three signup answers the wizard collected and never
# stored. Existing rows get NULL / NULL / '[]' — never a backfill from `trade`.
for col in service_area service_radius_miles service_types; do
  check "workspaces.$col added" \
    "$(sq prodsim "SELECT COUNT(*) n FROM pragma_table_info('workspaces') WHERE name='$col'")" "1"
done
check "033 gives every existing workspace an empty service_types array" \
  "$(sq prodsim "SELECT COUNT(*) n FROM workspaces WHERE service_types = '[]'")" "$(sq prodsim 'SELECT COUNT(*) n FROM workspaces')"
check "033 leaves service_area NULL on a workspace that never gave one" \
  "$(sq prodsim "SELECT COUNT(*) n FROM workspaces WHERE service_area IS NULL AND service_radius_miles IS NULL")" "$(sq prodsim 'SELECT COUNT(*) n FROM workspaces')"

# ── 4. The backfill in 009 must leave no NULL status ─────────────────────────
check "custom_domain_status backfilled" \
  "$(sq prodsim 'SELECT custom_domain_status v FROM workspaces')" "none"

# ── 5. Table-rebuilding migrations must not lose rows ────────────────────────
# 007 copies with INSERT OR IGNORE, which silently drops any row the new
# constraints reject. Production rows are fully populated, so none should be.
check "007 preserves lead_meter_events rows" "$(sq prodsim 'SELECT COUNT(*) n FROM lead_meter_events')" "1"
check "007 preserves row contents" "$(sq prodsim 'SELECT service_type v FROM lead_meter_events')" "ev_charger"
# 007 added UNIQUE(lead_id); 043 (WS-1, fee at booking) widened it to
# UNIQUE(lead_id, workspace_id) — one fee per lead per shop, so a rebook
# at a different shop bills that shop. The end-state constraint is 043's.
check "043 widens 007's UNIQUE(lead_id) to UNIQUE(lead_id, workspace_id)" \
  "$(sq prodsim "SELECT CASE WHEN sql LIKE '%UNIQUE(lead_id, workspace_id)%' THEN 1 ELSE 0 END v FROM sqlite_master WHERE name='lead_meter_events'")" "1"
check "activity_log rows survive" "$(sq prodsim 'SELECT COUNT(*) n FROM activity_log')" "1"
check "workspace data survives" "$(sq prodsim 'SELECT name v FROM workspaces')" "Acme Electric"

# ── 5b. 011 adds the recovery-phone column and its partial unique index ──────
check "users.recovery_phone added" \
  "$(sq prodsim "SELECT COUNT(*) n FROM pragma_table_info('users') WHERE name='recovery_phone'")" "1"
check "011 leaves existing users with no recovery number" \
  "$(sq prodsim "SELECT COUNT(*) n FROM users WHERE recovery_phone IS NOT NULL")" "0"
check "011 creates the partial unique index" \
  "$(sq prodsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_users_recovery_phone'")" "1"
check "the recovery-phone index is partial, so NULLs do not collide" \
  "$(sq prodsim "SELECT CASE WHEN sql LIKE '%WHERE recovery_phone IS NOT NULL%' THEN 1 ELSE 0 END v FROM sqlite_master WHERE name='idx_users_recovery_phone'")" "1"

# ── 5c. 012 normalises the phones that were stored as typed ──────────────────
# The write side is fixed in apps/api/src/routes/auth.ts; this is the rows that
# predate it. Conservative by design: only unambiguous NANP shapes move.
check "012 normalises a 10-digit phone written with punctuation" \
  "$(sq prodsim "SELECT phone v FROM workspaces WHERE id='w1'")" "+19495550187"
check "012 leaves an already-normalised phone untouched" \
  "$(sq prodsim "SELECT phone v FROM workspaces WHERE id='w2'")" "+18005550100"
check "012 leaves a phone it cannot read alone, rather than mangling it" \
  "$(sq prodsim "SELECT phone v FROM workspaces WHERE id='w3'")" "ext 0187"
check "012 leaves an empty phone empty" \
  "$(sq prodsim "SELECT COUNT(*) n FROM workspaces WHERE id='w4' AND phone=''")" "1"
check "012 loses no workspace rows" \
  "$(sq prodsim 'SELECT COUNT(*) n FROM workspaces')" "4"

# ── 5d. 013 adds the column PATCH /api/workspace has always written to ───────
# workspaces has never had updated_at, and apps/api/src/routes/workspace.ts
# builds its UPDATE with `updated_at = ?` unconditionally — so PATCH
# /api/workspace returned 500 on every call it ever received, in every
# environment. That is the whole reason 013 exists, which makes it worth pinning
# here rather than trusting it once.
check "workspaces.updated_at added" \
  "$(sq prodsim "SELECT COUNT(*) n FROM pragma_table_info('workspaces') WHERE name='updated_at'")" "1"
# NULLABLE on purpose, unlike users.updated_at. SQLite's ALTER TABLE ADD COLUMN
# refuses a non-constant default ("Cannot add a column with non-constant
# default"), so NOT NULL DEFAULT (datetime('now')) cannot be reached on a live
# table without rebuilding workspaces — the parent of most of this schema.
# schema.sql declares it nullable too; check-migration-coverage.mjs fails the
# build if these two ever disagree, and this pins the migration's half.
check "workspaces.updated_at is nullable, as schema.sql declares it" \
  "$(sq prodsim "SELECT \"notnull\" v FROM pragma_table_info('workspaces') WHERE name='updated_at'")" "0"
check "013 backfills updated_at from created_at" \
  "$(sq prodsim "SELECT updated_at v FROM workspaces WHERE id='w1'")" "2026-08-01T00:00:00Z"
check "013 backfills every row, not just the first" \
  "$(sq prodsim "SELECT updated_at v FROM workspaces WHERE id='w4'")" "2026-08-04T00:00:00Z"
check "013 leaves no workspace without an updated_at" \
  "$(sq prodsim 'SELECT COUNT(*) n FROM workspaces WHERE updated_at IS NULL')" "0"
check "013 loses no workspace rows" \
  "$(sq prodsim 'SELECT COUNT(*) n FROM workspaces')" "4"
check "013 changes no other column" \
  "$(sq prodsim "SELECT name v FROM workspaces WHERE id='w1'")" "Acme Electric"
# ── 5e. 015 makes workspaces.slug uniqueness real ────────────────────────────
# The column arrived by `ALTER TABLE workspaces ADD COLUMN slug TEXT` in 001,
# and SQLite's ADD COLUMN cannot carry UNIQUE — so the live databases had no
# uniqueness at all while schema.sql declared `slug TEXT UNIQUE` and every test
# fixture built from schema.sql enforced it. /api/auth/register lets the database
# arbitrate concurrent signups, so this index is the whole guarantee. Asserted
# against the real migration runner on a live-shaped database, not against
# schema.sql, because schema.sql is the thing that was lying.
check "015 creates the slug unique index" \
  "$(sq prodsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_workspaces_slug_unique'")" "1"
check "the slug index is unique" \
  "$(sq prodsim "SELECT CASE WHEN sql LIKE 'CREATE UNIQUE INDEX%' THEN 1 ELSE 0 END v FROM sqlite_master WHERE name='idx_workspaces_slug_unique'")" "1"
check "the slug index is partial, so workspaces with no site do not collide" \
  "$(sq prodsim "SELECT CASE WHEN sql LIKE '%WHERE slug IS NOT NULL%' THEN 1 ELSE 0 END v FROM sqlite_master WHERE name='idx_workspaces_slug_unique'")" "1"
# And the behaviour, not just the DDL: a second row claiming a taken slug must be
# rejected. w1 already holds 'acme'. A rejected INSERT leaves no row behind.
dup_slug="$(STUB_DB="$TESTDIR/prodsim.sqlite" node --no-warnings -e '
  const {DatabaseSync} = require("node:sqlite");
  const db = new DatabaseSync(process.env.STUB_DB);
  try {
    db.prepare("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").run("dup", "Acme Electric", "acme");
    console.log("accepted");
  } catch (e) { console.log(/UNIQUE constraint failed/i.test(e.message) ? "rejected" : "other: " + e.message); }
')"
check "a duplicate slug is rejected on a migrated live-shaped database" "$dup_slug" "rejected"
check "the rejected duplicate left no row" \
  "$(sq prodsim "SELECT COUNT(*) n FROM workspaces WHERE id='dup'")" "0"

# ── 5f. 027 gives a live database the availability model (GP-101) ───────────
# Two new tables and five workspaces columns. The columns carry constant
# defaults, so every existing workspace gets the booking policy the code
# assumes — and NO availability rows, because a workspace that has never said
# when it works is not bookable, never "always open".
for col in timezone booking_lead_hours booking_horizon_days travel_buffer_minutes concurrent_jobs; do
  check "workspaces.$col added" \
    "$(sq prodsim "SELECT COUNT(*) n FROM pragma_table_info('workspaces') WHERE name='$col'")" "1"
done
check "027 leaves timezone NULL on existing workspaces — no guessing UTC" \
  "$(sq prodsim "SELECT COUNT(*) n FROM workspaces WHERE timezone IS NOT NULL")" "0"
check "027 defaults booking_lead_hours to 24 on existing rows" \
  "$(sq prodsim "SELECT booking_lead_hours v FROM workspaces WHERE id='w1'")" "24"
check "027 defaults booking_horizon_days to 30 on existing rows" \
  "$(sq prodsim "SELECT booking_horizon_days v FROM workspaces WHERE id='w1'")" "30"
check "027 defaults travel_buffer_minutes to 30 on existing rows" \
  "$(sq prodsim "SELECT travel_buffer_minutes v FROM workspaces WHERE id='w1'")" "30"
check "027 defaults concurrent_jobs to 1 on existing rows" \
  "$(sq prodsim "SELECT concurrent_jobs v FROM workspaces WHERE id='w1'")" "1"
check "027 creates workspace_availability" \
  "$(sq prodsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='workspace_availability'")" "1"
check "027 creates workspace_availability_exceptions" \
  "$(sq prodsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='workspace_availability_exceptions'")" "1"
check "027 seeds no availability rows — an absent answer publishes no claim" \
  "$(sq prodsim "SELECT COUNT(*) n FROM workspace_availability")" "0"
check "027 makes (workspace_id, weekday) unique on a live-shaped database" \
  "$(sq prodsim "SELECT CASE WHEN sql LIKE '%UNIQUE(workspace_id, weekday)%' THEN 1 ELSE 0 END v FROM sqlite_master WHERE name='workspace_availability'")" "1"

# ── 5g. 028 gives a live database the double-booking guard (GP-104) ─────────
# The PRIMARY KEY on (workspace_id, slot_start, lane) is the whole mechanism,
# so pin that it exists on a migrated live-shaped database and that the
# backfill claimed the half-hours existing jobs occupy — without erasing a
# job that genuinely overlaps another.
check "028 creates job_slots" \
  "$(sq prodsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='job_slots'")" "1"
check "028 makes (workspace_id, slot_start, lane) the primary key" \
  "$(sq prodsim "SELECT CASE WHEN sql LIKE '%PRIMARY KEY (workspace_id, slot_start, lane)%' THEN 1 ELSE 0 END v FROM sqlite_master WHERE name='job_slots'")" "1"
check "028 backfills five half-hours for a 09:00-11:30 job" \
  "$(sq prodsim "SELECT COUNT(*) n FROM job_slots WHERE job_id='j1'")" "5"
check "028 floors the first slot to the half-hour grid in UTC ISO form" \
  "$(sq prodsim "SELECT MIN(slot_start) v FROM job_slots WHERE job_id='j1'")" "2026-10-05T09:00:00.000Z"
check "028 gives a zero-length job one slot, not none" \
  "$(sq prodsim "SELECT COUNT(*) n FROM job_slots WHERE job_id='j2'")" "1"
check "028 claims nothing for a cancelled job" \
  "$(sq prodsim "SELECT COUNT(*) n FROM job_slots WHERE job_id='j4'")" "0"
# j3 (11:00-12:00) overlaps j1 on the 11:00 half-hour. The earlier job holds
# the shared slot; j3 keeps 11:30 and, above all, is still a job.
check "028 lets the earlier job hold a genuinely shared half-hour" \
  "$(sq prodsim "SELECT job_id v FROM job_slots WHERE slot_start='2026-10-05T11:00:00.000Z'")" "j1"
check "028 gives the overlapping job the half-hours it does not share" \
  "$(sq prodsim "SELECT slot_start v FROM job_slots WHERE job_id='j3'")" "2026-10-05T11:30:00.000Z"
check "028 erases neither of two overlapping jobs" \
  "$(sq prodsim "SELECT COUNT(*) n FROM jobs WHERE id IN ('j1','j3')")" "2"
check "028 backfills only lane 0" \
  "$(sq prodsim "SELECT COUNT(*) n FROM job_slots WHERE lane<>0")" "0"
# And the behaviour: a second job on a taken half-hour is rejected by the
# migrated table, not by application code.
dup_slot="$(STUB_DB="$TESTDIR/prodsim.sqlite" node --no-warnings -e '
  const {DatabaseSync} = require("node:sqlite");
  const db = new DatabaseSync(process.env.STUB_DB);
  try {
    db.prepare("INSERT INTO job_slots (workspace_id,slot_start,lane,job_id) VALUES (?,?,?,?)").run("w1", "2026-10-05T09:00:00.000Z", 0, "j2");
    console.log("accepted");
  } catch (e) { console.log(/UNIQUE constraint failed: job_slots\./.test(e.message) ? "rejected" : "other: " + e.message); }
')"
check "a second job on a taken half-hour is rejected on a migrated database" "$dup_slot" "rejected"

# ── 5h. 031 gives a live database jobs.assigned_to (GP-034) ─────────────────
# The Technicians report and the schedule's techId filter read this column
# now, so a live database without it would 500 on both. Nullable, and NOT
# backfilled: created_by is who typed the job in, not who did it, and the
# four seeded jobs above must stay unassigned after migrating.
check "jobs.assigned_to added" \
  "$(sq prodsim "SELECT COUNT(*) n FROM pragma_table_info('jobs') WHERE name='assigned_to'")" "1"
check "jobs.assigned_to is nullable, as schema.sql declares it" \
  "$(sq prodsim "SELECT \"notnull\" v FROM pragma_table_info('jobs') WHERE name='assigned_to'")" "0"
check "031 backfills nothing — no job is credited to whoever typed it in" \
  "$(sq prodsim "SELECT COUNT(*) n FROM jobs WHERE assigned_to IS NOT NULL")" "0"
check "031 loses no job rows" \
  "$(sq prodsim 'SELECT COUNT(*) n FROM jobs')" "4"
check "031 creates the assignee index" \
  "$(sq prodsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_jobs_assigned_to'")" "1"

# ── 5i. 030 converts the quote leads that were valued in dollars (GP-111) ────
# createLeadFromQuote wrote the band's dollar midpoint into a cents column
# from 2026-09-11 until the fix. The predicate is the session's own band: a
# lead is converted only while its value still equals ROUND((low+high)/2), so
# a row already in cents, a hand-edited value, and a lead the quote flow never
# created are all left alone — and a re-run finds nothing to do. Built here
# rather than in build_prodsim because pricing_quote_sessions does not exist
# until 010 has run, and re-run the way 6b re-runs 013: by dropping the ledger
# row, which is the only path that executes 030 over data.
STUB_DB="$TESTDIR/prodsim.sqlite" node --no-warnings -e '
  const {DatabaseSync} = require("node:sqlite");
  const db = new DatabaseSync(process.env.STUB_DB);
  // The session rows name no pricing_fsms parent: this is about the value
  // predicate, not the FSM tables, and node:sqlite enforces FKs by default.
  db.exec("PRAGMA foreign_keys = OFF");
  const lead = db.prepare("INSERT INTO leads (id,workspace_id,first_name,last_name,source,estimated_value,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)");
  lead.run("lq1", "w1", "Dana", "Dollars", "website", 1138, "u1", "2026-09-12T00:00:00Z");   // written in dollars by the old code
  lead.run("lq2", "w1", "Casey", "Cents", "website", 113800, "u1", "2026-09-14T00:00:00Z");  // written in cents by the fixed code
  lead.run("lq3", "w1", "Eve", "Edited", "website", 1500, "u1", "2026-09-12T00:00:00Z");     // a value someone typed over
  lead.run("lm1", "w1", "Manny", "Manual", "manual", 1138, "u1", "2026-09-12T00:00:00Z");    // never a quote: no session
  const session = db.prepare("INSERT INTO pricing_quote_sessions (id,workspace_id,fsm_id,fsm_version_id,rate_card_version_id,lead_id,status,quote_low,quote_high) VALUES (?,?,?,?,?,?,?,?,?)");
  session.run("s1", "w1", "f", "fv", "rcv", "lq1", "completed", 1000, 1275);
  session.run("s2", "w1", "f", "fv", "rcv", "lq2", "completed", 1000, 1275);
  session.run("s3", "w1", "f", "fv", "rcv", "lq3", "completed", 1000, 1275);
  db.prepare("DELETE FROM schema_migrations WHERE name = ?").run("030-quote-lead-value-to-cents.sql");
'
out030="$("$REPO_ROOT/scripts/db/migrate.sh" prodsim --remote 2>&1)"
check "030 re-runs when the ledger is missing its row" \
  "$(grep -c '→ 030-quote-lead-value-to-cents.sql' <<<"$out030")" "1"
check "030 converts a quote lead still holding the dollar midpoint" \
  "$(sq prodsim "SELECT CAST(estimated_value AS INTEGER) v FROM leads WHERE id='lq1'")" "113800"
check "030 leaves a quote lead already in cents alone" \
  "$(sq prodsim "SELECT CAST(estimated_value AS INTEGER) v FROM leads WHERE id='lq2'")" "113800"
check "030 leaves a hand-edited value alone" \
  "$(sq prodsim "SELECT CAST(estimated_value AS INTEGER) v FROM leads WHERE id='lq3'")" "1500"
check "030 leaves a lead the quote flow never created alone" \
  "$(sq prodsim "SELECT CAST(estimated_value AS INTEGER) v FROM leads WHERE id='lm1'")" "1138"
check "030 leaves the baseline lead's NULL value NULL" \
  "$(sq prodsim "SELECT COUNT(*) n FROM leads WHERE id='l1' AND estimated_value IS NULL")" "1"
STUB_DB="$TESTDIR/prodsim.sqlite" node --no-warnings -e '
  const {DatabaseSync} = require("node:sqlite");
  const db = new DatabaseSync(process.env.STUB_DB);
  db.prepare("DELETE FROM schema_migrations WHERE name = ?").run("030-quote-lead-value-to-cents.sql");
'
"$REPO_ROOT/scripts/db/migrate.sh" prodsim --remote >/dev/null 2>&1
check "a second pass of 030 multiplies nothing twice" \
  "$(sq prodsim "SELECT CAST(estimated_value AS INTEGER) v FROM leads WHERE id='lq1'")" "113800"

# ── 6. Running twice must change nothing ─────────────────────────────────────
out2="$("$REPO_ROOT/scripts/db/migrate.sh" prodsim --remote 2>&1)"
check "second run applies nothing" "$(grep -c '0 applied now' <<<"$out2")" "1"
check "second run rebuilds no table" "$(sq prodsim 'SELECT COUNT(*) n FROM lead_meter_events')" "1"
check "012 is idempotent — a second run moves no phone again" \
  "$(sq prodsim "SELECT phone v FROM workspaces WHERE id='w1'")" "+19495550187"
# The ledger's job: a second run must not re-execute 013 at all. This is NOT a
# test of 013's `WHERE updated_at IS NULL` guard — re-reading the value after a
# run that never touched the table cannot test that, and a check that passes
# with the guard deleted is worse than no check. The guard is tested in 6b, on
# the path that does re-execute 013.
check "second run does not re-execute 013" \
  "$(grep -c '→ 013-workspaces-updated-at.sql' <<<"$out2")" "0"

# ── 6b. 013 re-applied over live data must not clobber an edited updated_at ──
# The path that re-executes an already-applied migration is a ledger missing its
# row — exactly the 006/007 mis-seeding this suite was written to catch — and
# migrate.sh:139 per-statement mode deliberately swallows "duplicate column
# name" so the ALTER is survivable and the UPDATE runs again over live rows.
# That makes 013's `WHERE updated_at IS NULL` load-bearing: without it a re-run
# rewinds every workspace's updated_at to created_at, discarding every edit
# PATCH /api/workspace has made since.
#
# So: edit two workspaces the way PATCH /api/workspace now does, add one that
# has never been edited, drop 013 from the ledger, and migrate again.
STUB_DB="$TESTDIR/prodsim.sqlite" node --no-warnings -e '
  const {DatabaseSync} = require("node:sqlite");
  const db = new DatabaseSync(process.env.STUB_DB);
  // Two edited rows, both with an updated_at that differs from created_at, so
  // a re-run that drops the guard is caught on more than the first row.
  const edit = db.prepare("UPDATE workspaces SET updated_at = ? WHERE id = ?");
  edit.run("2026-09-11T12:00:00Z", "w1");
  edit.run("2026-09-10T08:30:00Z", "w4");
  // And one row that has never been edited, so the backfill still has work to
  // do: deleting the UPDATE entirely must not pass either.
  db.prepare("INSERT INTO workspaces (id,name,slug,phone,created_at) VALUES (?,?,?,?,?)")
    .run("w5", "Never Edited", "never", "+18005550199", "2026-08-05T00:00:00Z");
  db.prepare("DELETE FROM schema_migrations WHERE name = ?").run("013-workspaces-updated-at.sql");
  // 028 too: its backfill is INSERT OR IGNORE so a re-run over an already
  // claimed table must add nothing, and — like 013 — that only gets tested
  // on the path that actually re-executes it.
  db.prepare("DELETE FROM schema_migrations WHERE name = ?").run("028-job-slots.sql");
'
out3="$("$REPO_ROOT/scripts/db/migrate.sh" prodsim --remote 2>&1)"
# If migrate.sh silently skipped 013 the checks below would pass for the
# wrong reason, so prove the re-run actually happened first.
check "013 re-runs when the ledger is missing its row" \
  "$(grep -c '→ 013-workspaces-updated-at.sql' <<<"$out3")" "1"
check "the re-applied 013 and 028 survive their column and table already existing" \
  "$(grep -c '2 applied now' <<<"$out3")" "1"
check "028 re-runs when the ledger is missing its row" \
  "$(grep -c '→ 028-job-slots.sql' <<<"$out3")" "1"
check "a re-applied 028 adds no slot rows over an already-claimed table" \
  "$(sq prodsim 'SELECT COUNT(*) n FROM job_slots')" "7"
check "013's WHERE guard keeps an edited updated_at" \
  "$(sq prodsim "SELECT updated_at v FROM workspaces WHERE id='w1'")" "2026-09-11T12:00:00Z"
check "013's WHERE guard keeps every edited updated_at, not just the first" \
  "$(sq prodsim "SELECT updated_at v FROM workspaces WHERE id='w4'")" "2026-09-10T08:30:00Z"
check "a re-applied 013 still backfills a row that has none" \
  "$(sq prodsim "SELECT updated_at v FROM workspaces WHERE id='w5'")" "2026-08-05T00:00:00Z"
check "a re-applied 013 loses no workspace rows" \
  "$(sq prodsim 'SELECT COUNT(*) n FROM workspaces')" "5"

# ── 7. 010 replaces the hand-applied FSM tables ──────────────────────────────
# `greenput` (and only `greenput`) carries five tables that were applied
# directly to the database, declared in no commit and read by no code. 010 drops
# them and creates the six the engine actually uses. The danger is the opposite
# of a lost row: CREATE TABLE IF NOT EXISTS would silently KEEP the hand-applied
# `flow_instances` on one database and create the new shape everywhere else. So
# build a database that has them, and assert they are gone afterwards.
build_prodsim fsmsim
STUB_DB="$TESTDIR/fsmsim.sqlite" node --no-warnings -e '
  const {DatabaseSync} = require("node:sqlite");
  const db = new DatabaseSync(process.env.STUB_DB);
  // Exactly the columns docs/UNTRACKED-PRODUCTION-TABLES.md recorded on 2026-09-11.
  db.exec(`
    CREATE TABLE intake_flows (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, slug TEXT, description TEXT, service_type TEXT, status TEXT, version INTEGER, initial_state_key TEXT, created_at TEXT, updated_at TEXT, created_by TEXT);
    CREATE TABLE flow_states (id TEXT PRIMARY KEY, flow_id TEXT, workspace_id TEXT, key TEXT, kind TEXT, prompt TEXT, config TEXT, is_terminal INTEGER, created_at TEXT);
    CREATE TABLE flow_transitions (id TEXT PRIMARY KEY, flow_id TEXT, workspace_id TEXT, from_state_id TEXT, to_state_id TEXT, condition TEXT, priority INTEGER, created_at TEXT);
    CREATE TABLE flow_instances (id TEXT PRIMARY KEY, workspace_id TEXT, flow_id TEXT, flow_version INTEGER, lead_id TEXT, current_state_id TEXT, status TEXT, context TEXT, started_at TEXT, updated_at TEXT, completed_at TEXT, abandoned_at TEXT);
    CREATE TABLE flow_instance_events (id TEXT PRIMARY KEY, instance_id TEXT, workspace_id TEXT, from_state_id TEXT, to_state_id TEXT, input TEXT, created_at TEXT);
  `);
'
check "the hand-applied FSM tables exist before migrating" \
  "$(sq fsmsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('intake_flows','flow_states','flow_transitions','flow_instances','flow_instance_events')")" "5"
"$REPO_ROOT/scripts/db/migrate.sh" fsmsim --remote >/dev/null 2>&1
check "010 drops all five hand-applied FSM tables" \
  "$(sq fsmsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('intake_flows','flow_states','flow_transitions','flow_instances','flow_instance_events')")" "0"
check "010 creates the six pricing tables" \
  "$(sq fsmsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('pricing_fsms','pricing_fsm_versions','rate_cards','rate_card_versions','pricing_quote_sessions','pricing_quote_events')")" "6"
check "010 is a no-op on a database that never had them" \
  "$(sq prodsim "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='pricing_quote_sessions'")" "1"
check "workspace data survives 010" "$(sq fsmsim 'SELECT name v FROM workspaces')" "Acme Electric"

echo
if [ "$fail" -gt 0 ]; then
  echo "FAILED: ${fail} of $((pass + fail)) checks"
  exit 1
fi
echo "PASSED: ${pass} checks"
