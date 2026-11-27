// ─────────────────────────────────────────────────────────────
// The platform's own renderers, fed the API's own bytes.
//
// This is the test whose absence let the outage ship. Every other test on
// either side of the seam used a hand-written fixture: the route specs in
// ../routes/*/ invent camelCase objects with a `contact: {}` the API had never
// returned, and the API's route specs assert on rows they handed to a
// `vi.fn()`. Each side was tested against its own assumptions, so both were
// green while /leads threw "Cannot read properties of undefined (reading
// 'email')" and every Scheduled cell on /jobs read "Invalid Date".
//
// Here there is no fixture at all. A real SQLite database is built from the
// real schema.sql, the real Worker routers answer real requests against it,
// and the JSON they produce is handed to the platform through the same
// `fetch` seam the browser uses. The assertions are on rendered DOM — the
// email a contractor can read, the date on the Scheduled cell, the money on
// the row. One definition of the response, exercised from both sides.
// ─────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { campaignsRouter } from '../../../api/src/routes/campaigns';
import { changeOrdersRouter } from '../../../api/src/routes/change-orders';
import { chatRouter } from '../../../api/src/routes/chat';
import { customersRouter } from '../../../api/src/routes/customers';
import { dashboardRouter } from '../../../api/src/routes/dashboard';
import { estimatesRouter } from '../../../api/src/routes/estimates';
import { jobsRouter } from '../../../api/src/routes/jobs';
import { leadsRouter } from '../../../api/src/routes/leads';
import { opportunitiesRouter } from '../../../api/src/routes/opportunities';
import { reportsRouter } from '../../../api/src/routes/reports';
import { reviewsRouter } from '../../../api/src/routes/reviews';
import { workspaceRouter } from '../../../api/src/routes/workspace';
import { slotStartsFor } from '@greenput/shared/scheduling';
import { renderCampaignsRoute } from '../routes/campaigns/campaigns.js';
import { renderChatListRoute } from '../routes/chat/chat-list.js';
import { renderCustomersRoute } from '../routes/customers/customers.js';
import { renderCustomerDetailRoute } from '../routes/customers/customer-detail.js';
import { renderEstimateDetailRoute } from '../routes/estimates/estimate-detail.js';
import { renderJobDetailRoute } from '../routes/jobs/job-detail.js';
import { renderLeadDetailRoute } from '../routes/leads/lead-detail.js';
import { renderOpportunityDetailRoute } from '../routes/opportunities/opportunity-detail.js';
import { renderDashboardRoute } from '../routes/dashboard/dashboard.js';
import { renderJobsRoute } from '../routes/jobs/jobs.js';
import { renderLeadsRoute } from '../routes/leads/leads.js';
import { renderOpportunitiesRoute } from '../routes/opportunities/opportunities.js';
import { renderReviewsRoute } from '../routes/reviews/reviews.js';
import { buildTestDeps, createFakeFetch, tick } from '../test/helpers.js';
import { toDateTimeLocal } from '../lib/datetime.js';

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000b1';
const USER = '00000000-0000-4000-8000-0000000000b2';

/** Today, so the dashboard run sheet has something on it. */
function at(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const JOB_START = at(9, 30);
const JOB_END = at(11, 30);

function seed(): string {
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'demo-contract', 'electrical', '5125550142',
        'hello@rivertown.example', '100 Example Way', 'Rivertown', 'TX', '78701', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${USER}', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact,
                   street, city, state, zip, status, source, service_type, estimated_value, notes,
                   qualified_at, created_at, updated_at, created_by)
VALUES ('lead-1', '${WS}', 'Alex', 'Rivera', 'alex.rivera@example.com', '5125550101', 'email',
        '1 Oak St', 'Rivertown', 'TX', '78701', 'qualified', 'website', 'Panel Upgrade',
        265213, '', '2026-04-02T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z', '${USER}');

INSERT INTO customers (id, workspace_id, first_name, last_name, company, email, phone, preferred_contact,
                       street, city, state, zip, notes, total_job_value, job_count,
                       created_at, updated_at, created_by)
VALUES ('cust-1', '${WS}', 'Jane', 'Doe', NULL, 'jane@example.com', '5125550143', 'phone',
        '2 Elm St', 'Rivertown', 'TX', '78702', '', 850000, 2,
        '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z', '${USER}');

INSERT INTO opportunities (id, workspace_id, lead_id, customer_id, title, status, value, service_type,
                           notes, created_at, updated_at, created_by)
VALUES ('opp-1', '${WS}', 'lead-1', 'cust-1', '200A Panel Upgrade', 'won', 265213, 'Panel Upgrade',
        '', '2026-04-05T00:00:00.000Z', '2026-04-05T00:00:00.000Z', '${USER}');

INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                  street, city, state, zip, scheduled_start, scheduled_end, total, notes,
                  created_at, updated_at, created_by)
VALUES ('job-1', '${WS}', 'opp-1', 'cust-1', '#1001', 'Panel upgrade', 'scheduled',
        '2 Elm St', 'Rivertown', 'TX', '78702', '${JOB_START}', '${JOB_END}', 265213, '',
        '2026-04-07T00:00:00.000Z', '2026-04-07T00:00:00.000Z', '${USER}');

INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
VALUES ('li-1', 'job-1', '200A panel replacement', 1, 220000, 220000);
`;
}

type Router = { fetch: (req: Request, env: unknown) => Promise<Response> };

describe('the platform reads what the API actually sends', () => {
  let sqlite: SqliteD1;
  let fake: ReturnType<typeof createFakeFetch>;
  let dispose: (() => void) | null = null;

  /**
   * `createFakeFetch` answers synchronously, and a router is async, so each
   * body is fetched up front and replayed. The bytes are still the router's.
   */
  async function bodyOf(router: Router, path: string): Promise<string> {
    const req = new Request(`https://api.greenput.com${path}`);
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const res = await router.fetch(req, { DB: sqlite.db });
    expect(res.status).toBe(200);
    return res.text();
  }

  async function stub(
    router: Router,
    path: string,
    matcher: string | RegExp = path,
  ): Promise<void> {
    const body = await bodyOf(router, path);
    fake.respond(
      matcher,
      () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
  }

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed()],
    });
    fake = createFakeFetch();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    sqlite.close();
  });

  it('/leads shows the lead’s email and value', async () => {
    await stub(leadsRouter, '/api/leads');
    const view = renderLeadsRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    const text = rows[0]?.textContent ?? '';
    expect(text).toContain('Alex Rivera');
    // The read that threw: `lead.contact.email`.
    expect(text).toContain('alex.rivera@example.com');
    // 265213 cents is $2,652.13, rendered without cents by the list formatter.
    expect(text).toMatch(/\$2,652/);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('/customers shows the customer’s email, phone and lifetime value', async () => {
    await stub(customersRouter, '/api/customers');
    const view = renderCustomersRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    const text = rows[0]?.textContent ?? '';
    expect(text).toContain('Jane Doe');
    expect(text).toContain('jane@example.com');
    expect(text).toMatch(/\$8,500/);
    expect(text).not.toContain('undefined');
  });

  it('/jobs list shows a real date in the Scheduled cell and the right total', async () => {
    await stub(jobsRouter, '/api/jobs', /\/api\/jobs(\?|$)/);
    await stub(
      opportunitiesRouter,
      '/api/opportunities?status=won',
      '/api/opportunities',
    );
    const view = renderJobsRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    const text = rows[0]?.textContent ?? '';
    expect(text).toContain('#1001');
    // "Invalid Date" was every Scheduled cell in production.
    expect(text).not.toContain('Invalid Date');
    const expected = new Date(JOB_START).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    expect(text).toContain(expected);
    expect(text).toMatch(/\$2,652/);
  });

  it('/jobs calendar places the job as an event', async () => {
    // The calendar reads its own week from /api/jobs/schedule now (GP-006);
    // the list page is a different request.
    const day = JOB_START.slice(0, 10);
    await stub(
      jobsRouter,
      `/api/jobs/schedule?start=${day}&end=${day}`,
      /\/api\/jobs\/schedule/,
    );
    await stub(jobsRouter, '/api/jobs', /\/api\/jobs(\?|$)/);
    await stub(
      opportunitiesRouter,
      '/api/opportunities?status=won',
      '/api/opportunities',
    );
    const view = renderJobsRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="jobs-view-calendar"]',
      ) as HTMLElement | null
    )?.click();
    await tick();
    await tick();

    const calendar = view.element.querySelector('[data-bn-jobs-calendar]');
    expect(calendar).not.toBeNull();
    // The calendar had no events at all: every job was filtered out by a
    // `new Date(undefined)` comparison.
    expect(calendar?.textContent).toContain('Panel upgrade');
  });

  it('/dashboard run sheet shows the job’s clock time, not --:--', async () => {
    await stub(dashboardRouter, '/api/dashboard/stats');
    await stub(jobsRouter, '/api/jobs?perPage=100', /\/api\/jobs(\?|$)/);
    const view = renderDashboardRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const items = view.element.querySelectorAll('[data-bn-run-item]');
    expect(items).toHaveLength(1);
    const time = items[0]?.querySelector('[data-bn-run-time]')?.textContent;
    expect(time).not.toContain('--:--');
    expect(time).toContain(
      new Date(JOB_START).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    );
    expect(items[0]?.textContent).toMatch(/\$2,652/);
  });

  it('/campaigns divides Cost/lead by the leads the API counted — the number /reports uses', async () => {
    // GP-034. The contractor typed 40 leads into the campaign; three lead rows
    // actually cite it; $300 spent. /campaigns used to divide by the typed
    // 40 while /reports divided by the counted 3, both under the label
    // "Leads". Now both counts are on the wire and both screens divide by 3.
    sqlite.raw.exec(`
INSERT INTO campaigns (id, workspace_id, name, status, channel, spent, leads_generated, start_date, created_at, updated_at, created_by)
VALUES ('camp-1', '${WS}', 'Spring postcards', 'active', 'postcard', 30000, 40, '2026-03-01',
        '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '${USER}');
INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, campaign_id, created_at, updated_at, created_by)
VALUES ('lead-c1', '${WS}', 'One', 'Cited', 'new', 'campaign', 'camp-1', '2026-03-02T00:00:00.000Z', '2026-03-02T00:00:00.000Z', '${USER}'),
       ('lead-c2', '${WS}', 'Two', 'Cited', 'contacted', 'campaign', 'camp-1', '2026-03-03T00:00:00.000Z', '2026-03-03T00:00:00.000Z', '${USER}'),
       ('lead-c3', '${WS}', 'Three', 'Cited', 'converted', 'campaign', 'camp-1', '2026-03-04T00:00:00.000Z', '2026-03-04T00:00:00.000Z', '${USER}');
`);
    await stub(campaignsRouter, '/api/campaigns');
    const view = renderCampaignsRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const header = view.element.querySelector('thead')?.textContent ?? '';
    expect(header).toContain('Leads (entered)');
    expect(header).toContain('Leads (tracked)');
    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    const cells = [...(rows[0]?.querySelectorAll('td') ?? [])].map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells).toContain('40');
    expect(cells).toContain('3');
    // 30000 cents / 3 = $100, not 30000 / 40 = $7.50.
    expect(rows[0]?.textContent).toMatch(/\$100\/lead/);

    // The same database through the report: same 3, same $100.
    const report = JSON.parse(
      await bodyOf(
        reportsRouter,
        '/api/reports/campaigns?from=2026-01-01&to=2026-12-31',
      ),
    ) as {
      data: {
        campaigns: Array<{
          id: string;
          leadCount: number;
          costPerLead: number;
        }>;
      };
    };
    expect(report.data.campaigns).toEqual([
      expect.objectContaining({
        id: 'camp-1',
        leadCount: 3,
        costPerLead: 10000,
      }),
    ]);
  });

  it('/opportunities shows the deal value', async () => {
    await stub(opportunitiesRouter, '/api/opportunities');
    const view = renderOpportunitiesRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    expect(view.element.textContent).toContain('200A Panel Upgrade');
    expect(view.element.textContent).toMatch(/\$2,652/);
    expect(view.element.textContent).not.toContain('NaN');
  });
});

