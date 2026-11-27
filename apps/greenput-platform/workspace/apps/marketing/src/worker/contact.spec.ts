import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import handler from './index.js';
import { CONTACT_SAVE_FAILED_MESSAGE } from './contact.js';
import type { Env } from './env.js';

const ROOT = resolve(__dirname, '../../../..');
const HOUSE_WORKSPACE = 'ws-greenput';
const HOUSE_OWNER = 'u-greenput-owner';

const HOUSE_SEED = `
  INSERT INTO workspaces (id, name, slug, trade, phone, email)
  VALUES ('${HOUSE_WORKSPACE}', 'Greenput', 'duganlabs', 'electrical', '', 'hello@greenput.com');
  INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
  VALUES ('${HOUSE_OWNER}', '${HOUSE_WORKSPACE}', 'Warren', 'Dugan', 'owner@greenput.com', 'owner', '');
`;

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

interface SubmissionRow {
  lead_id: string;
  form_data: string;
  source_url: string | null;
  ip_address: string | null;
  processed: number;
}

interface ActivityRow {
  user_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  meta: string | null;
}

interface NotificationRow {
  channel: string;
  event_type: string;
  recipient: string;
  status: string;
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
  contactEmail?: string;
}

function makeCtx(): { ctx: ExecutionContext; settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return {
    ctx,
    settle: async () => {
      await Promise.all(pending);
    },
  };
}

const VALID_FORM = {
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@smith-electric.example',
  company: 'Smith Electrical',
  trade: 'Electrician',
  message: 'We run 3 crews and want to see the scheduling.',
};

function formRequest(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return new Request('https://greenput.com/contact', {
    method: 'POST',
    body,
    headers,
  });
}

/** What a browser sends when the form is submitted with no JavaScript. */
const BROWSER_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

