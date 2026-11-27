-- ─────────────────────────────────────────────────────────────
-- Greenput D1 Schema
-- Cloudflare D1 (SQLite dialect)
-- ─────────────────────────────────────────────────────────────


-- ── Workspaces ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspaces (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  -- Deliberately NOT `TEXT UNIQUE`. The live databases got this column from
  -- migrations/001-workspaces-slug.sql — a bare ALTER TABLE ADD COLUMN, which
  -- SQLite cannot give a UNIQUE constraint — so a column-level UNIQUE here
  -- would exist in fresh databases and test fixtures and nowhere else, which
  -- is exactly what it did until 2026-09-11. Uniqueness is
  -- idx_workspaces_slug_unique below, a partial UNIQUE index that a populated
  -- database can actually be given (migrations/015-workspaces-slug-unique.sql).
  -- Put nothing on this column that ADD COLUMN cannot carry.
  slug         TEXT,
  trade        TEXT NOT NULL DEFAULT 'electrical',
  phone        TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  street       TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  state        TEXT NOT NULL DEFAULT '',
  zip          TEXT NOT NULL DEFAULT '',
  license_num  TEXT,
  logo_url             TEXT,
  stripe_customer_id   TEXT,
  stripe_account_id    TEXT,
  -- Whole US dollars per accepted lead when set. NULL bills the placeholder
  -- rate card (apps/api/src/lib/lead-rate-card.ts). The Hi Power pilot
  -- (slug hi-power) is grandfathered at $1: migrations/041 sets this on an
  -- existing row, and registration writes it when the allocated slug is in
  -- GRANDFATHERED_LEAD_FEE_USD. Nullable on purpose — a missing override is
  -- the normal case, and ALTER TABLE ADD COLUMN cannot attach a CHECK.
  lead_fee_override_usd INTEGER,
  -- Prepaid outbound-SMS balance, in micro-USD (1 USD = 1_000_000). Not
  -- cents: a US long-code segment is $0.0083 (8300 micro-USD), and rounding
  -- it to a cent would overcharge. Top-up and threshold ARE cents, because
  -- they are Stripe charges. Defaults: $10 top-up when the balance falls
  -- below $2 (apps/api/src/lib/usage-balance.ts). ALTER TABLE ADD COLUMN
  -- can carry NOT NULL DEFAULT, which is what migrations/042 does.
  usage_balance_micro_usd INTEGER NOT NULL DEFAULT 0,
  usage_topup_cents INTEGER NOT NULL DEFAULT 1000,
  usage_topup_threshold_cents INTEGER NOT NULL DEFAULT 200,
  -- Billing lifecycle (added in billing-pipeline PR).
  -- For prod DBs without these columns, run:
  --   ALTER TABLE workspaces ADD COLUMN billing_status  TEXT NOT NULL DEFAULT 'trialing';
  --   ALTER TABLE workspaces ADD COLUMN trial_ends_at   TEXT;
  --   ALTER TABLE workspaces ADD COLUMN trial_started_at TEXT;
  billing_status     TEXT NOT NULL DEFAULT 'trialing'
                     CHECK(billing_status IN ('trialing','active','past_due','canceled','trial_expired')),
  trial_started_at   TEXT,
  trial_ends_at      TEXT,
  -- Custom domain / Cloudflare for SaaS (added in custom-domains PR, 2026-09-10).
  -- Tenants default to <slug>.greenput.com; a workspace may CNAME a domain it
  -- owns onto the platform, tracked here through provisioning + verification.
  -- Cloudflare for SaaS custom hostnames.
  -- `custom_hostname` is the exact hostname the contractor's DNS points at us.
  -- `custom_domain_cf_hostname_id` is the Cloudflare Custom Hostname id (see
  -- apps/api/src/lib/cloudflare-saas.ts). `custom_domain_setup_fee_paid_at`
  -- records the one-time setup fee.
  --
  -- Existing databases get these columns from
  -- migrations/009-workspaces-custom-domain.sql. Do NOT write ALTERs in a
  -- comment here: a comment applies to nothing, which is exactly how these
  -- columns reached production as an index over a column that did not exist
  -- and stopped every deploy from PR #103 onward. Adding a column below
  -- without a matching file in migrations/ now fails CI
  -- (scripts/db/check-migration-coverage.mjs).
  custom_hostname                    TEXT,
  custom_domain_status               TEXT NOT NULL DEFAULT 'none'
                                      CHECK(custom_domain_status IN ('none','pending','verifying','active','failed')),
  custom_domain_verification_method  TEXT CHECK(custom_domain_verification_method IN ('cname','txt','http')),
  custom_domain_verification_token   TEXT,
  custom_domain_cf_hostname_id       TEXT,
  custom_domain_failure_reason       TEXT,
  custom_domain_requested_at         TEXT,
  custom_domain_verified_at          TEXT,
  custom_domain_last_checked_at      TEXT,
  custom_domain_setup_fee_paid_at    TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  -- PATCH /api/workspace has always written this column. The table never had
  -- it, so that endpoint returned 500 on every call — every Settings save and
  -- every onboarding step that writes a workspace field. Existing databases
  -- get it from migrations/013-workspaces-updated-at.sql.
  --
  -- Nullable, unlike users.updated_at, and deliberately so: SQLite's
  -- ALTER TABLE ADD COLUMN rejects a non-constant default, so a live database
  -- cannot be given `NOT NULL DEFAULT (datetime('now'))` without rebuilding
  -- workspaces — and workspaces is the parent of most of this schema. The
  -- alternatives were a constant default (every new row silently stamped with
  -- the wrong value or an empty string) or a column that disagrees with this
  -- file (which the drift guard would reject, correctly). NULL means "never
  -- edited since it was created", which is true and useful.
  updated_at         TEXT,
  -- Booking (GP-101). `timezone` is the IANA zone the contractor's hours are
  -- written in (workspace_availability.opens_at is local wall-clock), and it is
  -- nullable on purpose: slot generation must refuse to run without it rather
  -- than guess UTC. The four numbers are booking policy: how far ahead the
  -- first offered slot is, how far ahead the last one is, the travel gap put
  -- between two jobs, and how many jobs may overlap (a two-van shop books two).
  -- Constant defaults only — ALTER TABLE ADD COLUMN cannot carry any other
  -- kind. Existing databases get these from
  -- migrations/027-workspace-availability.sql.
  timezone               TEXT,
  booking_lead_hours     INTEGER NOT NULL DEFAULT 24,
  booking_horizon_days   INTEGER NOT NULL DEFAULT 30,
  travel_buffer_minutes  INTEGER NOT NULL DEFAULT 30,
  concurrent_jobs        INTEGER NOT NULL DEFAULT 1,
  -- Where the contractor works and what they do (GP-039). Signup asked for
  -- all three and stored none of them: `trade` kept only the first of the
  -- services picked on the "pick all that apply" grid, and the service area
  -- and radius were read back on the review step and then thrown away.
  -- `service_types` is a JSON array of the full selection; `trade` stays its
  -- first entry, because apps/tenant-site and the brand card still read
  -- `trade`. `service_area` and `service_radius_miles` are nullable: a
  -- workspace created before this has neither, and NULL is the honest value.
  -- Constant defaults only — ALTER TABLE ADD COLUMN cannot carry any other
  -- kind. Existing databases get these from
  -- migrations/033-workspace-service-area.sql.
  service_area           TEXT,
  service_radius_miles   INTEGER,
  service_types          TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
-- Partial unique index: two workspaces may not share a micro-site address, but
-- any number may have none yet (slug NULL). This, not a column-level UNIQUE, is
-- what enforces slug uniqueness everywhere — see the comment on the column and
-- migrations/015-workspaces-slug-unique.sql. /api/auth/register depends on it:
-- it lets the database arbitrate concurrent signups of the same company name
-- instead of trusting a SELECT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug_unique ON workspaces(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspaces_billing_status ON workspaces(billing_status);
-- Partial unique index: only one *active-or-pending* workspace may claim a
-- given custom hostname at a time; many rows may share NULL (no domain set).
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_custom_hostname ON workspaces(custom_hostname) WHERE custom_hostname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspaces_custom_domain_status ON workspaces(custom_domain_status);

-- ── Workspace availability (GP-101) ───────────────────────────
--
-- When a contractor works. `workspace_availability` is the recurring week, one
-- row per (workspace_id, weekday); `workspace_availability_exceptions` is the
-- dated overrides (a public holiday, a day off, a Saturday they are opening
-- specially) and wins over the weekday row for its date. Times are local
-- wall-clock `HH:MM` in `workspaces.timezone`, NOT UTC — the same hours have
-- to mean the same thing across a DST change.
--
-- A workspace with NO rows here is NOT BOOKABLE, never "always open". An
-- absent answer must not publish a claim. Existing databases get both tables
-- from migrations/027-workspace-availability.sql.

CREATE TABLE IF NOT EXISTS workspace_availability (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), -- 0 = Sunday, as Date.getDay()
  opens_at     TEXT,                                            -- HH:MM local; NULL when closed
  closes_at    TEXT,                                            -- HH:MM local; NULL when closed
  is_open      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(workspace_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_workspace_availability_workspace ON workspace_availability(workspace_id);

CREATE TABLE IF NOT EXISTS workspace_availability_exceptions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,                                   -- YYYY-MM-DD local
  opens_at     TEXT,                                            -- HH:MM local; NULL when closed
  closes_at    TEXT,                                            -- HH:MM local; NULL when closed
  is_open      INTEGER NOT NULL DEFAULT 1,
  reason       TEXT,
  UNIQUE(workspace_id, date)
);

CREATE INDEX IF NOT EXISTS idx_workspace_availability_exceptions_workspace ON workspace_availability_exceptions(workspace_id, date);

-- ── Per-user scheduling tables (captured 2026-10-16, migration 035) ──
-- These four tables lived in both production databases from 2026-09-11
-- (docs/UNTRACKED-PRODUCTION-TABLES.md) with no commit and no migration:
-- hand-applied under the scheduling features, invisible to the drift
-- guard, and silently absent from every fresh environment. They are the
-- per-USER layer beside the workspace-level tables above: when a tech
-- works (windows, in minutes after local midnight), when they never
-- work (blackouts), how much air a service needs around it (buffers),
-- and the workspace's booking policy (settings). Column lists are the
-- production record in docs/UNTRACKED-PRODUCTION-TABLES.md; types follow
-- the conventions of the tables around them. The schedule-aware
-- delivery engine (apps/api/src/lib/schedule-delivery.ts) reads them.

CREATE TABLE IF NOT EXISTS availability_windows (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_minute INTEGER NOT NULL, -- minutes after local midnight
  end_minute   INTEGER NOT NULL,
  timezone     TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_availability_windows_workspace_user ON availability_windows(workspace_id, user_id);

CREATE TABLE IF NOT EXISTS availability_blackouts (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at     TEXT NOT NULL, -- ISO-8601 instant
  end_at       TEXT NOT NULL, -- ISO-8601 instant
  reason       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_availability_blackouts_workspace_user ON availability_blackouts(workspace_id, user_id);

CREATE TABLE IF NOT EXISTS schedule_buffers (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  service_type       TEXT NOT NULL DEFAULT '',
  pre_buffer_minutes INTEGER NOT NULL DEFAULT 0,
  post_buffer_minutes INTEGER NOT NULL DEFAULT 0,
  min_gap_minutes    INTEGER NOT NULL DEFAULT 0,
  max_jobs_per_day   INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_buffers_workspace ON schedule_buffers(workspace_id);

CREATE TABLE IF NOT EXISTS schedule_settings (
  workspace_id          TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  timezone              TEXT,
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
  buffer_after_minutes  INTEGER NOT NULL DEFAULT 0,
  travel_buffer_minutes INTEGER NOT NULL DEFAULT 0,
  min_notice_hours      INTEGER NOT NULL DEFAULT 0,
  max_lead_time_days    INTEGER,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Users ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL CHECK(role IN ('owner','admin','tech','office')),
  -- NOT NULL, matching the live databases. A passkey-only account stores the
  -- empty NO_PASSWORD sentinel (apps/api/src/lib/password.ts), never NULL;
  -- verifyPassword fails closed on it. This was declared nullable while the live
  -- table was NOT NULL, so every signup 500'd in production while passing
  -- against a fresh database. scripts/db/check-migration-coverage.mjs now fails
  -- the build on that class of disagreement.
  password_hash TEXT NOT NULL,
  -- The owner's PERSONAL number, in E.164, and the only channel an account
  -- can be recovered through (apps/api/src/routes/otp.ts).
  --
  -- Deliberately NOT `workspaces.phone`. The workspace phone is the company
  -- line: it is printed on the contractor's micro-site, on every estimate and
  -- on the public workspace endpoint. Texting a sign-in code to a number the
  -- product itself publishes is not recovery, it is a takeover form with a
  -- "Send code" button. This column is write-only from the outside — set only
  -- by its owner, only after an OTP to the new number proves possession, and
  -- never returned in full by any endpoint (see maskPhone).
  --
  -- NULL means "no recovery channel", which is a legitimate state: an account
  -- with two passkeys may rationally want no SMS fallback at all.
  recovery_phone TEXT,
  -- The teammate contact number for chat's SMS fallback (GP-110 step 2):
  -- set by the teammate, resolved server-side from a user id, and the ONLY
  -- number that fallback may send to. Deliberately separate from
  -- recovery_phone above — the recovery channel is write-only from the
  -- outside and must never become a chat address. NULL means the teammate
  -- has not offered a number, and the fallback refuses for them.
  mobile_phone TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
-- One account per recovery number. Two users sharing one number makes the
-- recovery lookup ambiguous, and "whichever row came first" is not an answer
-- you want an authentication path to give. Partial, so the many rows with no
-- recovery number set do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_recovery_phone ON users(recovery_phone) WHERE recovery_phone IS NOT NULL;

-- ── WebAuthn Credentials ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id    TEXT NOT NULL UNIQUE,
  public_key       TEXT NOT NULL,
  counter          INTEGER NOT NULL DEFAULT 0,
  device_type      TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up        INTEGER NOT NULL DEFAULT 0,
  transports       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_cred ON webauthn_credentials(credential_id);

-- ── User Invitations ───────────────────────────────────────────
-- The one-time enrolment ticket for an invited teammate (GP-008). Sign-in is
-- passkeys only and passkey enrolment needs a session, so an invited user had
-- no way in at all. POST /api/workspace/users writes a row and returns
-- https://app.greenput.com/accept-invite/<token> for the inviter to pass on
-- by hand — nothing sends it. POST /api/auth/invite/:token/accept stamps
-- accepted_at (conditionally: NULL before, expires_at still ahead) and mints
-- the session the holder enrols their passkey under. One row admits one
-- session; a re-invite deletes the user's open rows and writes a fresh one.
CREATE TABLE IF NOT EXISTS user_invitations (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TEXT NOT NULL,
  accepted_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_user ON user_invitations(user_id);

-- ── Campaigns ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS campaigns (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed')),
  channel         TEXT NOT NULL CHECK(channel IN ('email','sms','postcard','social','google')),
  target_area     TEXT,
  budget          REAL,
  spent           REAL DEFAULT 0,
  leads_generated INTEGER NOT NULL DEFAULT 0,
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- ── Customers ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  company           TEXT,
  email             TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  preferred_contact TEXT NOT NULL DEFAULT 'phone' CHECK(preferred_contact IN ('email','phone','text')),
  street            TEXT NOT NULL DEFAULT '',
  city              TEXT NOT NULL DEFAULT '',
  state             TEXT NOT NULL DEFAULT '',
  zip               TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  consent_given_at  TEXT,
  consent_method    TEXT CHECK(consent_method IN ('form','verbal','email')),
  total_job_value      REAL NOT NULL DEFAULT 0,
  job_count            INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id   TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by           TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_customers_workspace ON customers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- ── Leads ─────────────────────────────────────────────────────

-- status: 'accepted' and 'withdrawn' are declared here for fresh installs
-- (dev bootstrap, tests, and any future from-scratch prod database) but are
-- NOT yet writable on the long-lived production `greenput` D1 database — see
-- the "lead billing lifecycle" migration note above the CI additive-migration
-- step in .github/workflows/ci.yml for why (leads is a RESTRICT-guarded FK
-- parent, which D1 cannot safely recreate via the usual defer_foreign_keys
-- trick). Until that's resolved, `qualified_at`/`accepted_at`/`withdrawn_at`
-- are the authoritative lifecycle signal everywhere — see
-- apps/api/src/routes/leads.ts's qualify/accept/withdraw handlers, which
-- intentionally never write these two status values so behavior is uniform
-- regardless of whether a given database has widened this CHECK yet.
CREATE TABLE IF NOT EXISTS leads (
  id                           TEXT PRIMARY KEY,
  workspace_id                 TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  first_name                   TEXT NOT NULL,
  last_name                    TEXT NOT NULL,
  email                        TEXT NOT NULL DEFAULT '',
  phone                        TEXT NOT NULL DEFAULT '',
  preferred_contact            TEXT NOT NULL DEFAULT 'phone' CHECK(preferred_contact IN ('email','phone','text')),
  street                       TEXT,
  city                         TEXT,
  state                        TEXT,
  zip                          TEXT,
  status                       TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','unqualified','converted','accepted','withdrawn')),
  source                       TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('website','referral','campaign','manual','google','nextdoor','other')),
  campaign_id                  TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  service_type                 TEXT NOT NULL DEFAULT '',
  estimated_value              REAL,
  notes                        TEXT NOT NULL DEFAULT '',
  converted_to_opportunity_id  TEXT,
  -- Billing lifecycle (nullable — independent of each other and of `status`).
  -- qualified_at: set the first time the receiving workspace confirms this is
  --   a real, contactable, in-scope service request. Necessary but not
  --   sufficient for billing.
  -- accepted_at: set when the receiving workspace commits to servicing a
  --   qualified lead. A state transition, NOT a charge (WS-1). Requires
  --   qualified_at IS NOT NULL. The billable event is the booking commit:
  --   recordLeadMeter() fires once per (lead, workspace) when a job is
  --   booked (apps/api/src/lib/lead-meter.ts).
  -- withdrawn_at: set if the consumer withdraws (e.g. balks at the price).
  --   Before a booking nothing is owed (no meter event exists yet). After
  --   a booking the fee stands: withdrawal never waives, deletes or refunds
  --   the meter event; only refundLeadFee reverses it (fraud or platform
  --   fault, with a recorded reason).
  -- withdrawn_reason: why, when the homeowner said (GP-105). Recorded, not
  --   adjudicated — the fee does not depend on it. The CHECK below reaches
  --   fresh databases only: 029 adds the column by ALTER TABLE, which cannot
  --   carry a CHECK, so libs/shared/validators and the tenant site enforce
  --   the same set (LEAD_WITHDRAWN_REASONS in libs/shared/models) in code.
  qualified_at                 TEXT,
  accepted_at                  TEXT,
  withdrawn_at                 TEXT,
  withdrawn_reason             TEXT CHECK(withdrawn_reason IN ('schedule_no_longer_works','chose_another_provider','no_longer_needed','other')),
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by                   TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);

-- ── Opportunities ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opportunities (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id               TEXT NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  customer_id           TEXT REFERENCES customers(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','proposal_sent','negotiating','won','lost')),
  value                 REAL NOT NULL DEFAULT 0,
  service_type          TEXT NOT NULL DEFAULT '',
  notes                 TEXT NOT NULL DEFAULT '',
  proposal_sent_at      TEXT,
  closed_at             TEXT,
  converted_to_job_id   TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  created_by            TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_opps_workspace ON opportunities(workspace_id);
CREATE INDEX IF NOT EXISTS idx_opps_lead ON opportunities(lead_id);
CREATE INDEX IF NOT EXISTS idx_opps_status ON opportunities(status);

-- ── Jobs ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobs (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  opportunity_id   TEXT NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  customer_id      TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  job_number       TEXT NOT NULL,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','completed','invoiced','paid','cancelled')),
  street           TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  state            TEXT NOT NULL DEFAULT '',
  zip              TEXT NOT NULL DEFAULT '',
  scheduled_start  TEXT NOT NULL,
  scheduled_end    TEXT NOT NULL,
  actual_start     TEXT,
  actual_end       TEXT,
  total            REAL NOT NULL DEFAULT 0,
  notes            TEXT NOT NULL DEFAULT '',
  invoiced_at      TEXT,
  paid_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by       TEXT NOT NULL REFERENCES users(id),
  -- The technician doing the work (GP-034), as distinct from created_by, who
  -- typed it in. Nullable with no default — 031 adds it by ALTER, and a NULL
  -- on a row that predates it is the honest answer, never created_by copied.
  assigned_to      TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- The capability behind the public invoice page,
  -- https://<slug>.greenput.com/invoice/<token> (GP-008). Minted by
  -- POST /api/jobs/:id/invoice as a random UUID; NULL until then, and NULL
  -- forever on jobs invoiced before migrations/032 — no link was ever made
  -- for them and nothing pretends otherwise. Uniqueness is the partial
  -- index below, never a column UNIQUE (ADD COLUMN cannot carry one).
  invoice_token    TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_assigned_to ON jobs(assigned_to);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_number ON jobs(job_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_invoice_token ON jobs(invoice_token) WHERE invoice_token IS NOT NULL;

-- ── Job Line Items ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_line_items (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_line_items_job ON job_line_items(job_id);

-- ── Job Slots ─────────────────────────────────────────────────
-- One row per half-hour a job occupies, per lane (GP-104). The PRIMARY KEY is
-- the whole double-booking guard: a booking inserts the job and its slot rows
-- in one batch, so a colliding row fails the batch and no job is left behind.
-- `lane` runs 0..workspaces.concurrent_jobs-1 (GP-101): a two-van shop has two
-- lanes and the third booking on a half-hour has nowhere to go. Never a
-- SELECT-then-INSERT on top of this — two requests interleaved between the
-- check and the write both pass, which is exactly the case that matters.
-- `slot_start` is the half-hour grid in UTC (`YYYY-MM-DDTHH:MM:00.000Z`), see
-- apps/api/src/lib/job-slots.ts. Existing databases get this table from
-- migrations/028-job-slots.sql.

CREATE TABLE IF NOT EXISTS job_slots (
  workspace_id TEXT    NOT NULL,
  slot_start   TEXT    NOT NULL,
  lane         INTEGER NOT NULL,
  job_id       TEXT    NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, slot_start, lane)
);

CREATE INDEX IF NOT EXISTS idx_job_slots_job ON job_slots(job_id);

-- ── Activity Log ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_log (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type  TEXT NOT NULL CHECK(entity_type IN ('lead','opportunity','job','customer','campaign','workspace','user','estimate','file','webhook','inventory_item','vehicle','branding','review','plugin')),
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  meta         TEXT, -- JSON
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);

-- ── Chat Rooms ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_rooms (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'Chat Room',
  entity_type  TEXT,
  entity_id    TEXT,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_workspace ON chat_rooms(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_entity ON chat_rooms(entity_type, entity_id);

-- ── Chat Messages ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
  id           TEXT PRIMARY KEY,
  chat_room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  user_name    TEXT NOT NULL,
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(chat_room_id, created_at);

-- ── Chat Read Receipts ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_read_receipts (
  user_id      TEXT NOT NULL,
  chat_room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, chat_room_id)
);

-- ── Schedule-aware delivery (migration 038) ───────────────────
-- Enrollment is configuration, not a paid tier: a row opts one team
-- member in for one service ('' = every service), exposing the listed
-- availability windows (empty array = all of theirs). lead_deliveries
-- records each auto-booked delivery and its one-tap undo.
CREATE TABLE IF NOT EXISTS schedule_delivery_enrollments (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_type    TEXT NOT NULL DEFAULT '',
  window_ids_json TEXT NOT NULL DEFAULT '[]',
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sde_workspace ON schedule_delivery_enrollments(workspace_id, enabled);
CREATE TABLE IF NOT EXISTS lead_deliveries (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  slot_start    TEXT NOT NULL,
  slot_end      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'booked'
                  CHECK (status IN ('booked', 'undone')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_lead_deliveries_lead ON lead_deliveries(lead_id, status);

-- ── Consumers (cross-workspace identity) ────────────────────────
-- The consumer as a single party across workspaces (PRD §1/Goal 4): one
-- row per person, matched by phone first, then email. Leads remain
-- children of exactly one workspace at a time; this row is what lets a
-- lead MOVE (the pool mechanism, migrations/037) without losing who it
-- is about, and what consent records link to via consumer_id.

CREATE TABLE IF NOT EXISTS consumers (
  id         TEXT PRIMARY KEY,
  phone      TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consumers_phone ON consumers(phone) WHERE phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_consumers_email ON consumers(email) WHERE email <> '';

-- ── Lead pool (offers + transfers) ────────────────────────────────
-- The network pool mechanism: a lead is OFFERED from one workspace to
-- another (only with the consumer's reroute consent — the grant's
-- allow_network_reroute), and on acceptance it MOVES: leads.workspace_id
-- is re-pointed, a transfer row records the move, a fresh consent record
-- grants the receiver the same fields. Pool acceptance bills nothing; the
-- per-lead fee bills to the RECEIVER when the lead is booked (WS-1).

CREATE TABLE IF NOT EXISTS lead_offers (
  id                TEXT PRIMARY KEY,
  lead_id           TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  consumer_id       TEXT NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
  from_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  to_workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'offered' CHECK(status IN ('offered','accepted','declined','expired','withdrawn')),
  offered_at        TEXT NOT NULL,
  responded_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_offers_lead ON lead_offers(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_offers_to ON lead_offers(to_workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_offers_from ON lead_offers(from_workspace_id, status);

CREATE TABLE IF NOT EXISTS lead_transfers (
  id                TEXT PRIMARY KEY,
  lead_id           TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  offer_id          TEXT NOT NULL REFERENCES lead_offers(id) ON DELETE CASCADE,
  consumer_id       TEXT NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
  from_workspace_id TEXT NOT NULL,
  to_workspace_id   TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_transfers_lead ON lead_transfers(lead_id);

-- ── Consent records ─────────────────────────────────────────────
-- The persisted consent record (gap C2): one row per consumer grant to
-- one workspace, shaped exactly like the MCP booking grant — the fields
-- that may be used, the single purpose (quote-and-schedule), whether the
-- network pool may reroute, and when it was granted. Revocation is a
-- timestamp on the row, never a delete: the record of what was agreed
-- has to survive the agreement ending. Consumer-facing SMS requires an
-- active row whose fields include 'phone' (libs/shared/consent).

CREATE TABLE IF NOT EXISTS consent_records (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id               TEXT REFERENCES leads(id) ON DELETE SET NULL,
  consumer_id           TEXT REFERENCES consumers(id) ON DELETE SET NULL,
  consumer_phone        TEXT NOT NULL DEFAULT '',
  consumer_email        TEXT NOT NULL DEFAULT '',
  fields                TEXT NOT NULL, -- JSON array of grant-model field names
  purpose               TEXT NOT NULL DEFAULT 'quote-and-schedule',
  allow_network_reroute INTEGER NOT NULL DEFAULT 0,
  source                TEXT NOT NULL, -- intake_quote | tenant_site_form | public_form | manual_entry | mcp_booking | pool_offer
  consent_text          TEXT NOT NULL, -- the exact words the consumer agreed to
  granted_at            TEXT NOT NULL,
  revoked_at            TEXT,
  revoke_source         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consent_workspace_phone ON consent_records(workspace_id, consumer_phone);
CREATE INDEX IF NOT EXISTS idx_consent_workspace_email ON consent_records(workspace_id, consumer_email);
CREATE INDEX IF NOT EXISTS idx_consent_lead ON consent_records(lead_id);

-- ── SMS fallback sends (GP-110 step 2) ──────────────────────────
-- The per-workspace daily-cap ledger for chat's SMS fallback: one row per
-- SUCCESSFUL fallback send, counted by UTC day before the next send is
-- allowed. The destination number is never stored here — it is resolved
-- from users.mobile_phone at send time and stays there.

CREATE TABLE IF NOT EXISTS sms_fallback_sends (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_room_id      TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sms_fallback_sends_workspace_day ON sms_fallback_sends(workspace_id, created_at);

-- ── Admin Users ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- ── Admin WebAuthn Credentials ──────────────────────────────

CREATE TABLE IF NOT EXISTS admin_webauthn_credentials (
  id               TEXT PRIMARY KEY,
  admin_user_id    TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  credential_id    TEXT NOT NULL UNIQUE,
  public_key       TEXT NOT NULL,
  counter          INTEGER NOT NULL DEFAULT 0,
  device_type      TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up        INTEGER NOT NULL DEFAULT 0,
  transports       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_webauthn_user ON admin_webauthn_credentials(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_webauthn_cred ON admin_webauthn_credentials(credential_id);

-- ── Subscriptions (Stripe Billing) ──────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id   TEXT NOT NULL UNIQUE,
  stripe_customer_id       TEXT NOT NULL,
  plan                     TEXT NOT NULL DEFAULT 'starter' CHECK(plan IN ('starter','pro','business','enterprise')),
  status                   TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','past_due','canceled','trialing','incomplete')),
  current_period_start     TEXT NOT NULL,
  current_period_end       TEXT NOT NULL,
  cancel_at_period_end     INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

-- ── Payments (Stripe Connect) ───────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id                        TEXT PRIMARY KEY,
  workspace_id              TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id                    TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  customer_id               TEXT REFERENCES customers(id) ON DELETE SET NULL,
  stripe_payment_intent_id  TEXT UNIQUE,
  amount                    INTEGER NOT NULL,  -- cents
  currency                  TEXT NOT NULL DEFAULT 'usd',
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','failed','refunded')),
  description               TEXT NOT NULL DEFAULT '',
  payment_method_type       TEXT,
  receipt_url               TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_workspace ON payments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_payments_job ON payments(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe ON payments(stripe_payment_intent_id);

-- ── Deposits (booking deposits, fee paper v2 §3) ────────────
-- One row per auto-booked job that carries a deposit. The customer pays the
-- deposit at booking; it is a down payment credited toward the job price,
-- never a GreenPut charge to the customer. Money moves as a Stripe Connect
-- destination charge with manual capture: the PaymentIntent is authorized
-- at booking (status 'pending' until the authorization lands, then 'held')
-- and exactly one settlement ends the row —
--   'applied'   the job completed; captured in full to the shop and
--               credited against the final invoice;
--   'refunded'  every exit that is not a forfeit (customer cancels before
--               confirmation or outside the 24h window, the shop cancels
--               or cannot perform, the delivery is undone): the
--               authorization is voided — or, if it was somehow captured,
--               refunded with the transfer reversed — so the customer is
--               made whole and no fee is taken;
--   'forfeited' the ONLY forfeit case: a confirmed booking the customer
--               cancels inside the 24h window, or a no-show. Captured
--               with the application fee set to GreenPut's delivered-lead
--               fee, so the forfeit pays the fee first and the remainder
--               reaches the shop for the held slot. A shortfall against
--               the fee is absorbed by GreenPut (fee paper v2 §4) — the
--               split is recorded on the row and the lead's meter event
--               is waived, never invoiced as a second bill.
-- 'failed' is a creation/authorization failure (declined card, Stripe
-- error): nothing is held and the row keeps the error for the operator.
-- confirmation_token is the capability for the homeowner's card-
-- confirmation page on the shop's tenant site (/deposit/<token>,
-- migrations/040): minted at creation, never derived from the row id.
-- Amounts are integer cents (§5.0.1); fee_cents is the delivered-lead fee
-- actually charged for the booking (the lead's meter price_usd × 100),
-- snapshotted at creation so a later rate-card change cannot rewrite a
-- live deposit. quote_low_cents snapshots the quote band's low end the
-- 10% cap was computed from, when a quote exists.
CREATE TABLE IF NOT EXISTS deposits (
  id                        TEXT PRIMARY KEY,
  workspace_id              TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id                    TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  lead_id                   TEXT REFERENCES leads(id) ON DELETE SET NULL,
  customer_id               TEXT REFERENCES customers(id) ON DELETE SET NULL,
  stripe_payment_intent_id  TEXT UNIQUE,
  connected_account_id      TEXT,
  amount_cents              INTEGER NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'usd',
  fee_cents                 INTEGER NOT NULL,
  quote_low_cents           INTEGER,
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','held','refunded','forfeited','applied','failed')),
  stripe_status             TEXT,
  fee_portion_cents         INTEGER,
  shop_portion_cents        INTEGER,
  shortfall_cents           INTEGER,
  confirmed_at              TEXT,
  settled_at                TEXT,
  settle_reason             TEXT,
  last_error                TEXT,
  confirmation_token        TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deposits_workspace ON deposits(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_job ON deposits(job_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_stripe ON deposits(stripe_payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_confirmation_token ON deposits(confirmation_token);

-- ── Form Submissions (public lead capture) ──────────────────

CREATE TABLE IF NOT EXISTS form_submissions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id      TEXT REFERENCES leads(id) ON DELETE SET NULL,
  form_data    TEXT NOT NULL,  -- JSON
  source_url   TEXT,
  ip_address   TEXT,
  processed    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_workspace ON form_submissions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_processed ON form_submissions(processed);

-- ── Notification Preferences ────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK(channel IN ('email','sms','push')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences(user_id);

-- ── Notification Log ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_log (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel      TEXT NOT NULL CHECK(channel IN ('email','sms','push')),
  event_type   TEXT NOT NULL,
  recipient    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','failed','bounced')),
  error_msg    TEXT,
  sent_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_log_workspace ON notification_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_user ON notification_log(user_id);

-- ── Webhooks ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhooks (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  events         TEXT NOT NULL DEFAULT '[]',
  secret         TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON webhooks(workspace_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id             TEXT PRIMARY KEY,
  webhook_id     TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL,
  payload        TEXT NOT NULL,
  status_code    INTEGER,
  response_body  TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  delivered_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);

-- ── Stripe columns on existing tables ─────────────────────────

-- Workspace billing & connect accounts
-- (D1 supports ALTER TABLE ADD COLUMN but not in IF NOT EXISTS form,
--  so these are idempotent via CREATE TABLE above having defaults.)
-- Run these as one-time migrations:
-- Existing databases get the Stripe columns from
-- migrations/008-stripe-columns.sql. They spent months here as a comment,
-- which is why the live databases never had them.

-- ── Estimates / Proposals ────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimates (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  opportunity_id   TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  customer_id      TEXT REFERENCES customers(id) ON DELETE SET NULL,
  estimate_number  TEXT NOT NULL,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','rejected','expired')),
  line_items       TEXT NOT NULL DEFAULT '[]',
  subtotal         REAL NOT NULL DEFAULT 0,
  tax_rate         REAL NOT NULL DEFAULT 0,
  tax_amount       REAL NOT NULL DEFAULT 0,
  total            REAL NOT NULL DEFAULT 0,
  notes            TEXT NOT NULL DEFAULT '',
  valid_until      TEXT,
  sent_at          TEXT,
  accepted_at      TEXT,
  rejected_at      TEXT,
  -- The homeowner quote this estimate was drafted from (migration 044).
  quote_session_id TEXT REFERENCES pricing_quote_sessions(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by       TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_estimates_workspace ON estimates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_estimates_quote_session ON estimates(quote_session_id);
CREATE INDEX IF NOT EXISTS idx_estimates_opportunity ON estimates(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status);

-- ── Change orders ──────────────────────────────────────────
-- The only way a job's (or a sent estimate's) price moves once it exists.
-- One row per proposed change: proposed → approved | rejected, decided exactly
-- once. Money is whole cents. line_items is JSON in the estimate line shape
-- ({id,type,description,quantity,unitPrice,total}); a negative unitPrice is a
-- credit. price_delta is the signed sum of the lines; total_before is the
-- parent's total when the change was proposed. Approving appends the lines to
-- the parent and recomputes its total. change_order_events is the
-- append-only trail. Exactly one parent: a job or an estimate. (migration 045)
CREATE TABLE IF NOT EXISTS change_orders (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id         TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  estimate_id    TEXT REFERENCES estimates(id) ON DELETE CASCADE,
  number         TEXT NOT NULL,
  title          TEXT NOT NULL,
  reason         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected')),
  line_items     TEXT NOT NULL DEFAULT '[]',
  price_delta    INTEGER NOT NULL DEFAULT 0,
  total_before   INTEGER NOT NULL DEFAULT 0,
  decided_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at     TEXT,
  decision_note  TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     TEXT NOT NULL REFERENCES users(id),
  CHECK ((job_id IS NULL) <> (estimate_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_change_orders_workspace ON change_orders(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_change_orders_job ON change_orders(job_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_estimate ON change_orders(estimate_id);

CREATE TABLE IF NOT EXISTS change_order_events (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  change_order_id  TEXT NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  action           TEXT NOT NULL CHECK(action IN ('proposed','approved','rejected')),
  actor_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  note             TEXT NOT NULL DEFAULT '',
  total_after      INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_change_order_events_co ON change_order_events(change_order_id, created_at);

-- ── Files (R2-backed file uploads) ──────────────────────────

CREATE TABLE IF NOT EXISTS files (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  r2_key       TEXT NOT NULL UNIQUE,
  uploaded_by  TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_type, entity_id);

-- ── API Keys ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  key_prefix     TEXT NOT NULL,
  key_hash       TEXT NOT NULL,
  scopes         TEXT NOT NULL DEFAULT '["read"]',
  last_used_at   TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- ── Customer Portal Magic Link Tokens ────────────────────────

CREATE TABLE IF NOT EXISTS portal_tokens (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON portal_tokens(token);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_customer ON portal_tokens(customer_id);

-- ── Deletion Requests (GDPR compliance) ──────────────────────

CREATE TABLE IF NOT EXISTS deletion_requests (
  id                     TEXT PRIMARY KEY,
  workspace_id           TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by           TEXT NOT NULL REFERENCES users(id),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cancelled','completed')),
  scheduled_deletion_at  TEXT NOT NULL,
  completed_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_workspace ON deletion_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests(status);

-- ── Multi-Workspace Support ───────────────────────────────────

CREATE TABLE IF NOT EXISTS user_workspaces (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'tech' CHECK(role IN ('owner','admin','tech','office')),
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_user_workspaces_user ON user_workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_user_workspaces_workspace ON user_workspaces(workspace_id);

-- ── SSO Configurations ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sso_configurations (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK(provider IN ('saml','oidc','google','microsoft')),
  issuer_url       TEXT NOT NULL,
  client_id        TEXT,
  client_secret    TEXT,
  certificate      TEXT,
  metadata_url     TEXT,
  enabled          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sso_workspace ON sso_configurations(workspace_id);

-- ── Custom Roles (Advanced RBAC) ──────────────────────────────

CREATE TABLE IF NOT EXISTS custom_roles (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  permissions  TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_workspace ON custom_roles(workspace_id);

-- ── Plugins (marketplace registry) ────────────────────────────

CREATE TABLE IF NOT EXISTS plugins (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  version      TEXT NOT NULL DEFAULT '1.0.0',
  author       TEXT NOT NULL DEFAULT '',
  icon_url     TEXT,
  category     TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('general','communication','accounting','scheduling','marketing','analytics')),
  events       TEXT NOT NULL DEFAULT '[]',
  config_schema TEXT NOT NULL DEFAULT '{}',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plugins_slug ON plugins(slug);
CREATE INDEX IF NOT EXISTS idx_plugins_category ON plugins(category);

-- ── Plugin Installations (per-workspace) ──────────────────────

CREATE TABLE IF NOT EXISTS plugin_installations (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plugin_id    TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  config       TEXT NOT NULL DEFAULT '{}',
  enabled      INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  installed_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(workspace_id, plugin_id)
);
CREATE INDEX IF NOT EXISTS idx_plugin_installations_workspace ON plugin_installations(workspace_id);

-- ── White-Label Branding ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS branding (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  logo_url         TEXT,
  favicon_url      TEXT,
  primary_color    TEXT NOT NULL DEFAULT '#10b981',
  secondary_color  TEXT NOT NULL DEFAULT '#1f2937',
  accent_color     TEXT NOT NULL DEFAULT '#3b82f6',
  font_family      TEXT NOT NULL DEFAULT 'system-ui',
  custom_domain    TEXT,
  email_footer     TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_branding_workspace ON branding(workspace_id);

-- ── Reviews / Reputation ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id   TEXT REFERENCES customers(id) ON DELETE SET NULL,
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  platform      TEXT NOT NULL DEFAULT 'internal' CHECK(platform IN ('internal','google','yelp','nextdoor','facebook')),
  rating        INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  content       TEXT NOT NULL DEFAULT '',
  author_name   TEXT NOT NULL DEFAULT '',
  review_url    TEXT,
  responded     INTEGER NOT NULL DEFAULT 0,
  response_text TEXT,
  fetched_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_workspace ON reviews(workspace_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);

CREATE TABLE IF NOT EXISTS review_requests (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK(channel IN ('email','sms')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','completed','declined')),
  sent_at       TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_review_requests_workspace ON review_requests(workspace_id);

-- ── Inventory ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  sku            TEXT,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT 'general',
  quantity       INTEGER NOT NULL DEFAULT 0,
  min_quantity   INTEGER NOT NULL DEFAULT 0,
  unit_cost      REAL NOT NULL DEFAULT 0,
  unit_price     REAL NOT NULL DEFAULT 0,
  supplier       TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_workspace ON inventory_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory_items(sku);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id          TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  job_id           TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  type             TEXT NOT NULL CHECK(type IN ('purchase','usage','adjustment','return')),
  quantity         INTEGER NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by       TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_trans_item ON inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_workspace ON inventory_transactions(workspace_id);

-- ── Fleet / Vehicles ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  make           TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  year           INTEGER,
  license_plate  TEXT,
  vin            TEXT,
  assigned_to    TEXT REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','inactive')),
  mileage        INTEGER NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_workspace ON vehicles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_assigned ON vehicles(assigned_to);

-- ── Physical Assets (QR-tagged equipment/tools) ─────────────
CREATE TABLE IF NOT EXISTS assets (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'equipment',
  serial_number  TEXT,
  qr_code        TEXT UNIQUE,
  status         TEXT NOT NULL DEFAULT 'available'
    CHECK(status IN ('available','checked_out','maintenance','retired')),
  assigned_to    TEXT REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id     TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  purchase_date  TEXT,
  purchase_cost  REAL,
  condition      TEXT NOT NULL DEFAULT 'good'
    CHECK(condition IN ('new','good','fair','poor')),
  location       TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assets_qr ON assets(qr_code);
CREATE INDEX IF NOT EXISTS idx_assets_assigned ON assets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assets_vehicle ON assets(vehicle_id);

-- ── Asset Maintenance Logs ──────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id       TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  type           TEXT NOT NULL DEFAULT 'repair'
    CHECK(type IN ('repair','inspection','calibration','cleaning','replacement')),
  description    TEXT NOT NULL,
  cost           REAL,
  performed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  performed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  next_due       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maint_asset ON maintenance_logs(asset_id);
CREATE INDEX IF NOT EXISTS idx_maint_workspace ON maintenance_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_maint_next_due ON maintenance_logs(next_due);

-- ── Error Logs (monitoring / error tracking) ────────────────
CREATE TABLE IF NOT EXISTS error_logs (
  id           TEXT PRIMARY KEY,
  severity     TEXT NOT NULL,
  category     TEXT NOT NULL,
  code         TEXT NOT NULL,
  message      TEXT NOT NULL,
  stack        TEXT,
  request_id   TEXT,
  user_id      TEXT,
  workspace_id TEXT,
  path         TEXT,
  method       TEXT,
  status_code  INTEGER,
  metadata     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at);

-- ── Asset Assignments (check-in/check-out history) ──────────
CREATE TABLE IF NOT EXISTS asset_assignments (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id       TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id         TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK(action IN ('check_out','check_in')),
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assignments_asset ON asset_assignments(asset_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON asset_assignments(user_id);

-- ── Lead Meter Events (per-lead billing audit trail) ──────────
-- Per-lead pricing is the core revenue model. A row here is created exactly
-- once per (lead, workspace) at BOOKING commit — today that is
-- schedule-aware delivery, which writes the job, its slots and the
-- lead_deliveries('booked') row in the same batch (recordLeadMeter() in
-- lib/lead-meter.ts) — never at lead creation, never at a staff accept
-- click, and never at a pool accept (WS-1, canonical model v14).
-- job_id / delivery_id link the row to the booking that created it.
-- priority = 1 marks a priority (rescue) booking, priced at 50% of the
-- resolved rate. Status starts 'pending'. chargeBookedLeadFee
-- (lib/lead-fee-billing.ts) then charges that one row off-session. A
-- succeeded PaymentIntent flips it to 'invoiced'. 'waived' is a legacy
-- status from the pre-WS-1 model (a lead withdrawn after acceptance while
-- the fee was still pending); no current path writes it for a booking
-- fee — declines, cancels and no-shows leave the fee standing. The ONLY
-- refund path is refundLeadFee, for proven fraud or platform fault, with
-- the reason recorded in refund_reason.
-- payment_status is the collection state (paid, failed, no_payment_method,
-- processing, unconfigured, below_minimum). NULL until a charge is attempted.
-- A pending row with payment_status failed or processing pauses further
-- accept and auto-book (lib/lead-billing-gate.ts) until it is collected
-- or waived. With Stripe configured, no saved card refuses the booking
-- before this row is inserted.
-- No CHECK: the column is added by ALTER TABLE, which cannot carry one.
-- stripe_payment_intent_id is the platform PaymentIntent for this lead.
-- The partial unique index allows many NULLs (not yet charged) and forbids
-- two rows sharing one intent. stripe_usage_record_id is unused.
-- UNIQUE(lead_id, workspace_id): one fee per lead per shop — a rebook at
-- the SAME shop can never insert a second billing row, while an
-- eject-and-rebook at a DIFFERENT shop bills that shop. recordLeadMeter()
-- uses INSERT ... ON CONFLICT(lead_id, workspace_id) DO NOTHING.
CREATE TABLE IF NOT EXISTS lead_meter_events (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  vertical      TEXT NOT NULL,
  service_type  TEXT NOT NULL DEFAULT '',
  price_usd     REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','invoiced','refunded','waived')),
  stripe_usage_record_id TEXT,
  stripe_payment_intent_id TEXT,
  payment_status TEXT,
  invoiced_at   TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  job_id        TEXT,
  delivery_id   TEXT,
  priority      INTEGER NOT NULL DEFAULT 0,
  refund_reason TEXT,
  UNIQUE(lead_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_meter_workspace ON lead_meter_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meter_status ON lead_meter_events(status);
CREATE INDEX IF NOT EXISTS idx_meter_lead ON lead_meter_events(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meter_stripe_payment_intent ON lead_meter_events(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- ── Workspace usage ledger (prepaid SMS balance) ──────────────
-- Credits are top-ups charged to the saved card. Debits are outbound SMS
-- the contractor initiated (chat fallback, booking texts). amount_micro_usd
-- is positive for a credit and negative for a debit, in micro-USD — the
-- same unit as workspaces.usage_balance_micro_usd, and deliberately not
-- cents. Account-recovery OTP is not written here.
-- A top-up row is inserted pending before Stripe is called. The partial
-- unique index allows one pending top-up per workspace, so two sends
-- cannot start two charges. payment_status has no CHECK (same reason as
-- lead_meter_events: a later ALTER cannot carry one). failed or processing
-- pauses accept and auto-book, alongside a failed lead fee
-- (lib/lead-billing-gate.ts).
-- sms_estimate reserves Twilio's published US list price at send time.
-- sms_reconcile adjusts that reserve to the status-callback Price, once
-- per MessageSid. sms_reversal credits the reserve back when the send
-- itself fails. The ledger is append-only: nothing here is deleted.
CREATE TABLE IF NOT EXISTS workspace_usage_ledger (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                CHECK(kind IN ('topup','sms_estimate','sms_reconcile','sms_reversal')),
  amount_micro_usd INTEGER NOT NULL,
  balance_after_micro_usd INTEGER NOT NULL,
  twilio_message_sid TEXT,
  segments      INTEGER,
  stripe_payment_intent_id TEXT,
  payment_status TEXT,
  description   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_workspace_created ON workspace_usage_ledger(workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_sms_estimate_sid ON workspace_usage_ledger(twilio_message_sid) WHERE kind = 'sms_estimate' AND twilio_message_sid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_sms_reconcile_sid ON workspace_usage_ledger(twilio_message_sid) WHERE kind = 'sms_reconcile' AND twilio_message_sid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_topup_pi ON workspace_usage_ledger(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_topup_pending ON workspace_usage_ledger(workspace_id) WHERE kind = 'topup' AND payment_status = 'pending';

-- ── Pricing state machines ────────────────────────────────────
-- An enrichment form is a finite state machine whose traversal deterministically
-- produces a price range. The engine that walks it is libs/shared/pricing; the
-- five seeded machines and the default rate card are seeds/pricing/, loaded with
--   node scripts/seed/pricing-fsms.mjs sql
--
-- A flow's graph is immutable once published, and so are the numbers it prices
-- against — a homeowner half-way through a form must finish against what they
-- started on, and a contractor who has promised to honour a range must be able
-- to see exactly which graph and which rates produced it. That is why the graph
-- and the rate card each live on a version row and a session pins both.
--
-- workspace_id NULL means a Greenput global template. A tenant site runs the
-- global templates until the contractor clones one into their own workspace and
-- tunes it; see listPublishedFlows() in libs/shared/pricing/src/store.ts.
--
-- These replace five tables (intake_flows, flow_states, flow_transitions,
-- flow_instances, flow_instance_events) that were applied to the `greenput`
-- database by hand, outside CI, and were declared in no commit. See
-- migrations/010-pricing-fsm.sql and docs/UNTRACKED-PRODUCTION-TABLES.md.

CREATE TABLE IF NOT EXISTS pricing_fsms (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  slug               TEXT NOT NULL,
  vertical           TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  -- The published version a new session starts on. NULL = nothing published yet,
  -- which is how a flow is hidden from every tenant site without deleting it.
  current_version_id TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL
);
-- COALESCE, not a plain UNIQUE(workspace_id, slug): SQLite treats NULLs as
-- distinct, so a bare composite unique index would happily accept two global
-- templates both called 'ev-charger-install'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_fsms_slug ON pricing_fsms(COALESCE(workspace_id, ''), slug);
CREATE INDEX IF NOT EXISTS idx_pricing_fsms_workspace ON pricing_fsms(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pricing_fsms_vertical ON pricing_fsms(vertical);

CREATE TABLE IF NOT EXISTS pricing_fsm_versions (
  id             TEXT PRIMARY KEY,
  fsm_id         TEXT NOT NULL REFERENCES pricing_fsms(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  -- The whole machine, flattened (fragments already inlined) — entry, states,
  -- terminals, honesty rules and all. Immutable once status = 'published'.
  graph_json     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK(status IN ('draft','published','archived')),
  published_at   TEXT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fsm_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_pricing_fsm_versions_fsm ON pricing_fsm_versions(fsm_id, status);

CREATE TABLE IF NOT EXISTS rate_cards (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_cards_workspace ON rate_cards(workspace_id);

CREATE TABLE IF NOT EXISTS rate_card_versions (
  id             TEXT PRIMARY KEY,
  rate_card_id   TEXT NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  -- Labour rates, the parts list, permit policy and the uncertainty settings.
  -- Immutable once status = 'published', for the same reason graph_json is.
  rates_json     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK(status IN ('draft','published','archived')),
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(rate_card_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_rate_card_versions_card ON rate_card_versions(rate_card_id, status);

-- One homeowner filling in one form. `answers` holds ONLY what they actually
-- answered: derived values, defaults and photo interpretations are recomputed
-- on every step, so a session can be resumed or re-priced without carrying
-- anything stale. `quote_json` freezes the outcome exactly as it was shown,
-- because that range is a commitment.
CREATE TABLE IF NOT EXISTS pricing_quote_sessions (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fsm_id               TEXT NOT NULL REFERENCES pricing_fsms(id),
  fsm_version_id       TEXT NOT NULL REFERENCES pricing_fsm_versions(id),
  rate_card_version_id TEXT NOT NULL REFERENCES rate_card_versions(id),
  lead_id              TEXT REFERENCES leads(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'in_progress'
                       CHECK(status IN ('in_progress','completed','abandoned')),
  current_state_id     TEXT,
  answers              TEXT NOT NULL DEFAULT '{}',
  env                  TEXT NOT NULL DEFAULT '{}',
  terminal_id          TEXT,
  quote_low            REAL,
  quote_high           REAL,
  quote_json           TEXT,
  source_url           TEXT,
  started_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_quote_sessions_workspace ON pricing_quote_sessions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_quote_sessions_lead ON pricing_quote_sessions(lead_id);
CREATE INDEX IF NOT EXISTS idx_quote_sessions_fsm ON pricing_quote_sessions(fsm_id);

-- Append-only: one row per screen answered, carrying the raw submitted input.
-- A quote can be re-derived — or disputed — from what the homeowner actually
-- typed, not from the merged state it produced.
CREATE TABLE IF NOT EXISTS pricing_quote_events (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES pricing_quote_sessions(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  from_state_id TEXT NOT NULL,
  to_state_id   TEXT,
  input         TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, seq)
);

-- ── Panel photos: the file, and what a human read off it ──────
-- The machines' `photo` screens are the one step whose answer nobody can type
-- (seeds/pricing/fragments/panel-check.json). A homeowner sends an image; a
-- licensed electrician reads it later; the quote narrows. Until this table
-- existed the photo screen accepted a CLIENT-ASSERTED status with no file
-- behind it, so `unreviewed` was an unverifiable claim and `reviewed` was
-- unreachable — the band could never narrow.
--
-- One row per (session, answer key). `status` and `fields_json` are the ONLY
-- source of a photo answer from now on: `photoAnswerFor()` reads them
-- server-side, so a consumer cannot assert what is in their own panel.
--
-- status='unreviewed' + fields_json='{}' is the shipping default. Nothing
-- classifies panel photos, so the traversal falls back to each interpretation
-- field's `default_when_missing`, lands on whatever the machine decides that
-- means (usually a spanning band), and this row is what puts the photo in the
-- contractor's review queue. That is greenput-fsm-pricing.md §3(c), and the
-- seed's own resolution_policy: "Never block the first number on this."
CREATE TABLE IF NOT EXISTS pricing_photo_reviews (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES pricing_quote_sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The machine's answer key, e.g. 'panel_photo'.
  answer_key   TEXT NOT NULL,
  file_id      TEXT NOT NULL REFERENCES files(id),
  method       TEXT NOT NULL DEFAULT 'unresolved'
               CHECK(method IN ('contractor_review','greenput_ops_review','automated_classification','unresolved')),
  status       TEXT NOT NULL DEFAULT 'unreviewed'
               CHECK(status IN ('missing','unreviewed','reviewed','unreadable')),
  -- JSON object of whatever the reviewer could read, keyed by the machine's
  -- own interpretation field names. `{}` means nothing was read.
  fields_json  TEXT NOT NULL DEFAULT '{}',
  confidence   REAL,
  reviewed_by  TEXT REFERENCES users(id),
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, answer_key)
);
CREATE INDEX IF NOT EXISTS idx_photo_reviews_pending ON pricing_photo_reviews(workspace_id, status);

-- ── Feature flags ─────────────────────────────────────────────
-- Read by both the API and tenant-site Workers, which share the D1 binding but
-- not a KV namespace — so D1, not KV, is where a flag both of them must agree
-- on has to live. Consumed through @basenative/flags' createFlagManager via the
-- D1 provider in libs/shared/pricing/src/flags.ts; the rollout and rule
-- semantics are the package's, not a reimplementation.
-- Absent row = disabled, which is what "ships dark" means here.
CREATE TABLE IF NOT EXISTS feature_flags (
  name        TEXT PRIMARY KEY,
  -- @basenative/flags flag config: { enabled, percentage?, rules? }
  config_json TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- The platform admin (admin_users.id) who last flipped it. Not a workspace
  -- user: a global flag is not a tenant's to set (GP-107).
  updated_by  TEXT REFERENCES admin_users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── A published version can never be rewritten ────────────────
-- The whole reproducibility guarantee rests on this: a quote pins
-- `fsm_version_id` and `rate_card_version_id`, and re-reading those has to
-- return what the homeowner was actually priced against, years later. A
-- comment saying "immutable once published" is not that guarantee; these are.
--
-- Only `status` may move on (to 'archived'), which is what "publish a new
-- version instead" looks like. Drafts stay editable.
CREATE TRIGGER IF NOT EXISTS trg_fsm_version_immutable
BEFORE UPDATE OF graph_json ON pricing_fsm_versions
FOR EACH ROW WHEN OLD.status = 'published' AND NEW.graph_json <> OLD.graph_json
BEGIN
  SELECT RAISE(ABORT, 'pricing_fsm_versions.graph_json is immutable once published');
END;

CREATE TRIGGER IF NOT EXISTS trg_rate_card_version_immutable
BEFORE UPDATE OF rates_json ON rate_card_versions
FOR EACH ROW WHEN OLD.status = 'published' AND NEW.rates_json <> OLD.rates_json
BEGIN
  SELECT RAISE(ABORT, 'rate_card_versions.rates_json is immutable once published');
END;
