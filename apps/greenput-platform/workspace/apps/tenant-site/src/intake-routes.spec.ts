import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
// By relative path, not the `@greenput/shared/pricing` alias: the seed loader
// reads `seeds/pricing/` with `node:fs` and is kept out of the barrel.
import {
  loadFlattenedSeed,
  readFixture,
} from '../../../libs/shared/pricing/src/seed-loader';
import { resolvePhotoReview, type D1Like } from '@greenput/shared/pricing';
import { handleQuoteRequest, isQuotePath } from './intake-routes';
import type { Env } from './env';
import type { WorkspaceData } from './render';

const REPO = resolve(__dirname, '..', '..', '..');
const SCHEMA = join(REPO, 'schema.sql');
const SEED_DIR = join(REPO, 'seeds', 'pricing');

const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const found = machines.find((m) => m.slug === 'ev-charger-install');
if (!found) throw new Error('the EV machine is missing from seeds/pricing');
const ev = found;
const fixture = readFixture(join(SEED_DIR, 'fixtures', '01-ev-typical.json'));
const troubleshooting = machines.find(
  (m) => m.slug === 'troubleshooting-callout',
);
if (!troubleshooting)
  throw new Error('the troubleshooting machine is missing from seeds/pricing');

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

const workspace: WorkspaceData = {
  id: 'ws1',
  name: 'Rivertown Electric',
  slug: 'rivertown',
  trade: 'electrical',
  phone: '512-555-0134',
  email: 'hello@rivertown.example',
  logo_url: null,
  street: '1 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78704',
};

/** An R2-shaped bucket that keeps what it is given, so uploads can be asserted. */
function fakeBucket() {
  const objects = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    objects,
    put: async (
      key: string,
      body: Uint8Array,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      objects.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType,
      });
      return { key };
    },
    get: async () => null,
    delete: async () => undefined,
    head: async () => null,
  };
}

let sqlite: SqliteD1;
let env: Env;

function build(options: { photos?: boolean } = {}): Env {
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      // The photo surface ships dark: no row at all is "off", which is the
      // state every other test in this file runs in.
      ...(options.photos
        ? [
            `INSERT INTO feature_flags (name, config_json) VALUES ('intake_panel_photo', '{"enabled":true}');`,
          ]
        : []),
      // A card on file (a Stripe customer) — self-booking requires one.
      `INSERT INTO workspaces (id, name, slug, stripe_customer_id) VALUES ('ws1', 'Rivertown Electric', 'rivertown', 'cus_rivertown');`,
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws2', 'Someone Else', 'other');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u1', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Greenput default');`,
      `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
         VALUES ('rcv', 'rc', 1, ${q(JSON.stringify(rateCard))}, 'published');`,
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, description, current_version_id)
         VALUES ('fsm', NULL, 'ev-charger-install', 'ev_charger', 'Level 2 EV charger install', 'Nine questions.', 'fsmv');`,
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
         VALUES ('fsmv', 'fsm', 1, ${q(JSON.stringify(ev))}, 'published');`,
      // The urgent path lives in the troubleshooting machine.
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, description, current_version_id)
         VALUES ('fsm-ts', NULL, 'troubleshooting-callout', 'troubleshooting', ${q(troubleshooting.name)}, '', 'fsmv-ts');`,
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
         VALUES ('fsmv-ts', 'fsm-ts', 1, ${q(JSON.stringify(troubleshooting))}, 'published');`,
    ],
  });
  return {
    DB: sqlite.db,
    ENVIRONMENT: 'test',
    ...(options.photos
      ? { INTAKE_PHOTOS: fakeBucket() as unknown as R2Bucket }
      : {}),
  };
}

const get = (path: string) =>
  new Request(`https://rivertown.greenput.com${path}`);

const post = (path: string, body: FormData) =>
  new Request(`https://rivertown.greenput.com${path}`, {
    method: 'POST',
    body,
  });

const form = (entries: Record<string, string | string[]>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  }
  return fd;
};

/** Start a session and return its id. */
async function start(): Promise<string> {
  const res = await handleQuoteRequest(
    post('/quote/start', form({ flow: 'ev-charger-install' })),
    env,
    workspace,
  );
  if (res.kind !== 'redirect') throw new Error('expected a redirect');
  return res.location.replace('/quote/s/', '');
}

/** The screen html a session is currently showing. */
async function currentHtml(id: string): Promise<string> {
  const res = await handleQuoteRequest(get(`/quote/s/${id}`), env, workspace);
  if (res.kind !== 'html') throw new Error(`expected html, got ${res.kind}`);
  return res.html;
}

/**
 * Answer whatever screen the form is on, using the fixture's answers. With
 * `photo`, the panel-photo screen gets a real upload instead of a skip.
 */
async function answerCurrent(
  id: string,
  options: { photo?: boolean } = {},
): Promise<boolean> {
  const html = await currentHtml(id);
  const stateId = /name="stateId" value="([^"]+)"/.exec(html)?.[1];
  if (!stateId) return false; // no form left: this is the finished quote

  const fd = form({ stateId, ...fieldsFor(stateId) });
  if (options.photo && stateId.endsWith('panel_photo')) {
    fd.delete('skip');
    fd.set('panel_photo__status', 'unreviewed');
    fd.append(
      'panel_photo',
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'panel.jpg', {
        type: 'image/jpeg',
      }),
    );
  }
  const res = await handleQuoteRequest(
    post(`/quote/s/${id}`, fd),
    env,
    workspace,
  );
  expect(res.kind, `${stateId}: ${JSON.stringify(res)}`).toBe('redirect');
  return true;
}

/** The form values a screen would have been submitted with. */
function fieldsFor(stateId: string): Record<string, string | string[]> {
  const state = ev.states.find((s) => s.id === stateId);
  if (!state?.answer) throw new Error(`no screen "${stateId}"`);
  const spec = state.answer;
  const keys =
    spec.type === 'group'
      ? (spec.fields ?? []).map((f) => f.key)
      : [spec.key as string];

  const out: Record<string, string | string[]> = {};
  for (const key of keys) {
    const value = fixture.answers[key];
    if (spec.type === 'photo') {
      out['skip'] = '1';
    } else if (Array.isArray(value)) {
      out[key] = value.map(String);
    } else if (value && typeof value === 'object' && 'estimated' in value) {
      out[`${key}__estimate`] = String((value as { value: number }).value);
    } else if (value !== undefined && value !== null) {
      out[key] = String(value);
    }
  }
  return out;
}

beforeEach(() => {
  env = build();
});
afterEach(() => sqlite.close());

describe('isQuotePath', () => {
  it('claims /quote and everything under it, and nothing else', () => {
    expect(isQuotePath('/quote')).toBe(true);
    expect(isQuotePath('/quote/')).toBe(true);
    expect(isQuotePath('/quote/start')).toBe(true);
    expect(isQuotePath('/quote/s/abc')).toBe(true);
    expect(isQuotePath('/quotes')).toBe(false);
    expect(isQuotePath('/contact')).toBe(false);
  });
});

