-- ─────────────────────────────────────────────────────────────
-- Seed data for the product screenshots on greenput.com/features.
--
-- Loaded into an in-memory SQLite database built from schema.sql (see
-- scripts/screenshots/capture.ts). It is never applied to a real database:
-- the harness's only `env.DB` is `createSqliteD1`'s, it holds no Cloudflare
-- credential, and nothing in it talks to D1.
--
-- The business is the same fictional one the rest of the repo demos with —
-- "Rivertown Electric" (scripts/preview/seed.sql) — and follows the same
-- rules for invented data:
--   * phone numbers come from the 555-0100..555-0199 block NANPA reserves
--     for fiction, on the 512 area code the demo tenant already uses;
--   * email domains are RFC 2606's `example.com` / `.example`, which can
--     never resolve to a real mailbox;
--   * streets are "Example"-named placeholders in a town that does not
--     exist, zip 00000 (never assigned);
--   * no license number, certification, review or testimonial is set —
--     those would imply real credentials.
-- No person, address, job or price here is real.
--
-- MONEY IS IN CENTS. Every monetary column is divided by 100 at the point of
-- display in apps/platform (`formatCurrency(x / 100)` in the leads, jobs,
-- customers, estimates, opportunities, inventory and reports routes) and
-- multiplied by 100 on write (`Math.round(f.value * 100)` in the
-- opportunities panel), so cents is the unit the SPA's own contract implies.
-- scripts/preview/seed.sql writes DOLLARS into the same columns, which is why
-- the live demo tenant reads "$26.52" for a $2,652 panel upgrade; this file
-- does not copy that. (apps/api/src/lib/pdf/invoice.ts disagrees in the other
-- direction, formatting the same column as dollars — flagged, not fixed here;
-- no screenshot in this commit renders that template.)
--
-- Dates are relative to the moment of capture, so the calendar always has a
-- week in it when this is re-run. Timestamps are UTC ISO-8601, but the
-- BUSINESS is in Texas: the harness runs Node and Chromium in
-- America/Chicago, and every job time below is written as a local wall-clock
-- time and converted — `date('now','localtime', ...)` is this week's Sunday in
-- Chicago (the same Sunday the SPA's startOfWeek() picks), and the trailing
-- 'utc' modifier turns "<that day> 08:00:00" into the UTC instant that IS
-- 8 AM in Chicago, DST included. So "08:00:00" here is the 8 AM slot on
-- screen, and nothing lands at 2 AM the way a UTC-literal seed did.
--
-- One modelling note, because the schema forces it: `jobs.opportunity_id` and
-- `opportunities.lead_id` are both NOT NULL, so repeat work for an existing
-- customer — which arrives by phone, not as a new inbound lead — has to hang
-- off the lead that first brought that customer in. Hence two customers below
-- carry more than one opportunity against a single converted lead.
-- ─────────────────────────────────────────────────────────────

-- ── Workspace + the signed-in user ───────────────────────────
-- Same ids, name and contact details as the demo tenant in
-- scripts/preview/seed.sql. password_hash '' is that file's NO_PASSWORD
-- sentinel (verifyPassword fails closed on it): the harness signs in by
-- writing a session into its own in-memory KV, never with a credential.
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip)
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

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'Demo',
  'User',
  'demo@greenput.com',
  'owner',
  '',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 days'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 days')
);

