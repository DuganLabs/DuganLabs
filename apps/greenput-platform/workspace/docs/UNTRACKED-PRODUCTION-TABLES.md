# Untracked tables in the production database

Recorded 2026-09-11.

The live GreenPut D1 databases contain nine tables that exist in no commit and
that no application code reads or writes. They fall into two groups.

**Update, 2026-09-11 — the five FSM tables are RESOLVED.** They are dropped by
[`migrations/010-pricing-fsm.sql`](../migrations/010-pricing-fsm.sql), which
creates the six tables the pricing engine actually uses in their place. The
four scheduling tables below are still outstanding. The section that follows is
kept as the record of what was there.

## Intake finite-state-machine tables — RESOLVED, dropped by migration 010

Present in `greenput` only, not in `greenput-staging`.

| Table | Columns |
| --- | --- |
| `intake_flows` | id, workspace_id, name, slug, description, service_type, status, version, initial_state_key, created_at, updated_at, created_by |
| `flow_states` | id, flow_id, workspace_id, key, kind, prompt, config, is_terminal, created_at |
| `flow_transitions` | id, flow_id, workspace_id, from_state_id, to_state_id, condition, priority, created_at |
| `flow_instances` | id, workspace_id, flow_id, flow_version, lead_id, current_state_id, status, context, started_at, updated_at, completed_at, abandoned_at |
| `flow_instance_events` | id, instance_id, workspace_id, from_state_id, to_state_id, input, created_at |

Their shape matches the intake finite-state-machine design that was still in
progress when this was written.

**When the FSM lands**, its author owns the decision: either declare these
tables in `schema.sql` and add the migration that reconciles the live copies,
or drop them and create the real ones through CI. Until then they must not be
built on.

**What was decided.** The FSM landed on `feat/pricing-engine` and these five
were dropped, not adopted. The reasoning is written out in full at the top of
`migrations/010-pricing-fsm.sql`; in short, `flow_states` + `flow_transitions`
model a normalised graph, while the engine evaluates a whole machine document
(terminals carrying line items, uncertainty and presentation copy, plus
machine-level honesty rules); there is nowhere in the five to record which
version of a graph a half-finished session is being priced against; and
`flow_instances` / `flow_instance_events` are names the engine needs at a
different shape, where `CREATE TABLE IF NOT EXISTS` would have silently kept
the hand-applied shape on `greenput` and created the new one everywhere else.

They are replaced by `pricing_fsms`, `pricing_fsm_versions`, `rate_cards`,
`rate_card_versions`, `pricing_quote_sessions` and `pricing_quote_events`, all
declared in `schema.sql` and created by migration 010.
`scripts/db/test-migrate.sh` builds a database that has the five, runs the
migration, and asserts they are gone and the six are there.

## Scheduling tables — RESOLVED 2026-10-16 (migration 035)

**Update, 2026-10-16 — the four scheduling tables are RESOLVED.** They
are declared in `schema.sql` and captured by
[`migrations/035-scheduling-tables-capture.sql`](../migrations/035-scheduling-tables-capture.sql)
with `CREATE TABLE IF NOT EXISTS`, so the live databases keep their
hand-applied shape and rows untouched while fresh environments finally
get the tables. Column lists below are the production record the
migration was written from. The section that follows is kept as the
record of what was there.

Present in both `greenput` and `greenput-staging`.

| Table | Columns |
| --- | --- |
| `availability_windows` | id, workspace_id, user_id, day_of_week, start_minute, end_minute, timezone, active, created_at, updated_at |
| `availability_blackouts` | id, workspace_id, user_id, start_at, end_at, reason, created_at |
| `schedule_buffers` | id, workspace_id, service_type, pre_buffer_minutes, post_buffer_minutes, min_gap_minutes, max_jobs_per_day, created_at, updated_at |
| `schedule_settings` | workspace_id, timezone, buffer_before_minutes, buffer_after_minutes, travel_buffer_minutes, min_notice_hours, max_lead_time_days, created_at, updated_at |

These back the scheduling and availability features. Being in both databases
means they were applied deliberately, twice, by hand.

**These need reconciling first**, because unlike the FSM tables they sit under
live features. Declaring them in `schema.sql` brings them under the drift
guard and gives preview environments a working copy.

## How this happened, and why it stops here

All nine were applied straight to a database rather than through CI. Nothing
recorded them, so nothing could verify them, and a preview or fresh
environment silently lacks them. Five are now resolved; the four scheduling
tables are not.

`migrations/` plus `scripts/db/check-migration-coverage.mjs` exist to end that
practice. The guard fails the build if `schema.sql` and `migrations/` disagree,
and `scripts/db/migrate.sh` is the only sanctioned way to change a database.
Tables added outside it remain invisible to all of that — which is the whole
argument for not doing it.
