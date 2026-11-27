import { inlineFragments } from './graph.ts';
import { coerceScreenAnswers } from './session.ts';
import type {
  Answers,
  EnvFacts,
  EvaluationResult,
  Fragment,
  Machine,
  RateCard,
  Terminal,
} from './types.ts';

/**
 * The slice of D1 this library uses.
 *
 * Declared structurally rather than imported from `@cloudflare/workers-types`
 * so the engine stays importable from plain Node — `scripts/seed/pricing-fsms.mjs`
 * loads this same module. A real `D1Database` satisfies it.
 */
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(query: string): D1StatementLike;
}

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface FsmRow {
  id: string;
  workspace_id: string | null;
  slug: string;
  vertical: string;
  name: string;
  description: string;
  current_version_id: string | null;
}

export interface FsmVersionRow {
  id: string;
  fsm_id: string;
  version_number: number;
  graph_json: string;
  status: string;
}

export interface RateCardVersionRow {
  id: string;
  rate_card_id: string;
  version_number: number;
  rates_json: string;
  status: string;
}

export interface QuoteSessionRow {
  id: string;
  workspace_id: string;
  fsm_id: string;
  fsm_version_id: string;
  rate_card_version_id: string;
  lead_id: string | null;
  status: string;
  current_state_id: string | null;
  answers: string;
  env: string;
  terminal_id: string | null;
  quote_low: number | null;
  quote_high: number | null;
  quote_json: string | null;
  source_url: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** A published flow plus everything needed to run it. */
export interface LoadedFlow {
  fsm: FsmRow;
  version: FsmVersionRow;
  rateCardVersion: RateCardVersionRow;
  machine: Machine;
  rateCard: RateCard;
}

const FSM_COLUMNS =
  'id, workspace_id, slug, vertical, name, description, current_version_id';

/**
 * Published flows a tenant's site can offer, the workspace's own first.
 *
 * A workspace that has not authored or cloned anything falls back to Greenput's
 * global templates (`workspace_id IS NULL`) — the five seeded machines. That is
 * what makes a brand-new tenant site able to quote on day one; cloning a
 * template into a workspace so a contractor can tune it is the authoring side,
 * which is not built here.
 */
export async function listPublishedFlows(
  db: D1Like,
  workspaceId: string,
): Promise<FsmRow[]> {
  const own = await db
    .prepare(
      `SELECT ${FSM_COLUMNS} FROM pricing_fsms
       WHERE workspace_id = ? AND current_version_id IS NOT NULL
       ORDER BY name`,
    )
    .bind(workspaceId)
    .all<FsmRow>();
  if (own.results.length > 0) return own.results;

  const global = await db
    .prepare(
      `SELECT ${FSM_COLUMNS} FROM pricing_fsms
       WHERE workspace_id IS NULL AND current_version_id IS NOT NULL
       ORDER BY name`,
    )
    .all<FsmRow>();
  return global.results;
}

async function loadRateCardVersion(
  db: D1Like,
  workspaceId: string,
): Promise<RateCardVersionRow | null> {
  const own = await db
    .prepare(
      `SELECT v.id, v.rate_card_id, v.version_number, v.rates_json, v.status
       FROM rate_card_versions v
       JOIN rate_cards c ON c.id = v.rate_card_id
       WHERE c.workspace_id = ? AND v.status = 'published'
       ORDER BY v.version_number DESC LIMIT 1`,
    )
    .bind(workspaceId)
    .first<RateCardVersionRow>();
  if (own) return own;

  return db
    .prepare(
      `SELECT v.id, v.rate_card_id, v.version_number, v.rates_json, v.status
       FROM rate_card_versions v
       JOIN rate_cards c ON c.id = v.rate_card_id
       WHERE c.workspace_id IS NULL AND v.status = 'published'
       ORDER BY v.version_number DESC LIMIT 1`,
    )
    .first<RateCardVersionRow>();
}

/**
 * Load one published flow by slug, with the rate card it will be priced against.
 *
 * Returns `null` rather than throwing when the flow, its published version or a
 * rate card is missing — a tenant site asking for a flow that was never
 * published is a 404, not a 500.
 */
export async function loadFlow(
  db: D1Like,
  workspaceId: string,
  slug: string,
): Promise<LoadedFlow | null> {
  const fsm =
    (await db
      .prepare(
        `SELECT ${FSM_COLUMNS} FROM pricing_fsms
         WHERE workspace_id = ? AND slug = ? AND current_version_id IS NOT NULL`,
      )
      .bind(workspaceId, slug)
      .first<FsmRow>()) ??
    (await db
      .prepare(
        `SELECT ${FSM_COLUMNS} FROM pricing_fsms
         WHERE workspace_id IS NULL AND slug = ? AND current_version_id IS NOT NULL`,
      )
      .bind(slug)
      .first<FsmRow>());
  if (!fsm) return null;

  const version = await db
    .prepare(
      `SELECT id, fsm_id, version_number, graph_json, status
       FROM pricing_fsm_versions WHERE id = ? AND status = 'published'`,
    )
    .bind(fsm.current_version_id)
    .first<FsmVersionRow>();
  if (!version) return null;

  const rateCardVersion = await loadRateCardVersion(db, workspaceId);
  if (!rateCardVersion) return null;

  return {
    fsm,
    version,
    rateCardVersion,
    machine: JSON.parse(version.graph_json) as Machine,
    rateCard: JSON.parse(rateCardVersion.rates_json) as RateCard,
  };
}

/** Load a flow by the version id a session pinned, so a republish cannot move a live quote. */
export async function loadFlowByVersion(
  db: D1Like,
  fsmVersionId: string,
  rateCardVersionId: string,
): Promise<LoadedFlow | null> {
  const version = await db
    .prepare(
      `SELECT id, fsm_id, version_number, graph_json, status
       FROM pricing_fsm_versions WHERE id = ?`,
    )
    .bind(fsmVersionId)
    .first<FsmVersionRow>();
  if (!version) return null;

  const fsm = await db
    .prepare(`SELECT ${FSM_COLUMNS} FROM pricing_fsms WHERE id = ?`)
    .bind(version.fsm_id)
    .first<FsmRow>();
  if (!fsm) return null;

  const rateCardVersion = await db
    .prepare(
      `SELECT id, rate_card_id, version_number, rates_json, status
       FROM rate_card_versions WHERE id = ?`,
    )
    .bind(rateCardVersionId)
    .first<RateCardVersionRow>();
  if (!rateCardVersion) return null;

  return {
    fsm,
    version,
    rateCardVersion,
    machine: JSON.parse(version.graph_json) as Machine,
    rateCard: JSON.parse(rateCardVersion.rates_json) as RateCard,
  };
}

/**
 * Start a session against a flow's currently published version.
 *
 * The version ids are copied onto the row, not looked up later: a homeowner
 * half-way through a form must finish against the machine and the prices they
 * started on, whatever the contractor publishes in the meantime.
 */
export async function createSession(
  db: D1Like,
  input: {
    id: string;
    workspaceId: string;
    flow: LoadedFlow;
    env?: EnvFacts;
    sourceUrl?: string | null;
    now?: string;
  },
): Promise<QuoteSessionRow> {
  const now = input.now ?? new Date().toISOString();
  const row: QuoteSessionRow = {
    id: input.id,
    workspace_id: input.workspaceId,
    fsm_id: input.flow.fsm.id,
    fsm_version_id: input.flow.version.id,
    rate_card_version_id: input.flow.rateCardVersion.id,
    lead_id: null,
    status: 'in_progress',
    current_state_id: null,
    answers: '{}',
    env: JSON.stringify(input.env ?? {}),
    terminal_id: null,
    quote_low: null,
    quote_high: null,
    quote_json: null,
    source_url: input.sourceUrl ?? null,
    started_at: now,
    updated_at: now,
    completed_at: null,
  };
  await db
    .prepare(
      `INSERT INTO pricing_quote_sessions (
         id, workspace_id, fsm_id, fsm_version_id, rate_card_version_id,
         status, answers, env, source_url, started_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      row.id,
      row.workspace_id,
      row.fsm_id,
      row.fsm_version_id,
      row.rate_card_version_id,
      row.status,
      row.answers,
      row.env,
      row.source_url,
      row.started_at,
      row.updated_at,
    )
    .run();
  return row;
}

const SESSION_COLUMNS =
  'id, workspace_id, fsm_id, fsm_version_id, rate_card_version_id, lead_id, status, ' +
  'current_state_id, answers, env, terminal_id, quote_low, quote_high, quote_json, ' +
  'source_url, started_at, updated_at, completed_at';

/**
 * The user a workspace's automated writes are attributed to.
 *
 * `leads.created_by` and `files.uploaded_by` are both NOT NULL foreign keys to
 * `users(id)`, and a homeowner filling in a quote form is not a user and never
 * will be. So anything the public form writes is attributed to the workspace
 * owner (or its most senior member), exactly as the tenant site's own lead form
 * does. Returns null for a workspace with no users, which is not a state the
 * product can reach but is a state the schema allows.
 */
export async function attributionUserId(
  db: D1Like,
  workspaceId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM users WHERE workspace_id = ?
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function loadSession(
  db: D1Like,
  sessionId: string,
): Promise<QuoteSessionRow | null> {
  return db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM pricing_quote_sessions WHERE id = ?`,
    )
    .bind(sessionId)
    .first<QuoteSessionRow>();
}

/** The answers a session has collected. A corrupt blob reads as no answers, not a crash. */
export function sessionAnswers(session: QuoteSessionRow): Answers {
  try {
    const parsed = JSON.parse(session.answers) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Answers) : {};
  } catch {
    return {};
  }
}