-- ── Leads: the kanban on /leads ──────────────────────────────
-- One card per lead, spread across every column the board renders — New,
-- Contacted, Qualified, Unqualified, Converted (STATUSES in
-- apps/platform/src/routes/leads/leads.ts) — and across every source, since
-- the board's card subtitle falls back to the source when there is no service
-- type. estimated_value is the figure on the card.
INSERT INTO leads
  (id, workspace_id, first_name, last_name, email, phone, preferred_contact, status, source, service_type, estimated_value, notes, created_at, updated_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001', 'Jamie',   'Scott',  'jamie.scott@example.com',   '5125550109', 'email', 'new',         'website',  'Outlet & Switch Installation', 48000,  '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 hours'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 hours'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000001', 'Reese',   'Walker', 'reese.walker@example.com',  '5125550111', 'phone', 'new',         'referral', 'Generator Installation',       870000, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000001', 'Drew',    'Chen',   'drew.chen@example.com',     '5125550108', 'text',  'new',         'google',   'Breaker Panel Repair',         65000,  '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000001', 'Logan',   'Ellis',  'logan.ellis@example.com',   '5125550113', 'email', 'new',         'nextdoor', 'Hot Tub Circuit',              115000, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000905', '00000000-0000-4000-8000-000000000001', 'Cameron', 'Diaz',   'cameron.diaz@example.com',  '5125550110', 'phone', 'contacted',   'nextdoor', 'Electrical Safety Inspection', 29000,  '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000906', '00000000-0000-4000-8000-000000000001', 'Taylor',  'Brooks', 'taylor.brooks@example.com', '5125550106', 'email', 'contacted',   'website',  'Lighting Installation',        142000, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000907', '00000000-0000-4000-8000-000000000001', 'Noor',    'Haddad', 'noor.haddad@example.com',    '5125550118', 'text',  'contacted',   'campaign', 'Whole-Home Surge Protection',  36000,  '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000908', '00000000-0000-4000-8000-000000000001', 'Casey',   'Nguyen', 'casey.nguyen@example.com',  '5125550104', 'phone', 'qualified',   'website',  'EV Charger Installation',      119000, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-8 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000909', '00000000-0000-4000-8000-000000000001', 'Sam',     'Ortiz',  'sam.ortiz@example.com',     '5125550107', 'email', 'qualified',   'referral', 'Ceiling Fan Installation',     62000,  '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-9 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000910', '00000000-0000-4000-8000-000000000001', 'Quinn',   'Harper', 'quinn.harper@example.com',  '5125550115', 'phone', 'unqualified', 'google',   'Commercial Fit-Out',           0,      '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-11 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000001', 'Alex',    'Rivera', 'alex.rivera@example.com',   '5125550101', 'email', 'converted',   'referral', 'Panel Upgrade',                265200, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-24 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-20 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000912', '00000000-0000-4000-8000-000000000001', 'Riley',   'Kim',    'riley.kim@example.com',     '5125550105', 'email', 'converted',   'website',  'Whole-Home Rewiring',          711200, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-26 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000001', 'Morgan',  'Patel',  'morgan.patel@example.com',  '5125550103', 'phone', 'converted',   'campaign', 'EV Charger Installation',      119000, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-34 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-28 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000914', '00000000-0000-4000-8000-000000000001', 'Jordan',  'Lee',    'jordan.lee@example.com',    '5125550102', 'text',  'converted',   'referral', 'Generator Installation',       141500, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-38 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-31 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000915', '00000000-0000-4000-8000-000000000001', 'Devon',   'Okafor', 'devon.okafor@example.com',  '5125550117', 'email', 'converted',   'nextdoor', 'Lighting Installation',        284500, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-44 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-35 days'), '00000000-0000-4000-8000-000000000002');