// ─────────────────────────────────────────────────────────────
// The WRITE half of the same seam.
//
// #142 unified reads through the wire contract and left the write validators
// alone, so the two halves disagreed in the opposite direction: the create
// panels post the nested model shape (`contact: { email, phone }`) because
// their own client types say `create(payload: Partial<Lead>)`, and
// `CreateLeadSchema` was flat. A plain `z.object()` strips unknown keys, so
// `contact` was discarded in silence, every flat field fell to its
// `.default('')`, and the handler wrote an empty row and answered 201.
//
// Nothing here is hand-written. The panel is filled and submitted, the payload
// the CLIENT built is taken off the fake fetch, and that exact object is handed
// to the real router against the real database. Then the row is read back out
// of SQLite. A fixture written from either side's point of view could not catch
// this, which is the whole reason it shipped.
// ─────────────────────────────────────────────────────────────
describe('what the create panels post, the API stores', () => {
  let sqlite: SqliteD1;
  let fake: ReturnType<typeof createFakeFetch>;
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed()],
    });
    fake = createFakeFetch();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    sqlite.close();
  });

  /** The list body the route loads on mount, from the real router. */
  async function stub(router: Router, path: string): Promise<void> {
    const req = new Request(`https://api.greenput.com${path}`);
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const res = await router.fetch(req, { DB: sqlite.db });
    const body = await res.text();
    fake.respond(
      path,
      () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
  }

  /** Type into a panel input and fire the listener the route binds. */
  function type(root: ParentNode, testid: string, value: string): void {
    const input = root.querySelector(
      `[data-testid="${testid}"]`,
    ) as HTMLInputElement | null;
    expect(input, `no input ${testid}`).not.toBeNull();
    input!.value = value;
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function click(root: ParentNode, testid: string): void {
    const btn = root.querySelector(
      `[data-testid="${testid}"]`,
    ) as HTMLElement | null;
    expect(btn, `no control ${testid}`).not.toBeNull();
    btn!.click();
  }

  /** POST the captured client payload through the real router. */
  async function post(
    router: Router,
    path: string,
    body: unknown,
  ): Promise<Response> {
    const req = new Request(`https://api.greenput.com${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    return router.fetch(req, { DB: sqlite.db });
  }

  /** The body of the last POST the client made to `path`. */
  function lastPost(path: string): Record<string, unknown> {
    const call = [...fake.calls]
      .reverse()
      .find((c) => c.method === 'POST' && c.url.includes(path));
    expect(call, `the panel made no POST to ${path}`).toBeTruthy();
    return call!.body as Record<string, unknown>;
  }

  it('keeps the email and phone typed into New lead', async () => {
    await stub(leadsRouter, '/api/leads');
    fake.respond(
      /\/api\/leads$/,
      () =>
        new Response('{"data":{}}', {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const view = renderLeadsRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    click(view.element, 'leads-new');
    await tick();
    type(view.element, 'leads-form-firstName', 'Priya');
    type(view.element, 'leads-form-lastName', 'Raman');
    type(view.element, 'leads-form-email', 'priya@example.com');
    type(view.element, 'leads-form-phone', '5125550190');
    type(view.element, 'leads-form-serviceType', 'EV Charger');
    click(view.element, 'panel-submit');
    await tick();
    await tick();

    // What the client actually sent — nested, because Lead is nested.
    const payload = lastPost('/api/leads');
    expect(payload['contact']).toMatchObject({
      email: 'priya@example.com',
      phone: '5125550190',
    });

    // Hand that same object to the real router and the real database.
    const res = await post(leadsRouter, '/api/leads', payload);
    expect(res.status).toBe(201);

    const rows = sqlite.rows<Record<string, unknown>>('leads');
    const created = rows.find((r) => r['first_name'] === 'Priya');
    expect(created, 'no lead row was written').toBeTruthy();
    // Before the validators accepted the nested shape these were ''.
    expect(created!['email']).toBe('priya@example.com');
    expect(created!['phone']).toBe('5125550190');
  });

  it('keeps the email, phone and service address typed into New customer', async () => {
    await stub(customersRouter, '/api/customers');
    fake.respond(
      /\/api\/customers$/,
      () =>
        new Response('{"data":{}}', {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const view = renderCustomersRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    click(view.element, 'customers-new');
    await tick();
    type(view.element, 'customers-form-firstName', 'Sam');
    type(view.element, 'customers-form-lastName', 'Okafor');
    type(view.element, 'customers-form-email', 'sam@example.com');
    type(view.element, 'customers-form-phone', '5125550191');
    type(view.element, 'customers-form-street', '9 Birch Ave');
    type(view.element, 'customers-form-city', 'Rivertown');
    type(view.element, 'customers-form-state', 'TX');
    type(view.element, 'customers-form-zip', '78703');
    click(view.element, 'panel-submit');
    await tick();
    await tick();

    const payload = lastPost('/api/customers');
    expect(payload['contact']).toMatchObject({ email: 'sam@example.com' });
    expect(payload['address']).toMatchObject({ street: '9 Birch Ave' });

    const res = await post(customersRouter, '/api/customers', payload);
    expect(res.status).toBe(201);

    const created = sqlite
      .rows<Record<string, unknown>>('customers')
      .find((r) => r['first_name'] === 'Sam');
    expect(created, 'no customer row was written').toBeTruthy();
    expect(created!['email']).toBe('sam@example.com');
    expect(created!['phone']).toBe('5125550191');
    // The address the dashboard run sheet prints.
    expect(created!['street']).toBe('9 Birch Ave');
    expect(created!['city']).toBe('Rivertown');
    expect(created!['state']).toBe('TX');
    expect(created!['zip']).toBe('78703');
  });
});

// ─────────────────────────────────────────────────────────────
// New opportunity, end to end through the real routers (GP-015).
//
// The panel used to post `leadId: ''` — a field it never showed — and the
// only test of the create path handed the client's payload to a fake fetch
// that answers anything with 201. Against the real router that same
// sequence was a 400 reading `Invalid uuid`, on every click, since the day
// the panel shipped. Here the platform's `fetch` IS the router: the lead
// list the select shows is the API's own bytes, the option chosen carries
// the row's real id, the POST lands in SQLite, and the reload that follows
// puts the new deal on the screen.
// ─────────────────────────────────────────────────────────────

describe('New opportunity is created through the real router (GP-015)', () => {
  let sqlite: SqliteD1;
  let dispose: (() => void) | null = null;
  let calls: Array<{ method: string; url: string; status: number }> = [];

  const QUALIFIED_LEAD = '00000000-0000-4000-8000-0000000000c1';
  const GP015_SEED = `
INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact,
                   status, source, service_type, notes, qualified_at, created_at, updated_at, created_by)
VALUES ('${QUALIFIED_LEAD}', '${WS}', 'Morgan', 'Lee', 'morgan@example.com', '5125550102', 'phone',
        'qualified', 'website', 'EV charger install', '', '2026-04-02T00:00:00.000Z',
        '2026-04-02T00:00:00.000Z', '2026-04-02T00:00:00.000Z', '${USER}');
`;

  /** The platform's `fetch`, answered by whichever real router owns the path. */
  const live: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const req = new Request(`https://api.greenput.com${url}`, {
      method,
      ...(init?.headers ? { headers: init.headers } : {}),
      ...(init?.body ? { body: init.body } : {}),
    });
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const router = url.startsWith('/api/leads')
      ? leadsRouter
      : opportunitiesRouter;
    const res =
      ((await router.fetch(req, { DB: sqlite.db })) as Response | undefined) ??
      new Response(
        JSON.stringify({
          error: {
            code: 'not_found',
            message: `The API does not serve ${method} ${url}`,
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    calls.push({ method, url, status: res.status });
    return res;
  };

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await tick();
  }

  beforeEach(() => {
    calls = [];
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(), GP015_SEED],
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    sqlite.close();
  });

  it('lists the qualified lead by name, posts its id, gets 201 and shows the new deal', async () => {
    const view = renderOpportunitiesRoute(buildTestDeps({ fetch: live }));
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();
    const root = view.element;

    (
      root.querySelector('[data-testid="opportunities-new"]') as HTMLElement
    ).click();
    await settle();

    // The select's options are the leads router's own list — the name is
    // read off the wire, the value is the row's primary key.
    const select = root.querySelector(
      '[data-testid="opportunities-form-leadId"]',
    ) as HTMLSelectElement | null;
    expect(select, 'no From lead select').not.toBeNull();
    const listed = calls.find((c) => c.url.startsWith('/api/leads'));
    expect(listed?.url).toContain('status=qualified');
    expect(listed?.status).toBe(200);
    const option = [...select!.options].find((o) => o.value === QUALIFIED_LEAD);
    expect(option, 'the seeded lead is not offered').toBeTruthy();
    expect(option!.textContent).toBe('Morgan Lee · EV charger install');

    select!.value = QUALIFIED_LEAD;
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    const title = root.querySelector(
      '[data-testid="opportunities-form-title"]',
    ) as HTMLInputElement;
    title.value = 'Level 2 EV charger';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    (root.querySelector('[data-testid="panel-submit"]') as HTMLElement).click();
    await settle();

    // Before GP-015 this was 400 — `Invalid uuid`, zod's words, on `leadId: ''`.
    const posted = calls.find(
      (c) => c.method === 'POST' && c.url === '/api/opportunities',
    );
    expect(posted, 'the panel made no POST').toBeTruthy();
    expect(posted!.status).toBe(201);

    const row = sqlite
      .rows<Record<string, unknown>>('opportunities')
      .find((r) => r['title'] === 'Level 2 EV charger');
    expect(row, 'no opportunity row was written').toBeTruthy();
    expect(row!['lead_id']).toBe(QUALIFIED_LEAD);

    // The panel closed, the list reloaded from the router, the deal is on it.
    expect(root.querySelector('[data-bn-panel]')).toBeNull();
    expect(root.textContent).toContain('Level 2 EV charger');
  });

  it("will not post at all while no lead is chosen — the message is the product's", async () => {
    const view = renderOpportunitiesRoute(buildTestDeps({ fetch: live }));
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();
    const root = view.element;
    (
      root.querySelector('[data-testid="opportunities-new"]') as HTMLElement
    ).click();
    await settle();
    const title = root.querySelector(
      '[data-testid="opportunities-form-title"]',
    ) as HTMLInputElement;
    title.value = 'Level 2 EV charger';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    (root.querySelector('[data-testid="panel-submit"]') as HTMLElement).click();
    await settle();

    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(
      root.querySelector('[data-bn-error]:not([hidden])')?.textContent,
    ).toBe('Choose a lead.');
    expect(sqlite.rows<Record<string, unknown>>('opportunities').length).toBe(
      1,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// The lifecycle actions, addressed at the real router (GP-106).
//
// The ticket's failure mode: three client endpoints addressed URLs the API
// did not serve, and every route spec was green because a fake fetch
// answers any URL it is told to. Here the platform's `fetch` is the real
// leads router over the real database. Qualify, the fee read, Accept and
// Withdraw are clicked in the rendered DOM, the request goes wherever the
// client addresses it, and only a route the Worker actually serves answers —
// so renaming `/:id/accept` on either side fails here, and the fee the
// dialog states is the one a booking bills (WS-1: accept itself writes
// no lead_meter_events row, and this spec pins that too).
// ─────────────────────────────────────────────────────────────
describe('the lifecycle actions address URLs the API serves (GP-106)', () => {
  let sqlite: SqliteD1;
  let dispose: (() => void) | null = null;
  let calls: Array<{ method: string; url: string }> = [];

  const LIFECYCLE_SEED = `
INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact,
                   status, source, service_type, notes, qualified_at, created_at, updated_at, created_by)
VALUES ('lead-2', '${WS}', 'Morgan', 'Lee', 'morgan@example.com', '5125550102', 'phone',
        'qualified', 'website', 'EV charger install', '', '2026-04-02T00:00:00.000Z',
        '2026-04-02T00:00:00.000Z', '2026-04-02T00:00:00.000Z', '${USER}'),
       ('lead-3', '${WS}', 'Nia', 'Park', 'nia@example.com', '5125550103', 'phone',
        'new', 'website', 'Drain cleaning', '', NULL,
        '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z', '${USER}');
`;

  /**
   * The platform's `fetch`, answered by the real router. A URL the router
   * does not serve gets a 404 — the tooth this block bites with.
   */
  const live: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url });
    const req = new Request(`https://api.greenput.com${url}`, {
      method,
      ...(init?.headers ? { headers: init.headers } : {}),
      ...(init?.body ? { body: init.body } : {}),
    });
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const res = (await leadsRouter.fetch(req, { DB: sqlite.db })) as
      Response | undefined;
    return (
      res ??
      new Response(
        JSON.stringify({
          error: {
            code: 'not_found',
            message: `The API does not serve ${method} ${url}`,
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      )
    );
  };

  /** Drive the router directly, as another session would. */
  async function direct(method: string, path: string): Promise<Response> {
    const req = new Request(`https://api.greenput.com${path}`, { method });
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    return leadsRouter.fetch(req, { DB: sqlite.db });
  }

  /** A click, its fetch, the reload it triggers, and the re-render. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await tick();
  }

  async function mount(): Promise<HTMLElement> {
    const view = renderLeadsRoute(buildTestDeps({ fetch: live }));
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();
    return view.element;
  }

  function click(root: ParentNode, testid: string): void {
    const btn = root.querySelector(
      `[data-testid="${testid}"]`,
    ) as HTMLElement | null;
    if (!btn) throw new Error(`no control ${testid}`);
    btn.click();
  }

  function openAlertDialog(): HTMLDialogElement {
    const dialog = document.querySelector(
      'dialog[role="alertdialog"][open]',
    ) as HTMLDialogElement | null;
    if (!dialog) throw new Error('no open alertdialog');
    return dialog;
  }

  function meterRows(): Array<Record<string, unknown>> {
    return sqlite.rows<Record<string, unknown>>('lead_meter_events');
  }

  beforeEach(() => {
    calls = [];
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(), LIFECYCLE_SEED],
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    sqlite.close();
  });

  it('answers 404 for a URL the router does not serve — the check has teeth', async () => {
    const res = await live('/api/leads/lead-2/approve', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('Accept: the dialog states the fee a booking will bill; accept itself bills nothing (WS-1)', async () => {
    const root = await mount();
    // The list itself came from the router; lead-2 is qualified, so the
    // one lifecycle action on its row is Accept.
    click(root, 'leads-accept-lead-2');
    await settle();

    const dialog = openAlertDialog();
    const fee = dialog.querySelector('[data-testid="leads-accept-fee"]');
    expect(fee?.textContent).toContain('$60');
    expect(
      calls.some(
        (c) => c.method === 'GET' && c.url === '/api/leads/lead-2/fee',
      ),
    ).toBe(true);
    expect(meterRows()).toHaveLength(0);

    click(dialog, 'leads-accept-confirm');
    await settle();

    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url === '/api/leads/lead-2/accept',
      ),
    ).toBe(true);
    // WS-1: accept is a state transition — no meter row, no charge.
    // The $60 the dialog stated is what a booking of this lead bills.
    expect(meterRows()).toHaveLength(0);
    const notice = root.querySelector('[data-testid="leads-notice"]');
    expect(notice?.textContent).toContain('$60');
    expect(notice?.textContent).toContain('bills at booking');
    // The reload came from the router too: the row now offers Withdraw.
    expect(
      root.querySelector('[data-testid="leads-accept-lead-2"]'),
    ).toBeNull();
    expect(
      root.querySelector('[data-testid="leads-withdraw-lead-2"]'),
    ).not.toBeNull();
  });

  it('a stale Accept on an already-accepted lead says so and bills nothing more', async () => {
    const root = await mount();
    click(root, 'leads-accept-lead-2');
    await settle();
    const dialog = openAlertDialog();
    // Another session accepts first.
    expect((await direct('POST', '/api/leads/lead-2/accept')).status).toBe(200);
    expect(meterRows()).toHaveLength(0);

    click(dialog, 'leads-accept-confirm');
    await settle();

    const text =
      root.querySelector('[data-testid="leads-notice"]')?.textContent ?? '';
    expect(text).toContain('already accepted');
    expect(text).not.toMatch(/\$/);
    expect(meterRows()).toHaveLength(0);
  });

  it('Withdraw after acceptance leaves the pending booking fee standing, through the real router', async () => {
    expect((await direct('POST', '/api/leads/lead-2/accept')).status).toBe(200);
    // WS-1: accept created no fee. Seed the pending row a booking
    // would have written, so the withdraw path is exercised against
    // the fee it must leave standing.
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events
           (id, workspace_id, lead_id, vertical, service_type, price_usd, status, created_at)
         VALUES ('meter-lead-2', ?, 'lead-2', 'ev_charger', 'EV charger install', 60, 'pending', '2026-04-02T00:00:00.000Z')`,
      )
      .run(WS);
    const root = await mount();
    click(root, 'leads-withdraw-lead-2');
    await settle();
    click(openAlertDialog(), 'leads-withdraw-confirm');
    await settle();

    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url === '/api/leads/lead-2/withdraw',
      ),
    ).toBe(true);
    const rows = meterRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['status']).toBe('pending');
    expect(
      root.querySelector('[data-testid="leads-notice"]')?.textContent,
    ).toContain('lead fee stands');
    // Withdrawn: no lifecycle action is left on the row.
    expect(
      root.querySelector('[data-testid="leads-withdraw-lead-2"]'),
    ).toBeNull();
  });

  it('Qualify stamps qualified_at and the row moves on to Accept', async () => {
    const root = await mount();
    click(root, 'leads-qualify-lead-3');
    await settle();

    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url === '/api/leads/lead-3/qualify',
      ),
    ).toBe(true);
    const row = sqlite
      .rows<Record<string, unknown>>('leads')
      .find((r) => r['id'] === 'lead-3');
    expect(row?.['qualified_at']).toBeTruthy();
    expect(row?.['status']).toBe('qualified');
    expect(meterRows()).toHaveLength(0);
    expect(
      root.querySelector('[data-testid="leads-qualify-lead-3"]'),
    ).toBeNull();
    expect(
      root.querySelector('[data-testid="leads-accept-lead-3"]'),
    ).not.toBeNull();
  });
});

// ── Request review, through the real reviews router (GP-047) ───────────
//
// The button lives on the paid job row because that row already carries the
// customer id and the job id. Here the click's POST is answered by the real
// `reviewsRouter` over the real schema, so what the row is written with is
// what the API accepts — and the /reviews page then lists it from the real
// GET. Greenput sends nothing (GP-008): the row must be `pending`, `sent_at`
// NULL, and the page must say so.
describe('Request review posts through the real reviews router (GP-047)', () => {
  let sqlite: SqliteD1;
  let dispose: (() => void) | null = null;

  // CreateReviewRequestSchema requires UUIDs, which seed()'s 'cust-1' and
  // 'job-1' are not; this pair is what the button's POST carries.
  const CUST = '00000000-0000-4000-8000-0000000000c3';
  const JOB = '00000000-0000-4000-8000-0000000000c4';
  const REVIEW_SEED = `
INSERT INTO customers (id, workspace_id, first_name, last_name, company, email, phone, preferred_contact,
                       street, city, state, zip, notes, total_job_value, job_count,
                       created_at, updated_at, created_by)
VALUES ('${CUST}', '${WS}', 'Morgan', 'Lee', NULL, 'morgan@example.com', '5125550102', 'phone',
        '3 Pine St', 'Rivertown', 'TX', '78703', '', 265213, 1,
        '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z', '${USER}');

INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                  street, city, state, zip, scheduled_start, scheduled_end, total, notes,
                  created_at, updated_at, created_by)
VALUES ('${JOB}', '${WS}', 'opp-1', '${CUST}', '#1002', 'EV charger install', 'paid',
        '3 Pine St', 'Rivertown', 'TX', '78703', '${JOB_START}', '${JOB_END}', 265213, '',
        '2026-04-08T00:00:00.000Z', '2026-04-08T00:00:00.000Z', '${USER}');
`;

  /** The platform's `fetch`, answered by whichever real router owns the path. */
  const live: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const req = new Request(`https://api.greenput.com${url}`, {
      method,
      ...(init?.headers ? { headers: init.headers } : {}),
      ...(init?.body ? { body: init.body } : {}),
    });
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const path = new URL(req.url).pathname;
    const router: Router = path.startsWith('/api/reviews')
      ? reviewsRouter
      : path.startsWith('/api/customers')
        ? customersRouter
        : path.startsWith('/api/opportunities')
          ? opportunitiesRouter
          : jobsRouter;
    const res = (await router.fetch(req, { DB: sqlite.db })) as
      Response | undefined;
    return (
      res ??
      new Response(
        JSON.stringify({
          error: {
            code: 'not_found',
            message: `The API does not serve ${method} ${url}`,
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      )
    );
  };

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await tick();
  }

  function click(root: ParentNode, testid: string): void {
    const btn = root.querySelector(
      `[data-testid="${testid}"]`,
    ) as HTMLElement | null;
    if (!btn) throw new Error(`no control ${testid}`);
    btn.click();
  }

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(), REVIEW_SEED],
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    sqlite.close();
    document
      .querySelectorAll('dialog[data-bn="dialog"]')
      .forEach((node) => node.remove());
  });

  it('records a pending row with the ids the paid row had, and /reviews lists it as recorded, not sent', async () => {
    const jobsView = renderJobsRoute(buildTestDeps({ fetch: live }));
    dispose = jobsView.dispose;
    document.body.append(jobsView.element);
    await settle();

    click(jobsView.element, `jobs-request-review-${JOB}`);
    await settle();
    const dialog = document.querySelector(
      'dialog[data-bn="dialog"][open]',
    ) as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    // The customer's name came from the real GET /api/customers/:id.
    expect(
      (
        dialog?.querySelector(
          '[data-testid="jobs-review-message"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toContain('Hi Morgan');

    click(dialog as ParentNode, 'jobs-review-submit');
    await settle();

    const rows = sqlite.rows<Record<string, unknown>>('review_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: WS,
      customer_id: CUST,
      job_id: JOB,
      channel: 'sms',
      status: 'pending',
      sent_at: null,
    });
    // Recorded, so the dialog is gone; nothing was sent.
    expect(document.querySelector('dialog[data-bn="dialog"]')).toBeNull();

    jobsView.dispose();
    dispose = null;
    const reviewsView = renderReviewsRoute(buildTestDeps({ fetch: live }));
    dispose = reviewsView.dispose;
    document.body.append(reviewsView.element);
    await settle();
    click(reviewsView.element, 'reviews-tab-requests');
    await settle();
    const card = reviewsView.element.querySelector(
      '[data-bn-review-list] article',
    );
    expect(card).not.toBeNull();
    expect(card?.textContent).toMatch(/Recorded/);
    expect(card?.textContent).not.toMatch(/\bSent\b/);
  });
});

// ─────────────────────────────────────────────────────────────
// The detail routes edit through the real routers (GP-003).
//
// Before this ticket nothing in the product could correct a record, so
// there was no write to test. Now `/customers/:id` and `/leads/:id` read
// with the real GET, PATCH what changed — nested `contact: { phone }`, the
// shape `UpdateCustomerSchema` folds onto the columns — and re-read. Here
// the platform's `fetch` IS the router over a real SQLite database: the
// phone typed into the form lands in the `customers` row, and a freshly
// mounted route renders it back. Delete is exercised the way the ticket
// warns about — the seeded customer has a scheduled job, the router refuses,
// and the dialog must show the refusal in the API's words.
// ─────────────────────────────────────────────────────────────
describe('the detail routes edit through the real routers (GP-003)', () => {
  let sqlite: SqliteD1;
  let dispose: (() => void) | null = null;
  let calls: Array<{
    method: string;
    url: string;
    status: number;
    body: unknown;
  }> = [];

  const live: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const req = new Request(`https://api.greenput.com${url}`, {
      method,
      ...(init?.headers ? { headers: init.headers } : {}),
      ...(init?.body ? { body: init.body } : {}),
    });
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const path = new URL(req.url).pathname;
    const router: Router = path.startsWith('/api/customers')
      ? customersRouter
      : path.startsWith('/api/jobs')
        ? jobsRouter
        : path.startsWith('/api/opportunities')
          ? opportunitiesRouter
          : path.startsWith('/api/estimates')
            ? estimatesRouter
            : path.startsWith('/api/change-orders')
              ? changeOrdersRouter
              : path.startsWith('/api/workspace')
                ? workspaceRouter
                : leadsRouter;
    const res =
      ((await router.fetch(req, { DB: sqlite.db })) as Response | undefined) ??
      new Response(
        JSON.stringify({
          error: {
            code: 'not_found',
            message: `The API does not serve ${method} ${url}`,
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, url, status: res.status, body });
    return res;
  };

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await tick();
  }

  function q<T extends Element = HTMLElement>(testid: string): T {
    const node = document.querySelector<T>(`[data-testid="${testid}"]`);
    if (!node) throw new Error(`no ${testid}`);
    return node;
  }

  function type(testid: string, value: string): void {
    const input = q<HTMLInputElement>(testid);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function deps() {
    const built = buildTestDeps({ fetch: live });
    built.auth.setUser({
      id: USER,
      email: 'dana@rivertown.example',
      firstName: 'Dana',
      lastName: 'Ortiz',
      role: 'owner',
      workspaceId: WS,
    });
    return built;
  }

  function customerRow(id: string): Record<string, unknown> | undefined {
    return sqlite
      .rows<Record<string, unknown>>('customers')
      .find((r) => r['id'] === id);
  }

  /** Tomorrow at `hour` local — a window nothing in `seed()` occupies. */
  function tomorrowAt(hour: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
    return d;
  }
  const TAKEN_START = tomorrowAt(13).toISOString();
  const TAKEN_END = tomorrowAt(15).toISOString();

  /**
   * job-1's own half-hours in `job_slots` (the seed writes the job row
   * bare), a second job holding tomorrow 13:00–15:00 so a reschedule onto
   * it meets the real guard, and an estimate with a typed line item list.
   */
  function passTwoSeed(): string {
    const slotRows = (jobId: string, start: string, end: string): string =>
      slotStartsFor(start, end)
        .map((slot) => `('${WS}', '${slot}', 0, '${jobId}')`)
        .join(',\n       ');
    return `
INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                  street, city, state, zip, scheduled_start, scheduled_end, total, notes,
                  created_at, updated_at, created_by)
VALUES ('job-2', '${WS}', 'opp-1', 'cust-1', '#1002', 'Service call', 'scheduled',
        '2 Elm St', 'Rivertown', 'TX', '78702', '${TAKEN_START}', '${TAKEN_END}', 15000, '',
        '2026-04-08T00:00:00.000Z', '2026-04-08T00:00:00.000Z', '${USER}');

INSERT INTO job_slots (workspace_id, slot_start, lane, job_id)
VALUES ${slotRows('job-1', JOB_START, JOB_END)},
       ${slotRows('job-2', TAKEN_START, TAKEN_END)};

INSERT INTO estimates (id, workspace_id, opportunity_id, customer_id, estimate_number, title, status,
                       line_items, subtotal, tax_rate, tax_amount, total, notes,
                       created_at, updated_at, created_by)
VALUES ('est-1', '${WS}', 'opp-1', 'cust-1', 'EST-0001', '200A Panel Upgrade', 'draft',
        '[{"id":"li-a","type":"labor","description":"Install","quantity":4,"unitPrice":10000,"total":40000},{"type":"material","description":"Panel","quantity":1,"unitPrice":80000,"total":80000}]',
        120000, 8.25, 9900, 129900, '',
        '2026-04-06T00:00:00.000Z', '2026-04-06T00:00:00.000Z', '${USER}');
`;
  }

  beforeEach(() => {
    calls = [];
    // Earlier blocks dispose their views but leave the elements in the
    // document; `panel-submit` must be THIS route's, not a dead one's.
    document.body.innerHTML = '';
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(), passTwoSeed()],
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    sqlite.close();
    document.body.innerHTML = '';
  });

  it('/customers/:id: the phone edited in the form is the phone in the row, and survives a reload', async () => {
    history.replaceState(null, '', '/customers/cust-1');
    const view = renderCustomerDetailRoute(deps(), { id: 'cust-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();

    // The read: the router's own bytes, through the wire contract.
    expect(q('customer-detail-heading').textContent).toBe('Jane Doe');
    expect(q('customer-detail-field-phone').textContent).toBe('(512) 555-0143');
    expect(q('customer-detail-field-email').textContent).toBe(
      'jane@example.com',
    );
    // The job history came from the same GET.
    expect(q('customer-detail-jobs').textContent).toContain('#1001');
    expect(q('customer-detail-jobs').textContent).toMatch(/\$2,652/);

    q('customer-detail-edit').click();
    await settle();
    type('customer-detail-form-phone', '5125550199');
    q('panel-submit').click();
    await settle();

    // What the client sent, and what the router made of it.
    const patched = calls.find((c) => c.method === 'PATCH');
    expect(patched).toMatchObject({
      url: '/api/customers/cust-1',
      status: 200,
      body: { contact: { phone: '5125550199' } },
    });
    expect(customerRow('cust-1')?.['phone']).toBe('5125550199');
    // Untouched columns stayed untouched: the nested patch must not blank them.
    expect(customerRow('cust-1')?.['email']).toBe('jane@example.com');
    expect(customerRow('cust-1')?.['street']).toBe('2 Elm St');

    // The route re-read and shows the new value.
    expect(document.querySelector('[data-bn-panel]')).toBeNull();
    expect(q('customer-detail-field-phone').textContent).toBe('(512) 555-0199');

    // And so does a fresh mount — the edit survives a reload.
    view.dispose();
    dispose = null;
    document.body.innerHTML = '';
    const again = renderCustomerDetailRoute(deps(), { id: 'cust-1' });
    dispose = again.dispose;
    document.body.append(again.element);
    await settle();
    expect(q('customer-detail-field-phone').textContent).toBe('(512) 555-0199');
  });

  it("/customers/:id: a customer with a scheduled job cannot be deleted, and the dialog says so in the API's words", async () => {
    history.replaceState(null, '', '/customers/cust-1');
    const view = renderCustomerDetailRoute(deps(), { id: 'cust-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();

    q('customer-detail-delete').click();
    await settle();
    q('customer-detail-delete-confirm').click();
    await settle();

    const refused = calls.find((c) => c.method === 'DELETE');
    expect(refused).toMatchObject({
      url: '/api/customers/cust-1',
      status: 400,
    });
    const dialog = document.querySelector(
      'dialog[role="alertdialog"]',
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(q('customer-detail-delete-error').textContent).toBe(
      'Cannot delete customer with active jobs',
    );
    expect(customerRow('cust-1')).toBeTruthy();
    expect(window.location.pathname).toBe('/customers/cust-1');
  });

  it('/leads/:id: the phone edited in the form is the phone in the row', async () => {
    history.replaceState(null, '', '/leads/lead-1');
    const view = renderLeadDetailRoute(deps(), { id: 'lead-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();

    expect(q('lead-detail-heading').textContent).toBe('Alex Rivera');
    expect(q('lead-detail-field-phone').textContent).toBe('(512) 555-0101');
    // 265213 cents, rendered without cents by the shared formatter.
    expect(q('lead-detail-field-estimatedValue').textContent).toBe('$2,652');
    // lead-1 is qualified: the lifecycle action on this page is Accept.
    expect(q('lead-detail-accept')).not.toBeNull();

    q('lead-detail-edit').click();
    await settle();
    type('lead-detail-form-phone', '5125550190');
    q('panel-submit').click();
    await settle();

    const patched = calls.find((c) => c.method === 'PATCH');
    expect(patched).toMatchObject({
      url: '/api/leads/lead-1',
      status: 200,
      body: { contact: { phone: '5125550190' } },
    });
    const row = sqlite
      .rows<Record<string, unknown>>('leads')
      .find((r) => r['id'] === 'lead-1');
    expect(row?.['phone']).toBe('5125550190');
    expect(row?.['email']).toBe('alex.rivera@example.com');
    expect(row?.['estimated_value']).toBe(265213);
    expect(q('lead-detail-field-phone').textContent).toBe('(512) 555-0190');
  });

  function slotsOf(jobId: string): string[] {
    return sqlite
      .rows<{ job_id: string; slot_start: string }>('job_slots')
      .filter((r) => r.job_id === jobId)
      .map((r) => r.slot_start)
      .sort();
  }

  it('/jobs/:id: a reschedule through the real jobsRouter frees the old half-hours and claims the new ones', async () => {
    history.replaceState(null, '', '/jobs/job-1');
    const view = renderJobDetailRoute(deps(), { id: 'job-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();

    // The read: the router's own bytes — the line item child rows included.
    expect(q('job-detail-heading').textContent).toBe('Panel upgrade');
    expect(q('job-detail-field-jobNumber').textContent).toBe('#1001');
    expect(q('job-detail-field-total').textContent).toBe('$2,652.13');
    expect(q('job-detail-line-items').textContent).toContain(
      '200A panel replacement',
    );
    // The technician select is fed by the real workspace router.
    expect(q('job-detail-field-technician').textContent).toBe('Unassigned');
    expect(slotsOf('job-1')).toEqual(slotStartsFor(JOB_START, JOB_END).sort());

    const newStart = tomorrowAt(9);
    const newEnd = tomorrowAt(11);
    q('job-detail-edit').click();
    await settle();
    type('job-detail-form-scheduledStart', toDateTimeLocal(newStart));
    type('job-detail-form-scheduledEnd', toDateTimeLocal(newEnd));
    const tech = q<HTMLSelectElement>('job-detail-form-assignedTo');
    expect([...tech.options].map((o) => o.value)).toEqual(['', USER]);
    tech.value = USER;
    tech.dispatchEvent(new Event('change', { bubbles: true }));
    q('panel-submit').click();
    await settle();

    const patched = calls.find((c) => c.method === 'PATCH');
    expect(patched).toMatchObject({
      url: '/api/jobs/job-1',
      status: 200,
      body: {
        scheduledStart: newStart.toISOString(),
        scheduledEnd: newEnd.toISOString(),
        assignedTo: USER,
      },
    });
    const job = sqlite
      .rows<Record<string, unknown>>('jobs')
      .find((r) => r['id'] === 'job-1');
    expect(job?.['scheduled_start']).toBe(newStart.toISOString());
    expect(job?.['assigned_to']).toBe(USER);
    // GP-104: the guard's rows moved with the job — the morning is free
    // again and tomorrow 9:00–11:00 is held.
    expect(slotsOf('job-1')).toEqual(
      slotStartsFor(newStart.toISOString(), newEnd.toISOString()).sort(),
    );
    // job-2's rows are untouched.
    expect(slotsOf('job-2')).toEqual(
      slotStartsFor(TAKEN_START, TAKEN_END).sort(),
    );

    // The route re-read: the new time and the technician's name render.
    expect(document.querySelector('[data-bn-panel]')).toBeNull();
    expect(
      q('job-detail-field-scheduled')
        .querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe(newStart.toISOString());
    expect(q('job-detail-field-technician').textContent).toBe('Dana Ortiz');
  });

  it("/jobs/:id: rescheduling onto another job's time is a 409 from the real guard, shown in the form, and nothing moves", async () => {
    history.replaceState(null, '', '/jobs/job-1');
    const view = renderJobDetailRoute(deps(), { id: 'job-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();

    q('job-detail-edit').click();
    await settle();
    type(
      'job-detail-form-scheduledStart',
      toDateTimeLocal(new Date(TAKEN_START)),
    );
    type('job-detail-form-scheduledEnd', toDateTimeLocal(new Date(TAKEN_END)));
    q('panel-submit').click();
    await settle();

    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/jobs/job-1',
      status: 409,
    });
    expect(document.querySelector('[data-bn-panel]')).not.toBeNull();
    expect(
      document.querySelector('[data-bn-panel-form] [data-bn-error]')
        ?.textContent,
    ).toBe('That time just went — pick another');
    // Rolled back: the original window is still job-1's.
    expect(slotsOf('job-1')).toEqual(slotStartsFor(JOB_START, JOB_END).sort());
    const job = sqlite
      .rows<Record<string, unknown>>('jobs')
      .find((r) => r['id'] === 'job-1');
    expect(job?.['scheduled_start']).toBe(JOB_START);
  });

  it('/jobs/:id: a change order proposed and approved through the real router moves the total by exactly its change', async () => {
    // Ids on the wire are UUIDs (the validator checks), so this job has one.
    const JOB_ID = '00000000-0000-4000-8000-0000000000d1';
    sqlite.raw.exec(`
INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                  street, city, state, zip, scheduled_start, scheduled_end, total, notes,
                  created_at, updated_at, created_by)
VALUES ('${JOB_ID}', '${WS}', 'opp-1', 'cust-1', '#1003', 'Panel upgrade', 'in_progress',
        '2 Elm St', 'Rivertown', 'TX', '78702', '${JOB_START}', '${JOB_END}', 265213, '',
        '2026-04-07T00:00:00.000Z', '2026-04-07T00:00:00.000Z', '${USER}');
INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
VALUES ('li-d1', '${JOB_ID}', '200A panel replacement', 1, 220000, 220000);`);
    history.replaceState(null, '', `/jobs/${JOB_ID}`);
    const view = renderJobDetailRoute(deps(), { id: JOB_ID });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();
    expect(q('job-change-orders').textContent).toContain(
      'No change orders yet.',
    );

    q('job-change-orders-propose').click();
    type('job-change-orders-form-title', 'Add a surge protector');
    type(
      'job-change-orders-form-line-0-description',
      'Whole-home surge protector',
    );
    type('job-change-orders-form-line-0-unitPrice', '795');
    q('job-change-orders-form-submit').click();
    await settle();

    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/change-orders',
      status: 201,
    });
    const [proposed] = sqlite.rows<Record<string, unknown>>('change_orders');
    expect(proposed).toMatchObject({
      job_id: JOB_ID,
      status: 'proposed',
      price_delta: 79500,
      total_before: 265213,
    });
    const id = String(proposed?.['id']);
    expect(q(`job-change-order-${id}-delta`).textContent).toBe('+$795.00');
    // Proposing alone moves nothing.
    expect(q('job-detail-field-total').textContent).toBe('$2,652.13');

    type(`job-change-order-${id}-note`, 'Yes, by phone');
    q(`job-change-order-${id}-approve`).click();
    await settle();

    expect(
      calls.find((c) => c.url === `/api/change-orders/${id}/approve`),
    ).toMatchObject({ status: 200 });
    // The route re-read the job: 265213 + 79500, and the new line is there.
    expect(q('job-detail-field-total').textContent).toBe('$3,447.13');
    expect(q('job-detail-line-items').textContent).toContain(
      'Whole-home surge protector',
    );
    expect(
      q(`job-change-order-${id}`)
        .querySelector('[data-bn-status]')
        ?.getAttribute('data-bn-status'),
    ).toBe('approved');
    expect(
      sqlite
        .rows<Record<string, unknown>>('change_order_events')
        .map((e) => e['action'])
        .sort(),
    ).toEqual(['approved', 'proposed']);
  });

  it('/opportunities/:id: the value edited in dollars is stored in cents and renders back', async () => {
    history.replaceState(null, '', '/opportunities/opp-1');
    const view = renderOpportunityDetailRoute(deps(), { id: 'opp-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();

    expect(q('opportunity-detail-heading').textContent).toBe(
      '200A Panel Upgrade',
    );
    expect(q('opportunity-detail-field-value').textContent).toBe('$2,652.13');
    expect(
      q('opportunity-detail-field-lead')
        .querySelector('a')
        ?.getAttribute('href'),
    ).toBe('/leads/lead-1');

    q('opportunity-detail-edit').click();
    await settle();
    type('opportunity-detail-form-valueUsd', '3000');
    q('panel-submit').click();
    await settle();

    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/opportunities/opp-1',
      status: 200,
      body: { value: 300000 },
    });
    const row = sqlite
      .rows<Record<string, unknown>>('opportunities')
      .find((r) => r['id'] === 'opp-1');
    expect(row?.['value']).toBe(300000);
    expect(row?.['title']).toBe('200A Panel Upgrade');
    expect(q('opportunity-detail-field-value').textContent).toBe('$3,000.00');
  });

  it('/estimates/:id: the typed line items render with their split; a quantity edited in the costing editor is re-totalled by the real router', async () => {
    history.replaceState(null, '', '/estimates/est-1');
    const view = renderEstimateDetailRoute(deps(), { id: 'est-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();

    // The read: `line_items` parsed through `readEstimateLineItems`, cents
    // rendered as money, the labor / materials split from the API's rows.
    expect(q('estimate-detail-heading').textContent).toBe('200A Panel Upgrade');
    expect(q('estimate-detail-field-total').textContent).toBe('$1,299.00');
    expect(q('estimate-detail-field-tax').textContent).toBe('$99.00 (8.25%)');
    expect(q('estimate-detail-labor').textContent).toBe('$400.00');
    expect(q('estimate-detail-materials').textContent).toBe('$800.00');
    expect(q('estimate-detail-line-items').textContent).toContain('Material');

    q('estimate-detail-edit').click();
    await settle();
    type('estimate-detail-form-title', '200A Panel Upgrade — Doe');
    type('estimate-detail-row-li-a-qty', '5');
    q('panel-submit').click();
    await settle();

    const patched = calls.find((c) => c.method === 'PATCH');
    expect(patched).toMatchObject({
      url: '/api/estimates/est-1',
      status: 200,
      body: { title: '200A Panel Upgrade — Doe' },
    });
    const body = patched?.body as { lineItems: Array<Record<string, unknown>> };
    expect(
      body.lineItems.map((li) => [li['type'], li['quantity'], li['unitPrice']]),
    ).toEqual([
      ['labor', 5, 10000],
      ['material', 1, 80000],
    ]);
    // The API, not the client, decided the totals: 5 × $100 + $800 = $1,300
    // plus 8.25% tax.
    const row = sqlite
      .rows<Record<string, unknown>>('estimates')
      .find((r) => r['id'] === 'est-1');
    expect(row?.['subtotal']).toBe(130000);
    expect(row?.['tax_amount']).toBe(10725);
    expect(row?.['total']).toBe(140725);
    expect(q('estimate-detail-field-total').textContent).toBe('$1,407.25');
    expect(q('estimate-detail-labor').textContent).toBe('$500.00');
    expect(q('estimate-detail-heading').textContent).toBe(
      '200A Panel Upgrade — Doe',
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Messages runs on the real chat router (GP-055).
//
// The chat router read `req.session` on every handler — a property nothing
// ever set — and its own spec never drove a handler with a principal, so
// every authenticated chat request 500ed behind a green suite. Here the
// Message button on /customers/:id and the /chat list are fed the bytes the
// real router produces over the real schema, and the body the client builds
// for POST is handed to that same router.
// ─────────────────────────────────────────────────────────────
describe('Messages runs on the real chat router (GP-055)', () => {
  let sqlite: SqliteD1;
  let fake: ReturnType<typeof createFakeFetch>;
  let dispose: (() => void) | null = null;

  const PRINCIPAL = {
    id: USER,
    workspaceId: WS,
    email: 'dana@rivertown.example',
    role: 'owner',
    firstName: 'Dana',
    lastName: 'Ortiz',
  };

  /** A request exactly as requireAuth hands it to the chat router. */
  function real(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const req = new Request(
      `https://api.greenput.com${path}`,
      body === undefined
        ? { method }
        : {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = PRINCIPAL;
    return chatRouter.fetch(req, { DB: sqlite.db });
  }

  async function realBody(path: string): Promise<string> {
    const res = await real('GET', path);
    expect(res.status).toBe(200);
    return res.text();
  }

  function replay(body: string): Response {
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  async function customerPage(): Promise<string> {
    const req = new Request('https://api.greenput.com/api/customers/cust-1');
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    const res = await (customersRouter as Router).fetch(req, { DB: sqlite.db });
    expect(res.status).toBe(200);
    return res.text();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await tick();
  }

  function click(root: ParentNode, testid: string): void {
    const btn = root.querySelector(
      `[data-testid="${testid}"]`,
    ) as HTMLElement | null;
    expect(btn, `no control ${testid}`).not.toBeNull();
    btn!.click();
  }

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed()],
    });
    fake = createFakeFetch();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
    sqlite.close();
  });

  it('Message on /customers/:id creates the room through the real router, and a second press opens that room without creating another', async () => {
    const page = await customerPage();
    fake.respond(/\/api\/customers\/cust-1$/, () => replay(page));
    // The lookup answers whatever the real router currently knows.
    let lookup = await realBody(
      '/api/chat/rooms?entityType=customer&entityId=cust-1',
    );
    fake.respond(/\/api\/chat\/rooms\?/, () => replay(lookup));
    // The POST's canned reply only needs an id to navigate to; the payload
    // the client built is what is handed to the real router below.
    fake.respond(
      /\/api\/chat\/rooms$/,
      () =>
        new Response(
          JSON.stringify({
            data: {
              id: 'pending',
              name: '',
              createdBy: USER,
              createdAt: '2026-09-14T00:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    );

    const deps = buildTestDeps({ fetch: fake.fetch });
    deps.auth.setUser({ ...PRINCIPAL });
    history.replaceState(null, '', '/customers/cust-1');
    let view = renderCustomerDetailRoute(deps, { id: 'cust-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();
    click(view.element, 'customer-detail-message');
    await settle();

    const post = [...fake.calls]
      .reverse()
      .find((c) => c.method === 'POST' && c.url === '/api/chat/rooms');
    expect(post?.body).toEqual({
      name: 'Jane Doe',
      entityType: 'customer',
      entityId: 'cust-1',
    });
    const created = await real('POST', '/api/chat/rooms', post!.body);
    expect(created.status).toBe(201);
    const room = (
      (await created.json()) as { data: { id: string; name: string } }
    ).data;
    expect(room.name).toBe('Jane Doe');
    expect(sqlite.rows('chat_rooms')).toHaveLength(1);

    // A fresh page, a second press: the lookup now finds the room, so
    // nothing is posted and the page goes straight to it.
    view.dispose();
    dispose = null;
    document.body.innerHTML = '';
    lookup = await realBody(
      '/api/chat/rooms?entityType=customer&entityId=cust-1',
    );
    const postsBefore = fake.calls.filter((c) => c.method === 'POST').length;
    history.replaceState(null, '', '/customers/cust-1');
    view = renderCustomerDetailRoute(deps, { id: 'cust-1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();
    click(view.element, 'customer-detail-message');
    await settle();

    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(
      postsBefore,
    );
    expect(window.location.pathname).toBe(`/chat/${room.id}`);
    // And the router itself would not have minted a second one either.
    const again = await real('POST', '/api/chat/rooms', post!.body);
    expect(again.status).toBe(200);
    expect(sqlite.rows('chat_rooms')).toHaveLength(1);
  });

  it('/chat lists the rooms the real router answers, named, linked, with the unread count of what a teammate wrote', async () => {
    await real('POST', '/api/chat/rooms', {
      name: 'Jane Doe',
      entityType: 'customer',
      entityId: 'cust-1',
    });
    const jobRoom = (
      (await (
        await real('POST', '/api/chat/rooms', {
          name: '#1001 Panel upgrade',
          entityType: 'job',
          entityId: 'job-1',
        })
      ).json()) as { data: { id: string } }
    ).data;
    sqlite.raw.exec(`
INSERT INTO chat_messages (id, chat_room_id, user_id, user_name, content, created_at)
VALUES ('m1', '${jobRoom.id}', 'user-sam', 'Sam Lee', 'Panel is in.', '2026-09-14T10:00:00.000Z'),
       ('m2', '${jobRoom.id}', 'user-sam', 'Sam Lee', 'Heading to the next one.', '2026-09-14T10:05:00.000Z');
`);
    const rooms = await realBody('/api/chat/rooms');
    const unread = await realBody('/api/chat/unread');
    fake.respond('/api/chat/unread', () => replay(unread));
    fake.respond('/api/chat/rooms', () => replay(rooms));

    history.replaceState(null, '', '/chat');
    const view = renderChatListRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();

    // Both rooms were made inside one millisecond, so their order under
    // `created_at DESC` is a tie; find each row by what it says.
    const trs = [...view.element.querySelectorAll('tbody tr')];
    expect(trs).toHaveLength(2);
    const jobRow = trs.find((tr) => tr.textContent?.includes('#1001'));
    const customerRow = trs.find((tr) => tr.textContent?.includes('Jane Doe'));
    expect(jobRow?.querySelector('a')?.getAttribute('href')).toBe(
      `/chat/${jobRoom.id}`,
    );
    expect(jobRow?.textContent).toContain('#1001 Panel upgrade');
    expect(jobRow?.textContent).toContain('About a job');
    expect(jobRow?.querySelector('[data-bn-unread]')?.textContent).toBe(
      '2 new',
    );
    expect(customerRow?.textContent).toContain('About a customer');
    expect(customerRow?.querySelector('[data-bn-unread]')).toBeNull();
    expect(view.element.textContent).not.toContain('undefined');
    expect(view.element.textContent).not.toContain('Invalid Date');
  });
});
