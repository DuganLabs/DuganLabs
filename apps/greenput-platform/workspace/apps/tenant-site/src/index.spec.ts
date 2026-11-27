import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { RESERVED_SUBDOMAINS } from '@greenput/shared/utils';
import handler from './index.js';
import type { Env } from './env.js';

const ROOT = resolve(__dirname, '../../..');
const DEMO_WORKSPACE = '00000000-0000-4000-8000-000000000001';
const DEMO_OWNER = '00000000-0000-4000-8000-000000000002';

interface LeadRow {
  id: string;
  workspace_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_contact: string;
  status: string;
  source: string;
  service_type: string;
  notes: string;
  created_by: string;
}

interface ActivityRow {
  workspace_id: string;
  user_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  meta: string | null;
}

interface ApiErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

/**
 * scripts/preview/seed.sql now seeds historical leads for the `demo`
 * workspace (source: 'manual') so the tenant site's Services section has
 * real content — see apps/tenant-site/src/render.ts. POST /leads always
 * writes source: 'website', so filtering on that isolates the rows this
 * suite's own submissions create from that pre-existing seed data.
 */
const websiteLeads = (db: SqliteD1): LeadRow[] =>
  db.rows<LeadRow>('leads').filter((lead) => lead.source === 'website');

describe('tenant-site POST /leads', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'test' };
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  const postLead = (
    body: unknown,
    host = 'demo.greenput.com',
  ): Promise<Response> =>
    handler.fetch(
      new Request(`https://${host}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    );

  it('writes a minimal lead (name + phone) against the real schema', async () => {
    const res = await postLead({
      firstName: 'Jane',
      lastName: 'Smith',
      phone: '(555) 123-4567',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);

    const leads = websiteLeads(sqlite);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      id: body.id,
      workspace_id: DEMO_WORKSPACE,
      first_name: 'Jane',
      last_name: 'Smith',
      email: '',
      phone: '(555) 123-4567',
      preferred_contact: 'phone',
      status: 'new',
      source: 'website',
      service_type: '',
      notes: '',
      created_by: DEMO_OWNER,
    });

    const activity = sqlite.rows<ActivityRow>('activity_log');
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      workspace_id: DEMO_WORKSPACE,
      user_id: DEMO_OWNER,
      entity_type: 'lead',
      entity_id: body.id,
      action: 'created',
    });
    expect(JSON.parse(activity[0].meta ?? '{}')).toEqual({
      source: 'tenant_site',
    });
  });

  it('writes a fully populated lead with every optional field', async () => {
    const res = await postLead({
      firstName: '  Sam ',
      lastName: 'Reed',
      email: 'sam@example.com',
      phone: '555-987-6543',
      serviceType: 'Panel upgrade',
      notes: 'Need a 200A panel before the EV charger install.',
    });

    expect(res.status).toBe(200);
    const [lead] = websiteLeads(sqlite);
    expect(lead).toMatchObject({
      first_name: 'Sam',
      last_name: 'Reed',
      email: 'sam@example.com',
      phone: '555-987-6543',
      preferred_contact: 'email',
      service_type: 'Panel upgrade',
      notes: 'Need a 200A panel before the EV charger install.',
      source: 'website',
      created_by: DEMO_OWNER,
    });
    expect(sqlite.rows('activity_log')).toHaveLength(1);
  });

  it('rejects a name-only submission with a field-specific 400', async () => {
    const res = await postLead({ firstName: 'Jane', lastName: 'Smith' });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.field).toBe('email');
    expect(body.error.message).toMatch(/email address or phone number/);
    expect(websiteLeads(sqlite)).toHaveLength(0);
  });

  it.each([
    [{ lastName: 'Smith', phone: '5551234567' }, 'firstName'],
    [{ firstName: 'Jane', phone: '5551234567' }, 'lastName'],
    [{ firstName: 'Jane', lastName: 'Smith', email: 'not-an-email' }, 'email'],
    [{ firstName: 'Jane', lastName: 'Smith', phone: '12345' }, 'phone'],
  ])('names the invalid field for %j', async (payload, field) => {
    const res = await postLead(payload);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.field).toBe(field);
    expect(websiteLeads(sqlite)).toHaveLength(0);
  });

  it('returns 400 for a malformed JSON body', async () => {
    const res = await handler.fetch(
      new Request('https://demo.greenput.com/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('swallows honeypot submissions without writing a row', async () => {
    const res = await postLead({
      firstName: 'Bot',
      lastName: 'Spam',
      email: 'bot@example.com',
      website: 'https://spam.example',
    });
    expect(res.status).toBe(200);
    expect(websiteLeads(sqlite)).toHaveLength(0);
    expect(sqlite.rows('activity_log')).toHaveLength(0);
  });

  it('returns a clear 500 and logs context when the workspace has no users', async () => {
    sqlite.raw
      .prepare(`INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)`)
      .run('ws-empty', 'Empty Co', 'empty');
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const res = await postLead(
      { firstName: 'Jane', lastName: 'Smith', phone: '5551234567' },
      'empty.greenput.com',
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error.code).toBe('WORKSPACE_NOT_READY');
    expect(body.error.message).toMatch(/call or email us directly/);
    expect(errorSpy).toHaveBeenCalledWith(
      'tenant-site lead submission failed',
      expect.objectContaining({ workspaceId: 'ws-empty', slug: 'empty' }),
    );
    expect(websiteLeads(sqlite)).toHaveLength(0);
  });

  it('logs the database error with workspace context when the insert fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const failing: Env = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          const statement = sqlite.db.prepare(sql);
          if (/INSERT INTO leads/.test(sql)) {
            return {
              bind: () => ({
                run: () => Promise.reject(new Error('D1_ERROR: disk I/O')),
              }),
            } as unknown as D1PreparedStatement;
          }
          return statement;
        },
      } as unknown as D1Database,
    };

    const res = await handler.fetch(
      new Request('https://demo.greenput.com/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '5551234567',
        }),
      }),
      failing,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error.code).toBe('INTERNAL');
    expect(errorSpy).toHaveBeenCalledWith(
      'tenant-site lead submission failed',
      expect.objectContaining({
        workspaceId: DEMO_WORKSPACE,
        error: 'D1_ERROR: disk I/O',
      }),
    );
  });

  it('returns 404 for an unknown workspace slug', async () => {
    const res = await postLead(
      { firstName: 'Jane', lastName: 'Smith', phone: '5551234567' },
      'nobody.greenput.com',
    );
    expect(res.status).toBe(404);
    expect(websiteLeads(sqlite)).toHaveLength(0);
  });

  it('produces a lead row that the billing lifecycle can later qualify and accept', async () => {
    // The tenant micro-site only ever inserts a lead — it has no qualify/
    // accept/withdraw endpoints of its own (those are staff-facing, on
    // apps/api; see apps/api/src/routes/leads.ts and
    // apps/api/src/routes/lead-lifecycle.spec.ts for the full behavior).
    // What this test proves is narrower but still real: apps/api and
    // apps/tenant-site bind to the SAME D1 database in production
    // (wrangler.toml: both declare database_name = "greenput"), so a row
    // this handler inserts must be schema-compatible with that lifecycle —
    // the new nullable qualified_at/accepted_at/withdrawn_at columns default
    // to NULL without this handler's INSERT needing to change, and the row
    // can be driven all the way to "accepted" using the exact SQL
    // apps/api's accept endpoint runs.
    const res = await postLead({
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      serviceType: 'HVAC tune-up',
    });
    expect(res.status).toBe(200);
    const { id: leadId } = (await res.json()) as { id: string };

    // scripts/preview/seed.sql now seeds historical leads for the demo
    // workspace (see websiteLeads above), so `leads` has rows before this
    // test's own POST — filter by the id the response just gave us rather
    // than assuming the first row in the table is the one just created.
    const created = sqlite
      .rows<
        LeadRow & { qualified_at: string | null; accepted_at: string | null }
      >('leads')
      .find((l) => l.id === leadId);
    expect(created?.qualified_at).toBeNull();
    expect(created?.accepted_at).toBeNull();

    const now = new Date().toISOString();
    sqlite.raw
      .prepare(
        `UPDATE leads SET status = 'qualified', qualified_at = ? WHERE id = ?`,
      )
      .run(now, leadId);
    sqlite.raw
      .prepare(`UPDATE leads SET accepted_at = ? WHERE id = ?`)
      .run(now, leadId);
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events (id, workspace_id, lead_id, vertical, service_type, price_usd, status, created_at)
         VALUES (?, ?, ?, 'hvac', 'HVAC tune-up', 60, 'pending', ?)`,
      )
      .run(crypto.randomUUID(), DEMO_WORKSPACE, leadId, now);

    const accepted = sqlite
      .rows<{ id: string; accepted_at: string | null }>('leads')
      .find((l) => l.id === leadId);
    expect(accepted?.accepted_at).toBe(now);
    expect(sqlite.rows('lead_meter_events')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// GP-004 — a homeowner with JavaScript off, blocked or still loading submits
// the form as application/x-www-form-urlencoded. The Worker must save it and
// answer POST-redirect-GET: a 303 to /contact carrying only the outcome, and
// the page it lands on must show that outcome. Validation and the honeypot
// behave exactly as they do for the JSON fetch().
// ─────────────────────────────────────────────────────────────
describe('tenant-site POST /leads without JavaScript (GP-004)', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'test' };
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  const postForm = (
    fields: Record<string, string>,
    host = 'demo.greenput.com',
  ): Promise<Response> =>
    handler.fetch(
      new Request(`https://${host}/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
        body: new URLSearchParams(fields).toString(),
      }),
      env,
    );

  /** Follow the 303: GET the path it pointed at, on the same host. */
  const follow = (path: string): Promise<Response> =>
    handler.fetch(new Request(`https://demo.greenput.com${path}`), env);

  it('writes the lead and 303s to /contact?sent=1, which renders the sent message', async () => {
    const res = await postForm({
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      phone: '(555) 123-4567',
      serviceType: 'Panel upgrade',
      notes: 'Before the EV charger goes in.',
    });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/contact?sent=1');
    expect(res.headers.get('content-type')).toBeNull();

    const leads = websiteLeads(sqlite);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      workspace_id: DEMO_WORKSPACE,
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'jane@example.com',
      phone: '(555) 123-4567',
      preferred_contact: 'email',
      service_type: 'Panel upgrade',
      notes: 'Before the EV charger goes in.',
      created_by: DEMO_OWNER,
    });
    expect(sqlite.rows<ActivityRow>('activity_log')).toHaveLength(1);

    const landing = await follow(res.headers.get('location') ?? '');
    expect(landing.status).toBe(200);
    expect(landing.headers.get('content-type')).toMatch(/text\/html/);
    const html = await landing.text();
    expect(html).toContain('data-bn-status="success"');
    expect(html).toContain('Thank you! We will be in touch soon.');
    expect(html).toContain('action="/leads"');
  });

  it('303s a rejected submission to /contact with only the reason and field, and the page shows the error', async () => {
    const res = await postForm({ firstName: 'Zebedee', lastName: 'Quill' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      '/contact?error=contact&field=email',
    );
    expect(websiteLeads(sqlite)).toHaveLength(0);

    const html = await (await follow(res.headers.get('location') ?? '')).text();
    expect(html).toContain('data-bn-status="error"');
    expect(html).toMatch(/email address or phone number/);
    expect(html).toMatch(/name="email"[^>]*aria-invalid="true"/);
    // Nothing the visitor typed is in the URL or the page.
    expect(res.headers.get('location')).not.toContain('Zebedee');
    expect(html).not.toContain('Zebedee');
  });

  it.each([
    [{ lastName: 'Smith', phone: '5551234567' }, 'firstName'],
    [{ firstName: 'Jane', phone: '5551234567' }, 'lastName'],
    [{ firstName: 'Jane', lastName: 'Smith', email: 'not-an-email' }, 'email'],
    [{ firstName: 'Jane', lastName: 'Smith', phone: '12345' }, 'phone'],
  ])(
    'names the invalid field in the redirect for %j',
    async (fields, field) => {
      const res = await postForm(fields);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(
        `/contact?error=${field}&field=${field}`,
      );
      expect(websiteLeads(sqlite)).toHaveLength(0);
    },
  );

  it('answers a honeypot hit exactly as a success, without writing a row', async () => {
    const res = await postForm({
      firstName: 'Bot',
      lastName: 'Spam',
      email: 'bot@example.com',
      website: 'https://spam.example',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/contact?sent=1');
    expect(websiteLeads(sqlite)).toHaveLength(0);
    expect(sqlite.rows('activity_log')).toHaveLength(0);
  });

  it('303s to a fixed error key, not a message, when the workspace has no users', async () => {
    sqlite.raw
      .prepare(`INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)`)
      .run('ws-empty', 'Empty Co', 'empty');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await postForm(
      { firstName: 'Jane', lastName: 'Smith', phone: '5551234567' },
      'empty.greenput.com',
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      '/contact?error=WORKSPACE_NOT_READY',
    );
    expect(websiteLeads(sqlite)).toHaveLength(0);
  });

  it('still answers JSON to a JSON request and never redirects it', async () => {
    const res = await handler.fetch(
      new Request('https://demo.greenput.com/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: 'Jane', lastName: 'Smith' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error).toEqual({
      code: 'VALIDATION_ERROR',
      field: 'email',
      message:
        'Please provide an email address or phone number so we can reply.',
    });
  });

  it('renders a plain /contact visit with the message hidden', async () => {
    const html = await (await follow('/contact')).text();
    expect(html).not.toContain('data-bn-status=');
    expect(html).toMatch(/id="form-message"[^>]*hidden/);
  });
});

describe('tenant-site page routing', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'test' };
  });

  afterEach(() => {
    sqlite.close();
  });

  const get = (path: string, host = 'demo.greenput.com'): Promise<Response> =>
    handler.fetch(new Request(`https://${host}${path}`), env);

  it('returns a branded HTML 404 (not a 200 home-page fall-through) for an unknown path', async () => {
    const res = await get('/this-does-not-exist');
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('data-bn="not-found"');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('returns a real HTML document for an unknown workspace, not plain text', async () => {
    const res = await get('/', 'nobody.greenput.com');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('<html lang="en" data-bn-platform="ios">');
    expect(html).toContain('Workspace Not Found');
    // GP-040: there is no workspace to brand this with, so it stays bare —
    // no nav, no links into a site that does not exist.
    expect(html).not.toContain('data-bn="site-nav"');
    expect(html).not.toContain('<a');
  });

  // GP-040. An expired proposal is a reason to talk to the contractor: the
  // 404 is their site, with their number, and a way to home and to contact.
  it('404s an unknown proposal on a page that is still the site', async () => {
    const res = await get('/proposal/11111111-1111-4111-8111-111111111111');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('Proposal Not Found');
    expect(html).toContain('data-bn="bn-button"');
    expect(html).toContain('data-variant="prominent"');
    expect(html).toContain('href="/"');
    expect(html).toContain('>Back to home</a>');
    expect(html).toContain('data-variant="bordered"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('>Get in touch</a>');
    expect(html).toContain('data-bn="bn-rail"');
    expect(html).toContain('data-bn="bn-site-footer"');
    expect(html).toContain('Rivertown Electric');
    expect(html).toContain('href="tel:(512) 555-0142"');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
  });

  it('does not list bluetooth in Permissions-Policy anywhere', async () => {
    const res = await get('/');
    expect(res.headers.get('permissions-policy')).not.toMatch(/bluetooth/);
  });

  it('serves /js/app.js with a submit handler that restores the button on every exit (GP-043)', async () => {
    const res = await get('/js/app.js');
    expect(res.status).toBe(200);
    const js = await res.text();
    // One restore, in a finally: success, honeypot, validation and network
    // failure all leave through it. tenant-script.spec.ts drives each path.
    expect(js).toMatch(
      /finally\s*\{\s*btn\.disabled=false;\s*btn\.textContent=origText;\s*\}/,
    );
  });

  it('serves no scanner and never allows the camera (GP-022)', async () => {
    // The public scanner served a contractor's asset register — serials,
    // location, the assigned employee's name — to anyone holding a label.
    // This Worker has no session, so it has no business reading a device.
    for (const path of [
      '/scanner',
      '/scanner/',
      '/scanner?mode=manual',
      '/scanner/result/gp-asset-anything',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('permissions-policy'), path).toContain(
        'camera=()',
      );
      expect(res.headers.get('permissions-policy'), path).not.toContain(
        'camera=(self)',
      );
    }
    const home = await get('/');
    expect(home.headers.get('permissions-policy')).toContain('camera=()');
  });

  it('noindexes the slugless workers.dev preview landing page', async () => {
    const res = await get('/', 'greenput-tenant.workers.dev');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Tenant Site Preview');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
  });

  it('allows connect-src to Google Fonts and Cloudflare Insights', async () => {
    const res = await get('/');
    expect(res.headers.get('content-security-policy')).toMatch(
      /connect-src 'self' https:\/\/fonts\.googleapis\.com https:\/\/static\.cloudflareinsights\.com/,
    );
  });

  // GP-011 / GP-101: the About page's hours come from workspace_availability
  // and from nowhere else. The demo seed sets no week, so the no-data path is
  // the seeded database as-is.
  it('renders no hours block for a workspace with no availability rows', async () => {
    const html = await (await get('/about')).text();
    expect(html).not.toContain('<section data-bn="hours"');
    expect(html).not.toContain('openingHours');
    expect(html).not.toContain('7:00 AM');
  });

  it('renders the hours block from workspace_availability rows in the database', async () => {
    const week: Array<[number, string | null, string | null, number]> = [
      [0, null, null, 0],
      [1, '07:00', '18:00', 1],
      [2, '07:00', '18:00', 1],
      [3, '07:00', '18:00', 1],
      [4, '07:00', '18:00', 1],
      [5, '07:00', '18:00', 1],
      [6, '08:00', '12:30', 1],
    ];
    for (const [weekday, opens, closes, isOpen] of week) {
      await env.DB.prepare(
        `INSERT INTO workspace_availability (id, workspace_id, weekday, opens_at, closes_at, is_open)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          DEMO_WORKSPACE,
          weekday,
          opens,
          closes,
          isOpen,
        )
        .run();
    }

    const html = await (await get('/about')).text();
    expect(html).toContain('<section data-bn="hours"');
    expect(html).toContain('<dt>Mon</dt><dd>7:00 AM – 6:00 PM</dd>');
    expect(html).toContain('<dt>Sat</dt><dd>8:00 AM – 12:30 PM</dd>');
    expect(html).toContain('<dt>Sun</dt><dd>Closed</dd>');
    expect(html).toContain(
      '"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Monday","opens":"07:00","closes":"18:00"}',
    );
    expect(html).not.toContain('https://schema.org/Sunday');
  });

  describe('?slug= is a preview-only override (GP-023)', () => {
    // Until this, `?slug=` won over the subdomain on every host, so
    // demo.greenput.com/?slug=green-electric served Green Electric's site —
    // and filed the leads it captured into Green Electric's workspace.
    beforeEach(() => {
      sqlite.raw
        .prepare(`INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)`)
        .run('ws-green', 'Green Electric', 'green-electric');
    });

    it('is ignored on a Greenput host — the subdomain wins', async () => {
      const res = await get('/?slug=green-electric');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Rivertown Electric');
      expect(html).not.toContain('Green Electric');
    });

    it('still selects the tenant on a workers.dev preview host', async () => {
      const res = await get(
        '/?slug=green-electric',
        'greenput-tenant.example.workers.dev',
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Green Electric');
      expect(html).not.toContain('Rivertown Electric');
    });

    it('cannot turn a real subdomain into a 404 with an unknown slug', async () => {
      const res = await get('/?slug=does-not-exist');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Rivertown Electric');
    });
  });
});

// GP-008. The invoice a contractor hands a homeowner is this page; the only
// other render sits behind the contractor's own session. The token is the
// authorisation, so every wrong token — unknown, another tenant's, a job that
// is not yet invoiced — is the same 404.
describe('tenant-site GET /invoice/:token', () => {
  const OPP = '00000000-0000-4000-8000-000000000201';
  const CUSTOMER = '00000000-0000-4000-8000-000000000901';
  const JOB = '00000000-0000-4000-8000-000000000a01';
  const TOKEN = '11111111-2222-4333-8444-555555555555';

  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
      sql: [
        `INSERT INTO customers (id, workspace_id, first_name, last_name, email, phone, street, city, state, zip, created_at, updated_at, created_by)
         VALUES ('${CUSTOMER}', '${DEMO_WORKSPACE}', 'Jane', 'Smith', 'jane@example.com', '5035550100', '9 Elm St', 'Portland', 'OR', '97203', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${DEMO_OWNER}')`,
        `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, invoiced_at, invoice_token,
                           scheduled_start, scheduled_end, total, created_at, updated_at, created_by)
         VALUES ('${JOB}', '${DEMO_WORKSPACE}', '${OPP}', '${CUSTOMER}', 'JOB-0900', 'Panel upgrade', 'invoiced', '2027-01-03T00:00:00Z', '${TOKEN}',
                 '2027-01-02T09:00:00Z', '2027-01-02T11:00:00Z', 265213, '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${DEMO_OWNER}')`,
        `INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
         VALUES ('li-1', '${JOB}', '200A panel replacement', 1, 265213, 265213)`,
      ],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'test' };
  });

  afterEach(() => {
    sqlite.close();
  });

  const get = (path: string, host = 'demo.greenput.com'): Promise<Response> =>
    handler.fetch(new Request(`https://${host}${path}`), env);

  it('serves the invoice for the token, uncached and unindexed', async () => {
    const res = await get(`/invoice/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('INVOICE');
    expect(html).toContain('JOB-0900');
    expect(html).toContain('Jane');
    expect(html).toContain('200A panel replacement');
    // Cents, formatted — never the raw column value.
    expect(html).toContain('$2,652.13');
  });

  it('404s a wrong token, a malformed one, and one used on another tenant', async () => {
    const wrong = await get('/invoice/11111111-2222-4333-8444-000000000000');
    expect(wrong.status).toBe(404);
    expect(wrong.headers.get('cache-control')).toBe('no-store');
    const html = await wrong.text();
    expect(html).toContain('Invoice Not Found');
    // GP-040: the 404 is still the contractor's site, with a way out.
    expect(html).toContain('data-bn="bn-rail"');
    expect(html).toContain('data-bn="bn-button"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/"');
    expect(html).toContain('Rivertown Electric');
    expect(html).toContain('href="tel:(512) 555-0142"');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
    expect((await get('/invoice/not-a-token')).status).toBe(404);
    expect((await get(`/invoice/${JOB}`)).status).toBe(404);
    // Another workspace under the same wildcard route: the token is scoped.
    sqlite.raw
      .prepare(
        `INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip)
         VALUES ('ws-other', 'Other Co', 'other', 'electrical', '', '', '', '', '', '')`,
      )
      .run();
    expect((await get(`/invoice/${TOKEN}`, 'other.greenput.com')).status).toBe(
      404,
    );
  });

  it('404s once the job is no longer invoiced or paid', async () => {
    sqlite.raw
      .prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = ?`)
      .run(JOB);
    expect((await get(`/invoice/${TOKEN}`)).status).toBe(404);
    sqlite.raw
      .prepare(
        `UPDATE jobs SET status = 'paid', paid_at = '2027-01-10T00:00:00Z' WHERE id = ?`,
      )
      .run(JOB);
    const paid = await get(`/invoice/${TOKEN}`);
    expect(paid.status).toBe(200);
    expect(await paid.text()).toContain('PAID');
  });
});

