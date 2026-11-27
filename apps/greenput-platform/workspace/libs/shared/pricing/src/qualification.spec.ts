import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { createLeadFromQuote, qualifies } from './lead.ts';
import { loadFlattenedSeed, readFixture, type Fixture } from './seed-loader.ts';
import { evaluate } from './evaluate.ts';
import type { D1Like, QuoteSessionRow } from './store.ts';
import type { EvaluationResult } from './types.ts';

/**
 * The lifecycle a quote has to reach: qualification, and therefore billing.
 *
 * `POST /api/leads/:id/accept` and booking refuse a lead whose `qualified_at`
 * is null, and the lead fee is metered only at booking commit (WS-1). So a
 * quote that does not qualify its lead produces leads a contractor can never
 * accept or book and Greenput can never bill — the funnel this engine exists
 * to feed would dead-end. These tests pin that it does not.
 */

const ROOT = resolve(__dirname, '../../../..');
const WORKSPACE = 'ws-1';

let sqlite: SqliteD1;
let ids = 0;
const newId = () => `id-${(ids += 1)}`;

const SEED_DIR = resolve(ROOT, 'seeds/pricing');
const seed = loadFlattenedSeed(SEED_DIR);
const ev = seed.machines.find((m) => m.slug === 'ev-charger-install');
if (!ev) throw new Error('expected the seeded EV machine');
const fixture = (file: string): Fixture =>
  readFixture(resolve(SEED_DIR, 'fixtures', file));

function session(overrides: Partial<QuoteSessionRow> = {}): QuoteSessionRow {
  return {
    id: 'sess-1',
    workspace_id: WORKSPACE,
    fsm_id: 'fsm-1',
    fsm_version_id: 'v-1',
    rate_card_version_id: 'rcv-1',
    lead_id: null,
    status: 'completed',
    current_state_id: null,
    answers: '{}',
    env: '{}',
    terminal_id: null,
    quote_low: null,
    quote_high: null,
    quote_json: null,
    source_url: null,
    started_at: '2026-09-11T12:00:00.000Z',
    updated_at: '2026-09-11T12:00:00.000Z',
    completed_at: '2026-09-11T12:00:00.000Z',
    ...overrides,
  } as QuoteSessionRow;
}

const contact = {
  first_name: 'Dana',
  last_name: 'Ortiz',
  email: 'dana@example.com',
  phone: '512-555-0134',
  preferred_contact: 'text',
};

/** Run a real fixture through the real engine. */
function outcome(file: string): EvaluationResult {
  const fx = fixture(file);
  return evaluate(
    ev,
    seed.rateCard,
    { ...fx.answers, ...contact },
    fx.env ?? {},
  );
}

beforeEach(async () => {
  ids = 0;
  sqlite = createSqliteD1({ files: [resolve(ROOT, 'schema.sql')] });
  await sqlite.db
    .prepare(
      `INSERT INTO workspaces (id, name, slug, trade) VALUES (?, 'Demo', 'demo', 'electrical')`,
    )
    .bind(WORKSPACE)
    .run();
  await sqlite.db
    .prepare(
      `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
       VALUES ('u-owner', ?, 'Owner', 'One', 'owner@example.com', 'owner', '')`,
    )
    .bind(WORKSPACE)
    .run();
  await sqlite.db
    .prepare(
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name)
       VALUES ('fsm-1', ?, 'ev-charger-install', 'ev_charger', 'EV')`,
    )
    .bind(WORKSPACE)
    .run();
  await sqlite.db
    .prepare(
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
       VALUES ('v-1', 'fsm-1', 1, '{}', 'published')`,
    )
    .run();
});

afterEach(() => sqlite.close());

describe('qualifies()', () => {
  it('is true only for an outcome that put a real price on the screen', () => {
    // The design's canonical job: a priced terminal.
    expect(qualifies(outcome('01-ev-typical.json'))).toBe(true);
    // A photo nobody has read: a real band, but not yet a real price.
    expect(qualifies(outcome('04-ev-no-photo-estimated-distance.json'))).toBe(
      false,
    );
  });
});

describe('createLeadFromQuote', () => {
  it('qualifies a priced lead, so it can be accepted and booked (and billed at booking)', async () => {
    const result = outcome('01-ev-typical.json');
    const created = await createLeadFromQuote({
      db: sqlite.db as unknown as D1Like,
      session: session(),
      machine: ev,
      answers: result.answers,
      result,
      newId,
      now: '2026-09-11T12:00:00.000Z',
    });
    expect(created).not.toBeNull();

    const lead = sqlite.rows<Record<string, unknown>>('leads')[0];
    expect(lead['status']).toBe('qualified');
    expect(lead['qualified_at']).toBe('2026-09-11T12:00:00.000Z');
    expect(lead['accepted_at']).toBeNull();
    // Cents (§5.0.1, GP-111): the band is dollars, the column is not.
    expect(lead['estimated_value']).toBe(
      Math.round((((result.low ?? 0) + (result.high ?? 0)) / 2) * 100),
    );

    // Qualification is not billing. The meter fires at booking commit
    // (WS-1), never at qualification or accept.
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);

    const entry = sqlite
      .rows<Record<string, unknown>>('activity_log')
      .find((row) => row['entity_id'] === lead['id']);
    expect(entry?.['action']).toBe('qualified');
  });

  it('does NOT qualify a lead whose photo nobody has read', async () => {
    const result = outcome('04-ev-no-photo-estimated-distance.json');
    await createLeadFromQuote({
      db: sqlite.db as unknown as D1Like,
      session: session(),
      machine: ev,
      answers: result.answers,
      result,
      newId,
      now: '2026-09-11T12:00:00.000Z',
    });

    const lead = sqlite.rows<Record<string, unknown>>('leads')[0];
    // The homeowner may already have a number on screen; it still covers
    // several outcomes, so the review that narrows it is what qualifies.
    expect(lead['status']).toBe('new');
    expect(lead['qualified_at']).toBeNull();
  });

  it('records a refusal as a real lead, unqualified and unpriced', async () => {
    const fx = fixture('01-ev-typical.json');
    const result = evaluate(
      ev,
      seed.rateCard,
      { ...fx.answers, ...contact },
      { in_service_area: false },
    );
    expect(result.low).toBeNull();

    await createLeadFromQuote({
      db: sqlite.db as unknown as D1Like,
      session: session(),
      machine: ev,
      answers: result.answers,
      result,
      newId,
    });

    const lead = sqlite.rows<Record<string, unknown>>('leads')[0];
    expect(lead['status']).toBe('new');
    expect(lead['qualified_at']).toBeNull();
    expect(lead['estimated_value']).toBeNull();
    // Out of area is still someone who answered nine questions.
    expect(sqlite.rows('leads')).toHaveLength(1);
  });
});
