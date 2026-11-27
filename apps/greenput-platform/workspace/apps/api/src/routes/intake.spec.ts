import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
// By relative path, not through the `@greenput/shared/pricing` alias: the seed
// loader reads `seeds/pricing/` off disk with `node:fs` and is deliberately
// kept out of the barrel so no Worker bundle can pull it in.
import {
  loadFlattenedSeed,
  readFixture,
} from '../../../../libs/shared/pricing/src/seed-loader';
import { intakeRouter, publicIntakeRouter } from './intake';

/**
 * These run the real handlers against a real SQLite database built from the
 * real `schema.sql` and seeded with the real EV machine, so a NOT NULL or a
 * CHECK the route violates fails here rather than in production.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const SCHEMA = join(REPO, 'schema.sql');
const SEED_DIR = join(REPO, 'seeds', 'pricing');

const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const ev = machines.find((m) => m.slug === 'ev-charger-install');
if (!ev) throw new Error('the EV machine is missing from seeds/pricing');
const fixture = readFixture(
  join(SEED_DIR, 'fixtures', '01-ev-typical.json'),
) as { answers: Record<string, unknown> };

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

let sqlite: SqliteD1;
let env: {
  DB: D1Database;
  SESSIONS: unknown;
  ENVIRONMENT: string;
  FILES?: R2Bucket;
};

/** An R2-shaped bucket that keeps what it is given, so uploads can be read back. */
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
    get: async (key: string) => {
      const found = objects.get(key);
      if (!found) return null;
      return {
        body: new Blob([found.body as BlobPart]).stream(),
        httpMetadata: { contentType: found.contentType },
      };
    },
    delete: async () => undefined,
    head: async () => null,
  };
}

function buildEnv(extraSql: string[] = []) {
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme Electric', 'acme');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u-owner', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Greenput default');`,
      `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
         VALUES ('rcv', 'rc', 1, ${q(JSON.stringify(rateCard))}, 'published');`,
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, description, current_version_id)
         VALUES ('fsm', NULL, 'ev-charger-install', 'ev_charger', 'Level 2 EV charger install', 'Nine questions.', 'fsmv');`,
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
         VALUES ('fsmv', 'fsm', 1, ${q(JSON.stringify(ev))}, 'published');`,
      ...extraSql,
    ],
  });
  return {
    DB: sqlite.db,
    SESSIONS: {},
    ENVIRONMENT: 'test',
    FILES: fakeBucket() as unknown as R2Bucket,
  };
}

/** Turn the panel-photo surface on for one test. Off is the default. */
async function enablePhotos(): Promise<void> {
  await sqlite.db
    .prepare(
      `INSERT INTO feature_flags (name, config_json) VALUES ('intake_panel_photo', '{"enabled":true}')`,
    )
    .run();
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** Upload a panel photo the way a phone would. */
async function uploadPhoto(sessionId: string): Promise<Response> {
  const fd = new FormData();
  fd.append(
    'file',
    new File([JPEG as BlobPart], 'panel.jpg', { type: 'image/jpeg' }),
  );
  return publicIntakeRouter.fetch(
    new Request(
      `https://api.greenput.com/api/public/intake/sessions/${sessionId}/photo`,
      { method: 'POST', body: fd },
    ),
    env,
  );
}

function request(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`https://api.greenput.com${path}`, init);
}

/** An authenticated request, with the fields `requireAuth` would have set. */
function authed(method: string, path: string, workspaceId = 'ws1') {
  const req = request(method, path) as Request & {
    workspaceId: string;
    user: { id: string; role: string };
    params: Record<string, string>;
  };
  req.workspaceId = workspaceId;
  req.user = { id: 'u-owner', role: 'owner' };
  return req;
}

