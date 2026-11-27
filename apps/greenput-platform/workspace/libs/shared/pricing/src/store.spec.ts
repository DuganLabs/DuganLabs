import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  attachLead,
  completeSession,
  createSession,
  listPublishedFlows,
  listSessionEvents,
  loadFlow,
  loadFlowByVersion,
  loadSession,
  recordScreen,
  restartSession,
  rewindTo,
  foldEvents,
  previousStateId,
  undoneInputFor,
  replayAnswers,
  sessionAnswers,
  sessionEnv,
  type D1Like,
  type QuoteEventRow,
  type LoadedFlow,
  type QuoteSessionRow,
} from './store.ts';
import { loadFlattenedSeed } from './seed-loader.ts';
import type { EvaluationResult, Machine } from './types.ts';

const REPO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SCHEMA = join(REPO, 'schema.sql');
const SEED_DIR = join(REPO, 'seeds', 'pricing');

const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const ev = machines.find((m) => m.slug === 'ev-charger-install') as Machine;

const q = (v: string | null) =>
  v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;

/** A session that cannot be read back is a failing test, not a null deref. */
async function mustLoad(
  database: D1Like,
  id: string,
): Promise<QuoteSessionRow> {
  const row = await loadSession(database, id);
  if (!row) throw new Error(`session "${id}" was not stored`);
  return row;
}

/**
 * The real schema, a workspace, and one published flow — so every assertion
 * below is made against the same NOT NULL / CHECK / FOREIGN KEY constraints
 * production has.
 */
function seedDb(options: { workspaceFlow?: boolean } = {}): SqliteD1 {
  const sql: string[] = [
    `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme Electric', 'acme');`,
    `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc-global', NULL, 'Greenput default');`,
    `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status, published_at)
       VALUES ('rcv-global', 'rc-global', 1, ${q(JSON.stringify(rateCard))}, 'published', '2026-09-11T00:00:00Z');`,
    `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, description, current_version_id)
       VALUES ('fsm-global', NULL, 'ev-charger-install', 'ev_charger', 'Level 2 EV charger install', '', 'fsmv-global');`,
    `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status, published_at)
       VALUES ('fsmv-global', 'fsm-global', 1, ${q(JSON.stringify(ev))}, 'published', '2026-09-11T00:00:00Z');`,
  ];
  if (options.workspaceFlow) {
    sql.push(
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, description, current_version_id)
         VALUES ('fsm-ws', 'ws1', 'ev-charger-install', 'ev_charger', 'Acme EV install', '', 'fsmv-ws');`,
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status, published_at)
         VALUES ('fsmv-ws', 'fsm-ws', 1, ${q(JSON.stringify(ev))}, 'published', '2026-09-11T00:00:00Z');`,
    );
  }
  return createSqliteD1({ files: [SCHEMA], sql });
}

let sqlite: SqliteD1;
let db: D1Like;

afterEach(() => sqlite?.close());

describe('listPublishedFlows', () => {
  it('offers the global templates to a workspace that has authored nothing', async () => {
    sqlite = seedDb();
    db = sqlite.db as unknown as D1Like;
    const flows = await listPublishedFlows(db, 'ws1');
    expect(flows.map((f) => f.id)).toEqual(['fsm-global']);
  });

  it("prefers the workspace's own flows once it has some", async () => {
    sqlite = seedDb({ workspaceFlow: true });
    db = sqlite.db as unknown as D1Like;
    const flows = await listPublishedFlows(db, 'ws1');
    expect(flows.map((f) => f.id)).toEqual(['fsm-ws']);
  });

  it('hides a flow with nothing published', async () => {
    sqlite = seedDb();
    db = sqlite.db as unknown as D1Like;
    sqlite.raw.exec(
      `UPDATE pricing_fsms SET current_version_id = NULL WHERE id = 'fsm-global'`,
    );
    expect(await listPublishedFlows(db, 'ws1')).toEqual([]);
  });
});

