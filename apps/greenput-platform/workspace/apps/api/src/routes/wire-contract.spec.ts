// ─────────────────────────────────────────────────────────────
// Every list and detail endpoint, driven for real, checked against the
// contract in libs/shared/models.
//
// Not a mock in sight: the routers run against a real SQLite database built
// from the real schema.sql, so the SQL is parsed, the constraints are enforced,
// and the bytes asserted on here are the bytes the Worker would send. Most
// route specs in this directory build `DB.prepare` out of `vi.fn()`, which
// never parses what it is handed and cannot tell you what a response looks
// like — that is how an endpoint that had never once returned the shape its
// only reader parses shipped with eleven passing tests.
//
// Two layers of assertion:
//
//   1. `checkWire` — the whole response body must be exactly the declared
//      model: every required field present and correctly typed, every money
//      amount whole cents, every closed value inside its set, and NO extra
//      keys (so a narrowed SELECT, a stray JOIN alias, or a leaked column
//      fails here).
//   2. Hand-written expected objects for the three entities the outage was
//      reported against, written out in full from the seeded row. These are
//      the independent check: they are not produced by `toWire`, so they
//      would still fail if `toWire` and `checkWire` agreed with each other
//      and both were wrong.
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  checkWire,
  checkWireList,
  describeWireProblems,
  WIRE_API_KEY,
  WIRE_BRANDING,
  WIRE_CAMPAIGN,
  WIRE_CUSTOMER,
  WIRE_ESTIMATE,
  WIRE_INSTALLED_PLUGIN,
  WIRE_INVENTORY_ITEM,
  WIRE_JOB,
  WIRE_LEAD,
  WIRE_NOTIFICATION_PREFERENCE,
  WIRE_OPPORTUNITY,
  WIRE_PLUGIN,
  WIRE_REVIEW,
  WIRE_REVIEW_REQUEST,
  WIRE_SCHEDULE_BLOCK,
  WIRE_SUBSCRIPTION,
  WIRE_VEHICLE,
  WIRE_WEBHOOK,
  WIRE_WORKSPACE,
  WIRE_WORKSPACE_AVAILABILITY,
  WIRE_WORKSPACE_USER,
  type Customer,
  type Job,
  type Lead,
  type ScheduleBlock,
  type Subscription,
  type WireEntity,
} from '@greenput/shared/models';
import type { Env } from '../env';
import { apiKeysRouter } from './api-keys';
import { availabilityRouter } from './availability';
import { billingRouter } from './billing';
import { brandingRouter } from './branding';
import { campaignsRouter } from './campaigns';
import { customersRouter } from './customers';
import { estimatesRouter } from './estimates';
import { inventoryRouter } from './inventory';
import { jobsRouter } from './jobs';
import { leadsRouter } from './leads';
import { notificationPreferencesRouter } from './notification-preferences';
import { opportunitiesRouter } from './opportunities';
import { pluginsRouter } from './plugins';
import { reviewsRouter } from './reviews';
import { vehiclesRouter } from './vehicles';
import { webhooksRouter } from './webhooks';
import { workspaceRouter } from './workspace';

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000a1';
const USER = '00000000-0000-4000-8000-0000000000a2';
const OPP_UUID = '00000000-0000-4000-8000-0000000000a3';