-- ── Customers: the directory on /customers ───────────────────
-- One per converted lead, plus the two the demo tenant picked up before this
-- seed's lead history starts. total_job_value/job_count are the "Lifetime"
-- column: at least the jobs below, plus earlier work.
INSERT INTO customers
  (id, workspace_id, first_name, last_name, company, email, phone, preferred_contact, street, city, state, zip, notes, total_job_value, job_count, created_at, updated_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000001', 'Alex',   'Rivera', NULL,                        'alex.rivera@example.com',  '5125550101', 'email', '214 Example Ave',   'Rivertown', 'TX', '00000', '', 447200, 3, strftime('%Y-%m-%dT%H:%M:%SZ','now','-95 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000001', 'Riley',  'Kim',    NULL,                        'riley.kim@example.com',    '5125550105', 'email', '38 Example Ridge',  'Rivertown', 'TX', '00000', '', 711200, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now','-61 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000001', 'Morgan', 'Patel',  'Patel Family Dental',       'morgan.patel@example.com', '5125550103', 'phone', '9 Example Plaza',   'Rivertown', 'TX', '00000', '', 253000, 3, strftime('%Y-%m-%dT%H:%M:%SZ','now','-48 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000804', '00000000-0000-4000-8000-000000000001', 'Jordan', 'Lee',    NULL,                        'jordan.lee@example.com',   '5125550102', 'text',  '1120 Example Loop', 'Rivertown', 'TX', '00000', '', 218500, 3, strftime('%Y-%m-%dT%H:%M:%SZ','now','-40 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000805', '00000000-0000-4000-8000-000000000001', 'Devon',  'Okafor', 'Rivertown Coffee Roasters', 'devon.okafor@example.com', '5125550117', 'email', '3 Example Market',  'Rivertown', 'TX', '00000', '', 526400, 3, strftime('%Y-%m-%dT%H:%M:%SZ','now','-36 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000806', '00000000-0000-4000-8000-000000000001', 'Priya',  'Raman',  NULL,                        'priya.raman@example.com',  '5125550119', 'phone', '77 Example Bend',   'Rivertown', 'TX', '00000', '', 96000,  1, strftime('%Y-%m-%dT%H:%M:%SZ','now','-21 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-9 days'),  '00000000-0000-4000-8000-000000000002');

-- ── Opportunities ────────────────────────────────────────────
-- Eight won deals that became the jobs below (converted_to_job_id set), two
-- won deals not yet on the calendar — those are the cards the calendar's
-- "Drag won deals" sidebar offers — and two still out for approval.
INSERT INTO opportunities
  (id, workspace_id, lead_id, customer_id, title, status, value, service_type, notes, proposal_sent_at, closed_at, converted_to_job_id, created_at, updated_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000801', '200A Panel Upgrade',              'won', 265200, 'Panel Upgrade',                '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-22 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-20 days'), '00000000-0000-4000-8000-000000000601', strftime('%Y-%m-%dT%H:%M:%SZ','now','-23 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-20 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000912', '00000000-0000-4000-8000-000000000802', 'Whole-Home Rewiring — Phase 1',   'won', 711200, 'Whole-Home Rewiring',          '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-28 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-26 days'), '00000000-0000-4000-8000-000000000602', strftime('%Y-%m-%dT%H:%M:%SZ','now','-29 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-26 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000803', 'Level 2 EV Charger Install',      'won', 119000, 'EV Charger Installation',      '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-28 days'), '00000000-0000-4000-8000-000000000603', strftime('%Y-%m-%dT%H:%M:%SZ','now','-31 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-28 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000915', '00000000-0000-4000-8000-000000000805', 'Shop Lighting Retrofit',          'won', 284500, 'Lighting Installation',        '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-38 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-35 days'), '00000000-0000-4000-8000-000000000604', strftime('%Y-%m-%dT%H:%M:%SZ','now','-39 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-35 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000705', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000914', '00000000-0000-4000-8000-000000000804', 'Outlet & Switch Replacement',     'won', 48000,  'Outlet & Switch Installation', '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-9 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'),  '00000000-0000-4000-8000-000000000605', strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000803', 'Ceiling Fan Installation',        'won', 38000,  'Ceiling Fan Installation',     '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-16 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-14 days'), '00000000-0000-4000-8000-000000000607', strftime('%Y-%m-%dT%H:%M:%SZ','now','-17 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-14 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000707', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000914', '00000000-0000-4000-8000-000000000804', 'Panel Label & Safety Audit',      'won', 29000,  'Electrical Safety Inspection', '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-18 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-16 days'), '00000000-0000-4000-8000-000000000608', strftime('%Y-%m-%dT%H:%M:%SZ','now','-19 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-16 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000708', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000914', '00000000-0000-4000-8000-000000000804', 'Generator Transfer Switch',       'won', 141500, 'Generator Installation',       '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-24 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-21 days'), '00000000-0000-4000-8000-000000000609', strftime('%Y-%m-%dT%H:%M:%SZ','now','-25 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-21 days'), '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000709', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000801', 'Detached Garage Subpanel',        'won', 182000, 'Panel Upgrade',                '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),  NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000710', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000912', '00000000-0000-4000-8000-000000000802', 'Phase 2 — Upstairs Rewiring',     'won', 534000, 'Whole-Home Rewiring',          '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),  NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000908', NULL,                                   'Level 2 EV Charger Install',      'proposal_sent', 119000, 'EV Charger Installation', '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),  NULL, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000909', NULL,                                   'Ceiling Fans & Dimmers (3 rooms)','proposal_sent', 62000,  'Ceiling Fan Installation','', strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),  NULL, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days'),  strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),  '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000713', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000803', 'Exam Room Dedicated Circuits',    'won', 96000,  'Outlet & Switch Installation', '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-12 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 days'), '00000000-0000-4000-8000-000000000606', strftime('%Y-%m-%dT%H:%M:%SZ','now','-13 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 days'), '00000000-0000-4000-8000-000000000002');