describe('GET /quote', () => {
  it('lists the flows this tenant can price', async () => {
    const res = await handleQuoteRequest(get('/quote'), env, workspace);
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(200);
    expect(res.html).toContain('Level 2 EV charger install');
    expect(res.html).toContain('action="/quote/start"');
  });

  it('?flow=<slug> deep-links to that one flow, a single Start that POSTs, and writes nothing', async () => {
    const res = await handleQuoteRequest(
      get('/quote?flow=ev-charger-install'),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(200);
    expect(res.html).toContain('Level 2 EV charger install');
    expect(res.html).not.toContain(troubleshooting.name);
    expect(res.html.match(/action="\/quote\/start"/g)).toHaveLength(1);
    expect(res.html).toContain('name="flow" value="ev-charger-install"');
    expect(res.html).toContain('<a href="/quote">See every instant price</a>');
    // A GET is a link a crawler or a link preview may follow: no session.
    expect(sqlite.rows('pricing_quote_sessions')).toHaveLength(0);
  });

  it('?flow= with a slug this tenant does not publish falls back to the full list', async () => {
    const res = await handleQuoteRequest(
      get('/quote?flow=nope'),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(200);
    expect(res.html).toContain('Level 2 EV charger install');
    expect(res.html).toContain(troubleshooting.name);
    expect(res.html).not.toContain('See every instant price');
    expect(sqlite.rows('pricing_quote_sessions')).toHaveLength(0);
  });
});

describe('POST /quote/start', () => {
  it('creates a session pinned to the published versions, and redirects to it', async () => {
    const res = await handleQuoteRequest(
      post('/quote/start', form({ flow: 'ev-charger-install' })),
      env,
      workspace,
    );
    expect(res.kind).toBe('redirect');
    if (res.kind !== 'redirect') return;
    expect(res.location).toMatch(/^\/quote\/s\/[0-9a-f-]{36}$/);

    const rows = sqlite.rows<Record<string, unknown>>('pricing_quote_sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0]['workspace_id']).toBe('ws1');
    expect(rows[0]['fsm_version_id']).toBe('fsmv');
    expect(rows[0]['rate_card_version_id']).toBe('rcv');
  });

  it('404s on a flow this tenant does not publish, on a page that is still the site (GP-040)', async () => {
    const res = await handleQuoteRequest(
      post('/quote/start', form({ flow: 'nope' })),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(404);
    expect(res.html).toContain('href="/quote"');
    expect(res.html).toContain('data-bn="bn-rail"');
  });
});

describe('GET and POST /quote/s/:id', () => {
  it('shows the first screen, then the next one after it is answered', async () => {
    const id = await start();
    expect(await currentHtml(id)).toContain('Where do you want the charger?');

    const res = await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({
          stateId: 'charger_location',
          charger_location: 'attached_garage_inside',
        }),
      ),
      env,
      workspace,
    );
    expect(res.kind).toBe('redirect');
    expect(await currentHtml(id)).toContain(
      'How fast do you want it to charge?',
    );
  });

  it('re-renders the screen with the message when an answer will not do', async () => {
    const id = await start();
    const res = await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({ stateId: 'charger_location', charger_location: 'in_the_pool' }),
      ),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(422);
    expect(res.html).toContain('Where do you want the charger?');
    expect(res.html).toContain('Please choose one of the options.');
    // Nothing was recorded for a rejected answer.
    expect(sqlite.rows('pricing_quote_events')).toHaveLength(0);
  });

  it('sends a stale tab back to the screen the form is actually on', async () => {
    const id = await start();
    await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({
          stateId: 'charger_location',
          charger_location: 'attached_garage_inside',
        }),
      ),
      env,
      workspace,
    );
    const stale = await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({
          stateId: 'charger_location',
          charger_location: 'detached_garage',
        }),
      ),
      env,
      workspace,
    );
    expect(stale.kind).toBe('redirect');
    // The first answer stands.
    const session = sqlite.rows<Record<string, unknown>>(
      'pricing_quote_sessions',
    )[0];
    expect(JSON.parse(String(session['answers']))['charger_location']).toBe(
      'attached_garage_inside',
    );
    expect(sqlite.rows('pricing_quote_events')).toHaveLength(1);
  });

  it("reads another tenant's session as absent", async () => {
    const id = await start();
    const res = await handleQuoteRequest(get(`/quote/s/${id}`), env, {
      ...workspace,
      id: 'ws2',
      slug: 'other',
    });
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(404);
  });

  it('404s on a session id that was never issued', async () => {
    const res = await handleQuoteRequest(
      get('/quote/s/11111111-1111-4111-8111-111111111111'),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(404);
  });

  // GP-040. The message names the quote page; the page now links it, and is
  // still the contractor's site rather than a dark dead end.
  it('links the quote page it names, with the nav and the phone, unindexed', async () => {
    const res = await handleQuoteRequest(
      get('/quote/s/11111111-1111-4111-8111-111111111111'),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.html).toContain('You can start a new one from the quote page.');
    expect(res.html).toContain('data-bn="bn-button"');
    expect(res.html).toContain('data-variant="prominent"');
    expect(res.html).toContain('href="/quote"');
    expect(res.html).toContain('>Start a new quote</a>');
    expect(res.html).toContain('data-variant="bordered"');
    expect(res.html).toContain('href="/"');
    expect(res.html).toContain('>Back to home</a>');
    expect(res.html).toContain('data-bn="bn-rail"');
    expect(res.html).toContain('data-bn="bn-site-footer"');
    expect(res.html).toContain('Rivertown Electric');
    expect(res.html).toContain('href="tel:512-555-0134"');
    expect(res.html).toMatch(
      /<meta name="robots" content="noindex, nofollow">/,
    );
  });

  it.each(['book', 'booked', 'reschedule', 'cancel'])(
    'the /%s route of an unknown session is the same shell (GP-103/105)',
    async (action) => {
      const res = await handleQuoteRequest(
        get(`/quote/s/11111111-1111-4111-8111-111111111111/${action}`),
        env,
        workspace,
      );
      expect(res.kind).toBe('html');
      if (res.kind !== 'html') return;
      expect(res.status).toBe(404);
      expect(res.html).toContain('href="/quote"');
      expect(res.html).toContain('data-bn="bn-rail"');
    },
  );

  it('claims nothing for a path that is not one of ours', async () => {
    expect(
      (await handleQuoteRequest(get('/quote/s/not-a-uuid'), env, workspace))
        .kind,
    ).toBe('none');
  });
});