/** Known values, so the expected objects below can be written out by hand. */
const SEED = `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, license_num, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'demo', 'electrical', '5125550142', 'hello@rivertown.example',
        '100 Example Way', 'Rivertown', 'TX', '78701', 'TECL-9001', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at, last_seen_at)
VALUES ('${USER}', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL);

INSERT INTO subscriptions (id, workspace_id, stripe_subscription_id, stripe_customer_id,
                           plan, status, current_period_start, current_period_end,
                           cancel_at_period_end, created_at, updated_at)
VALUES ('sub-1', '${WS}', 'sub_stripe_1', 'cus_stripe_1',
        'pro', 'active', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
        0, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');

INSERT INTO campaigns (id, workspace_id, name, status, channel, target_area, budget, spent, leads_generated, start_date, end_date, notes, created_at, updated_at, created_by)
VALUES ('camp-1', '${WS}', 'Spring postcards', 'active', 'postcard', '78701', 150000, 68000, 12,
        '2026-03-01T00:00:00.000Z', NULL, '', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '${USER}');

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact,
                   street, city, state, zip, status, source, campaign_id, service_type,
                   estimated_value, notes, qualified_at, created_at, updated_at, created_by)
VALUES ('lead-1', '${WS}', 'Alex', 'Rivera', 'alex.rivera@example.com', '5125550101', 'email',
        '1 Oak St', 'Rivertown', 'TX', '78701', 'qualified', 'campaign', 'camp-1', 'Panel Upgrade',
        265213, 'call back', '2026-04-02T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z', '${USER}');

INSERT INTO customers (id, workspace_id, first_name, last_name, company, email, phone, preferred_contact,
                       street, city, state, zip, notes, consent_given_at, consent_method,
                       total_job_value, job_count, created_at, updated_at, created_by)
VALUES ('cust-1', '${WS}', 'Jane', 'Doe', 'Doe Enterprises', 'jane@example.com', '5125550143', 'phone',
        '2 Elm St', 'Rivertown', 'TX', '78702', 'gate code 1234', '2026-04-03T00:00:00.000Z', 'form',
        850000, 2, '2026-04-03T00:00:00.000Z', '2026-04-04T00:00:00.000Z', '${USER}');

INSERT INTO opportunities (id, workspace_id, lead_id, customer_id, title, status, value, service_type,
                           notes, created_at, updated_at, created_by)
VALUES ('opp-1', '${WS}', 'lead-1', 'cust-1', '200A Panel Upgrade', 'won', 265213, 'Panel Upgrade',
        '', '2026-04-05T00:00:00.000Z', '2026-04-06T00:00:00.000Z', '${USER}');

INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                  street, city, state, zip, scheduled_start, scheduled_end, total, notes,
                  created_at, updated_at, created_by, assigned_to)
VALUES ('job-1', '${WS}', 'opp-1', 'cust-1', '#1001', 'Panel upgrade', 'scheduled',
        '2 Elm St', 'Rivertown', 'TX', '78702',
        '2026-04-10T14:00:00.000Z', '2026-04-10T16:00:00.000Z', 265213, 'bring the 200A panel',
        '2026-04-07T00:00:00.000Z', '2026-04-07T00:00:00.000Z', '${USER}', '${USER}');

INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
VALUES ('li-1', 'job-1', '200A panel replacement', 1, 220000, 220000);

-- A second opportunity whose id is a real UUID, because CreateEstimateSchema
-- requires one and the FK requires the row.
INSERT INTO opportunities (id, workspace_id, lead_id, title, status, value, service_type,
                           notes, created_at, updated_at, created_by)
VALUES ('${OPP_UUID}', '${WS}', 'lead-1', 'Whole-home rewire', 'open', 711203, 'Rewiring',
        '', '2026-04-06T00:00:00.000Z', '2026-04-06T00:00:00.000Z', '${USER}');

INSERT INTO estimates (id, workspace_id, opportunity_id, customer_id, estimate_number, title, status,
                       line_items, subtotal, tax_rate, tax_amount, total, notes, created_at, updated_at, created_by)
VALUES ('est-1', '${WS}', 'opp-1', 'cust-1', 'EST-1001', '200A Panel Upgrade', 'accepted',
        '[{"description":"200A panel replacement","quantity":1,"unitPrice":220000,"total":220000}]',
        245000, 8.25, 20213, 265213, '', '2026-04-05T00:00:00.000Z', '2026-04-05T00:00:00.000Z', '${USER}');

INSERT INTO inventory_items (id, workspace_id, name, sku, description, category, quantity, min_quantity,
                             unit_cost, unit_price, supplier, location, created_at, updated_at)
VALUES ('item-1', '${WS}', '12/2 Romex', 'ROMEX-12-2', '', 'wire', 4, 10, 12900, 19900,
        'Supply Co', 'Van 1', '2026-04-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z');

INSERT INTO inventory_transactions (id, workspace_id, item_id, job_id, type, quantity, notes, created_at, created_by)
VALUES ('tx-1', '${WS}', 'item-1', 'job-1', 'usage', -2, '', '2026-04-08T00:00:00.000Z', '${USER}');

INSERT INTO vehicles (id, workspace_id, name, make, model, year, license_plate, vin, assigned_to,
                      status, mileage, notes, created_at, updated_at)
VALUES ('veh-1', '${WS}', 'Van 1', 'Ford', 'Transit', 2022, 'TX-1234', NULL, '${USER}',
        'active', 42000, '', '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z');

INSERT INTO reviews (id, workspace_id, customer_id, job_id, platform, rating, content, author_name,
                     review_url, responded, response_text, created_at)
VALUES ('rev-1', '${WS}', 'cust-1', 'job-1', 'google', 5, 'Great work', 'Jane D.',
        NULL, 1, 'Thank you!', '2026-04-12T00:00:00.000Z');

INSERT INTO review_requests (id, workspace_id, customer_id, job_id, channel, status, sent_at, created_at)
VALUES ('rr-1', '${WS}', 'cust-1', 'job-1', 'email', 'sent', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z');

INSERT INTO plugins (id, name, slug, description, version, author, icon_url, category, events, config_schema, active, created_at)
VALUES ('plug-1', 'QuickBooks', 'quickbooks', 'Sync invoices', '1.2.0', 'Greenput', NULL,
        'accounting', '["job.paid"]', '{"type":"object"}', 1, '2026-02-01T00:00:00.000Z');

INSERT INTO plugin_installations (id, workspace_id, plugin_id, config, enabled, installed_at, installed_by)
VALUES ('inst-1', '${WS}', 'plug-1', '{"apiKey":"redacted"}', 1, '2026-04-01T00:00:00.000Z', '${USER}');

INSERT INTO webhooks (id, workspace_id, url, events, secret, active, created_at, updated_at, created_by)
VALUES ('hook-1', '${WS}', 'https://example.com/hook', '["lead.created"]', 'whsec_test', 1,
        '2026-04-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z', '${USER}');

INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status_code, attempts, delivered_at, created_at)
VALUES ('del-1', 'hook-1', 'lead.created', '{}', 200, 1, '2026-04-02T00:00:00.000Z', '2026-04-02T00:00:00.000Z');

INSERT INTO api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, last_used_at, expires_at, created_at, created_by)
VALUES ('key-1', '${WS}', 'CI key', 'abcdefgh', 'hash', '["read","leads"]', NULL, NULL,
        '2026-04-01T00:00:00.000Z', '${USER}');

INSERT INTO branding (id, workspace_id, logo_url, favicon_url, primary_color, secondary_color,
                      accent_color, font_family, custom_domain, email_footer, updated_at)
VALUES ('br-1', '${WS}', NULL, NULL, '#10b981', '#1f2937', '#3b82f6', 'system-ui', NULL, '',
        '2026-04-01T00:00:00.000Z');

INSERT INTO notification_preferences (id, user_id, event_type, channel, enabled)
VALUES ('np-1', '${USER}', 'new_lead', 'email', 1);

UPDATE workspaces SET timezone = 'America/Chicago' WHERE id = '${WS}';
INSERT INTO workspace_availability (id, workspace_id, weekday, opens_at, closes_at, is_open)
VALUES ('avail-1', '${WS}', 1, '08:00', '17:00', 1);
INSERT INTO workspace_availability_exceptions (id, workspace_id, date, opens_at, closes_at, is_open, reason)
VALUES ('exc-1', '${WS}', '2026-12-25', NULL, NULL, 0, 'Christmas Day');
`;