-- ── Jobs: the calendar and the list on /jobs ──────────────────
-- Six this week (Mon–Fri, two on Monday), three the week before carrying
-- the invoicing tail: completed → "Send invoice" → invoiced → "Mark paid" →
-- paid. All three of last week's are Jordan Lee's or Morgan Patel's, so
-- /customers/<Jordan Lee> shows a job history with an invoiced and a paid
-- row, and JOB-1037 (invoiced, three line items) is the invoice document.
--
-- `AT(day, time)` below is shorthand in this comment only; each cell is
--   strftime('%Y-%m-%dT%H:%M:%SZ', <local Sunday>||' HH:MM:SS', '+N days', 'utc')
-- i.e. local wall-clock on that weekday, stored as the UTC instant.
INSERT INTO jobs
  (id, workspace_id, opportunity_id, customer_id, job_number, title, status, street, city, state, zip, scheduled_start, scheduled_end, total, notes, invoiced_at, paid_at, created_at, updated_at, created_by)
VALUES
  -- This week: Mon 08:00–12:00
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000801', 'JOB-1041', '200A Panel Upgrade',            'scheduled',   '214 Example Ave',   'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 08:00:00', '+1 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 12:00:00', '+1 days', 'utc'), 265200, 'Utility disconnect booked for 08:30.', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-20 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-20 days'), '00000000-0000-4000-8000-000000000002'),
  -- Mon 13:00–17:00
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000802', 'JOB-1042', 'Whole-Home Rewiring — Phase 1', 'in_progress', '38 Example Ridge',  'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 13:00:00', '+1 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 17:00:00', '+1 days', 'utc'), 711200, 'Downstairs first; attic run on day 2.', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-26 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),  '00000000-0000-4000-8000-000000000002'),
  -- Tue 09:00–12:30
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000803', 'JOB-1043', 'Level 2 EV Charger Install',    'scheduled',   '9 Example Plaza',   'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 09:00:00', '+2 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 12:30:00', '+2 days', 'utc'), 119000, 'Charger supplied by customer.', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-28 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-28 days'), '00000000-0000-4000-8000-000000000002'),
  -- Wed 08:00–15:00
  ('00000000-0000-4000-8000-000000000604', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000805', 'JOB-1044', 'Shop Lighting Retrofit',        'scheduled',   '3 Example Market',  'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 08:00:00', '+3 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 15:00:00', '+3 days', 'utc'), 284500, 'Shop closed Wednesdays — full access.', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-35 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-35 days'), '00000000-0000-4000-8000-000000000002'),
  -- Thu 10:00–13:00
  ('00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000713', '00000000-0000-4000-8000-000000000803', 'JOB-1046', 'Exam Room Dedicated Circuits',  'scheduled',   '9 Example Plaza',   'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 10:00:00', '+4 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 13:00:00', '+4 days', 'utc'), 96000, 'Rooms 2 and 3; practice closes at 13:00 Thursdays.', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 days'), '00000000-0000-4000-8000-000000000002'),
  -- Fri 09:30–11:30
  ('00000000-0000-4000-8000-000000000605', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000705', '00000000-0000-4000-8000-000000000804', 'JOB-1045', 'Outlet & Switch Replacement',   'scheduled',   '1120 Example Loop', 'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 09:30:00', '+5 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 11:30:00', '+5 days', 'utc'), 48000, '', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'), '00000000-0000-4000-8000-000000000002'),
  -- Last week: Thu 13:00–15:00, completed, invoice not yet raised
  ('00000000-0000-4000-8000-000000000607', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000803', 'JOB-1038', 'Ceiling Fan Installation',      'completed',   '9 Example Plaza',   'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 13:00:00', '-3 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 15:00:00', '-3 days', 'utc'), 38000, '', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-14 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'), '00000000-0000-4000-8000-000000000002'),
  -- Last week: Tue 08:00–10:00, invoiced — the invoice document shot
  ('00000000-0000-4000-8000-000000000608', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000707', '00000000-0000-4000-8000-000000000804', 'JOB-1037', 'Panel Label & Safety Audit',    'invoiced',    '1120 Example Loop', 'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 08:00:00', '-5 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 10:00:00', '-5 days', 'utc'), 29000, 'Panel directory left in the door pocket.', strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'), NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-16 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'), '00000000-0000-4000-8000-000000000002'),
  -- Last week: Mon 09:00–14:00, paid
  ('00000000-0000-4000-8000-000000000609', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000708', '00000000-0000-4000-8000-000000000804', 'JOB-1036', 'Generator Transfer Switch',     'paid',        '1120 Example Loop', 'Rivertown', 'TX', '00000',
   strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 09:00:00', '-6 days', 'utc'), strftime('%Y-%m-%dT%H:%M:%SZ', date('now','localtime','-'||strftime('%w','now','localtime')||' days')||' 14:00:00', '-6 days', 'utc'), 141500, '', strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-21 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'), '00000000-0000-4000-8000-000000000002');