describe('the whole form, through the tenant site', () => {
  it('ends on the range the frozen fixture records, and leaves a lead behind', async () => {
    const id = await start();
    for (let i = 0; i < 40; i++) {
      if (!(await answerCurrent(id))) break;
    }

    const html = await currentHtml(id);
    // This run skipped the panel photo, and the design says a machine that
    // cannot see the panel must land on a SPANNING outcome rather than pretend
    // to a single number: low is the best case, high is the subpanel case.
    expect(html).toContain('data-bn="quote-range"');
    expect(html).toContain('Range — narrows once we see your panel');
    expect(html).toMatch(/\$\d/);

    // Both ends of the span, named the way their own terminals name them.
    // `T_subpanel_required` is a thing to say to an engineer, not to someone
    // working out whether they can afford their garage.
    expect(html).toContain('A new charger circuit from your existing panel');
    expect(html).toContain('A small extra panel, then your charger');
    expect(html).not.toContain('T_standard_install');
    expect(html).not.toContain('T_subpanel_required');

    // And the terminal's own words about what to do next.
    expect(html).toContain('cut this range in half');

    const session = sqlite.rows<Record<string, unknown>>(
      'pricing_quote_sessions',
    )[0];
    expect(session['status']).toBe('completed');
    expect(session['terminal_id']).toBeTruthy();
    // A span is not a price: the lead waits on the review that narrows it.
    expect(session['terminal_id']).toBe('T_needs_panel_review');

    const leads = sqlite.rows<Record<string, unknown>>('leads');
    expect(leads).toHaveLength(1);
    expect(leads[0]['first_name']).toBe('Dana');
    expect(leads[0]['service_type']).toBe('ev_charger');
    expect(session['lead_id']).toBe(leads[0]['id']);
    expect(leads[0]['status']).toBe('new');
    expect(leads[0]['qualified_at']).toBeNull();

    // Every screen answered is in the log, in order.
    const events = sqlite.rows<Record<string, unknown>>('pricing_quote_events');
    expect(events.length).toBeGreaterThan(8);
    expect(events.map((e) => e['seq'])).toEqual(events.map((_, i) => i + 1));
  });

  it('reaching the end twice does not produce a second lead', async () => {
    const id = await start();
    for (let i = 0; i < 40; i++) {
      if (!(await answerCurrent(id))) break;
    }
    const again = await handleQuoteRequest(
      post(`/quote/s/${id}`, form({ stateId: 'anything' })),
      env,
      workspace,
    );
    expect(again.kind).toBe('redirect');
    expect(sqlite.rows('leads')).toHaveLength(1);
  });
});

describe('the panel photo', () => {
  async function advanceToPhoto(): Promise<string> {
    const id = await start();
    for (const [stateId, fields] of [
      ['charger_location', { charger_location: 'attached_garage_inside' }],
      ['charge_speed', { charge_speed: '32a' }],
      ['charger_supply', { charger_supply: 'have_it' }],
      ['charger_connection', { charger_connection: 'hardwired' }],
      ['panel_check__include__panel_location', { panel_location: 'garage' }],
    ] as Array<[string, Record<string, string>]>) {
      const res = await handleQuoteRequest(
        post(`/quote/s/${id}`, form({ stateId, ...fields })),
        env,
        workspace,
      );
      expect(res.kind, stateId).toBe('redirect');
    }
    expect(await currentHtml(id)).toContain('a photo of your panel');
    return id;
  }

  it('stores what was uploaded and records it as unreviewed', async () => {
    env = build({ photos: true });
    const bucket = env.INTAKE_PHOTOS as unknown as ReturnType<
      typeof fakeBucket
    >;
    const id = await advanceToPhoto();

    const fd = new FormData();
    fd.append('stateId', 'panel_check__include__panel_photo');
    fd.append('panel_photo__status', 'unreviewed');
    fd.append(
      'panel_photo',
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'panel.jpg', {
        type: 'image/jpeg',
      }),
    );
    const res = await handleQuoteRequest(
      post(`/quote/s/${id}`, fd),
      env,
      workspace,
    );
    expect(res.kind).toBe('redirect');

    expect(bucket.objects.size).toBe(1);
    const [key, object] = [...bucket.objects.entries()][0];
    // Keyed by workspace and session, so an object's provenance is readable
    // from its name alone.
    expect(key).toMatch(/^ws1\/quote-session\/[0-9a-f-]{36}\/.*panel\.jpg$/);
    expect(object.contentType).toBe('image/jpeg');
    // The bytes survive intact — nothing round-trips them through UTF-8.
    expect([...object.body]).toEqual([0xff, 0xd8, 0xff, 0xe0]);

    // The file is a real `files` row, so it is reachable, attributable and
    // deletable like every other upload in the product.
    const file = sqlite.rows<Record<string, unknown>>('files')[0];
    expect(file['entity_type']).toBe('pricing_quote_session');
    expect(file['entity_id']).toBe(id);
    expect(file['uploaded_by']).toBe('u1');
    expect(file['content_type']).toBe('image/jpeg');

    // And a review is open, unresolved, asserting nothing about the panel.
    const review = sqlite.rows<Record<string, unknown>>(
      'pricing_photo_reviews',
    )[0];
    expect(review['answer_key']).toBe('panel_photo');
    expect(review['status']).toBe('unreviewed');
    expect(review['method']).toBe('unresolved');
    expect(review['fields_json']).toBe('{}');
    expect(review['reviewed_at']).toBeNull();

    // The session records presence only: the verdict lives server-side.
    const session = sqlite.rows<Record<string, unknown>>(
      'pricing_quote_sessions',
    )[0];
    const answers = JSON.parse(String(session['answers']));
    expect(answers.panel_photo).toEqual({ status: 'unreviewed', fields: {} });
  });

  it('offers no upload, and stores nothing, while the flag is off', async () => {
    env = build();
    const id = await advanceToPhoto();
    expect(await currentHtml(id)).not.toContain('type="file"');

    const fd = new FormData();
    fd.append('stateId', 'panel_check__include__panel_photo');
    fd.append(
      'panel_photo',
      new File([new Uint8Array([0xff, 0xd8])], 'panel.jpg', {
        type: 'image/jpeg',
      }),
    );
    const res = await handleQuoteRequest(
      post(`/quote/s/${id}`, fd),
      env,
      workspace,
    );
    expect(res.kind).toBe('redirect');
    // Dark means nothing is written anywhere, and the form still moves on.
    expect(sqlite.rows('files')).toHaveLength(0);
    expect(sqlite.rows('pricing_photo_reviews')).toHaveLength(0);
    expect(await currentHtml(id)).not.toContain('a photo of your panel');
  });

  it('turns a skip into a real answer so the form moves on', async () => {
    env = build({ photos: true });
    const id = await advanceToPhoto();
    const res = await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({
          stateId: 'panel_check__include__panel_photo',
          panel_photo__status: 'unreviewed',
          skip: '1',
        }),
      ),
      env,
      workspace,
    );
    expect(res.kind).toBe('redirect');
    const answers = JSON.parse(
      String(
        sqlite.rows<Record<string, unknown>>('pricing_quote_sessions')[0][
          'answers'
        ],
      ),
    );
    expect(answers.panel_photo.status).toBe('missing');
    expect(sqlite.rows('pricing_photo_reviews')).toHaveLength(0);
    expect(await currentHtml(id)).not.toContain('a photo of your panel');
  });

  it('refuses a file that is not an image, and moves on without it', async () => {
    env = build({ photos: true });
    const bucket = env.INTAKE_PHOTOS as unknown as ReturnType<
      typeof fakeBucket
    >;
    const id = await advanceToPhoto();

    const fd = new FormData();
    fd.append('stateId', 'panel_check__include__panel_photo');
    fd.append('panel_photo__status', 'unreviewed');
    fd.append(
      'panel_photo',
      new File([new Uint8Array([1, 2, 3])], 'invoice.pdf', {
        type: 'application/pdf',
      }),
    );
    const res = await handleQuoteRequest(
      post(`/quote/s/${id}`, fd),
      env,
      workspace,
    );
    expect(res.kind).toBe('redirect');
    expect(bucket.objects.size).toBe(0);
    const answers = JSON.parse(
      String(
        sqlite.rows<Record<string, unknown>>('pricing_quote_sessions')[0][
          'answers'
        ],
      ),
    );
    expect(answers.panel_photo.status).toBe('missing');
  });

  it('does not block the form when there is nowhere to store a photo', async () => {
    const id = await advanceToPhoto();
    const html = await currentHtml(id);
    expect(html).not.toContain('type="file"');
    const res = await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({
          stateId: 'panel_check__include__panel_photo',
          panel_photo__status: 'missing',
        }),
      ),
      env,
      workspace,
    );
    expect(res.kind).toBe('redirect');
    expect(await currentHtml(id)).not.toContain('a photo of your panel');
  });
});