type Router = { fetch: (req: Request, env: Env) => Promise<Response> };

describe('the wire contract, over the real schema', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [SEED],
    });
    env = { DB: sqlite.db } as unknown as Env;
  });

  afterEach(() => sqlite.close());

  async function get(
    router: Router,
    path: string,
  ): Promise<{ status: number; body: { data: unknown; meta?: unknown } }> {
    const req = new Request(`https://api.greenput.com${path}`);
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const res = await router.fetch(req, env);
    return {
      status: res.status,
      body: (await res.json()) as { data: unknown; meta?: unknown },
    };
  }

  function expectClean(entity: WireEntity, value: unknown): void {
    expect(describeWireProblems(checkWire(entity, value))).toBe('');
  }

  function expectCleanList(entity: WireEntity, value: unknown): void {
    expect(describeWireProblems(checkWireList(entity, value))).toBe('');
    expect(Array.isArray(value) && value.length).toBeGreaterThan(0);
  }

  // ── Layer 2: the full body, written by hand ────────────────

  it('GET /api/leads returns exactly the declared Lead', async () => {
    const { status, body } = await get(leadsRouter, '/api/leads');
    expect(status).toBe(200);
    expect(body.data).toEqual([
      {
        id: 'lead-1',
        firstName: 'Alex',
        lastName: 'Rivera',
        contact: {
          email: 'alex.rivera@example.com',
          phone: '5125550101',
          preferredContact: 'email',
        },
        address: {
          street: '1 Oak St',
          city: 'Rivertown',
          state: 'TX',
          zip: '78701',
        },
        status: 'qualified',
        source: 'campaign',
        campaignId: 'camp-1',
        notes: 'call back',
        estimatedValue: 265213,
        serviceType: 'Panel Upgrade',
        qualifiedAt: '2026-04-02T00:00:00.000Z',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
        createdBy: USER,
      } satisfies Lead,
    ]);
    expect(body.meta).toEqual({ total: 1, page: 1, perPage: 25 });
  });

  it('GET /api/customers returns a nested contact — the read that threw in production', async () => {
    const { body } = await get(customersRouter, '/api/customers');
    expect(body.data).toEqual([
      {
        id: 'cust-1',
        firstName: 'Jane',
        lastName: 'Doe',
        company: 'Doe Enterprises',
        contact: {
          email: 'jane@example.com',
          phone: '5125550143',
          preferredContact: 'phone',
        },
        address: {
          street: '2 Elm St',
          city: 'Rivertown',
          state: 'TX',
          zip: '78702',
        },
        notes: 'gate code 1234',
        consentGivenAt: '2026-04-03T00:00:00.000Z',
        consentMethod: 'form',
        totalJobValue: 850000,
        jobCount: 2,
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
        createdBy: USER,
      } satisfies Customer,
    ]);
  });

  it('GET /api/jobs returns scheduledStart/scheduledEnd and cents', async () => {
    const { body } = await get(jobsRouter, '/api/jobs');
    expect(body.data).toEqual([
      {
        id: 'job-1',
        opportunityId: 'opp-1',
        customerId: 'cust-1',
        jobNumber: '#1001',
        title: 'Panel upgrade',
        status: 'scheduled',
        address: {
          street: '2 Elm St',
          city: 'Rivertown',
          state: 'TX',
          zip: '78702',
        },
        scheduledStart: '2026-04-10T14:00:00.000Z',
        scheduledEnd: '2026-04-10T16:00:00.000Z',
        lineItems: [
          {
            id: 'li-1',
            description: '200A panel replacement',
            quantity: 1,
            unitPrice: 220000,
            total: 220000,
          },
        ],
        total: 265213,
        notes: 'bring the 200A panel',
        assignedTo: USER,
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:00:00.000Z',
        createdBy: USER,
      } satisfies Job,
    ]);
  });

  it('a job date parses — "Invalid Date" was every Scheduled cell', async () => {
    const { body } = await get(jobsRouter, '/api/jobs');
    const job = (body.data as Job[])[0] as Job;
    expect(Number.isNaN(new Date(job.scheduledStart).getTime())).toBe(false);
  });

  // ── Layer 1: every endpoint, against the contract ─────────

  it('GET /api/leads/:id', async () => {
    const { body } = await get(leadsRouter, '/api/leads/lead-1');
    expectClean(WIRE_LEAD, body.data);
  });

  it('GET /api/customers/:id (with its job history)', async () => {
    const { body } = await get(customersRouter, '/api/customers/cust-1');
    expectClean(WIRE_CUSTOMER, body.data);
    const jobs = (body.data as Customer).jobs ?? [];
    expect(jobs).toHaveLength(1);
    // A nested Job is a whole Job: `lineItems` is declared, so it has to be
    // there. `checkWire` treats a child as optional (a route may or may not
    // attach it), which is exactly the gap an assertion has to cover.
    expect(jobs[0]?.lineItems).toEqual([
      {
        id: 'li-1',
        description: '200A panel replacement',
        quantity: 1,
        unitPrice: 220000,
        total: 220000,
      },
    ]);
  });

  it('GET /api/jobs list + detail', async () => {
    expectCleanList(WIRE_JOB, (await get(jobsRouter, '/api/jobs')).body.data);
    expectClean(WIRE_JOB, (await get(jobsRouter, '/api/jobs/job-1')).body.data);
  });

  it('GET /api/jobs/schedule returns ScheduleBlocks the calendar can place', async () => {
    const { body } = await get(
      jobsRouter,
      '/api/jobs/schedule?start=2026-04-01&end=2026-04-30',
    );
    expectCleanList(WIRE_SCHEDULE_BLOCK, body.data);
    expect(body.data).toEqual([
      {
        id: 'job-1',
        title: 'Panel upgrade',
        jobNumber: '#1001',
        status: 'scheduled',
        start: '2026-04-10T14:00:00.000Z',
        end: '2026-04-10T16:00:00.000Z',
        customerId: 'cust-1',
        customerName: 'Jane Doe',
        location: '2 Elm St, Rivertown',
        assignedTo: USER,
        assigneeName: 'Dana Ortiz',
      } satisfies ScheduleBlock,
    ]);
  });

  /* GP-006. The schedule used to answer only scheduled / in_progress, so
     the moment GP-007 let a job be finished it fell off the calendar — a
     contractor looking back at last week saw an empty grid. */
  it('GET /api/jobs/schedule keeps a completed job inside the window', async () => {
    await env.DB.prepare(
      `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                         street, city, state, zip, scheduled_start, scheduled_end, total, notes,
                         created_at, updated_at, created_by)
       VALUES ('job-2', ?, 'opp-1', 'cust-1', '#1002', 'Outlet repair', 'completed',
               '2 Elm St', 'Rivertown', 'TX', '78702',
               '2026-04-12T14:00:00.000Z', '2026-04-12T15:00:00.000Z', 15000, '',
               '2026-04-07T00:00:00.000Z', '2026-04-07T00:00:00.000Z', ?)`,
    )
      .bind(WS, USER)
      .run();
    const { body } = await get(
      jobsRouter,
      '/api/jobs/schedule?start=2026-04-12&end=2026-04-18',
    );
    expectCleanList(WIRE_SCHEDULE_BLOCK, body.data);
    const blocks = body.data as ScheduleBlock[];
    expect(blocks.map((b) => [b.id, b.status])).toEqual([
      ['job-2', 'completed'],
    ]);
  });

  it('GET /api/opportunities list + detail', async () => {
    expectCleanList(
      WIRE_OPPORTUNITY,
      (await get(opportunitiesRouter, '/api/opportunities')).body.data,
    );
    expectClean(
      WIRE_OPPORTUNITY,
      (await get(opportunitiesRouter, '/api/opportunities/opp-1')).body.data,
    );
  });

  it('GET /api/campaigns list + detail', async () => {
    expectCleanList(
      WIRE_CAMPAIGN,
      (await get(campaignsRouter, '/api/campaigns')).body.data,
    );
    expectClean(
      WIRE_CAMPAIGN,
      (await get(campaignsRouter, '/api/campaigns/camp-1')).body.data,
    );
  });

  it('GET /api/estimates list + detail', async () => {
    expectCleanList(
      WIRE_ESTIMATE,
      (await get(estimatesRouter, '/api/estimates')).body.data,
    );
    expectClean(
      WIRE_ESTIMATE,
      (await get(estimatesRouter, '/api/estimates/est-1')).body.data,
    );
  });

  it('GET /api/inventory list, low-stock and detail', async () => {
    expectCleanList(
      WIRE_INVENTORY_ITEM,
      (await get(inventoryRouter, '/api/inventory')).body.data,
    );
    expectCleanList(
      WIRE_INVENTORY_ITEM,
      (await get(inventoryRouter, '/api/inventory/low-stock')).body.data,
    );
    const detail = (await get(inventoryRouter, '/api/inventory/item-1')).body
      .data;
    expectClean(WIRE_INVENTORY_ITEM, detail);
    expect((detail as InventoryDetail).transactions).toHaveLength(1);
  });

  it('GET /api/vehicles list + detail', async () => {
    expectCleanList(
      WIRE_VEHICLE,
      (await get(vehiclesRouter, '/api/vehicles')).body.data,
    );
    expectClean(
      WIRE_VEHICLE,
      (await get(vehiclesRouter, '/api/vehicles/veh-1')).body.data,
    );
  });

  it('GET /api/reviews list, detail and requests', async () => {
    expectCleanList(
      WIRE_REVIEW,
      (await get(reviewsRouter, '/api/reviews')).body.data,
    );
    expectClean(
      WIRE_REVIEW,
      (await get(reviewsRouter, '/api/reviews/rev-1')).body.data,
    );
    expectCleanList(
      WIRE_REVIEW_REQUEST,
      (await get(reviewsRouter, '/api/reviews/requests')).body.data,
    );
  });

  it('GET /api/plugins catalogue + installed', async () => {
    expectCleanList(
      WIRE_PLUGIN,
      (await get(pluginsRouter, '/api/plugins')).body.data,
    );
    expectCleanList(
      WIRE_INSTALLED_PLUGIN,
      (await get(pluginsRouter, '/api/plugins/installed')).body.data,
    );
  });

  it('GET /api/webhooks list + detail', async () => {
    const list = (await get(webhooksRouter, '/api/webhooks')).body.data;
    expectCleanList(WIRE_WEBHOOK, list);
    // A signing secret must not ride along in a list.
    expect('secret' in ((list as object[])[0] as object)).toBe(false);

    const detail = (await get(webhooksRouter, '/api/webhooks/hook-1')).body
      .data;
    expectClean(WIRE_WEBHOOK, detail);
    expect((detail as { secret?: string }).secret).toBe('whsec_test');
    expect((detail as { deliveries?: unknown[] }).deliveries).toHaveLength(1);
  });

  it('GET /api/api-keys', async () => {
    const list = (await get(apiKeysRouter, '/api/api-keys')).body.data;
    expectCleanList(WIRE_API_KEY, list);
    // Parsed, not the raw JSON string the platform was rendering verbatim.
    expect((list as { scopes: unknown }[])[0]?.scopes).toEqual([
      'read',
      'leads',
    ]);
  });

  it('GET /api/branding', async () => {
    expectClean(
      WIRE_BRANDING,
      (await get(brandingRouter, '/api/branding')).body.data,
    );
  });

  it('GET /api/notifications/preferences', async () => {
    expectCleanList(
      WIRE_NOTIFICATION_PREFERENCE,
      (
        await get(
          notificationPreferencesRouter,
          '/api/notifications/preferences',
        )
      ).body.data,
    );
  });

  it('GET /api/workspace + users', async () => {
    const workspace = (await get(workspaceRouter, '/api/workspace')).body.data;
    expectClean(WIRE_WORKSPACE, workspace);
    expect((workspace as { licenseNumber?: string }).licenseNumber).toBe(
      'TECL-9001',
    );
    expectCleanList(
      WIRE_WORKSPACE_USER,
      (await get(workspaceRouter, '/api/workspace/users')).body.data,
    );
  });

  it('GET /api/billing/subscription — camelCase, and the Stripe ids stay home', async () => {
    const { status, body } = await get(
      billingRouter,
      '/api/billing/subscription',
    );
    expect(status).toBe(200);
    expectClean(WIRE_SUBSCRIPTION, body.data);
    expect(body.data).toEqual({
      id: 'sub-1',
      plan: 'pro',
      status: 'active',
      currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } satisfies Subscription);
    expect(JSON.stringify(body)).not.toContain('cus_stripe_1');
    expect(JSON.stringify(body)).not.toContain('sub_stripe_1');
  });

  it('GET /api/availability — the week and exceptions ride as children', async () => {
    const { status, body } = await get(availabilityRouter, '/api/availability');
    expect(status).toBe(200);
    expectClean(WIRE_WORKSPACE_AVAILABILITY, body.data);
    expect(body.data).toEqual({
      timezone: 'America/Chicago',
      bookingLeadHours: 24,
      bookingHorizonDays: 30,
      travelBufferMinutes: 30,
      concurrentJobs: 1,
      bookable: true,
      week: [
        {
          id: 'avail-1',
          weekday: 1,
          isOpen: true,
          opensAt: '08:00',
          closesAt: '17:00',
        },
      ],
      exceptions: [
        {
          id: 'exc-1',
          date: '2026-12-25',
          isOpen: false,
          reason: 'Christmas Day',
        },
      ],
    });
  });

  // ── The mutation paths answer in the same shape ────────────

  it('POST /api/estimates derives whole-cent line totals and an id', async () => {
    const post = new Request('https://api.greenput.com/api/estimates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Rewire',
        opportunityId: OPP_UUID,
        taxRate: 8.25,
        lineItems: [
          // No `id` and no `total`: the validator strips both, so the API has
          // to derive them or the stored line item has neither — which is what
          // left apps/tenant-site's public proposal page printing no amount
          // per row.
          { description: 'Labor', quantity: 4.5, unitPrice: 17500 },
          { description: 'Materials', quantity: 1, unitPrice: 45000 },
        ],
      }),
    });
    const mutable = post as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const res = await estimatesRouter.fetch(post, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expectClean(WIRE_ESTIMATE, body.data);

    const items = body.data['lineItems'] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]?.['total']).toBe(78750); // 4.5 x 17500c, whole cents
    expect(items[0]?.['id']).toEqual(expect.any(String));
    expect(items[1]?.['total']).toBe(45000);
    // Totals are the API's own sum, in whole cents.
    expect(body.data['subtotal']).toBe(123750);
    expect(body.data['taxAmount']).toBe(10209); // round(123750 * 0.0825)
    expect(body.data['total']).toBe(133959);
  });

  it('POST and PATCH /api/leads answer in the declared shape', async () => {
    const post = new Request('https://api.greenput.com/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Casey',
        lastName: 'Nguyen',
        email: 'casey@example.com',
        phone: '5125550104',
        serviceType: 'EV Charger Installation',
        estimatedValue: 119075,
      }),
    });
    const mutable = post as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const created = await leadsRouter.fetch(post, env);
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { data: Lead };
    expectClean(WIRE_LEAD, createdBody.data);
    expect(createdBody.data.estimatedValue).toBe(119075);

    const patch = new Request(
      `https://api.greenput.com/api/leads/${createdBody.data.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contacted' }),
      },
    );
    const patchMutable = patch as unknown as Record<string, unknown>;
    patchMutable['workspaceId'] = WS;
    patchMutable['user'] = { id: USER, role: 'owner' };
    const patched = await leadsRouter.fetch(patch, env);
    const patchedBody = (await patched.json()) as { data: Lead };
    expectClean(WIRE_LEAD, patchedBody.data);
    expect(patchedBody.data.status).toBe('contacted');
  });
});

interface InventoryDetail {
  transactions?: unknown[];
}

// ── The demo seed, which is executed against PRODUCTION on every deploy ──
//
// .github/workflows/ci.yml runs scripts/preview/seed.sql against `greenput`
// after every main deploy. A unit disagreement in that file is therefore a
// production data bug, and it was one: it wrote dollars into columns every
// reader but the invoice generator treated as cents, which is why the live
// demo tenant showed $26.52 for a $2,652 job.

describe('scripts/preview/seed.sql, through the endpoints', () => {
  const DEMO_WS = '00000000-0000-4000-8000-000000000001';
  const DEMO_USER = '00000000-0000-4000-8000-000000000002';
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db } as unknown as Env;
  });

  afterEach(() => sqlite.close());

  async function demoGet(
    router: Router,
    path: string,
  ): Promise<{ data: unknown }> {
    const req = new Request(`https://api.greenput.com${path}`);
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = DEMO_WS;
    mutable['user'] = { id: DEMO_USER, role: 'owner' };
    const res = await router.fetch(req, env);
    expect(res.status).toBe(200);
    return (await res.json()) as { data: unknown };
  }

  it('seeded leads, opportunities and estimates all satisfy the contract', async () => {
    const leads = (await demoGet(leadsRouter, '/api/leads?perPage=100')).data;
    expect(describeWireProblems(checkWireList(WIRE_LEAD, leads))).toBe('');
    const opps = (await demoGet(opportunitiesRouter, '/api/opportunities'))
      .data;
    expect(describeWireProblems(checkWireList(WIRE_OPPORTUNITY, opps))).toBe(
      '',
    );
    const estimates = (await demoGet(estimatesRouter, '/api/estimates')).data;
    expect(describeWireProblems(checkWireList(WIRE_ESTIMATE, estimates))).toBe(
      '',
    );
  });

  it('the $2,652.13 proposal is 265213 cents, not 2652.13', async () => {
    const opps = (await demoGet(opportunitiesRouter, '/api/opportunities'))
      .data as { title: string; value: number }[];
    const panel = opps.find((o) => o.title === '200A Panel Upgrade');
    expect(panel?.value).toBe(265213);

    const estimates = (await demoGet(estimatesRouter, '/api/estimates'))
      .data as {
      estimateNumber: string;
      subtotal: number;
      taxRate: number;
      taxAmount: number;
      total: number;
      lineItems: { unitPrice: number; total: number }[];
    }[];
    const est = estimates.find((e) => e.estimateNumber === 'EST-1001');
    expect(est).toMatchObject({
      subtotal: 245000,
      // A percentage, not the fraction 0.0825 the seed used to write.
      taxRate: 8.25,
      taxAmount: 20213,
      total: 265213,
    });
    // The seed predates `type` (GP-038); the read path defaults it to labor.
    expect(est?.lineItems).toEqual([
      {
        type: 'labor',
        description: '200A panel replacement',
        quantity: 1,
        unitPrice: 220000,
        total: 220000,
      },
      {
        type: 'labor',
        description: 'Permit & inspection fee',
        quantity: 1,
        unitPrice: 25000,
        total: 25000,
      },
    ]);
    // subtotal + tax == total, in whole cents, with no float residue.
    expect((est?.subtotal ?? 0) + (est?.taxAmount ?? 0)).toBe(est?.total);
  });
});