/** An authenticated request with a JSON body, which `authed()` cannot carry. */
function withBody(req: Request, body: unknown): Request {
  const next = new Request(req.url, {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as Request & {
    workspaceId: string;
    user: { id: string; role: string };
    params: Record<string, string>;
  };
  const from = req as Request & {
    workspaceId: string;
    user: { id: string; role: string };
  };
  next.workspaceId = from.workspaceId;
  next.user = from.user;
  return next;
}

interface Envelope<T> {
  data: T;
  error?: { code: string; message: string; field?: string };
  meta?: { total: number };
}

const bodyOf = async <T>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

interface StepPayload {
  sessionId: string;
  status: 'question' | 'complete';
  screen?: { stateId: string; answer: { type: string; key?: string } };
  quote?: { low: number | null; high: number | null; terminal: string };
}

/**
 * Drive a session to the end using the fixture's answers.
 *
 * `withPhoto` sends a real file at the photo screen, which is the only way a
 * panel reading can exist at all now — the fixture's `panel_photo` verdict is
 * server-held state, not something a request body can claim.
 */
async function runToCompletion(
  sessionId: string,
  options: { withPhoto?: boolean } = {},
): Promise<StepPayload> {
  for (let i = 0; i < 40; i++) {
    const res = await publicIntakeRouter.fetch(
      request('GET', `/api/public/intake/sessions/${sessionId}`),
      env,
    );
    const payload = (await bodyOf<StepPayload>(res)).data;
    if (payload.status === 'complete') return payload;

    const screen = payload.screen as NonNullable<StepPayload['screen']>;
    if (options.withPhoto && screen.answer.type === 'photo') {
      const uploaded = await uploadPhoto(sessionId);
      expect(uploaded.status, 'photo upload').toBeLessThan(300);
      continue;
    }
    const answered = await publicIntakeRouter.fetch(
      request('POST', `/api/public/intake/sessions/${sessionId}/answers`, {
        stateId: screen.stateId,
        input: inputFor(screen),
      }),
      env,
    );
    expect(
      answered.status,
      `${screen.stateId}: ${JSON.stringify(await answered.clone().json())}`,
    ).toBeLessThan(300);
  }
  throw new Error('the form never finished');
}

/** The form values a screen would have been submitted with. */
function inputFor(screen: {
  answer: {
    type: string;
    key?: string;
    fields?: Array<{ key: string }>;
  };
}): Record<string, unknown> {
  const spec = screen.answer;
  const keys =
    spec.type === 'group'
      ? (spec.fields ?? []).map((f) => f.key)
      : [spec.key as string];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = fixture.answers[key];
    if (spec.type === 'photo') {
      // Presence, not a verdict: `reviewed` is unreachable from here by
      // design, so the fixture's reading has to come from a human.
      out[`${key}__status`] = 'missing';
    } else if (value && typeof value === 'object' && 'estimated' in value) {
      out[`${key}__estimate`] = String((value as { value: number }).value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

beforeEach(() => {
  env = buildEnv();
});
afterEach(() => sqlite.close());

describe('intake routes', () => {
  it('exports both routers', () => {
    expect(typeof publicIntakeRouter.fetch).toBe('function');
    expect(typeof intakeRouter.fetch).toBe('function');
  });
});

describe('GET /api/public/intake/flows', () => {
  it('lists what a tenant can quote, by workspace slug', async () => {
    const res = await publicIntakeRouter.fetch(
      request('GET', '/api/public/intake/flows?slug=acme'),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await bodyOf<Array<{ slug: string; name: string }>>(res);
    expect(data).toHaveLength(1);
    expect(data[0].slug).toBe('ev-charger-install');
  });

  it('needs a slug, and 404s on one that resolves to nothing', async () => {
    expect(
      (
        await publicIntakeRouter.fetch(
          request('GET', '/api/public/intake/flows'),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await publicIntakeRouter.fetch(
          request('GET', '/api/public/intake/flows?slug=nobody'),
          env,
        )
      ).status,
    ).toBe(404);
  });
});

describe('POST /api/public/intake/sessions', () => {
  it('starts a session and returns the first screen', async () => {
    const res = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
        sourceUrl: 'https://acme.greenput.com/quote/ev-charger-install',
      }),
      env,
    );
    expect(res.status).toBe(201);
    const { data } = await bodyOf<StepPayload>(res);
    expect(data.status).toBe('question');
    expect(data.screen?.stateId).toBe('charger_location');
    expect(data.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const rows = sqlite.rows<Record<string, unknown>>('pricing_quote_sessions');
    expect(rows).toHaveLength(1);
    // The version the form started on is pinned, not looked up later.
    expect(rows[0]['fsm_version_id']).toBe('fsmv');
    expect(rows[0]['rate_card_version_id']).toBe('rcv');
    expect(rows[0]['status']).toBe('in_progress');
  });

  it('rejects a missing slug or flow, and 404s on an unpublished flow', async () => {
    expect(
      (
        await publicIntakeRouter.fetch(
          request('POST', '/api/public/intake/sessions', { flow: 'x' }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await publicIntakeRouter.fetch(
          request('POST', '/api/public/intake/sessions', { slug: 'acme' }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await publicIntakeRouter.fetch(
          request('POST', '/api/public/intake/sessions', {
            slug: 'acme',
            flow: 'nope',
          }),
          env,
        )
      ).status,
    ).toBe(404);
  });

  it('rejects an unparseable body', async () => {
    const res = await publicIntakeRouter.fetch(
      new Request('https://api.greenput.com/api/public/intake/sessions', {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/public/intake/sessions/:id/answers', () => {
  async function start(): Promise<string> {
    const res = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    return (await bodyOf<StepPayload>(res)).data.sessionId;
  }

  it('advances one screen, and records the answer and the event', async () => {
    const id = await start();
    const res = await publicIntakeRouter.fetch(
      request('POST', `/api/public/intake/sessions/${id}/answers`, {
        stateId: 'charger_location',
        input: { charger_location: 'attached_garage_inside' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await bodyOf<StepPayload>(res);
    expect(data.screen?.stateId).toBe('charge_speed');

    const session = sqlite.rows<Record<string, unknown>>(
      'pricing_quote_sessions',
    )[0];
    expect(JSON.parse(String(session['answers']))).toEqual({
      charger_location: 'attached_garage_inside',
    });
    const events = sqlite.rows<Record<string, unknown>>('pricing_quote_events');
    expect(events).toHaveLength(1);
    expect(events[0]['from_state_id']).toBe('charger_location');
    expect(events[0]['to_state_id']).toBe('charge_speed');
    expect(events[0]['seq']).toBe(1);
  });

  it('refuses an answer to a screen the form has already moved past', async () => {
    const id = await start();
    await publicIntakeRouter.fetch(
      request('POST', `/api/public/intake/sessions/${id}/answers`, {
        stateId: 'charger_location',
        input: { charger_location: 'attached_garage_inside' },
      }),
      env,
    );
    const stale = await publicIntakeRouter.fetch(
      request('POST', `/api/public/intake/sessions/${id}/answers`, {
        stateId: 'charger_location',
        input: { charger_location: 'detached_garage' },
      }),
      env,
    );
    expect(stale.status).toBe(409);
    expect((await bodyOf(stale)).error?.code).toBe('STALE_SCREEN');
  });

  it('names the offending field when an answer will not do', async () => {
    const id = await start();
    const res = await publicIntakeRouter.fetch(
      request('POST', `/api/public/intake/sessions/${id}/answers`, {
        stateId: 'charger_location',
        input: { charger_location: 'in_the_swimming_pool' },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.field).toBe('charger_location');
    // Nothing was written for a rejected answer.
    expect(sqlite.rows('pricing_quote_events')).toHaveLength(0);
  });

  it('404s on a session that does not exist', async () => {
    const res = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions/nope/answers', {
        input: {},
      }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('the whole form, end to end', () => {
  it('spans the two outcomes while nobody has read the panel, and leads', async () => {
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
        sourceUrl: 'https://acme.greenput.com/quote/ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;

    const finished = await runToCompletion(id);
    expect(finished.status).toBe('complete');
    // Everything except the panel is the frozen fixture. With no photo the
    // machine lands on the spanning terminal — literally the cheap outcome's
    // low end to the expensive outcome's high end, not a padded guess.
    expect(finished.quote?.terminal).toBe('T_needs_panel_review');
    expect(finished.quote?.low).toBe(925);
    expect(finished.quote?.high).toBe(2500);
    // H1: an unread photo is a guess, so this is a range, never one number.
    const staged = finished.quote as unknown as {
      stage: string;
      exact: number | null;
      exactBlockers: string[];
    };
    expect(staged.stage).toBe('range');
    expect(staged.exact).toBeNull();

    const session = sqlite.rows<Record<string, unknown>>(
      'pricing_quote_sessions',
    )[0];
    expect(session['status']).toBe('completed');
    expect(session['quote_low']).toBe(925);
    expect(session['terminal_id']).toBe('T_needs_panel_review');

    const leads = sqlite.rows<Record<string, unknown>>('leads');
    expect(leads).toHaveLength(1);
    expect(leads[0]['first_name']).toBe('Dana');
    expect(leads[0]['service_type']).toBe('ev_charger');
    expect(session['lead_id']).toBe(leads[0]['id']);
    // A span is a real band but not a real price: the review that narrows it
    // is the qualification event, so this lead cannot be accepted yet.
    expect(leads[0]['status']).toBe('new');
    expect(leads[0]['qualified_at']).toBeNull();
  });

  it('narrows to the frozen fixture once a human reads the photo', async () => {
    await enablePhotos();
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;

    const finished = await runToCompletion(id, { withPhoto: true });
    // A photo nobody has read narrows the band a little — "your photo's with
    // us" is worth something — but not to a price.
    expect(finished.quote?.terminal).toBe('T_needs_panel_review');
    expect(finished.quote?.low).toBe(925);
    expect(finished.quote?.high).toBe(2450);

    const queue = await intakeRouter.fetch(
      authed('GET', '/api/intake/reviews'),
      env,
    );
    const { data: pending } =
      await bodyOf<
        Array<{ reviewId: string; sessionId: string; answerKey: string }>
      >(queue);
    expect(pending).toHaveLength(1);
    expect(pending[0].sessionId).toBe(id);
    expect(pending[0].answerKey).toBe('panel_photo');

    // What the fixture says an electrician reads off this panel.
    const reading = fixture.answers['panel_photo'] as {
      fields: Record<string, unknown>;
    };
    const resolved = await intakeRouter.fetch(
      withBody(authed('POST', `/api/intake/reviews/${pending[0].reviewId}`), {
        status: 'reviewed',
        fields: reading.fields,
      }),
      env,
    );
    expect(resolved.status).toBe(200);
    const { data: outcome } = await bodyOf<{
      outcome: string;
      qualified: boolean;
      quote: { terminal: string; low: number; high: number };
      shown: { low: number; high: number };
    }>(resolved);

    // seeds/pricing/fixtures/01-ev-typical.expected.json, reached the only way
    // it can be: a human read the image.
    expect(outcome.outcome).toBe('narrowed');
    expect(outcome.quote.terminal).toBe('T_standard_install');
    expect(outcome.quote.low).toBe(1000);
    expect(outcome.quote.high).toBe(1275);
    // Strictly inside what the homeowner was already shown.
    expect(outcome.shown).toEqual({ low: 925, high: 2450 });
    expect(outcome.qualified).toBe(true);

    const session = sqlite.rows<Record<string, unknown>>(
      'pricing_quote_sessions',
    )[0];
    expect(session['quote_low']).toBe(1000);
    expect(session['terminal_id']).toBe('T_standard_install');

    const lead = sqlite.rows<Record<string, unknown>>('leads')[0];
    expect(lead['status']).toBe('qualified');
    expect(lead['qualified_at']).not.toBeNull();
    expect(lead['estimated_value']).toBe(113750); // cents, GP-111
    // Qualification is not billing — that is still the accept transition.
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });

  it('will not take another answer once the quote is out', async () => {
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;
    await runToCompletion(id);

    const res = await publicIntakeRouter.fetch(
      request('POST', `/api/public/intake/sessions/${id}/answers`, {
        input: {},
      }),
      env,
    );
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe('SESSION_ALREADY_COMPLETE');
    // Still exactly one lead.
    expect(sqlite.rows('leads')).toHaveLength(1);
  });
});

describe('GET /api/public/intake/sessions/:id/quote', () => {
  it('409s while the form is unfinished, and returns the range once it is', async () => {
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;

    const early = await publicIntakeRouter.fetch(
      request('GET', `/api/public/intake/sessions/${id}/quote`),
      env,
    );
    expect(early.status).toBe(409);
    expect((await bodyOf(early)).error?.code).toBe('SESSION_INCOMPLETE');

    await runToCompletion(id);
    const res = await publicIntakeRouter.fetch(
      request('GET', `/api/public/intake/sessions/${id}/quote`),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await bodyOf<{ quote: { low: number } }>(res);
    expect(data.quote.low).toBe(925);
  });
});

describe('contractor-facing routes', () => {
  it('lists the flows the site is offering, flagging Greenput templates', async () => {
    const res = await intakeRouter.fetch(
      authed('GET', '/api/intake/flows'),
      env,
    );
    const { data } =
      await bodyOf<Array<{ slug: string; isTemplate: boolean }>>(res);
    expect(data[0].slug).toBe('ev-charger-install');
    expect(data[0].isTemplate).toBe(true);
  });

  it('lists sessions for the workspace, and only for the workspace', async () => {
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;

    const mine = await intakeRouter.fetch(
      authed('GET', '/api/intake/sessions'),
      env,
    );
    const listed = await bodyOf<Array<{ id: string; flow_slug: string }>>(mine);
    expect(listed.meta?.total).toBe(1);
    expect(listed.data[0].id).toBe(id);
    expect(listed.data[0].flow_slug).toBe('ev-charger-install');

    const theirs = await intakeRouter.fetch(
      authed('GET', '/api/intake/sessions', 'ws-someone-else'),
      env,
    );
    expect((await bodyOf<unknown[]>(theirs)).data).toHaveLength(0);
  });

  it('returns one session with its answers, its route and its price', async () => {
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;
    await runToCompletion(id);

    const req = authed('GET', `/api/intake/sessions/${id}`);
    req.params = { id };
    const res = await intakeRouter.fetch(req, env);
    expect(res.status).toBe(200);
    const { data } = await bodyOf<{
      status: string;
      flow: { slug: string; versionNumber: number };
      quote: { low: number } | null;
      nextScreen: unknown;
      events: Array<{ seq: number; from: string }>;
      answers: Record<string, unknown>;
      leadId: string | null;
    }>(res);

    expect(data.status).toBe('completed');
    expect(data.flow.slug).toBe('ev-charger-install');
    expect(data.flow.versionNumber).toBe(1);
    expect(data.quote?.low).toBe(925);
    expect(data.nextScreen).toBeNull();
    expect(data.leadId).toBeTruthy();
    expect(data.answers['charger_location']).toBe('attached_garage_inside');
    expect(data.events[0].seq).toBe(1);
    expect(data.events[0].from).toBe('charger_location');
  });

  it("reads another workspace's session as absent, not as forbidden", async () => {
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;

    const req = authed('GET', `/api/intake/sessions/${id}`, 'ws-someone-else');
    req.params = { id };
    const res = await intakeRouter.fetch(req, env);
    expect(res.status).toBe(404);
  });
});

describe('a workspace that has published its own flow', () => {
  it('offers its own, not the Greenput template', async () => {
    sqlite.close();
    env = buildEnv([
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, description, current_version_id)
         VALUES ('fsm-ws', 'ws1', 'ev-charger-install', 'ev_charger', 'Acme EV install', '', 'fsmv-ws');`,
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
         VALUES ('fsmv-ws', 'fsm-ws', 1, ${q(JSON.stringify(ev))}, 'published');`,
    ]);
    const res = await publicIntakeRouter.fetch(
      request('GET', '/api/public/intake/flows?slug=acme'),
      env,
    );
    const { data } = await bodyOf<Array<{ name: string }>>(res);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Acme EV install');
  });
});

describe('POST /api/public/intake/sessions/:id/photo', () => {
  async function advanceToPhoto(): Promise<string> {
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;
    for (let i = 0; i < 40; i++) {
      const res = await publicIntakeRouter.fetch(
        request('GET', `/api/public/intake/sessions/${id}`),
        env,
      );
      const payload = (await bodyOf<StepPayload>(res)).data;
      if (payload.status === 'complete') throw new Error('never asked');
      const screen = payload.screen as NonNullable<StepPayload['screen']>;
      if (screen.answer.type === 'photo') return id;
      await publicIntakeRouter.fetch(
        request('POST', `/api/public/intake/sessions/${id}/answers`, {
          stateId: screen.stateId,
          input: inputFor(screen),
        }),
        env,
      );
    }
    throw new Error('never reached the photo screen');
  }

  it('404s while the flag is off, writing nothing', async () => {
    const id = await advanceToPhoto();
    const res = await uploadPhoto(id);
    expect(res.status).toBe(404);
    expect(sqlite.rows('files')).toHaveLength(0);
    expect(sqlite.rows('pricing_photo_reviews')).toHaveLength(0);
  });

  it('503s when the flag is on but nothing is bound to store into', async () => {
    await enablePhotos();
    const id = await advanceToPhoto();
    delete env.FILES;
    const res = await uploadPhoto(id);
    expect(res.status).toBe(503);
    expect((await bodyOf(res)).error?.code).toBe('PHOTO_STORAGE_UNAVAILABLE');
  });

  it('advances the form, and answers the screen with presence only', async () => {
    await enablePhotos();
    const id = await advanceToPhoto();
    const res = await uploadPhoto(id);
    expect(res.status).toBe(201);

    const { data } = await bodyOf<{
      status: string;
      screen?: { stateId: string };
      photo: { fileId: string; status: string; interpretedBy: string };
    }>(res);
    expect(data.status).toBe('question');
    expect(data.screen?.stateId).not.toContain('panel_photo');
    expect(data.photo.status).toBe('unreviewed');
    // The seam reports honestly: nothing has read this image.
    expect(data.photo.interpretedBy).toBe('unresolved');

    // The session stores presence, not a verdict.
    const session = sqlite.rows<Record<string, unknown>>(
      'pricing_quote_sessions',
    )[0];
    expect(
      JSON.parse(String(session['answers']))['panel_photo'],
    ).toBeUndefined();

    // The move is in the event log, with the file and not the bytes.
    const event = sqlite
      .rows<Record<string, unknown>>('pricing_quote_events')
      .at(-1);
    const input = JSON.parse(String(event?.['input'])) as {
      panel_photo: { filename: string; size: number };
    };
    expect(input.panel_photo.filename).toBe('panel.jpg');
    expect(input.panel_photo.size).toBe(6);
  });

  it('refuses a file that is not a photo, and stores nothing', async () => {
    await enablePhotos();
    const id = await advanceToPhoto();
    const fd = new FormData();
    fd.append(
      'file',
      new File([new Uint8Array([1, 2]) as BlobPart], 'invoice.pdf', {
        type: 'application/pdf',
      }),
    );
    const res = await publicIntakeRouter.fetch(
      new Request(
        `https://api.greenput.com/api/public/intake/sessions/${id}/photo`,
        { method: 'POST', body: fd },
      ),
      env,
    );
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error?.code).toBe('INVALID_FILE_TYPE');
    expect(sqlite.rows('files')).toHaveLength(0);
  });

  it('409s when the form is not asking for a photo', async () => {
    await enablePhotos();
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;
    const res = await uploadPhoto(id);
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe('NOT_A_PHOTO_SCREEN');
  });
});

describe('the review queue over HTTP', () => {
  async function quotedWithPhoto(): Promise<string> {
    await enablePhotos();
    const started = await publicIntakeRouter.fetch(
      request('POST', '/api/public/intake/sessions', {
        slug: 'acme',
        flow: 'ev-charger-install',
      }),
      env,
    );
    const id = (await bodyOf<StepPayload>(started)).data.sessionId;
    await runToCompletion(id, { withPhoto: true });
    const queue = await intakeRouter.fetch(
      authed('GET', '/api/intake/reviews'),
      env,
    );
    const { data } = await bodyOf<Array<{ reviewId: string }>>(queue);
    return data[0].reviewId;
  }

  it('serves the image back, private and uncacheable', async () => {
    const reviewId = await quotedWithPhoto();
    const res = await intakeRouter.fetch(
      authed('GET', `/api/intake/reviews/${reviewId}/photo`),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    // A homeowner's panel is not a public asset.
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...JPEG]);
  });

  it("hides another workspace's review entirely", async () => {
    const reviewId = await quotedWithPhoto();
    expect(
      (
        await intakeRouter.fetch(
          authed('GET', '/api/intake/reviews', 'ws-other'),
          env,
        )
      ).status,
    ).toBe(200);
    const listed = await bodyOf<unknown[]>(
      await intakeRouter.fetch(
        authed('GET', '/api/intake/reviews', 'ws-other'),
        env,
      ),
    );
    expect(listed.data).toHaveLength(0);

    const photo = await intakeRouter.fetch(
      authed('GET', `/api/intake/reviews/${reviewId}/photo`, 'ws-other'),
      env,
    );
    expect(photo.status).toBe(404);

    const resolved = await intakeRouter.fetch(
      withBody(authed('POST', `/api/intake/reviews/${reviewId}`, 'ws-other'), {
        status: 'reviewed',
        fields: {},
      }),
      env,
    );
    expect(resolved.status).toBe(404);
  });

  it('refuses a verdict it cannot act on', async () => {
    const reviewId = await quotedWithPhoto();
    for (const body of [
      { status: 'approved' },
      { status: 'missing' },
      { status: 'unreadable', fields: { panel_capacity: 'spare_capable' } },
    ]) {
      const res = await intakeRouter.fetch(
        withBody(authed('POST', `/api/intake/reviews/${reviewId}`), body),
        env,
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('404s a review id that does not exist', async () => {
    await enablePhotos();
    const res = await intakeRouter.fetch(
      withBody(authed('POST', '/api/intake/reviews/nope'), {
        status: 'reviewed',
        fields: {},
      }),
      env,
    );
    expect(res.status).toBe(404);
  });
});