-- Line items sum to the job's `total` (cents). JOB-1037's three rows are the
-- body of the invoice document.
INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
VALUES
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000601', '200A panel replacement',            1, 220000, 220000),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000601', 'Permit & inspection fee',           1, 25000,  25000),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000608', 'Panel directory & circuit labelling', 1, 12000,  12000),
  ('00000000-0000-4000-8000-000000000506', '00000000-0000-4000-8000-000000000608', 'Electrical safety audit (2 hrs)',   2, 6500,   13000),
  ('00000000-0000-4000-8000-000000000507', '00000000-0000-4000-8000-000000000608', 'AFCI breaker, 20A',                 1, 4000,   4000),
  ('00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000609', 'Transfer switch (30A, 10-circuit)', 1, 98000,  98000),
  ('00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000609', 'Labour (5 hrs)',                    5, 8700,   43500);

-- ── Estimates: the proposal a homeowner opens ─────────────────
-- The `portal` shot is apps/tenant-site's /proposal/<id> for the EV charger
-- opportunity still out for approval (711). `status` must be 'sent' or
-- 'accepted' for that page to render it; line_items is the typed JSON
-- libs/shared/models readEstimateLineItem expects (cents; tax_rate is a
-- percentage, 8.25 = 8.25%).
INSERT INTO estimates
  (id, workspace_id, opportunity_id, customer_id, estimate_number, title, status, line_items, subtotal, tax_rate, tax_amount, total, notes, valid_until, sent_at, created_at, updated_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000711', NULL, 'EST-1019', 'Level 2 EV Charger Install', 'sent',
   '[{"id":"li-1","type":"material","description":"Level 2 EV charger, 48A hardwired","quantity":1,"unitPrice":65000,"total":65000},{"id":"li-2","type":"material","description":"60A breaker, 6 AWG copper run (40 ft) and conduit","quantity":1,"unitPrice":18000,"total":18000},{"id":"li-3","type":"labor","description":"Installation and load calculation","quantity":4,"unitPrice":9000,"total":36000}]',
   119000, 8.25, 9818, 128818,
   'Includes permit and final inspection. Charger mounts in the garage on the wall shared with the panel; a longer run is quoted separately.',
   date('now','+30 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'), '00000000-0000-4000-8000-000000000002');