// ── Booking (GP-103) ──────────────────────────────────────────

const CHICAGO = 'America/Chicago';

/** Rivertown says when it works: every day but Sunday, 8 to 5, Chicago time. */
function seedAvailability(): void {
  sqlite.raw.exec(
    `UPDATE workspaces SET timezone = '${CHICAGO}' WHERE id = 'ws1';`,
  );
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    sqlite.raw.exec(
      `INSERT INTO workspace_availability (id, workspace_id, weekday, opens_at, closes_at, is_open)
       VALUES ('wa-${weekday}', 'ws1', ${weekday}, '08:00', '17:00', ${weekday === 0 ? 0 : 1});`,
    );
  }
}

/**
 * The whole EV form with a real panel photo, then the human review that
 * narrows the span to the priced terminal the fixture records. That is the
 * product's own path to a bookable price: a photo nobody has read is a span,
 * and a span does not book.
 */
async function completeEvToPrice(): Promise<string> {
  const id = await start();
  for (let i = 0; i < 40; i++) {
    if (!(await answerCurrent(id, { photo: true }))) break;
  }
  const review = sqlite
    .rows<Record<string, unknown>>('pricing_photo_reviews')
    .find((r) => r['session_id'] === id);
  if (!review) throw new Error('no photo review was opened');
  const photo = fixture.answers['panel_photo'] as {
    fields: Record<string, string | number | boolean>;
  };
  const outcome = await resolvePhotoReview({
    db: env.DB as unknown as D1Like,
    reviewId: String(review['id']),
    workspaceId: 'ws1',
    status: 'reviewed',
    fields: photo.fields,
    reviewedBy: 'u1',
    newId: () => crypto.randomUUID(),
  });
  expect(outcome.kind).toBe('narrowed');
  return id;
}

const htmlOf = async (
  path: string,
): Promise<{ status: number; html: string }> => {
  const res = await handleQuoteRequest(get(path), env, workspace);
  if (res.kind !== 'html') throw new Error(`expected html, got ${res.kind}`);
  return { status: res.status, html: res.html };
};

const firstOfferedSlot = (html: string): string => {
  const value = /name="startUtc" value="([^"]+)"/.exec(html)?.[1];
  if (!value) throw new Error('no slot on offer');
  return value;
};