// ── migrations/023-money-to-cents.sql ────────────────────────
//
// The rows that predate the cents decision were written in dollars. This
// applies the real migration file to a database seeded the way production was
// and asserts what the endpoints then answer — so the conversion is checked
// against the readers, not just against itself.

describe('migrations/023-money-to-cents.sql', () => {
  const LEGACY_WS = '00000000-0000-4000-8000-0000000000c1';
  const LEGACY_USER = '00000000-0000-4000-8000-0000000000c2';

  /** The live `greenput` shape before the migration: dollars, fractional. */
  const DOLLARS_SEED = `
INSERT INTO workspaces (id, name, created_at)
VALUES ('${LEGACY_WS}', 'Legacy', '2026-01-01T00:00:00.000Z');
INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${LEGACY_USER}', '${LEGACY_WS}', 'A', 'B', 'a@example.com', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO leads (id, workspace_id, first_name, last_name, service_type, estimated_value, created_by, created_at, updated_at)
VALUES ('lead-d', '${LEGACY_WS}', 'Amy', 'X', 'HVAC', 8500, '${LEGACY_USER}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
       ('lead-n', '${LEGACY_WS}', 'Nul', 'X', 'HVAC', NULL, '${LEGACY_USER}', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
INSERT INTO opportunities (id, workspace_id, lead_id, title, value, created_by, created_at, updated_at)
VALUES ('opp-d', '${LEGACY_WS}', 'lead-d', 'Panel', 2652.13, '${LEGACY_USER}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO customers (id, workspace_id, first_name, last_name, total_job_value, job_count, created_by, created_at, updated_at)
VALUES ('cust-d', '${LEGACY_WS}', 'Jane', 'Doe', 7200, 1, '${LEGACY_USER}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, scheduled_start, scheduled_end, total, created_by, created_at, updated_at)
VALUES ('job-d', '${LEGACY_WS}', 'opp-d', 'cust-d', '#1', 'A', '2026-01-01T09:00:00.000Z', '2026-01-01T11:00:00.000Z',
        2800, '${LEGACY_USER}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
VALUES ('li-d', 'job-d', 'x', 2, 5200, 10400);
INSERT INTO campaigns (id, workspace_id, name, channel, budget, spent, start_date, created_by, created_at, updated_at)
VALUES ('camp-d', '${LEGACY_WS}', 'Spring', 'email', 1500, 680, '2026-01-01T00:00:00.000Z', '${LEGACY_USER}',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO estimates (id, workspace_id, opportunity_id, estimate_number, title, line_items,
                       subtotal, tax_rate, tax_amount, total, created_by, created_at, updated_at)
VALUES ('est-d', '${LEGACY_WS}', 'opp-d', 'EST-D', 'Panel',
        '[{"description":"200A panel replacement","quantity":1,"unitPrice":2200,"total":2200},{"description":"Permit","quantity":1,"unitPrice":250,"total":250}]',
        2450, 0.0825, 202.13, 2652.13, '${LEGACY_USER}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`;

  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [DOLLARS_SEED],
    });
    env = { DB: sqlite.db } as unknown as Env;
  });

  afterEach(() => sqlite.close());

  /**
   * Apply 023 the way scripts/db/migrate.sh does: the ledger exists before any
   * migration runs (migrate.sh creates it first), and a successful apply is
   * recorded. 023's statements guard on that ledger, because 2652 is a valid
   * amount in either unit so nothing in the data itself can tell you whether
   * the conversion already happened — re-running it once multiplied every
   * figure by 100 again.
   */
  function migrate(record = true): void {
    sqlite.raw.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    sqlite.raw.exec(
      readFileSync(resolve(ROOT, 'migrations/023-money-to-cents.sql'), 'utf8'),
    );
    if (record) {
      sqlite.raw.exec(
        `INSERT OR IGNORE INTO schema_migrations (name)
         VALUES ('023-money-to-cents.sql')`,
      );
    }
  }

  async function legacyGet(
    router: Router,
    path: string,
  ): Promise<{ data: unknown }> {
    const req = new Request(`https://api.greenput.com${path}`);
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = LEGACY_WS;
    mutable['user'] = { id: LEGACY_USER, role: 'owner' };
    const res = await router.fetch(req, env);
    expect(res.status).toBe(200);
    return (await res.json()) as { data: unknown };
  }

  it('reproduces the reported symptom before it runs', async () => {
    // 2652.13 dollars in a column every reader now treats as cents: the
    // endpoint reports 2652, which apps/platform renders as $26.52 for a
    // $2,652.13 deal. That is the exact figure the live demo tenant showed.
    const opps = (await legacyGet(opportunitiesRouter, '/api/opportunities'))
      .data as { value: number }[];
    expect(opps[0]?.value).toBe(2652);
    expect(
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format((opps[0]?.value ?? 0) / 100),
    ).toBe('$26.52');
  });

  it('is idempotent — a second and third apply change nothing', () => {
    // The defect this pins: every scaling statement but tax_rate ran
    // unconditionally, so applying the file twice took 2652.13 -> 265213 ->
    // 26521300. The ledger is the only thing that can tell you the conversion
    // already happened, because the data cannot: 2652 is a valid amount in
    // either unit. tax_rate self-guards on its own value and is the proof the
    // author knew a guard was needed.
    migrate();
    const after1 = {
      job: sqlite.raw.prepare('SELECT total FROM jobs LIMIT 1').get(),
      lead: sqlite.raw
        .prepare('SELECT estimated_value FROM leads LIMIT 1')
        .get(),
      item: sqlite.raw
        .prepare('SELECT unit_price, total FROM job_line_items LIMIT 1')
        .get(),
      est: sqlite.raw
        .prepare(
          'SELECT subtotal, tax_amount, total, tax_rate FROM estimates LIMIT 1',
        )
        .get(),
    };

    migrate();
    migrate();

    expect(sqlite.raw.prepare('SELECT total FROM jobs LIMIT 1').get()).toEqual(
      after1.job,
    );
    expect(
      sqlite.raw.prepare('SELECT estimated_value FROM leads LIMIT 1').get(),
    ).toEqual(after1.lead);
    expect(
      sqlite.raw
        .prepare('SELECT unit_price, total FROM job_line_items LIMIT 1')
        .get(),
    ).toEqual(after1.item);
    expect(
      sqlite.raw
        .prepare(
          'SELECT subtotal, tax_amount, total, tax_rate FROM estimates LIMIT 1',
        )
        .get(),
    ).toEqual(after1.est);
  });

  it('converts every amount to whole cents', async () => {
    migrate();

    const opps = (await legacyGet(opportunitiesRouter, '/api/opportunities'))
      .data as { value: number }[];
    expect(describeWireProblems(checkWireList(WIRE_OPPORTUNITY, opps))).toBe(
      '',
    );
    expect(opps[0]?.value).toBe(265213);

    const leads = (await legacyGet(leadsRouter, '/api/leads')).data as Record<
      string,
      unknown
    >[];
    expect(describeWireProblems(checkWireList(WIRE_LEAD, leads))).toBe('');
    expect(leads.map((l) => l['estimatedValue'])).toEqual([undefined, 850000]);

    const jobs = (await legacyGet(jobsRouter, '/api/jobs')).data as {
      total: number;
      lineItems: { unitPrice: number; total: number }[];
    }[];
    expect(jobs[0]?.total).toBe(280000);
    expect(jobs[0]?.lineItems[0]).toMatchObject({
      unitPrice: 520000,
      total: 1040000,
    });

    const customers = (await legacyGet(customersRouter, '/api/customers'))
      .data as { totalJobValue: number }[];
    expect(customers[0]?.totalJobValue).toBe(720000);

    const campaigns = (await legacyGet(campaignsRouter, '/api/campaigns'))
      .data as { budget: number; spent: number }[];
    expect(campaigns[0]).toMatchObject({ budget: 150000, spent: 68000 });
  });

  it('converts the estimate, its JSON line items and its tax rate', async () => {
    migrate();
    const estimates = (await legacyGet(estimatesRouter, '/api/estimates'))
      .data as {
      subtotal: number;
      taxRate: number;
      taxAmount: number;
      total: number;
      lineItems: { description: string; unitPrice: number; total: number }[];
    }[];
    expect(describeWireProblems(checkWireList(WIRE_ESTIMATE, estimates))).toBe(
      '',
    );
    expect(estimates[0]).toMatchObject({
      subtotal: 245000,
      taxRate: 8.25,
      taxAmount: 20213,
      total: 265213,
    });
    // `type: 'labor'` is the read-side default for a row that predates the
    // field (GP-038); the migration does not write it.
    expect(estimates[0]?.lineItems).toEqual([
      {
        type: 'labor',
        description: '200A panel replacement',
        quantity: 1,
        unitPrice: 220000,
        total: 220000,
      },
      {
        type: 'labor',
        description: 'Permit',
        quantity: 1,
        unitPrice: 25000,
        total: 25000,
      },
    ]);
  });

  it('leaves a tax rate that is already a percentage alone', () => {
    sqlite.raw.exec("UPDATE estimates SET tax_rate = 8.25 WHERE id = 'est-d'");
    migrate();
    expect(
      sqlite.raw.prepare('SELECT tax_rate FROM estimates').get(),
    ).toMatchObject({ tax_rate: 8.25 });
  });

  it('produces the same numbers the new seed.sql writes directly', () => {
    migrate();
    const seeded = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    try {
      const fromSeed = seeded.raw
        .prepare(
          "SELECT subtotal, tax_rate, tax_amount, total, line_items FROM estimates WHERE estimate_number = 'EST-1001'",
        )
        .get() as Record<string, unknown>;
      const fromMigration = sqlite.raw
        .prepare(
          "SELECT subtotal, tax_rate, tax_amount, total, line_items FROM estimates WHERE id = 'est-d'",
        )
        .get() as Record<string, unknown>;
      expect(fromMigration['subtotal']).toBe(fromSeed['subtotal']);
      expect(fromMigration['tax_rate']).toBe(fromSeed['tax_rate']);
      expect(fromMigration['tax_amount']).toBe(fromSeed['tax_amount']);
      expect(fromMigration['total']).toBe(fromSeed['total']);
      expect(
        JSON.parse(String(fromMigration['line_items']))[0]['unitPrice'],
      ).toBe(JSON.parse(String(fromSeed['line_items']))[0]['unitPrice']);
    } finally {
      seeded.close();
    }
  });
});
