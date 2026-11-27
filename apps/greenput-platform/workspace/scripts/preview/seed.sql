-- ─────────────────────────────────────────────────────────────
-- Preview environment seed data
-- Creates a demo workspace and user for testing.
-- The demo user has NO password and NO passkey: it is a workspace that exists
-- so demo.greenput.com has something to render, not an account anyone signs
-- into. It used to carry the literal string 'demo1234' in password_hash, and
-- apps/api/src/lib/password.ts authenticates a stored value containing no
-- colon by comparing it to the submitted password — so that was a working
-- owner login, for a production workspace, with the credential written on
-- this line of a file in the repository. Worse, this file is executed against
-- the PRODUCTION database on every deploy (.github/workflows/ci.yml, "Seed the
-- demo tenant"), so it was re-asserted continuously.
--
-- '' is the NO_PASSWORD sentinel; verifyPassword fails closed on it before it
-- reaches the plaintext branch. If a signed-in demo is ever wanted, it needs a
-- scoped read-only mechanism, not an owner account on a shared password.
--
-- The `demo` workspace doubles as Greenput's own reference micro-site: a
-- fictional residential electrician ("Rivertown Electric") used to show
-- prospects what a tenant site built on this platform looks and measures
-- like (see docs/technology-showcase-methodology.md or apps/marketing's
-- /technology page).
-- tenant-site labels it as a demo in the UI and keeps it out of search
-- (see the `isDemo` handling in apps/tenant-site/src/render.ts) — it must
-- never be mistaken for a real, solicitable business.
--
-- Everything below is invented and deliberately fake:
--   - Phone numbers use the "555-01XX" block NANPA reserves for fiction.
--   - The street/city/zip are placeholders, and the email domain uses the
--     RFC 2606 `.example` TLD, which can never resolve to a real mailbox.
--   - No license number, certification, or testimonial is set — those
--     would imply real credentials, so they're left absent rather than
--     invented.
-- ─────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Rivertown Electric',
  'demo',
  'electrical',
  '(512) 555-0142',
  'hello@rivertownelectric.example',
  '100 Example Way',
  'Rivertown',
  'TX',
  '00000'
);

INSERT OR IGNORE INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'Demo',
  'User',
  'demo@greenput.com',
  'owner',
  '',
  datetime('now'),
  datetime('now')
);