describe('loadFlow', () => {
  beforeEach(() => {
    sqlite = seedDb();
    db = sqlite.db as unknown as D1Like;
  });

  it('returns the machine and the rate card it will be priced against', async () => {
    const flow = await loadFlow(db, 'ws1', 'ev-charger-install');
    expect(flow).not.toBeNull();
    expect(flow?.machine.slug).toBe('ev-charger-install');
    expect(flow?.rateCard.slug).toBe(rateCard.slug);
    expect(flow?.rateCardVersion.id).toBe('rcv-global');
  });

  it('returns null rather than throwing for a flow that was never published', async () => {
    expect(await loadFlow(db, 'ws1', 'no-such-flow')).toBeNull();
    sqlite.raw.exec(`UPDATE pricing_fsm_versions SET status = 'draft'`);
    expect(await loadFlow(db, 'ws1', 'ev-charger-install')).toBeNull();
  });

  it('returns null when no rate card is published — a machine with no numbers cannot quote', async () => {
    sqlite.raw.exec(`UPDATE rate_card_versions SET status = 'archived'`);
    expect(await loadFlow(db, 'ws1', 'ev-charger-install')).toBeNull();
  });
});

describe('sessions', () => {
  let flow: LoadedFlow;

  beforeEach(async () => {
    sqlite = seedDb();
    db = sqlite.db as unknown as D1Like;
    flow = (await loadFlow(db, 'ws1', 'ev-charger-install')) as LoadedFlow;
  });

  it('pins the graph and rate-card versions onto the session', async () => {
    const session = await createSession(db, {
      id: 'sess1',
      workspaceId: 'ws1',
      flow,
      env: { in_service_area: true },
      sourceUrl: 'https://acme.greenput.com/quote/ev-charger-install',
    });
    const stored = await loadSession(db, 'sess1');
    expect(stored?.fsm_version_id).toBe('fsmv-global');
    expect(stored?.rate_card_version_id).toBe('rcv-global');
    expect(stored?.status).toBe('in_progress');
    expect(sessionAnswers(session)).toEqual({});
    expect(sessionEnv(await mustLoad(db, 'sess1'))).toEqual({
      in_service_area: true,
    });
  });

  it('survives a republish: the session still loads the version it started on', async () => {
    await createSession(db, { id: 'sess1', workspaceId: 'ws1', flow });
    // The contractor publishes version 2 with a different entry screen.
    sqlite.raw.exec(
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
       VALUES ('fsmv-2', 'fsm-global', 2, '{"slug":"v2","entry":"different"}', 'published');`,
    );
    sqlite.raw.exec(
      `UPDATE pricing_fsms SET current_version_id = 'fsmv-2' WHERE id = 'fsm-global'`,
    );

    const session = await mustLoad(db, 'sess1');
    const pinned = await loadFlowByVersion(
      db,
      session.fsm_version_id,
      session.rate_card_version_id,
    );
    expect(pinned?.machine.slug).toBe('ev-charger-install');
    // A brand-new session gets the new one.
    expect((await loadFlow(db, 'ws1', 'ev-charger-install'))?.version.id).toBe(
      'fsmv-2',
    );
  });

  it('merges answers, moves the cursor and appends a numbered event', async () => {
    let session = await createSession(db, {
      id: 'sess1',
      workspaceId: 'ws1',
      flow,
    });
    session = await recordScreen(db, session, {
      fromStateId: 'charger_location',
      toStateId: 'charge_speed',
      submitted: { charger_location: 'attached_garage_inside' },
      answers: { charger_location: 'attached_garage_inside' },
      eventId: 'ev1',
    });
    await recordScreen(db, session, {
      fromStateId: 'charge_speed',
      toStateId: 'charger_supply',
      submitted: { charge_speed: '32a' },
      answers: { charge_speed: '32a' },
      eventId: 'ev2',
    });

    const stored = await mustLoad(db, 'sess1');
    expect(sessionAnswers(stored)).toEqual({
      charger_location: 'attached_garage_inside',
      charge_speed: '32a',
    });
    expect(stored.current_state_id).toBe('charger_supply');

    const events = await listSessionEvents(db, 'sess1');
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events.map((e) => e.from_state_id)).toEqual([
      'charger_location',
      'charge_speed',
    ]);
    expect(JSON.parse(events[0].input)).toEqual({
      charger_location: 'attached_garage_inside',
    });
  });

  it('freezes the outcome as it was shown', async () => {
    const session = await createSession(db, {
      id: 'sess1',
      workspaceId: 'ws1',
      flow,
    });
    const result = {
      terminal: 'T_standard_install',
      kind: 'quote',
      path: ['charger_location', 'T_standard_install'],
      notices: [],
      answers: {},
      low: 1000,
      high: 1275,
    } as EvaluationResult;
    await completeSession(db, session, result);

    const stored = await mustLoad(db, 'sess1');
    expect(stored.status).toBe('completed');
    expect(stored.quote_low).toBe(1000);
    expect(stored.quote_high).toBe(1275);
    expect(stored.terminal_id).toBe('T_standard_install');
    expect(stored.completed_at).toBeTruthy();
    expect(JSON.parse(stored.quote_json as string).terminal).toBe(
      'T_standard_install',
    );
  });

  it('links the lead the session produced', async () => {
    const session = await createSession(db, {
      id: 'sess1',
      workspaceId: 'ws1',
      flow,
    });
    sqlite.raw.exec(
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
       VALUES ('u1', 'ws1', 'a@example.com', 'A', 'B', 'owner', 'x');`,
    );
    sqlite.raw.exec(
      `INSERT INTO leads (id, workspace_id, first_name, last_name, created_by)
       VALUES ('lead1', 'ws1', 'Dana', 'Ortiz', 'u1');`,
    );
    await attachLead(db, session.id, 'lead1');
    expect((await loadSession(db, 'sess1'))?.lead_id).toBe('lead1');
  });

  it('reads a corrupt answers blob as no answers rather than crashing a live form', () => {
    expect(sessionAnswers({ answers: 'not json' } as never)).toEqual({});
    expect(sessionEnv({ env: 'not json' } as never)).toEqual({});
  });
});