function browserFormRequest(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://greenput.com/contact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: BROWSER_ACCEPT,
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('marketing POST /contact', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [HOUSE_SEED],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'test' };
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('persists a submission as a website lead and notifies the workspace', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { ctx, settle } = makeCtx();

    const res = await handler.fetch(
      formRequest(VALID_FORM, {
        referer: 'https://greenput.com/contact',
        'cf-connecting-ip': '203.0.113.7',
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const leads = sqlite.rows<LeadRow>('leads');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      workspace_id: HOUSE_WORKSPACE,
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'jane@smith-electric.example',
      phone: '',
      preferred_contact: 'email',
      status: 'new',
      source: 'website',
      service_type: 'Electrician',
      created_by: HOUSE_OWNER,
    });
    expect(leads[0].notes).toContain('Company: Smith Electrical');
    expect(leads[0].notes).toContain(VALID_FORM.message);

    const [submission] = sqlite.rows<SubmissionRow>('form_submissions');
    expect(submission).toMatchObject({
      lead_id: leads[0].id,
      source_url: 'https://greenput.com/contact',
      ip_address: '203.0.113.7',
      processed: 1,
    });
    expect(JSON.parse(submission.form_data)).toEqual(VALID_FORM);

    const [activity] = sqlite.rows<ActivityRow>('activity_log');
    expect(activity).toMatchObject({
      user_id: HOUSE_OWNER,
      entity_type: 'lead',
      entity_id: leads[0].id,
      action: 'created',
    });
    expect(JSON.parse(activity.meta ?? '{}')).toMatchObject({
      source: 'marketing_site',
    });

    // Notification runs after the response via ctx.waitUntil.
    await settle();
    const [notification] = sqlite.rows<NotificationRow>('notification_log');
    expect(notification).toMatchObject({
      channel: 'email',
      event_type: 'new_lead',
      recipient: 'owner@greenput.com',
      status: 'sent',
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Subject: New lead: Jane Smith'),
    );
  });

  it.each([
    [{ ...VALID_FORM, email: 'not-an-email' }, 'email'],
    [{ ...VALID_FORM, firstName: '   ' }, 'firstName'],
    [{ ...VALID_FORM, lastName: '' }, 'lastName'],
    [{ ...VALID_FORM, message: '' }, 'message'],
  ])('rejects %j with a field-specific 400', async (fields, field) => {
    const { ctx } = makeCtx();
    const res = await handler.fetch(formRequest(fields), env, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.field).toBe(field);
    expect(sqlite.rows('leads')).toHaveLength(0);
  });

  /* GP-005. The Worker's default slug named a workspace that existed in no
     database, so every real submission was the 500 below. The seed file is
     now part of the contract: a fresh schema plus that file plus the
     Worker's OWN default must land a lead. If the default slug and the seed
     ever disagree again, this is the test that says so. */
  it('lands a lead on a fresh database seeded only with scripts/seed/duganlabs-workspace.sql', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fresh = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/seed/duganlabs-workspace.sql'),
      ],
    });
    try {
      const { ctx, settle } = makeCtx();
      const res = await handler.fetch(
        formRequest(VALID_FORM),
        { DB: fresh.db, ENVIRONMENT: 'test' }, // no CONTACT_WORKSPACE_SLUG: the default must resolve
        ctx,
      );
      expect(res.status).toBe(200);
      await settle();
      const leads = fresh.rows<LeadRow>('leads');
      expect(leads).toHaveLength(1);
      expect(leads[0]).toMatchObject({
        workspace_id: '00000000-0000-4000-8000-00000000d0a1',
        source: 'website',
        email: VALID_FORM.email,
      });
      // The seed is re-runnable against a database that already has it.
      for (const stmt of readFileSync(
        resolve(ROOT, 'scripts/seed/duganlabs-workspace.sql'),
        'utf8',
      )
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean)) {
        await fresh.db.prepare(stmt).run();
      }
      expect(fresh.rows('workspaces')).toHaveLength(1);
      expect(fresh.rows('users')).toHaveLength(1);
    } finally {
      fresh.close();
    }
  });

  it('returns 400 when the body is not a form', async () => {
    const { ctx } = makeCtx();
    const res = await handler.fetch(
      new Request('https://greenput.com/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"firstName":"Jane"}',
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('swallows honeypot submissions without writing anything', async () => {
    const { ctx, settle } = makeCtx();
    const res = await handler.fetch(
      formRequest({ ...VALID_FORM, website: 'https://spam.example' }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    await settle();
    expect(sqlite.rows('leads')).toHaveLength(0);
    expect(sqlite.rows('form_submissions')).toHaveLength(0);
    expect(sqlite.rows('notification_log')).toHaveLength(0);
  });

  it('shows an honest error when the house workspace is missing', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { ctx } = makeCtx();

    const res = await handler.fetch(
      formRequest(VALID_FORM),
      { ...env, CONTACT_WORKSPACE_SLUG: 'does-not-exist' },
      ctx,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe(CONTACT_SAVE_FAILED_MESSAGE);
    expect(body.error.message).not.toContain('@');
    expect(body.contactEmail).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'marketing contact submission failed',
      expect.objectContaining({
        code: 'WORKSPACE_MISSING',
        error: expect.stringContaining('does-not-exist'),
      }),
    );
    const loggedPayload = errorSpy.mock.calls[0]?.[1];
    expect(loggedPayload).not.toHaveProperty('email');
    expect(JSON.stringify(loggedPayload)).not.toContain(VALID_FORM.email);
    expect(sqlite.rows('leads')).toHaveLength(0);
  });

  it('fails honestly when the workspace has no users to attribute the lead to', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sqlite.raw.prepare('DELETE FROM users').run();
    const { ctx } = makeCtx();

    const res = await handler.fetch(formRequest(VALID_FORM), env, ctx);

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('INTERNAL');
    expect(sqlite.rows('leads')).toHaveLength(0);
  });

  it('still reports success when only the audit rows fail after the lead is written', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { ctx, settle } = makeCtx();
    const flaky: Env = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          if (/INSERT INTO form_submissions/.test(sql)) {
            return {
              bind: () => ({
                run: () =>
                  Promise.reject(new Error('D1_ERROR: table is locked')),
              }),
            } as unknown as D1PreparedStatement;
          }
          return sqlite.db.prepare(sql);
        },
      } as unknown as D1Database,
    };

    const res = await handler.fetch(formRequest(VALID_FORM), flaky, ctx);
    await settle();

    expect(res.status).toBe(200);
    expect(sqlite.rows('leads')).toHaveLength(1);
    expect(sqlite.rows('form_submissions')).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      'marketing contact audit rows failed',
      expect.objectContaining({ error: 'D1_ERROR: table is locked' }),
    );
  });

  it('still reports success when the notification fails after the lead is written', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { ctx, settle } = makeCtx();
    const flaky: Env = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          if (/notification_preferences/.test(sql)) {
            return {
              bind: () => ({
                all: () =>
                  Promise.reject(
                    new Error('D1_ERROR: notification lookup down'),
                  ),
              }),
            } as unknown as D1PreparedStatement;
          }
          return sqlite.db.prepare(sql);
        },
      } as unknown as D1Database,
    };

    const res = await handler.fetch(formRequest(VALID_FORM), flaky, ctx);
    await settle();

    expect(res.status).toBe(200);
    expect(sqlite.rows('leads')).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'marketing contact notification failed',
      expect.objectContaining({ error: 'D1_ERROR: notification lookup down' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// GP-004 — a form submitted without JavaScript is a form-encoded POST with a
// browser Accept header. It must get the page back (never a JSON body shown
// as text), with the same validation and honeypot behaviour as the fetch path.
// ─────────────────────────────────────────────────────────────
describe('marketing POST /contact without JavaScript (GP-004)', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [HOUSE_SEED],
    });
    env = { DB: sqlite.db, ENVIRONMENT: 'test' };
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('saves the lead and answers the rendered page in its submitted state', async () => {
    const { ctx, settle } = makeCtx();
    const res = await handler.fetch(browserFormRequest(VALID_FORM), env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('Message sent!');
    expect(html).toContain('data-bn="bn-note" role="status"');
    expect(html).not.toContain('id="contact-form"');
    // The full layout, with its nonced JSON-LD matching the CSP.
    const nonce = html.match(
      /<script type="application\/ld\+json" nonce="([0-9a-f]+)">/,
    )?.[1];
    expect(nonce).toBeTruthy();
    expect(res.headers.get('content-security-policy')).toContain(
      `'nonce-${nonce}'`,
    );

    const leads = sqlite.rows<LeadRow>('leads');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      workspace_id: HOUSE_WORKSPACE,
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'jane@smith-electric.example',
      source: 'website',
    });
    await settle();
    expect(sqlite.rows('notification_log')).toHaveLength(1);
  });

  it('answers a rejected submission as 422 HTML with the error, the field marked and the values echoed', async () => {
    const { ctx } = makeCtx();
    const res = await handler.fetch(
      browserFormRequest({ ...VALID_FORM, email: 'not-an-email' }),
      env,
      ctx,
    );

    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('data-bn="bn-note" role="alert"');
    expect(html).toContain('Please enter a valid email address.');
    expect(html).not.toContain('Message sent!');
    // The visitor does not retype everything.
    expect(html).toContain('name="firstName"');
    expect(html).toContain('value="Jane"');
    expect(html).toContain('value="Smith"');
    expect(html).toContain('value="not-an-email"');
    expect(html).toContain('value="Smith Electrical"');
    expect(html).toContain('<option value="Electrician" selected="true">');
    expect(html).toContain(`>${VALID_FORM.message}</textarea>`);
    // Only the offending input is flagged.
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
    expect(html).toMatch(/name="email"[^>]*aria-invalid="true"/);
    expect(sqlite.rows('leads')).toHaveLength(0);
  });

  it('escapes the echoed values and never echoes the honeypot', async () => {
    const { ctx } = makeCtx();
    const res = await handler.fetch(
      browserFormRequest({
        ...VALID_FORM,
        firstName: '"><script>alert(1)</script>',
        message: '<b>bold</b>',
        email: 'nope',
      }),
      env,
      ctx,
    );
    const html = await res.text();
    expect(res.status).toBe(422);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('answers a honeypot hit exactly as a success, without writing anything', async () => {
    const { ctx, settle } = makeCtx();
    const res = await handler.fetch(
      browserFormRequest({ ...VALID_FORM, website: 'https://spam.example' }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('Message sent!');
    await settle();
    expect(sqlite.rows('leads')).toHaveLength(0);
    expect(sqlite.rows('form_submissions')).toHaveLength(0);
    expect(sqlite.rows('notification_log')).toHaveLength(0);
  });

  it('answers a save failure as 500 HTML, keeping the values', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { ctx } = makeCtx();
    const res = await handler.fetch(
      browserFormRequest(VALID_FORM),
      { ...env, CONTACT_WORKSPACE_SLUG: 'does-not-exist' },
      ctx,
    );
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain(CONTACT_SAVE_FAILED_MESSAGE);
    expect(html).not.toContain('hello@greenput.com');
    expect(html).toContain('value="Jane"');
    expect(html).not.toContain('Message sent!');
    expect(sqlite.rows('leads')).toHaveLength(0);
  });

  it('answers 400 HTML, not JSON, when a browser posts an unreadable body', async () => {
    const { ctx } = makeCtx();
    const res = await handler.fetch(
      new Request('https://greenput.com/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Accept: BROWSER_ACCEPT },
        body: 'not a form',
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('Please check the form and try again.');
  });

  it("still answers JSON to the page's own fetch(), which says so explicitly", async () => {
    const { ctx } = makeCtx();
    // The site's app.js sends both; either alone is enough.
    for (const headers of [
      { 'X-Requested-With': 'fetch' },
      { Accept: 'application/json, text/html' },
    ]) {
      const res = await handler.fetch(
        browserFormRequest({ ...VALID_FORM, email: 'nope' }, headers),
        env,
        ctx,
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.field).toBe('email');
    }
  });
});