describe('booking the quoted job', () => {
  beforeEach(() => {
    env = build({ photos: true });
  });

  it('refuses a shop with no card on file with the please-call 409, writing nothing', async () => {
    seedAvailability();
    const id = await completeEvToPrice();
    sqlite.raw.exec(
      `UPDATE workspaces SET stripe_customer_id = NULL WHERE id = 'ws1'`,
    );
    const picker = await htmlOf(`/quote/s/${id}/book`);
    const startUtc = firstOfferedSlot(picker.html);
    const leadBefore = sqlite.rows<Record<string, unknown>>('leads');

    const res = await handleQuoteRequest(
      post(`/quote/s/${id}/book`, form({ startUtc })),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(409);
    expect(res.html).toMatch(
      /We couldn(?:'|&#39;|&#x27;|&apos;|’)t take this booking online — please call 512-555-0134\./,
    );
    for (const table of [
      'jobs',
      'job_slots',
      'opportunities',
      'customers',
      'lead_meter_events',
    ]) {
      expect(sqlite.rows(table), table).toHaveLength(0);
    }
    expect(sqlite.rows('leads')).toEqual(leadBefore);
  });

  it('offers times on the priced page, books one, and confirms it', async () => {
    seedAvailability();
    const id = await completeEvToPrice();

    // The priced page: the fixture's own numbers, and the offer.
    const priced = await htmlOf(`/quote/s/${id}`);
    expect(priced.html).toContain('$1,000');
    expect(priced.html).toContain('$1,275');
    expect(priced.html).toContain('We honour this price');
    expect(priced.html).toContain(`href="/quote/s/${id}/book"`);
    expect(priced.html).toContain('data-bn-book');
    expect(priced.html).not.toContain(
      'Someone will be in touch to book a time',
    );

    // The picker: a no-JavaScript form on this origin, one radio per slot,
    // grouped by the contractor's local day.
    const picker = await htmlOf(`/quote/s/${id}/book`);
    expect(picker.status).toBe(200);
    expect(picker.html).toContain(`action="/quote/s/${id}/book"`);
    expect(picker.html).toContain('method="post"');
    // The form itself needs no script: the shell's deferred enhancement is
    // the only script on the page, and the form is plain radios and a submit.
    const formHtml = picker.html.slice(
      picker.html.indexOf('<form'),
      picker.html.indexOf('</form>'),
    );
    expect(formHtml).not.toContain('<script');
    expect(formHtml).not.toMatch(/ on[a-z]+=/);
    expect(picker.html).toContain('data-bn="booking-day"');
    expect(picker.html).toMatch(/\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M/);
    expect(picker.html).toContain('$1,000 to $1,275');
    const startUtc = firstOfferedSlot(picker.html);
    expect(startUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:[03]0:00\.000Z$/);
    // Every offered start is inside 08:00–17:00 Chicago, on a half hour.
    for (const m of picker.html.matchAll(/name="startUtc" value="([^"]+)"/g)) {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: CHICAGO,
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(new Date(m[1])),
      );
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(17);
    }

    // Book it.
    const booked = await handleQuoteRequest(
      post(`/quote/s/${id}/book`, form({ startUtc })),
      env,
      workspace,
    );
    expect(booked.kind).toBe('redirect');
    if (booked.kind !== 'redirect') return;
    expect(booked.location).toBe(`/quote/s/${id}/booked`);

    // The row: scheduled, at exactly that instant, for exactly the quote's
    // duration, linked to the lead the quote wrote, through the guard.
    const session = sqlite
      .rows<Record<string, unknown>>('pricing_quote_sessions')
      .find((r) => r['id'] === id);
    const jobs = sqlite.rows<Record<string, unknown>>('jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]['status']).toBe('scheduled');
    expect(jobs[0]['scheduled_start']).toBe(startUtc);
    expect(jobs[0]['title']).toBe('Level 2 EV charger install');
    const opp = sqlite.rows<Record<string, unknown>>('opportunities')[0];
    expect(opp['id']).toBe(jobs[0]['opportunity_id']);
    expect(opp['lead_id']).toBe(session?.['lead_id']);
    expect(sqlite.rows('job_slots').length).toBeGreaterThan(0);
    for (const slot of sqlite.rows<Record<string, unknown>>('job_slots')) {
      expect(slot['job_id']).toBe(jobs[0]['id']);
    }
    const durationMs =
      Date.parse(String(jobs[0]['scheduled_end'])) - Date.parse(startUtc);
    expect(sqlite.rows('job_slots')).toHaveLength(durationMs / (30 * 60_000));
    const entry = sqlite
      .rows<Record<string, unknown>>('activity_log')
      .find((e) => e['entity_type'] === 'job');
    expect(entry?.['action']).toBe('created');
    expect(JSON.parse(String(entry?.['meta']))['quoteSessionId']).toBe(id);

    // The confirmation: local time, the band, the number, the way back.
    const confirmation = await htmlOf(`/quote/s/${id}/booked`);
    expect(confirmation.status).toBe(200);
    expect(confirmation.html).toContain("You're booked");
    expect(confirmation.html).toMatch(
      /data-bn="booking-when">[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M</,
    );
    expect(confirmation.html).toContain('$1,000 to $1,275');
    expect(confirmation.html).toContain('tel:512-555-0134');
    expect(confirmation.html).toContain(`href="/quote/s/${id}/reschedule"`);
    expect(confirmation.html).toContain(`href="/quote/s/${id}/cancel"`);
    expect(confirmation.html).toContain('costs nothing');
    expect(confirmation.html).toContain('change or cancel');

    // GP-111: the lead and the job booked off it are valued from the same
    // band, in the same unit — cents.
    const leadRow = sqlite
      .rows<Record<string, unknown>>('leads')
      .find((r) => r['id'] === session?.['lead_id']);
    expect(leadRow?.['estimated_value']).toBe(113750);
    expect(jobs[0]['total']).toBe(leadRow?.['estimated_value']);
    expect(opp['value']).toBe(leadRow?.['estimated_value']);
    // The capability URL itself now IS the booking.
    expect((await htmlOf(`/quote/s/${id}`)).html).toContain("You're booked");
    // And the picker no longer offers this session anything.
    const again = await handleQuoteRequest(
      get(`/quote/s/${id}/book`),
      env,
      workspace,
    );
    expect(again).toEqual({
      kind: 'redirect',
      location: `/quote/s/${id}/booked`,
    });

    // The same slot is gone for the next homeowner.
    const other = await completeEvToPrice();
    const otherPicker = await htmlOf(`/quote/s/${other}/book`);
    expect(otherPicker.html).not.toContain(`value="${startUtc}"`);
    expect(firstOfferedSlot(otherPicker.html)).not.toBe(startUtc);
  });

  it('re-offers when the slot went between the page and the submit', async () => {
    seedAvailability();
    const a = await completeEvToPrice();
    const b = await completeEvToPrice();
    const startUtc = firstOfferedSlot(
      (await htmlOf(`/quote/s/${a}/book`)).html,
    );
    // B is looking at the same page.
    expect((await htmlOf(`/quote/s/${b}/book`)).html).toContain(
      `value="${startUtc}"`,
    );

    const first = await handleQuoteRequest(
      post(`/quote/s/${a}/book`, form({ startUtc })),
      env,
      workspace,
    );
    expect(first.kind).toBe('redirect');

    // B's submit is checked against the slots as they are NOW, so the one A
    // took is already off the list (422). The narrower race — both pass that
    // check and collide in the batch — answers 409 with the same words, and
    // is pinned over the real table in booking.spec.ts ('answers taken').
    const second = await handleQuoteRequest(
      post(`/quote/s/${b}/book`, form({ startUtc })),
      env,
      workspace,
    );
    expect(second.kind).toBe('html');
    if (second.kind !== 'html') return;
    expect(second.status).toBe(422);
    expect(second.html).toContain('That time just went — pick another');
    expect(second.html).not.toContain(`value="${startUtc}"`);
    expect(second.html).toContain('name="startUtc"');
    expect(sqlite.rows('jobs')).toHaveLength(1);
  });

  it('refuses a start that was never offered, and writes nothing', async () => {
    seedAvailability();
    const id = await completeEvToPrice();
    const res = await handleQuoteRequest(
      post(
        `/quote/s/${id}/book`,
        form({ startUtc: '2030-01-01T03:00:00.000Z' }),
      ),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(422);
    expect(sqlite.rows('jobs')).toHaveLength(0);
    expect(sqlite.rows('opportunities')).toHaveLength(0);
    expect(sqlite.rows('customers')).toHaveLength(0);
  });

  it('keeps the "someone will be in touch" card when the workspace has no hours', async () => {
    const id = await completeEvToPrice();
    const priced = await htmlOf(`/quote/s/${id}`);
    expect(priced.html).toContain('$1,000');
    expect(priced.html).toContain('Someone will be in touch to book a time');
    expect(priced.html).not.toContain('data-bn-book');
    expect(priced.html).not.toContain('name="startUtc"');
    // The picker URL degrades to the price, never to an empty picker.
    expect(
      await handleQuoteRequest(get(`/quote/s/${id}/book`), env, workspace),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(
      await handleQuoteRequest(
        post(
          `/quote/s/${id}/book`,
          form({ startUtc: '2030-01-01T15:00:00.000Z' }),
        ),
        env,
        workspace,
      ),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(sqlite.rows('jobs')).toHaveLength(0);
  });

  it('offers nothing on a span — a band nobody has narrowed yet', async () => {
    seedAvailability();
    const id = await start();
    for (let i = 0; i < 40; i++) {
      if (!(await answerCurrent(id))) break;
    }
    const html = (await htmlOf(`/quote/s/${id}`)).html;
    expect(html).toContain('Range — narrows once we see your panel');
    expect(html).not.toContain('data-bn-book');
    expect(
      await handleQuoteRequest(get(`/quote/s/${id}/book`), env, workspace),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
  });

  it('offers nothing on the urgent path — call now, no picker', async () => {
    seedAvailability();
    const started = await handleQuoteRequest(
      post('/quote/start', form({ flow: 'troubleshooting-callout' })),
      env,
      workspace,
    );
    if (started.kind !== 'redirect') throw new Error('expected a redirect');
    const id = started.location.replace('/quote/s/', '');
    const answered = await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({ stateId: 'symptom', symptom: 'burning_or_hot' }),
      ),
      env,
      workspace,
    );
    expect(answered.kind).toBe('redirect');

    const html = (await htmlOf(`/quote/s/${id}`)).html;
    expect(html).toContain('data-bn-urgent');
    expect(html).toContain('tel:512-555-0134');
    expect(html).not.toContain('data-bn-book');
    expect(html).not.toContain('name="startUtc"');
    expect(
      await handleQuoteRequest(get(`/quote/s/${id}/book`), env, workspace),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(
      await handleQuoteRequest(
        post(
          `/quote/s/${id}/book`,
          form({ startUtc: '2030-01-01T15:00:00.000Z' }),
        ),
        env,
        workspace,
      ),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(sqlite.rows('jobs')).toHaveLength(0);
  });

  it('sends an unfinished form back to its screen rather than to a picker', async () => {
    seedAvailability();
    const id = await start();
    expect(
      await handleQuoteRequest(get(`/quote/s/${id}/book`), env, workspace),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(
      await handleQuoteRequest(get(`/quote/s/${id}/booked`), env, workspace),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
  });
});

// ── Change or cancel (GP-105) ─────────────────────────────────

const rows = <T = Record<string, unknown>>(table: string) =>
  sqlite.rows<T>(table);
const theJob = () => rows('jobs').find((j) => j['status'] !== 'cancelled');
const slotsOf = (jobId: unknown) =>
  rows('job_slots').filter((s) => s['job_id'] === jobId);
const leadOf = (id: string) => {
  const session = rows('pricing_quote_sessions').find((r) => r['id'] === id);
  return rows('leads').find((r) => r['id'] === session?.['lead_id']);
};
const actionsOn = (entityType: string) =>
  rows('activity_log')
    .filter((e) => e['entity_type'] === entityType)
    .map((e) => e['action']);

/** Book the first offered slot for a priced session; returns that start. */
async function bookFirstSlot(id: string): Promise<string> {
  const startUtc = firstOfferedSlot((await htmlOf(`/quote/s/${id}/book`)).html);
  const res = await handleQuoteRequest(
    post(`/quote/s/${id}/book`, form({ startUtc })),
    env,
    workspace,
  );
  expect(res).toEqual({ kind: 'redirect', location: `/quote/s/${id}/booked` });
  return startUtc;
}

describe('changing or cancelling the booked job', () => {
  beforeEach(() => {
    env = build({ photos: true });
    seedAvailability();
  });

  it('moves the booking to a new time — one job row, old slot free, new slot taken', async () => {
    const id = await completeEvToPrice();
    const original = await bookFirstSlot(id);
    const jobId = theJob()?.['id'];
    const oldSlots = slotsOf(jobId).map((s) => s['slot_start']);
    expect(oldSlots.length).toBeGreaterThan(0);

    // The picker for a move: says what they have, posts to /reschedule, and
    // offers the time they already hold as free — it is theirs to keep.
    const picker = await htmlOf(`/quote/s/${id}/reschedule`);
    expect(picker.status).toBe(200);
    expect(picker.html).toContain('Pick a new time');
    expect(picker.html).toContain('data-bn-reschedule');
    expect(picker.html).toContain(`action="/quote/s/${id}/reschedule"`);
    expect(picker.html).toContain('costs nothing');
    expect(picker.html).toContain(`href="/quote/s/${id}/booked"`);
    expect(picker.html).toContain(`value="${original}"`);
    const offered = [
      ...picker.html.matchAll(/name="startUtc" value="([^"]+)"/g),
    ].map((m) => m[1]);
    // Far enough away that the old time is genuinely free again afterwards:
    // the slot right after it would overlap the moved job's own duration and
    // travel buffer, which is the generator doing its job.
    const next = offered[offered.length - 1];
    if (!next || next === original) throw new Error('only one slot on offer');

    const moved = await handleQuoteRequest(
      post(`/quote/s/${id}/reschedule`, form({ startUtc: next })),
      env,
      workspace,
    );
    expect(moved).toEqual({
      kind: 'redirect',
      location: `/quote/s/${id}/booked`,
    });

    expect(rows('jobs')).toHaveLength(1);
    const job = theJob();
    expect(job?.['id']).toBe(jobId);
    expect(job?.['status']).toBe('scheduled');
    expect(job?.['scheduled_start']).toBe(next);
    const newSlots = slotsOf(jobId).map((s) => s['slot_start']);
    expect(newSlots).toHaveLength(oldSlots.length);
    expect(newSlots).toContain(next);
    expect(newSlots).not.toContain(original);
    expect(rows('job_slots')).toHaveLength(oldSlots.length);
    expect(actionsOn('job')).toEqual(['created', 'rescheduled']);
    // The lead is untouched by a move.
    expect(leadOf(id)?.['withdrawn_at']).toBeNull();

    const confirmation = await htmlOf(`/quote/s/${id}/booked`);
    expect(confirmation.html).toContain("You're booked");
    // The old time is free for the next homeowner; the new one is not.
    const other = await completeEvToPrice();
    const otherPicker = (await htmlOf(`/quote/s/${other}/book`)).html;
    expect(otherPicker).toContain(`value="${original}"`);
    expect(otherPicker).not.toContain(`value="${next}"`);
  });

  it('keeps the original booking when the new time just went', async () => {
    const a = await completeEvToPrice();
    const b = await completeEvToPrice();
    const original = await bookFirstSlot(a);
    // B takes the time A is about to move to.
    const wanted = await bookFirstSlot(b);
    expect(wanted).not.toBe(original);

    const res = await handleQuoteRequest(
      post(`/quote/s/${a}/reschedule`, form({ startUtc: wanted })),
      env,
      workspace,
    );
    expect(res.kind).toBe('html');
    if (res.kind !== 'html') return;
    expect(res.status).toBe(422);
    expect(res.html).toContain('That time just went — pick another');
    expect(res.html).toContain('data-bn-reschedule');
    expect(res.html).not.toContain(`value="${wanted}"`);
    // A still has exactly what A had.
    const jobA = rows('jobs').find((j) => j['scheduled_start'] === original);
    expect(jobA?.['status']).toBe('scheduled');
    expect(slotsOf(jobA?.['id']).length).toBeGreaterThan(0);
    expect(actionsOn('job')).toEqual(['created', 'created']);
  });

  it('cancels: the job goes, its slots go, the reason is recorded, and the price page says so', async () => {
    const id = await completeEvToPrice();
    const startUtc = await bookFirstSlot(id);
    const jobId = theJob()?.['id'];

    const page = await htmlOf(`/quote/s/${id}/cancel`);
    expect(page.status).toBe(200);
    expect(page.html).toContain('Cancel this booking?');
    expect(page.html).toContain(`action="/quote/s/${id}/cancel"`);
    expect(page.html).toContain('costs nothing');
    expect(page.html).toContain('value="schedule_no_longer_works"');

    // No reason is not a cancellation.
    const refused = await handleQuoteRequest(
      post(`/quote/s/${id}/cancel`, form({})),
      env,
      workspace,
    );
    expect(refused.kind).toBe('html');
    if (refused.kind === 'html') {
      expect(refused.status).toBe(422);
      expect(refused.html).toContain('Pick a reason first');
    }
    const outside = await handleQuoteRequest(
      post(`/quote/s/${id}/cancel`, form({ reason: 'changed_mind' })),
      env,
      workspace,
    );
    expect(outside.kind).toBe('html');
    expect(theJob()?.['status']).toBe('scheduled');

    const cancelled = await handleQuoteRequest(
      post(
        `/quote/s/${id}/cancel`,
        form({ reason: 'schedule_no_longer_works' }),
      ),
      env,
      workspace,
    );
    expect(cancelled).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });

    const job = rows('jobs').find((j) => j['id'] === jobId);
    expect(job?.['status']).toBe('cancelled');
    expect(rows('job_slots')).toHaveLength(0);
    const lead = leadOf(id);
    expect(lead?.['withdrawn_at']).toBeTruthy();
    expect(lead?.['withdrawn_reason']).toBe('schedule_no_longer_works');
    expect(actionsOn('job')).toEqual(['created', 'cancelled']);
    expect(actionsOn('lead')).toContain('withdrawn');
    const withdrawn = rows('activity_log').find(
      (e) => e['action'] === 'withdrawn',
    );
    expect(JSON.parse(String(withdrawn?.['meta']))).toEqual({
      meterEventAdjustment: 'left_unchanged',
      reason: 'schedule_no_longer_works',
    });
    // The booking was the billable event (WS-1): its fee was metered at
    // booking commit and stands through the cancellation (FR-1.4) — the
    // contractor's fee, not the homeowner's, so the page below still says
    // nothing is owed.
    const fee = rows('lead_meter_events');
    expect(fee).toHaveLength(1);
    expect(fee[0]).toMatchObject({ status: 'pending', job_id: jobId });

    // The capability URL now shows the cancelled state, with the way back in.
    const price = await htmlOf(`/quote/s/${id}`);
    expect(price.html).toContain('data-bn-cancelled');
    expect(price.html).toContain('is cancelled');
    expect(price.html).toContain('Nothing is owed');
    expect(price.html).toContain('data-bn-book');
    expect(price.html).not.toContain("You're booked");
    // And the booking pages fall back to it.
    expect(
      await handleQuoteRequest(get(`/quote/s/${id}/booked`), env, workspace),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(
      await handleQuoteRequest(get(`/quote/s/${id}/cancel`), env, workspace),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(
      await handleQuoteRequest(
        get(`/quote/s/${id}/reschedule`),
        env,
        workspace,
      ),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    // A second cancel is a no-op with the same answer.
    expect(
      await handleQuoteRequest(
        post(`/quote/s/${id}/cancel`, form({ reason: 'other' })),
        env,
        workspace,
      ),
    ).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(leadOf(id)?.['withdrawn_reason']).toBe('schedule_no_longer_works');

    // The slot is offered to the next caller.
    const other = await completeEvToPrice();
    expect((await htmlOf(`/quote/s/${other}/book`)).html).toContain(
      `value="${startUtc}"`,
    );
  });

  it('books again after a cancellation — same customer, same opportunity, a new job', async () => {
    const id = await completeEvToPrice();
    const first = await bookFirstSlot(id);
    await handleQuoteRequest(
      post(`/quote/s/${id}/cancel`, form({ reason: 'other' })),
      env,
      workspace,
    );
    expect(rows('customers')).toHaveLength(1);
    expect(rows('opportunities')).toHaveLength(1);

    const picker = await htmlOf(`/quote/s/${id}/book`);
    expect(picker.status).toBe(200);
    expect(picker.html).toContain(`value="${first}"`);
    const again = await bookFirstSlot(id);
    expect(again).toBe(first);

    expect(rows('jobs')).toHaveLength(2);
    expect(
      rows('jobs')
        .map((j) => j['status'])
        .sort(),
    ).toEqual(['cancelled', 'scheduled']);
    expect(rows('customers')).toHaveLength(1);
    expect(rows('opportunities')).toHaveLength(1);
    const opp = rows('opportunities')[0];
    expect(opp?.['converted_to_job_id']).toBe(theJob()?.['id']);
    expect(theJob()?.['customer_id']).toBe(rows('customers')[0]?.['id']);
    expect(slotsOf(theJob()?.['id']).length).toBeGreaterThan(0);
    expect((await htmlOf(`/quote/s/${id}`)).html).toContain("You're booked");
    expect((await htmlOf(`/quote/s/${id}`)).html).not.toContain(
      'data-bn-cancelled',
    );
  });

  it("a cancel from another tenant's site touches nothing", async () => {
    const id = await completeEvToPrice();
    await bookFirstSlot(id);
    const elsewhere: WorkspaceData = { ...workspace, id: 'ws2', slug: 'other' };
    const res = await handleQuoteRequest(
      post(`/quote/s/${id}/cancel`, form({ reason: 'other' })),
      env,
      elsewhere,
    );
    expect(res.kind).toBe('html');
    if (res.kind === 'html') expect(res.status).toBe(404);
    expect(theJob()?.['status']).toBe('scheduled');
    expect(rows('job_slots').length).toBeGreaterThan(0);
    expect(leadOf(id)?.['withdrawn_at']).toBeNull();
    expect(actionsOn('job')).toEqual(['created']);
  });
});

// ── Back and Start over (GP-014) ──────────────────────────────

describe('going back, and starting over', () => {
  const eventCount = () => sqlite.rows('pricing_quote_events').length;
  const answersOf = (id: string): Record<string, unknown> =>
    JSON.parse(
      String(
        sqlite
          .rows<Record<string, unknown>>('pricing_quote_sessions')
          .find((r) => r['id'] === id)?.['answers'],
      ),
    ) as Record<string, unknown>;
  const sessionRow = (id: string) =>
    sqlite
      .rows<Record<string, unknown>>('pricing_quote_sessions')
      .find((r) => r['id'] === id);

  const nav = (id: string, fields: Record<string, string>) =>
    handleQuoteRequest(post(`/quote/s/${id}`, form(fields)), env, workspace);

  /** The first two screens answered: location, then speed. */
  async function twoScreens(): Promise<string> {
    const id = await start();
    await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({
          stateId: 'charger_location',
          charger_location: 'attached_garage_inside',
        }),
      ),
      env,
      workspace,
    );
    await handleQuoteRequest(
      post(
        `/quote/s/${id}`,
        form({
          stateId: 'charge_speed',
          prevStateId: 'charger_location',
          charge_speed: '32a',
        }),
      ),
      env,
      workspace,
    );
    return id;
  }

  it('offers no Back on the first screen, and Back to the previous one after that', async () => {
    const id = await start();
    const first = await currentHtml(id);
    expect(first).toContain('Where do you want the charger?');
    expect(first).not.toContain('value="back"');
    expect(first).not.toContain('name="prevStateId"');
    expect(first).toContain('value="restart"');

    await twoScreensOn(id);
    const third = await currentHtml(id);
    expect(third).toContain('Do you have the charger already?');
    expect(third).toContain('name="prevStateId" value="charge_speed"');
    expect(third).toContain('name="nav" value="back" formnovalidate');
  });

  async function twoScreensOn(id: string): Promise<void> {
    for (const [stateId, key, value] of [
      ['charger_location', 'charger_location', 'attached_garage_inside'],
      ['charge_speed', 'charge_speed', '32a'],
    ]) {
      const res = await handleQuoteRequest(
        post(`/quote/s/${id}`, form({ stateId, [key]: value })),
        env,
        workspace,
      );
      expect(res.kind).toBe('redirect');
    }
  }

  it('Back: the previous question comes back with its answer preselected, and the answer is gone from the session', async () => {
    const id = await twoScreens();
    expect(answersOf(id)).toEqual({
      charger_location: 'attached_garage_inside',
      charge_speed: '32a',
    });
    // The navigation fields never became answers, and never reached the log.
    for (const e of sqlite.rows<Record<string, unknown>>(
      'pricing_quote_events',
    )) {
      expect(JSON.parse(String(e['input']))).not.toHaveProperty('prevStateId');
      expect(JSON.parse(String(e['input']))).not.toHaveProperty('nav');
    }
    const before = eventCount();
    expect(before).toBe(2);

    const res = await nav(id, { nav: 'back', prevStateId: 'charge_speed' });
    expect(res).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });

    const html = await currentHtml(id);
    expect(html).toContain('How fast do you want it to charge?');
    // What they had chosen, ready to be changed with one tap…
    expect(html).toMatch(/value="32a"[^>]*checked/);
    // …but not an answer any more: the walk stopped here because the
    // session no longer holds it.
    expect(answersOf(id)).toEqual({
      charger_location: 'attached_garage_inside',
    });
    expect(sessionRow(id)?.['current_state_id']).toBe('charge_speed');
    // And this screen's Back goes to the first one.
    expect(html).toContain('name="prevStateId" value="charger_location"');

    // The log grew by exactly one — a rewind row — and lost nothing.
    expect(eventCount()).toBe(before + 1);
    const last = sqlite
      .rows<Record<string, unknown>>('pricing_quote_events')
      .at(-1);
    expect(JSON.parse(String(last?.['input']))).toEqual({ _rewind: true });
    expect(last?.['from_state_id']).toBe('charger_supply');
    expect(last?.['to_state_id']).toBe('charge_speed');

    // Continue with a different answer: the form moves on from the new one.
    const again = await nav(id, {
      stateId: 'charge_speed',
      prevStateId: 'charger_location',
      charge_speed: '48a',
    });
    expect(again.kind).toBe('redirect');
    expect(answersOf(id)['charge_speed']).toBe('48a');
    expect(await currentHtml(id)).toContain('Do you have the charger already?');
    expect(eventCount()).toBe(before + 2);
  });

  it('Back is not swallowed by the stale-tab guard', async () => {
    const id = await twoScreens();
    // A tab still showing the FIRST screen presses Back-to-nowhere and then
    // a tab showing the second presses Back: the guard would have bounced
    // both as stale answers. The first is a no-op, the second rewinds.
    const noop = await nav(id, { nav: 'back', prevStateId: '' });
    expect(noop.kind).toBe('redirect');
    expect(eventCount()).toBe(2);
    await nav(id, { nav: 'back', prevStateId: 'charger_location' });
    expect(answersOf(id)).toEqual({});
    expect(await currentHtml(id)).toContain('Where do you want the charger?');
    expect(eventCount()).toBe(3);
  });

  it('Start over: the first screen, empty answers, the same address, one more row', async () => {
    const id = await twoScreens();
    const before = eventCount();
    const res = await nav(id, { nav: 'restart' });
    expect(res).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });

    const html = await currentHtml(id);
    expect(html).toContain('Where do you want the charger?');
    // A clean slate: nothing preselected, no Back.
    expect(html).not.toMatch(/checked/);
    expect(html).not.toContain('value="back"');
    expect(answersOf(id)).toEqual({});
    expect(sessionRow(id)?.['current_state_id']).toBeNull();
    expect(sessionRow(id)?.['status']).toBe('in_progress');

    expect(eventCount()).toBe(before + 1);
    const last = sqlite
      .rows<Record<string, unknown>>('pricing_quote_events')
      .at(-1);
    expect(JSON.parse(String(last?.['input']))).toEqual({ _restart: true });
    // Every answer row from before is still there to be read.
    expect(sqlite.rows('pricing_quote_events')).toHaveLength(3);
  });

  it("a prevStateId that is not in this session's own history is a no-op", async () => {
    const id = await twoScreens();
    const before = answersOf(id);
    // The troubleshooting machine's first screen: a real state id, from a
    // session on a different flow — the shape of a forged or stale field.
    for (const foreign of ['symptom', 'charger_connection', 'nope']) {
      const res = await nav(id, { nav: 'back', prevStateId: foreign });
      expect(res).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    }
    expect(answersOf(id)).toEqual(before);
    expect(eventCount()).toBe(2);
    expect(await currentHtml(id)).toContain('Do you have the charger already?');
  });

  it('never shrinks the log, whatever is pressed', async () => {
    const id = await twoScreens();
    const counts = [eventCount()];
    await nav(id, { nav: 'back', prevStateId: 'charge_speed' });
    counts.push(eventCount());
    await nav(id, { stateId: 'charge_speed', charge_speed: '48a' });
    counts.push(eventCount());
    await nav(id, { nav: 'restart' });
    counts.push(eventCount());
    await nav(id, { nav: 'restart' }); // nothing to reset: no row
    counts.push(eventCount());
    expect(counts).toEqual([2, 3, 4, 5, 5]);
  });

  it('Start over on the finished price: back to the first screen, the lead kept, no second lead', async () => {
    const id = await start();
    for (let i = 0; i < 40; i++) {
      if (!(await answerCurrent(id))) break;
    }
    const priced = await currentHtml(id);
    expect(priced).toContain('data-bn="quote-range"');
    expect(priced).toContain(
      `<form method="post" action="/quote/s/${id}" data-bn="quote-restart">`,
    );
    expect(priced).toContain('value="restart"');
    expect(priced).not.toContain('value="back"');
    expect(sqlite.rows('leads')).toHaveLength(1);
    const before = eventCount();

    const res = await nav(id, { nav: 'restart' });
    expect(res).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(await currentHtml(id)).toContain('Where do you want the charger?');
    const row = sessionRow(id);
    expect(row?.['status']).toBe('in_progress');
    expect(row?.['terminal_id']).toBeNull();
    expect(row?.['quote_low']).toBeNull();
    expect(row?.['completed_at']).toBeNull();
    expect(answersOf(id)).toEqual({});
    expect(eventCount()).toBe(before + 1);

    // Around again: the same lead, not a second one.
    for (let i = 0; i < 40; i++) {
      if (!(await answerCurrent(id))) break;
    }
    expect(sessionRow(id)?.['status']).toBe('completed');
    expect(sqlite.rows('leads')).toHaveLength(1);
    expect(sessionRow(id)?.['lead_id']).toBe(row?.['lead_id']);
  });

  it('Back from the finished price is nothing: only a screen has a previous screen', async () => {
    const id = await start();
    for (let i = 0; i < 40; i++) {
      if (!(await answerCurrent(id))) break;
    }
    const before = eventCount();
    const res = await nav(id, { nav: 'back', prevStateId: 'charge_speed' });
    expect(res).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
    expect(sessionRow(id)?.['status']).toBe('completed');
    expect(eventCount()).toBe(before);
    expect(await currentHtml(id)).toContain('data-bn="quote-range"');
  });

  describe('once a job is booked', () => {
    beforeEach(() => {
      env = build({ photos: true });
    });

    it('ignores both, and shows the confirmation', async () => {
      seedAvailability();
      const id = await completeEvToPrice();
      const startUtc = firstOfferedSlot(
        (await htmlOf(`/quote/s/${id}/book`)).html,
      );
      const booked = await handleQuoteRequest(
        post(`/quote/s/${id}/book`, form({ startUtc })),
        env,
        workspace,
      );
      expect(booked.kind).toBe('redirect');
      const answers = answersOf(id);
      const events = eventCount();
      const row = { ...sessionRow(id) };

      for (const fields of [
        { nav: 'restart' },
        { nav: 'back', prevStateId: 'charge_speed' },
      ]) {
        const res = await nav(id, fields);
        expect(res).toEqual({ kind: 'redirect', location: `/quote/s/${id}` });
        expect((await htmlOf(`/quote/s/${id}`)).html).toContain(
          "You're booked",
        );
      }
      expect(answersOf(id)).toEqual(answers);
      expect(eventCount()).toBe(events);
      expect(sessionRow(id)).toEqual(row);
      expect(sqlite.rows('jobs')).toHaveLength(1);
      expect(
        sqlite
          .rows<Record<string, unknown>>('pricing_photo_reviews')
          .map((r) => r['status']),
      ).toEqual(['reviewed']);
    });
  });
});