describe('tenant-site custom domain resolution', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'test' };
  });

  afterEach(() => {
    sqlite.close();
  });

  const get = (host: string, path = '/'): Promise<Response> =>
    handler.fetch(new Request(`https://${host}${path}`), env);

  const setCustomDomain = (hostname: string | null, status: string): void => {
    sqlite.raw
      .prepare(
        `UPDATE workspaces SET custom_hostname = ?, custom_domain_status = ? WHERE id = ?`,
      )
      .run(hostname, status, DEMO_WORKSPACE);
  };

  it('(a) resolves a workspace by an exact, active custom hostname', async () => {
    setCustomDomain('www.demo-electric.com', 'active');
    const res = await get('www.demo-electric.com');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en" data-bn-platform="ios">');
  });

  it('(b) falls back to the <slug>.greenput.com subdomain when no custom domain is set', async () => {
    const res = await get('demo.greenput.com');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en" data-bn-platform="ios">');
  });

  it('(c) returns the branded 404 for an unknown/foreign host, not a wrong tenant', async () => {
    const res = await get('random-plumbing-co.example.net');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('<html lang="en" data-bn-platform="ios">');
    expect(html).toContain('This site could not be found.');
  });

  it('does not leak a wrong tenant when a foreign host coincidentally shares a workspace slug', async () => {
    // "demo" is the seeded workspace's slug; a foreign domain whose first
    // label happens to be "demo" must NOT resolve to it — only an exact,
    // active custom_hostname match or the real *.greenput.com host does.
    const res = await get('demo.example.net');
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain('Rivertown Electric'); // no tenant leak
  });

  it('does not resolve a custom hostname that is only pending verification', async () => {
    setCustomDomain('www.demo-electric.com', 'pending');
    const res = await get('www.demo-electric.com');
    expect(res.status).toBe(404);
  });

  it('does not resolve a custom hostname after a failed verification', async () => {
    setCustomDomain('www.demo-electric.com', 'failed');
    const res = await get('www.demo-electric.com');
    expect(res.status).toBe(404);
  });

  it('301-redirects subdomain page views to an active custom domain, preserving path and query', async () => {
    setCustomDomain('www.demo-electric.com', 'active');
    const res = await get('demo.greenput.com', '/services?utm_source=x');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://www.demo-electric.com/services?utm_source=x',
    );
  });

  it('does not redirect requests already on the active custom domain', async () => {
    setCustomDomain('www.demo-electric.com', 'active');
    const res = await get('www.demo-electric.com', '/services');
    expect(res.status).toBe(200);
  });

  it('does not redirect a /leads POST even when the custom domain is active', async () => {
    setCustomDomain('www.demo-electric.com', 'active');
    const res = await handler.fetch(
      new Request('https://demo.greenput.com/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '5551234567',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

// The slug a workspace is reachable at is assigned by /api/auth/register, which
// decides what a slug may be from UNAVAILABLE_WORKSPACE_SLUGS — a SUPERSET of
// the RESERVED_SUBDOMAINS this file refuses to resolve, both in
// @greenput/shared/utils precisely so the two cannot drift. A workspace handed
// a subdomain this file refuses would look perfectly healthy in the database and
// have no site at all.
//
// The two lists are not the same list, and the difference is load-bearing:
// `demo` must never be ALLOCATED (it is Greenput's showcase tenant) and must
// always RESOLVE (it is the one tenant hostname bound in wrangler.toml). Adding
// it to the set below would 404 the only micro-site that resolves today.
describe('tenant-site reserved subdomains', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'test' };
  });

  afterEach(() => sqlite.close());

  // A reserved hostname must never serve a tenant, whatever a workspace row
  // claims. Since this Worker took the `*.greenput.com/*` wildcard there are
  // two correct ways to honour that: 404, or hand the request to the service
  // that really owns the hostname. `app` is the second kind — it is the
  // sign-in door, and a 404 there is an outage — so it is asserted separately
  // below rather than loosened here.
  const RESERVED_404 = [...RESERVED_SUBDOMAINS].filter((r) => r !== 'app');

  it.each(RESERVED_404)(
    'refuses to resolve a tenant at %s.greenput.com even when a workspace claims it',
    async (reserved) => {
      sqlite.raw.exec(
        `UPDATE workspaces SET slug = '${reserved}' WHERE slug = 'demo'`,
      );
      const res = await handler.fetch(
        new Request(`https://${reserved}.greenput.com/`),
        env,
      );
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).not.toContain('Rivertown Electric');
    },
  );

  describe('app.greenput.com, which the wildcard route also matches', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('hands the request to the Pages project instead of answering 404', async () => {
      sqlite.raw.exec(`UPDATE workspaces SET slug = 'app' WHERE slug = 'demo'`);
      const seen: string[] = [];
      vi.stubGlobal('fetch', (input: Request | string) => {
        seen.push(typeof input === 'string' ? input : input.url);
        return Promise.resolve(new Response('the platform app'));
      });

      const res = await handler.fetch(
        new Request('https://app.greenput.com/dashboard'),
        env,
      );

      // Never the tenant site — that is the whole point of the reserved list.
      const body = await res.text();
      expect(body).not.toContain('Rivertown Electric');
      expect(body).toBe('the platform app');
      // …and never a 404 at the only door anyone signs in through.
      expect(res.status).toBe(200);
      expect(seen).toEqual(['https://greenput-app.pages.dev/dashboard']);
    });

    it('keeps the path and query when it proxies', async () => {
      const seen: string[] = [];
      vi.stubGlobal('fetch', (input: Request | string) => {
        seen.push(typeof input === 'string' ? input : input.url);
        return Promise.resolve(new Response('ok'));
      });

      await handler.fetch(
        new Request('https://app.greenput.com/leads?status=new'),
        env,
      );

      expect(seen).toEqual(['https://greenput-app.pages.dev/leads?status=new']);
    });
  });

  it('still resolves demo.greenput.com, which allocation refuses to hand out', async () => {
    // `demo` is in UNAVAILABLE_WORKSPACE_SLUGS and deliberately NOT in
    // RESERVED_SUBDOMAINS. If it ever joins the set above, this fails — which is
    // the point: it is Greenput's showcase site, seeded into production by CI and
    // the only tenant hostname apps/tenant-site/wrangler.toml binds.
    expect(RESERVED_SUBDOMAINS.has('demo')).toBe(false);
    const res = await handler.fetch(
      new Request('https://demo.greenput.com/'),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Rivertown Electric');
  });

  it('resolves a slug of the shape /register hands out', async () => {
    // `acme-electric` is a bare slug and `acme-electric-3f8a2c` a collision
    // suffix. Neither is special to this Worker, which is the point — it is the
    // same subdomain lookup either way.
    for (const slug of ['acme-electric', 'acme-electric-3f8a2c']) {
      sqlite.raw.exec(`UPDATE workspaces SET slug = '${slug}'`);
      const res = await handler.fetch(
        new Request(`https://${slug}.greenput.com/`),
        env,
      );
      expect(res.status, slug).toBe(200);
      expect(await res.text()).toContain('Rivertown Electric');
    }
  });
});
