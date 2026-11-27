import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  completeSession,
  createSession,
  loadFlow,
  loadSession,
  type D1Like,
  type LoadedFlow,
  type QuoteSessionRow,
} from './store.ts';
import { evaluate } from './evaluate.ts';
import { loadFlattenedSeed, readFixture } from './seed-loader.ts';
import { confirmWorkOrder, estimateLinesFromQuote } from './work-order.ts';
import type { Machine } from './types.ts';

/**
 * The contractor's side of H1: confirming the work order is the provider
 * input that turns a range into one exact number, and the contractor's
 * estimate is drafted from that same quote, line for line.
 */

const REPO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SEED_DIR = join(REPO, 'seeds', 'pricing');
const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const ev = machines.find((m) => m.slug === 'ev-charger-install') as Machine;
const panel = machines.find(
  (m) => m.slug === 'panel-service-upgrade',
) as Machine;
const circuit = machines.find(
  (m) => m.slug === 'circuit-outlet-addition',
) as Machine;
const fx = (f: string) => readFixture(join(SEED_DIR, 'fixtures', f));
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

describe('estimateLinesFromQuote', () => {
  it('turns an exact quote into estimate lines in cents that add up to the exact number', () => {
    const f = fx('01-ev-typical.json');
    const r = evaluate(ev, rateCard, f.answers, { work_order_confirmed: true });
    const { lineItems, omitted } = estimateLinesFromQuote(r);
    expect(omitted).toEqual([]);
    const total = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    expect(total).toBe(112698);
    for (const l of lineItems) {
      expect(Number.isInteger(l.unitPrice)).toBe(true);
      expect(['labor', 'material']).toContain(l.type);
      expect(l.description.length).toBeGreaterThan(0);
    }
    expect(lineItems.some((l) => l.type === 'labor')).toBe(true);
    expect(lineItems.some((l) => l.type === 'material')).toBe(true);
  });

  it('adds the minimum call-out as its own line when it bites', () => {
    const f = fx('09-circuit-tap-existing.json');
    const r = evaluate(circuit, rateCard, f.answers, {
      work_order_confirmed: true,
    });
    const { lineItems } = estimateLinesFromQuote(r);
    const total = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    expect(total).toBe(28500);
    expect(lineItems.at(-1)?.description).toMatch(/minimum/i);
  });

  it('leaves priced-only-if-needed lines out of the draft and names them', () => {
    const troubleshoot = machines.find(
      (m) => m.slug === 'troubleshooting-callout',
    ) as Machine;
    const f = fx('12-troubleshoot-diagnostic.json');
    const r = evaluate(troubleshoot, rateCard, f.answers, {
      work_order_confirmed: true,
    });
    const { omitted } = estimateLinesFromQuote(r);
    expect(omitted.length).toBeGreaterThan(0);
    expect(omitted.every((l) => l.side === 'high_only')).toBe(true);
  });

  it('has nothing to draft from an outcome with no price', () => {
    const f = fx('17-surge-refuses.json');
    const surge = machines.find(
      (m) => m.slug === 'whole-home-surge-protection',
    ) as Machine;
    const r = evaluate(surge, rateCard, f.answers, {});
    expect(estimateLinesFromQuote(r).lineItems).toEqual([]);
  });
});

describe('confirmWorkOrder', () => {
  let sqlite: SqliteD1;
  let db: D1Like;
  let n = 0;
  const newId = () => `id-${++n}`;
  const NOW = '2026-11-01T12:00:00.000Z';

  async function completed(
    machine: Machine,
    slug: string,
    file: string,
  ): Promise<QuoteSessionRow> {
    const flow = (await loadFlow(db, 'ws1', slug)) as LoadedFlow;
    const s = await createSession(db, {
      id: `sess-${slug}`,
      workspaceId: 'ws1',
      flow,
      sourceUrl: null,
    });
    const f = fx(file);
    sqlite.raw
      .prepare(
        'UPDATE pricing_quote_sessions SET answers = ?, env = ? WHERE id = ?',
      )
      .run(JSON.stringify(f.answers), JSON.stringify(f.env ?? {}), s.id);
    const fresh = (await loadSession(db, s.id)) as QuoteSessionRow;
    return completeSession(
      db,
      fresh,
      evaluate(machine, rateCard, f.answers, f.env ?? {}),
    );
  }

  beforeEach(() => {
    n = 0;
    sqlite = createSqliteD1({
      files: [join(REPO, 'schema.sql')],
      sql: [
        `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme Electric', 'acme');`,
        `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
           VALUES ('u-owner', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
        `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Default');`,
        `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
           VALUES ('rcv', 'rc', 1, ${q(JSON.stringify(rateCard))}, 'published');`,
        ...[ev, panel].map(
          (
            m,
          ) => `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, current_version_id)
             VALUES ('fsm-${m.slug}', NULL, '${m.slug}', 'x', ${q(m.name)}, 'v-${m.slug}');
           INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
             VALUES ('v-${m.slug}', 'fsm-${m.slug}', 1, ${q(JSON.stringify(m))}, 'published');`,
        ),
      ],
    });
    db = sqlite.db as unknown as D1Like;
  });
  afterEach(() => sqlite.close());

  it('collapses a clean quote to one exact number and records it on the session', async () => {
    const s = await completed(ev, 'ev-charger-install', '01-ev-typical.json');
    expect(s.quote_low).toBe(1000);
    const out = await confirmWorkOrder(db, s, {
      newId,
      now: NOW,
      userId: 'u-owner',
    });
    expect(out.kind).toBe('exact');
    expect(out.result?.exact).toBe(1126.98);
    const after = (await loadSession(db, s.id)) as QuoteSessionRow;
    expect(after.quote_low).toBe(1126.98);
    expect(after.quote_high).toBe(1126.98);
    expect(JSON.parse(after.env).work_order_confirmed).toBe(true);
    expect(JSON.parse(after.quote_json as string).stage).toBe('exact');
    const log = sqlite.raw
      .prepare(
        "SELECT action, meta FROM activity_log WHERE action = 'work_order_confirmed'",
      )
      .all() as Array<{ meta: string }>;
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0].meta)).toMatchObject({
      quoteSessionId: s.id,
      shown: { low: 1000, high: 1275 },
      exact: 1126.98,
    });
  });

  it('keeps the range, and says why, while a guess remains', async () => {
    const s = await completed(
      panel,
      'panel-service-upgrade',
      '06-panel-service-upgrade.json',
    );
    const out = await confirmWorkOrder(db, s, {
      newId,
      now: NOW,
      userId: 'u-owner',
    });
    expect(out.kind).toBe('range');
    expect(out.blockers.join(' ')).toMatch(/utility/i);
    const after = (await loadSession(db, s.id)) as QuoteSessionRow;
    // The band shown to the homeowner is untouched…
    expect(after.quote_low).toBe(s.quote_low);
    expect(after.quote_high).toBe(s.quote_high);
    // …but the contractor's confirmation is kept, so resolving the last guess
    // later lands on the exact number without asking again.
    expect(JSON.parse(after.env).work_order_confirmed).toBe(true);
  });

  it('refuses a session that has not finished', async () => {
    const flow = (await loadFlow(
      db,
      'ws1',
      'ev-charger-install',
    )) as LoadedFlow;
    const s = await createSession(db, {
      id: 'sess-open',
      workspaceId: 'ws1',
      flow,
      sourceUrl: null,
    });
    const out = await confirmWorkOrder(db, s, {
      newId,
      now: NOW,
      userId: 'u-owner',
    });
    expect(out.kind).toBe('not_complete');
  });
});