-- ── Demo services ────────────────────────────────────────────
-- tenant-site's "What We Do" / Services pages derive their list entirely
-- from historical leads.service_type (grouped + counted — see
-- apps/tenant-site/src/index.ts), not from a curated services table. These
-- rows are what makes the demo site's Services section non-empty and are
-- what a brand-new electrician's own lead history would realistically look
-- like a few weeks into using the product. The lead names are placeholders
-- and are never displayed publicly — only the aggregated service_type is.
INSERT OR IGNORE INTO leads
  (id, workspace_id, first_name, last_name, email, phone, preferred_contact, status, source, service_type, notes, created_at, updated_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Alex',    'Rivera',  'alex.rivera@example.com',   '555-0101', 'email', 'converted', 'manual', 'Panel Upgrade',                '', datetime('now','-40 days'), datetime('now','-40 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Jordan',  'Lee',     'jordan.lee@example.com',    '555-0102', 'phone', 'converted', 'manual', 'Panel Upgrade',                '', datetime('now','-35 days'), datetime('now','-35 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'Morgan',  'Patel',   'morgan.patel@example.com',  '555-0103', 'email', 'converted', 'manual', 'EV Charger Installation',      '', datetime('now','-30 days'), datetime('now','-30 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'Casey',   'Nguyen',  'casey.nguyen@example.com',  '555-0104', 'phone', 'qualified', 'manual', 'EV Charger Installation',      '', datetime('now','-28 days'), datetime('now','-28 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000001', 'Riley',   'Kim',     'riley.kim@example.com',     '555-0105', 'email', 'converted', 'manual', 'Whole-Home Rewiring',          '', datetime('now','-25 days'), datetime('now','-25 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000001', 'Taylor',  'Brooks',  'taylor.brooks@example.com', '555-0106', 'phone', 'new',       'manual', 'Lighting Installation',        '', datetime('now','-20 days'), datetime('now','-20 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000001', 'Sam',     'Ortiz',   'sam.ortiz@example.com',     '555-0107', 'email', 'qualified', 'manual', 'Ceiling Fan Installation',     '', datetime('now','-18 days'), datetime('now','-18 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000108', '00000000-0000-4000-8000-000000000001', 'Drew',    'Chen',    'drew.chen@example.com',     '555-0108', 'phone', 'new',       'manual', 'Breaker Panel Repair',         '', datetime('now','-15 days'), datetime('now','-15 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000001', 'Jamie',   'Scott',   'jamie.scott@example.com',   '555-0109', 'email', 'new',       'manual', 'Outlet & Switch Installation', '', datetime('now','-10 days'), datetime('now','-10 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000001', 'Cameron', 'Diaz',    'cameron.diaz@example.com',  '555-0110', 'phone', 'contacted', 'manual', 'Electrical Safety Inspection', '', datetime('now','-8 days'),  datetime('now','-8 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000001', 'Reese',   'Walker',  'reese.walker@example.com',  '555-0111', 'email', 'new',       'manual', 'Generator Installation',       '', datetime('now','-5 days'),  datetime('now','-5 days'),  '00000000-0000-4000-8000-000000000002');

-- ── Demo proposals ───────────────────────────────────────────
-- Viewable read-only at /proposal/:estimateId (apps/tenant-site
-- src/index.ts + proposal.ts). Line-item pricing is illustrative only —
-- it is not a real quote and doesn't reference any real vendor's pricing.
--
-- MONEY: every amount below is INTEGER CENTS, the canonical unit — see the
-- MONEY note in libs/shared/models/src/wire.ts. This file used to write
-- dollars (2652.13), while apps/platform read the same columns as cents, which
-- is why the live demo tenant showed $26.52 for a $2,652 job. `tax_rate` is a
-- PERCENTAGE (8.25 = 8.25%), which is how apps/api and apps/platform have
-- always computed with it; this file used to write the fraction 0.0825, so the
-- public proposal page printed "Tax (0.0825%)".
-- migrations/023-money-to-cents.sql converted the rows written before this.
INSERT OR IGNORE INTO opportunities
  (id, workspace_id, lead_id, title, status, value, service_type, created_at, updated_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', '200A Panel Upgrade',               'won',           265213, 'Panel Upgrade',           datetime('now','-38 days'), datetime('now','-30 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', 'Level 2 EV Charger Installation',  'proposal_sent', 119075, 'EV Charger Installation', datetime('now','-28 days'), datetime('now','-27 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000105', 'Whole-Home Rewiring — Phase 1',    'proposal_sent', 711203, 'Whole-Home Rewiring',     datetime('now','-23 days'), datetime('now','-21 days'), '00000000-0000-4000-8000-000000000002');

INSERT OR IGNORE INTO estimates
  (id, workspace_id, opportunity_id, estimate_number, title, status, line_items, subtotal, tax_rate, tax_amount, total, notes, valid_until, sent_at, accepted_at, created_at, updated_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'EST-1001', '200A Panel Upgrade', 'accepted',
   '[{"description":"200A panel replacement","quantity":1,"unitPrice":220000,"total":220000},{"description":"Permit & inspection fee","quantity":1,"unitPrice":25000,"total":25000}]',
   245000, 8.25, 20213, 265213, 'Includes disconnect/reconnect with the utility.', datetime('now','-8 days'), datetime('now','-37 days'), datetime('now','-30 days'), datetime('now','-38 days'), datetime('now','-30 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000202', 'EST-1002', 'Level 2 EV Charger Installation', 'sent',
   '[{"description":"Level 2 (240V) EV charger install","quantity":1,"unitPrice":95000,"total":95000},{"description":"Dedicated 50A circuit run","quantity":1,"unitPrice":15000,"total":15000}]',
   110000, 8.25, 9075, 119075, 'Charger hardware supplied by customer.', datetime('now','+9 days'), datetime('now','-27 days'), NULL, datetime('now','-28 days'), datetime('now','-27 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000203', 'EST-1003', 'Whole-Home Rewiring — Phase 1', 'sent',
   '[{"description":"Rewire first-floor circuits (knob-and-tube removal)","quantity":1,"unitPrice":520000,"total":520000},{"description":"New grounded outlets (12x)","quantity":12,"unitPrice":8500,"total":102000},{"description":"Permit & inspection fee","quantity":1,"unitPrice":35000,"total":35000}]',
   657000, 8.25, 54203, 711203, 'Phase 1 covers the first floor; phase 2 (upstairs) to be quoted separately.', datetime('now','+16 days'), datetime('now','-21 days'), NULL, datetime('now','-23 days'), datetime('now','-21 days'), '00000000-0000-4000-8000-000000000002');