/** The environment facts a session was started with. */
export function sessionEnv(session: QuoteSessionRow): EnvFacts {
  try {
    const parsed = JSON.parse(session.env) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as EnvFacts) : {};
  } catch {
    return {};
  }
}

/**
 * Record one answered screen: merge the answers, move the cursor, and append an
 * event.
 *
 * The event log is append-only and carries the raw submitted input, so a quote
 * can be re-derived — or disputed — from what the homeowner actually typed
 * rather than from the merged state it produced.
 */
export async function recordScreen(
  db: D1Like,
  session: QuoteSessionRow,
  input: {
    fromStateId: string;
    toStateId: string | null;
    submitted: Record<string, unknown>;
    answers: Answers;
    eventId: string;
    now?: string;
  },
): Promise<QuoteSessionRow> {
  const now = input.now ?? new Date().toISOString();
  const merged = { ...sessionAnswers(session), ...input.answers };
  const answersJson = JSON.stringify(merged);

  await db
    .prepare(
      `UPDATE pricing_quote_sessions
       SET answers = ?, current_state_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(answersJson, input.toStateId, now, session.id)
    .run();

  await db
    .prepare(
      `INSERT INTO pricing_quote_events (
         id, session_id, workspace_id, seq, from_state_id, to_state_id, input, created_at
       ) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(
      input.eventId,
      session.id,
      session.workspace_id,
      await nextSeq(db, session.id),
      input.fromStateId,
      input.toStateId,
      JSON.stringify(input.submitted),
      now,
    )
    .run();

  return {
    ...session,
    answers: answersJson,
    current_state_id: input.toStateId,
    updated_at: now,
  };
}

/** Freeze the outcome onto the session. The range is stored as it was shown. */
export async function completeSession(
  db: D1Like,
  session: QuoteSessionRow,
  result: EvaluationResult,
  now = new Date().toISOString(),
): Promise<QuoteSessionRow> {
  const quoteJson = JSON.stringify(result);
  await db
    .prepare(
      `UPDATE pricing_quote_sessions
       SET status = 'completed', terminal_id = ?, quote_low = ?, quote_high = ?,
           quote_json = ?, current_state_id = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`,
    )
    .bind(
      result.terminal,
      result.low,
      result.high,
      quoteJson,
      result.terminal,
      now,
      now,
      session.id,
    )
    .run();
  return {
    ...session,
    status: 'completed',
    terminal_id: result.terminal,
    quote_low: result.low,
    quote_high: result.high,
    quote_json: quoteJson,
    current_state_id: result.terminal,
    updated_at: now,
    completed_at: now,
  };
}

/** Link a session to the lead it produced. */
export async function attachLead(
  db: D1Like,
  sessionId: string,
  leadId: string,
  now = new Date().toISOString(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE pricing_quote_sessions SET lead_id = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(leadId, now, sessionId)
    .run();
}

export interface QuoteEventRow {
  id: string;
  seq: number;
  from_state_id: string;
  to_state_id: string | null;
  input: string;
  created_at: string;
}

/** Every screen a session answered, in order. */
export async function listSessionEvents(
  db: D1Like,
  sessionId: string,
): Promise<QuoteEventRow[]> {
  const res = await db
    .prepare(
      `SELECT id, seq, from_state_id, to_state_id, input, created_at
       FROM pricing_quote_events WHERE session_id = ? ORDER BY seq`,
    )
    .bind(sessionId)
    .all<QuoteEventRow>();
  return res.results;
}

// ── Going back, and starting over (GP-014) ────────────────────

/**
 * What one row of the log is: a screen answered, or one of the two moves a
 * homeowner can make against their own history. A navigation event carries
 * no answers — its `input` is the marker alone — so replaying the log never
 * mistakes one for a submission.
 */
export type QuoteEventKind = 'answer' | 'rewind' | 'restart';

export function eventKind(event: Pick<QuoteEventRow, 'input'>): QuoteEventKind {
  try {
    const parsed = JSON.parse(event.input) as unknown;
    if (parsed && typeof parsed === 'object') {
      const marks = parsed as Record<string, unknown>;
      if (marks['_restart'] === true) return 'restart';
      if (marks['_rewind'] === true) return 'rewind';
    }
  } catch {
    // Not JSON: an answer event whose input was mangled. It still counts as
    // an answer for the walk; replay will simply find nothing to coerce.
  }
  return 'answer';
}

/** The log folded: the answers that still stand, and the ones a rewind undid. */
export interface FoldedEvents {
  /** Answer events in `seq` order that no later rewind or restart removed. */
  live: QuoteEventRow[];
  /**
   * Answer events a rewind cut off since the last restart, oldest first. Kept
   * so a screen the homeowner stepped back to can show what they had chosen;
   * a restart empties this too, because "start over" means a clean form.
   */
  undone: QuoteEventRow[];
}

/**
 * Replay the navigation in the log without touching the log.
 *
 * The event table is append-only (schema.sql says so, and the audit trail is
 * the point of it), so going back is recorded as one more row rather than by
 * deleting the rows it undoes. This fold is the one reading of that record:
 * a `rewind` to state S drops every surviving answer from the one that
 * left S onward, and a `restart` drops them all.
 */
export function foldEvents(events: QuoteEventRow[]): FoldedEvents {
  let live: QuoteEventRow[] = [];
  let undone: QuoteEventRow[] = [];
  for (const event of events) {
    const kind = eventKind(event);
    if (kind === 'restart') {
      live = [];
      undone = [];
      continue;
    }
    if (kind === 'rewind') {
      const at = lastIndexWhere(
        live,
        (e) => e.from_state_id === event.to_state_id,
      );
      if (at >= 0) {
        undone = [...undone, ...live.slice(at)];
        live = live.slice(0, at);
      }
      continue;
    }
    live = [...live, event];
  }
  return { live, undone };
}

function lastIndexWhere<T>(list: T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) if (test(list[i])) return i;
  return -1;
}

/**
 * The screen a Back control should return to: the one the most recent
 * surviving answer left. Null on the first screen, where there is nothing
 * to go back to and no control is offered.
 */
export function previousStateId(events: QuoteEventRow[]): string | null {
  const { live } = foldEvents(events);
  return live.length > 0 ? live[live.length - 1].from_state_id : null;
}

/**
 * What the homeowner had answered on a screen before they stepped back to
 * it — the raw input of the most recent undone event for that state, or
 * null. For redisplay only: it is not in the session's answers any more,
 * and it is not what the walk prices.
 */
export function undoneInputFor(
  events: QuoteEventRow[],
  stateId: string,
): Record<string, unknown> | null {
  const { undone } = foldEvents(events);
  for (let i = undone.length - 1; i >= 0; i -= 1) {
    if (undone[i].from_state_id !== stateId) continue;
    return parseInput(undone[i].input);
  }
  return null;
}

function parseInput(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The answers a set of surviving events amount to, rebuilt from nothing.
 *
 * Each event's stored input goes back through `coerceScreenAnswers` against
 * the machine state it answered — the same path that produced the answers
 * the first time — and the results are merged in order, exactly as
 * `recordScreen` merged them. Never subtracted from the old blob: one screen
 * can write several keys and two screens can write the same key, so "delete
 * the undone screen's key" is wrong in both directions. An event whose state
 * the machine no longer has, or whose input no longer coerces, contributes
 * nothing rather than throwing — the walk will simply ask that screen again.
 */
export function replayAnswers(
  machine: Machine,
  events: QuoteEventRow[],
): Answers {
  let answers: Answers = {};
  for (const event of events) {
    const state = machine.states.find((s) => s.id === event.from_state_id);
    if (!state || state.kind !== 'question') continue;
    const coerced = coerceScreenAnswers(state, parseInput(event.input));
    if (coerced.ok) answers = { ...answers, ...coerced.answers };
  }
  return answers;
}

async function nextSeq(db: D1Like, sessionId: string): Promise<number> {
  const seq = await db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM pricing_quote_events WHERE session_id = ?`,
    )
    .bind(sessionId)
    .first<{ next: number }>();
  return seq?.next ?? 1;
}

async function appendNavigation(
  db: D1Like,
  session: QuoteSessionRow,
  input: {
    eventId: string;
    fromStateId: string;
    toStateId: string | null;
    mark: '_rewind' | '_restart';
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pricing_quote_events (
         id, session_id, workspace_id, seq, from_state_id, to_state_id, input, created_at
       ) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(
      input.eventId,
      session.id,
      session.workspace_id,
      await nextSeq(db, session.id),
      input.fromStateId,
      input.toStateId,
      JSON.stringify({ [input.mark]: true }),
      input.now,
    )
    .run();
}

/**
 * A photo the homeowner stepped back past is no longer their answer, but the
 * server still holds the file and its review row — and `withPhotoReadings`
 * overlays that row onto every read regardless of what the session stores.
 * So the row is marked `missing`: no reading stands, the photo screen is
 * asked again, and a re-upload's upsert brings the row back to `unreviewed`.
 * Nothing is deleted — the file, and whatever a reviewer already read off
 * it, stay in the row.
 */
async function withdrawPhotoReadings(
  db: D1Like,
  sessionId: string,
  keptAnswers: Answers,
): Promise<void> {
  const rows = (
    await db
      .prepare(
        `SELECT id, answer_key FROM pricing_photo_reviews WHERE session_id = ? AND status <> 'missing'`,
      )
      .bind(sessionId)
      .all<{ id: string; answer_key: string }>()
  ).results;
  for (const row of rows) {
    if (row.answer_key in keptAnswers) continue;
    await db
      .prepare(
        `UPDATE pricing_photo_reviews SET status = 'missing' WHERE id = ?`,
      )
      .bind(row.id)
      .run();
  }
}

/**
 * Step a session back to the screen `stateId`, undoing that screen's answer
 * and every answer after it.
 *
 * `stateId` is validated against the session's own surviving history, not
 * trusted off the wire: a state that no surviving event left — another
 * session's, a made-up one, or one already undone — is a no-op and returns
 * null, and nothing is written. Otherwise the answers are rebuilt by
 * `replayAnswers` from the events that survive, the cursor moves to
 * `stateId`, and ONE event is appended recording the move (`from` the screen
 * they were on, `to` the one they went back to, input `{"_rewind": true}`).
 * The rows being undone stay exactly where they are.
 *
 * The machine is the session's pinned version; pass it when you have it,
 * otherwise it is loaded — a session whose version has gone cannot be
 * replayed and is also a no-op.
 */
export async function rewindTo(
  db: D1Like,
  session: QuoteSessionRow,
  stateId: string,
  options: { machine?: Machine; eventId?: string; now?: string } = {},
): Promise<QuoteSessionRow | null> {
  if (!stateId || !session.current_state_id) return null;
  const events = await listSessionEvents(db, session.id);
  const { live } = foldEvents(events);
  const at = lastIndexWhere(live, (e) => e.from_state_id === stateId);
  if (at < 0) return null;

  const machine =
    options.machine ??
    (
      await loadFlowByVersion(
        db,
        session.fsm_version_id,
        session.rate_card_version_id,
      )
    )?.machine;
  if (!machine) return null;

  const now = options.now ?? new Date().toISOString();
  const answers = replayAnswers(machine, live.slice(0, at));
  const answersJson = JSON.stringify(answers);

  await db
    .prepare(
      `UPDATE pricing_quote_sessions
       SET answers = ?, current_state_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(answersJson, stateId, now, session.id)
    .run();
  await withdrawPhotoReadings(db, session.id, answers);
  await appendNavigation(db, session, {
    eventId: options.eventId ?? crypto.randomUUID(),
    fromStateId: session.current_state_id,
    toStateId: stateId,
    mark: '_rewind',
    now,
  });

  return {
    ...session,
    answers: answersJson,
    current_state_id: stateId,
    updated_at: now,
  };
}

/**
 * Wipe a session's answers and put it back on its first screen — the same
 * session id, so the address the homeowner was told to keep still works.
 *
 * A finished but unbooked session is reset too: its status returns to
 * `in_progress` and the frozen outcome is cleared, so the price page's
 * "Start over" prices a second job on the same link. The lead a first
 * finish created is left attached, which is what stops a second finish from
 * creating another one. A booked session is never reset — that is the
 * caller's check (`findBookedJob`), made before this is reached.
 *
 * ONE event records the reset (`{"_restart": true}`); nothing is deleted.
 * A session with nothing answered yet is left alone: null, no event.
 */
export async function restartSession(
  db: D1Like,
  session: QuoteSessionRow,
  options: { eventId?: string; now?: string } = {},
): Promise<QuoteSessionRow | null> {
  if (!session.current_state_id) return null;
  const now = options.now ?? new Date().toISOString();

  await db
    .prepare(
      `UPDATE pricing_quote_sessions
       SET answers = '{}', current_state_id = NULL, status = 'in_progress',
           terminal_id = NULL, quote_low = NULL, quote_high = NULL,
           quote_json = NULL, completed_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, session.id)
    .run();
  await withdrawPhotoReadings(db, session.id, {});
  await appendNavigation(db, session, {
    eventId: options.eventId ?? crypto.randomUUID(),
    fromStateId: session.current_state_id,
    toStateId: null,
    mark: '_restart',
    now,
  });

  return {
    ...session,
    answers: '{}',
    current_state_id: null,
    status: 'in_progress',
    terminal_id: null,
    quote_low: null,
    quote_high: null,
    quote_json: null,
    completed_at: null,
    updated_at: now,
  };
}

/**
 * Assemble a machine from the seed's authored form (fragments not yet inlined).
 *
 * Published versions are stored flattened, so this is only needed by tooling
 * that reads `seeds/pricing/` directly — it is exported so the seed script and
 * the engine cannot disagree about what "flattened" means.
 */
export function assembleMachine(
  machine: Machine,
  fragments: Record<string, Fragment>,
  sharedTerminals: Terminal[],
): Machine {
  return inlineFragments(machine, fragments, sharedTerminals);
}
