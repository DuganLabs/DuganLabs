import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { createLeadFromQuote } from './lead.ts';
import {
  createSession,
  loadFlow,
  loadSession,
  type D1Like,
  type LoadedFlow,
  type QuoteSessionRow,
} from './store.ts';
import { evaluate } from './evaluate.ts';
import { loadFlattenedSeed, readFixture } from './seed-loader.ts';
import type { Machine } from './types.ts';

const REPO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SCHEMA = join(REPO, 'schema.sql');
const SEED_DIR = join(REPO, 'seeds', 'pricing');
const FIXTURE_DIR = join(SEED_DIR, 'fixtures');

const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const ev = machines.find((m) => m.slug === 'ev-charger-install') as Machine;
const fixture = readFixture(join(FIXTURE_DIR, '01-ev-typical.json'));

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

let sqlite: SqliteD1;
let db: D1Like;
let session: QuoteSessionRow;
let counter = 0;
const newId = () => `id-${++counter}`;

beforeEach(async () => {
  counter = 0;
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme Electric', 'acme');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u-tech', 'ws1', 't@example.com', 'Tam', 'Tech', 'tech', 'x');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u-owner', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Default');`,
      `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
         VALUES ('rcv', 'rc', 1, ${q(JSON.stringify(rateCard))}, 'published');`,
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, current_version_id)
         VALUES ('fsm', NULL, 'ev-charger-install', 'ev_charger', 'Level 2 EV charger install', 'fsmv');`,
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
         VALUES ('fsmv', 'fsm', 1, ${q(JSON.stringify(ev))}, 'published');`,
    ],
  });
  db = sqlite.db as unknown as D1Like;
  const flow = (await loadFlow(db, 'ws1', 'ev-charger-install')) as LoadedFlow;
  session = await createSession(db, {
    id: 'sess1',
    workspaceId: 'ws1',
    flow,
    sourceUrl: 'https://acme.greenput.com/quote/ev-charger-install',
  });
});

afterEach(() => sqlite.close());

describe('createLeadFromQuote', () => {
  it('summarises an exact quote as one number, not a range (H1)', async () => {
    const result = evaluate(ev, rateCard, fixture.answers, {
      ...(fixture.env ?? {}),
      work_order_confirmed: true,
    });
    expect(result.stage).toBe('exact');
    await createLeadFromQuote({
      db,
      session,
      machine: ev,
      answers: result.answers,
      result,
      newId,
    });
    const notes = String(
      sqlite.rows<Record<string, unknown>>('leads')[0]['notes'],
    );
    expect(notes).toContain('quoted $1,126.98');
    expect(notes).not.toContain('–');
    // One number, so the lead's value is that number, in cents.
    expect(
      sqlite.rows<Record<string, unknown>>('leads')[0]['estimated_value'],
    ).toBe(112698);
  });

  it('writes the lead, the raw submission and the activity entry, and links the session', async () => {
    const result = evaluate(ev, rateCard, fixture.answers, fixture.env ?? {});
    const created = await createLeadFromQuote({
      db,
      session,
      machine: ev,
      answers: result.answers,
      result,
      newId,
    });

    expect(created?.firstName).toBe('Dana');

    const leads = sqlite.rows<Record<string, unknown>>('leads');
    expect(leads).toHaveLength(1);
    expect(leads[0]['first_name']).toBe('Dana');
    expect(leads[0]['phone']).toBe('512-555-0134');
    // A real price qualifies the lead — which is what lets
    // POST /api/leads/:id/accept bill it (see qualifies() in lead.ts).
    expect(leads[0]['status']).toBe('qualified');
    expect(leads[0]['qualified_at']).not.toBeNull();
    // Cents (§5.0.1): the midpoint of $1,000–$1,275 is $1,137.50. Written as
    // 1138 dollars until GP-111, which read as $11.38 on /leads.
    expect(leads[0]['estimated_value']).toBe(113750);
    expect(leads[0]['source']).toBe('website');
    expect(leads[0]['service_type']).toBe('ev_charger');
    expect(leads[0]['preferred_contact']).toBe('text');
    // Attributed to the owner, not whichever user happens to sort first.
    expect(leads[0]['created_by']).toBe('u-owner');
    expect(String(leads[0]['notes'])).toContain('$1,000');

    const submissions =
      sqlite.rows<Record<string, unknown>>('form_submissions');
    expect(submissions).toHaveLength(1);
    const payload = JSON.parse(String(submissions[0]['form_data']));
    expect(payload.quoteSessionId).toBe('sess1');
    expect(payload.low).toBe(1000);
    expect(payload.answers.charger_location).toBe('attached_garage_inside');
    expect(submissions[0]['source_url']).toBe(
      'https://acme.greenput.com/quote/ev-charger-install',
    );

    const activity = sqlite.rows<Record<string, unknown>>('activity_log');
    expect(activity).toHaveLength(1);
    expect(JSON.parse(String(activity[0]['meta'])).source).toBe(
      'pricing_quote',
    );

    expect((await loadSession(db, 'sess1'))?.lead_id).toBe(created?.leadId);
  });

  it('records an outcome that refused to quote, in words, rather than a blank note', async () => {
    const refused = readFixture(join(FIXTURE_DIR, '17-surge-refuses.json'));
    const surge = machines.find(
      (m) => m.slug === 'whole-home-surge-protection',
    ) as Machine;
    const result = evaluate(
      surge,
      rateCard,
      refused.answers,
      refused.env ?? {},
    );
    expect(result.low).toBeNull();

    const created = await createLeadFromQuote({
      db,
      session,
      machine: surge,
      answers: { ...result.answers, first_name: 'Sam', phone: '512-555-0100' },
      result,
      newId,
    });
    expect(created).not.toBeNull();
    const notes = String(
      sqlite.rows<Record<string, unknown>>('leads')[0]['notes'],
    );
    expect(notes).toContain(result.terminal);
    expect(notes).not.toContain('undefined');
  });

  it('writes nothing for a form that never reached the contact screen', async () => {
    const result = evaluate(ev, rateCard, fixture.answers, fixture.env ?? {});
    const created = await createLeadFromQuote({
      db,
      session,
      machine: ev,
      answers: { charger_location: 'attached_garage_inside' },
      result,
      newId,
    });
    expect(created).toBeNull();
    expect(sqlite.rows('leads')).toHaveLength(0);
    expect(sqlite.rows('activity_log')).toHaveLength(0);
  });

  it('never writes a second lead for the same session', async () => {
    const result = evaluate(ev, rateCard, fixture.answers, fixture.env ?? {});
    const first = await createLeadFromQuote({
      db,
      session,
      machine: ev,
      answers: result.answers,
      result,
      newId,
    });
    const reloaded = (await loadSession(db, 'sess1')) as QuoteSessionRow;
    const second = await createLeadFromQuote({
      db,
      session: reloaded,
      machine: ev,
      answers: result.answers,
      result,
      newId,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(sqlite.rows('leads')).toHaveLength(1);
  });

  it('writes nothing when the workspace has nobody to attribute the lead to', async () => {
    sqlite.raw.exec(`DELETE FROM users`);
    const result = evaluate(ev, rateCard, fixture.answers, fixture.env ?? {});
    expect(
      await createLeadFromQuote({
        db,
        session,
        machine: ev,
        answers: result.answers,
        result,
        newId,
      }),
    ).toBeNull();
    expect(sqlite.rows('leads')).toHaveLength(0);
  });
});