// ── Going back, and starting over (GP-014) ────────────────────

describe('rewindTo and restartSession', () => {
  let flow: LoadedFlow;

  beforeEach(async () => {
    sqlite = seedDb();
    db = sqlite.db as unknown as D1Like;
    flow = (await loadFlow(db, 'ws1', 'ev-charger-install')) as LoadedFlow;
  });

  const eventCount = () =>
    sqlite.rows<{ seq: number }>('pricing_quote_events').length;

  /** Three screens of the EV machine answered, as the tenant site records them. */
  async function threeScreens(): Promise<QuoteSessionRow> {
    let session = await createSession(db, {
      id: 'sess1',
      workspaceId: 'ws1',
      flow,
    });
    session = await recordScreen(db, session, {
      fromStateId: 'charger_location',
      toStateId: 'charge_speed',
      submitted: { charger_location: 'attached_garage_inside' },
      answers: { charger_location: 'attached_garage_inside' },
      eventId: 'ev1',
    });
    session = await recordScreen(db, session, {
      fromStateId: 'charge_speed',
      toStateId: 'charger_supply',
      submitted: { charge_speed: '32a' },
      answers: { charge_speed: '32a' },
      eventId: 'ev2',
    });
    return recordScreen(db, session, {
      fromStateId: 'charger_supply',
      toStateId: 'charger_connection',
      submitted: { charger_supply: 'have_it' },
      answers: { charger_supply: 'have_it' },
      eventId: 'ev3',
    });
  }

  it('undoes the screen stepped back to, recomputes the answers, and appends one event', async () => {
    const session = await threeScreens();
    expect(eventCount()).toBe(3);

    const rewound = await rewindTo(db, session, 'charger_supply', {
      machine: flow.machine,
      eventId: 'nav1',
    });
    expect(rewound).not.toBeNull();
    expect(rewound?.current_state_id).toBe('charger_supply');

    const stored = await mustLoad(db, 'sess1');
    expect(sessionAnswers(stored)).toEqual({
      charger_location: 'attached_garage_inside',
      charge_speed: '32a',
    });
    expect(stored.current_state_id).toBe('charger_supply');

    // Append-only: the three answers are still there, and one row joined them.
    const events = await listSessionEvents(db, 'sess1');
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(events[3].from_state_id).toBe('charger_connection');
    expect(events[3].to_state_id).toBe('charger_supply');
    expect(JSON.parse(events[3].input)).toEqual({ _rewind: true });
    expect(JSON.parse(events[2].input)).toEqual({ charger_supply: 'have_it' });
  });

  it('replays through the same coercion the answers came from, not by deleting keys', async () => {
    const session = await threeScreens();
    // Two screens back: everything from charge_speed onward goes.
    await rewindTo(db, session, 'charge_speed', {
      machine: flow.machine,
      eventId: 'nav1',
    });
    expect(sessionAnswers(await mustLoad(db, 'sess1'))).toEqual({
      charger_location: 'attached_garage_inside',
    });
    // The surviving event's raw input is what was coerced — the same
    // function `recordScreen`'s caller used — so a stored input that would
    // not coerce contributes nothing rather than a half-answer.
    const events = await listSessionEvents(db, 'sess1');
    expect(
      replayAnswers(flow.machine, [
        { ...events[0], input: '{"charger_location":"in_the_pool"}' },
        events[1],
      ]),
    ).toEqual({ charge_speed: '32a' });
  });

  it('refuses a state no surviving event left, writing nothing', async () => {
    const session = await threeScreens();
    // A state from another machine, a made-up one, and the screen the
    // session is ON (which nothing has left yet) all read the same.
    for (const bogus of [
      'symptom',
      'no_such_state',
      'charger_connection',
      '',
    ]) {
      expect(
        await rewindTo(db, session, bogus, {
          machine: flow.machine,
          eventId: `nav-${bogus}`,
        }),
      ).toBeNull();
    }
    expect(eventCount()).toBe(3);
    expect(sessionAnswers(await mustLoad(db, 'sess1'))).toEqual({
      charger_location: 'attached_garage_inside',
      charge_speed: '32a',
      charger_supply: 'have_it',
    });
  });

  it('cannot go back to a screen that was already undone', async () => {
    const session = await threeScreens();
    const once = await rewindTo(db, session, 'charge_speed', {
      machine: flow.machine,
      eventId: 'nav1',
    });
    if (!once) throw new Error('first rewind did not happen');
    // charger_supply's answer went with the first rewind; it is not a place
    // the homeowner can be sent back to again.
    expect(
      await rewindTo(db, once, 'charger_supply', {
        machine: flow.machine,
        eventId: 'nav2',
      }),
    ).toBeNull();
    expect(eventCount()).toBe(4);
  });

  it('loads the pinned machine itself when the caller has none', async () => {
    const session = await threeScreens();
    const rewound = await rewindTo(db, session, 'charger_supply', {
      eventId: 'nav1',
    });
    expect(rewound?.current_state_id).toBe('charger_supply');
    expect(eventCount()).toBe(4);
  });

  it('starts over: empty answers, no cursor, the same id, one more event', async () => {
    const session = await threeScreens();
    const restarted = await restartSession(db, session, { eventId: 'nav1' });
    expect(restarted?.id).toBe('sess1');
    expect(restarted?.current_state_id).toBeNull();

    const stored = await mustLoad(db, 'sess1');
    expect(sessionAnswers(stored)).toEqual({});
    expect(stored.current_state_id).toBeNull();
    expect(stored.status).toBe('in_progress');

    const events = await listSessionEvents(db, 'sess1');
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(events[3].from_state_id).toBe('charger_connection');
    expect(events[3].to_state_id).toBeNull();
    expect(JSON.parse(events[3].input)).toEqual({ _restart: true });
  });

  it('starts a finished, unbooked session over and clears the frozen outcome', async () => {
    const session = await threeScreens();
    const completed = await completeSession(db, session, {
      terminal: 'T_standard_install',
      kind: 'quote',
      path: [],
      notices: [],
      answers: {},
      low: 1000,
      high: 1275,
    } as EvaluationResult);
    await attachLead(db, 'sess1', 'lead1').catch(() => undefined);

    await restartSession(db, completed, { eventId: 'nav1' });
    const stored = await mustLoad(db, 'sess1');
    expect(stored.status).toBe('in_progress');
    expect(stored.terminal_id).toBeNull();
    expect(stored.quote_low).toBeNull();
    expect(stored.quote_high).toBeNull();
    expect(stored.quote_json).toBeNull();
    expect(stored.completed_at).toBeNull();
    expect(sessionAnswers(stored)).toEqual({});
  });

  it('leaves a session with nothing answered alone', async () => {
    const session = await createSession(db, {
      id: 'sess1',
      workspaceId: 'ws1',
      flow,
    });
    expect(await restartSession(db, session, { eventId: 'nav1' })).toBeNull();
    expect(
      await rewindTo(db, session, 'charger_location', {
        machine: flow.machine,
        eventId: 'nav2',
      }),
    ).toBeNull();
    expect(eventCount()).toBe(0);
  });

  it('never shrinks the log: rewinds and restarts only ever add rows', async () => {
    let session = await threeScreens();
    const counts = [eventCount()];
    session = (await rewindTo(db, session, 'charger_supply', {
      machine: flow.machine,
      eventId: 'nav1',
    })) as QuoteSessionRow;
    counts.push(eventCount());
    session = await recordScreen(db, session, {
      fromStateId: 'charger_supply',
      toStateId: 'charger_connection',
      submitted: { charger_supply: 'need_one' },
      answers: { charger_supply: 'need_one' },
      eventId: 'ev4',
    });
    counts.push(eventCount());
    await restartSession(db, session, { eventId: 'nav2' });
    counts.push(eventCount());
    expect(counts).toEqual([3, 4, 5, 6]);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
    expect(sessionAnswers(await mustLoad(db, 'sess1'))).toEqual({});
  });

  it('withdraws a photo reading the homeowner stepped back past, without deleting it', async () => {
    const session = await threeScreens();
    sqlite.raw.exec(
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u1', 'ws1', 'a@example.com', 'A', 'B', 'owner', 'x');
       INSERT INTO files (id, workspace_id, entity_type, entity_id, filename, content_type, size, r2_key, uploaded_by)
         VALUES ('f1', 'ws1', 'quote_session', 'sess1', 'panel.jpg', 'image/jpeg', 6, 'k', 'u1');
       INSERT INTO pricing_photo_reviews (id, session_id, workspace_id, answer_key, file_id, status, fields_json)
         VALUES ('r1', 'sess1', 'ws1', 'panel_photo', 'f1', 'reviewed', '{"panel_capacity":"spare_capable"}');`,
    );
    const withPhoto = await recordScreen(db, session, {
      fromStateId: 'panel_check__include__panel_photo',
      toStateId: 'wire_run__include__run_distance_ft',
      submitted: { panel_photo: { status: 'unreviewed', photos: [] } },
      answers: { panel_photo: { status: 'unreviewed', fields: {} } },
      eventId: 'ev4',
    });

    // Back to the screen BEFORE the photo: the reading no longer stands.
    await rewindTo(db, withPhoto, 'charger_supply', {
      machine: flow.machine,
      eventId: 'nav1',
    });
    const review = sqlite
      .rows<Record<string, unknown>>('pricing_photo_reviews')
      .find((r) => r['id'] === 'r1');
    expect(review?.['status']).toBe('missing');
    // Not deleted, and the reviewer's reading is still in the row.
    expect(review?.['fields_json']).toBe('{"panel_capacity":"spare_capable"}');
    expect(sqlite.rows('files')).toHaveLength(1);
  });
});

describe('foldEvents', () => {
  // Pure, but the file-level afterEach closes `sqlite` after every test and
  // would close the previous describe's handle twice.
  beforeEach(() => {
    sqlite = seedDb();
  });

  const ev = (
    seq: number,
    from: string,
    to: string | null,
    input: Record<string, unknown>,
  ): QuoteEventRow => ({
    id: `e${seq}`,
    seq,
    from_state_id: from,
    to_state_id: to,
    input: JSON.stringify(input),
    created_at: '2026-09-11T00:00:00Z',
  });

  it('reads the log as a homeowner moved through it', () => {
    const log = [
      ev(1, 'a', 'b', { a: 1 }),
      ev(2, 'b', 'c', { b: 1 }),
      ev(3, 'c', 'd', { c: 1 }),
      ev(4, 'd', 'b', { _rewind: true }),
      ev(5, 'b', 'c', { b: 2 }),
    ];
    const { live, undone } = foldEvents(log);
    expect(live.map((e) => e.seq)).toEqual([1, 5]);
    expect(undone.map((e) => e.seq)).toEqual([2, 3]);
    expect(previousStateId(log)).toBe('b');
    // The most recent thing they had on b before stepping back to it.
    expect(undoneInputFor(log, 'b')).toEqual({ b: 1 });
    expect(undoneInputFor(log, 'c')).toEqual({ c: 1 });
    expect(undoneInputFor(log, 'a')).toBeNull();
  });

  it('forgets everything, including what could be recalled, on a restart', () => {
    const log = [
      ev(1, 'a', 'b', { a: 1 }),
      ev(2, 'b', 'c', { b: 1 }),
      ev(3, 'c', 'b', { _rewind: true }),
      ev(4, 'b', null, { _restart: true }),
    ];
    expect(foldEvents(log)).toEqual({ live: [], undone: [] });
    expect(previousStateId(log)).toBeNull();
    expect(undoneInputFor(log, 'b')).toBeNull();
  });

  it('ignores a rewind to a state nothing surviving left', () => {
    const log = [
      ev(1, 'a', 'b', { a: 1 }),
      ev(2, 'b', 'zz', { _rewind: true }),
    ];
    expect(foldEvents(log).live.map((e) => e.seq)).toEqual([1]);
  });

  it('is empty, not a crash, on nothing', () => {
    expect(foldEvents([])).toEqual({ live: [], undone: [] });
    expect(previousStateId([])).toBeNull();
  });
});
