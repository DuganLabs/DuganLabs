import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteD1 } from '@greenput/shared/testing';
import { evaluate } from './evaluate.ts';
import {
  listPublishedFlows,
  loadFlow,
  loadFlowByVersion,
  type D1Like,
} from './store.ts';
import { readFixture } from './seed-loader.ts';

/**
 * The seed SQL, against the real schema.
 *
 * `scripts/seed/pricing-fsms.mjs sql` is what CI hands to
 * `wrangler d1 execute` on every production and staging deploy
 * (`scripts/seed/apply-pricing-fsms.sh`). Nothing else checks that its emitted
 * columns still match `schema.sql`, or that what comes back out of the database
 * still prices — and a seed that fails to apply takes a deploy down with it.
 *
 * So: generate it exactly as CI does, apply it to a real SQLite database built
 * from the real `schema.sql`, read the machines back through the store, and
 * price one. Seed, schema, store and engine, end to end.
 */

const REPO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SCHEMA = join(REPO, 'schema.sql');
const SEED_SCRIPT = join(REPO, 'scripts', 'seed', 'pricing-fsms.mjs');

function generateSeedSql(): string {
  const out = join(mkdtempSync(join(tmpdir(), 'greenput-seed-')), 'seed.sql');
  execFileSync(process.execPath, [SEED_SCRIPT, 'sql', out], {
    cwd: REPO,
    stdio: 'pipe',
  });
  return readFileSync(out, 'utf8');
}

describe('the generated seed SQL', () => {
  const sql = generateSeedSql();
  /** The same SQL with its `--` comment lines removed. */
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('writes only Greenput templates — never into a customer workspace', () => {
    expect(sql).toContain('INSERT INTO pricing_fsms');
    expect(sql).toContain('INSERT INTO rate_card_versions');
    // Every row's workspace_id is NULL. A seed that ever wrote a real
    // workspace id would overwrite a contractor's own tuned machine.
    expect(sql).not.toMatch(/INSERT INTO pricing_fsms[^;]*VALUES \([^,]+, '/);
  });

  it('never uses INSERT OR REPLACE', () => {
    // REPLACE is DELETE-then-INSERT, and pricing_quote_sessions references
    // three of the tables this seed writes with no ON DELETE clause. See the
    // re-apply test below for what that costs.
    //
    // Comment lines are stripped first: the generated header explains at
    // length why it is not INSERT OR REPLACE, and naming the thing you do not
    // do must not trip the check that you do not do it.
    expect(statements).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
  });

  it('never rewrites a published version, however many times it runs', () => {
    // The parent rows (pricing_fsms, rate_cards) are a real upsert — their
    // metadata is meant to move. The two VERSION tables are not: a published
    // version is what a live quote's `fsm_version_id` points at, and
    // schema.sql backs that with a BEFORE UPDATE trigger. So their conflict
    // clause has to be DO NOTHING, not DO UPDATE, or the first edited seed
    // aborts the deploy on that trigger.
    const lines = sql.split('\n');
    for (const table of ['pricing_fsm_versions', 'rate_card_versions']) {
      const stmt = lines.find((l) => l.startsWith(`INSERT INTO ${table} `));
      expect(stmt, `no INSERT for ${table}`).toBeDefined();
      expect(stmt).toContain('ON CONFLICT(id) DO NOTHING');
      expect(stmt).not.toContain('DO UPDATE');
    }
    // And the parent rows still are an upsert.
    for (const table of ['pricing_fsms', 'rate_cards']) {
      const stmt = lines.find((l) => l.startsWith(`INSERT INTO ${table} `));
      expect(stmt, `no INSERT for ${table}`).toBeDefined();
      expect(stmt).toContain('ON CONFLICT(id) DO UPDATE SET');
    }
  });

  it('applies cleanly to a database built from schema.sql', () => {
    const db = createSqliteD1({ files: [SCHEMA], sql: [sql] });
    try {
      expect(db.rows('pricing_fsms')).toHaveLength(5);
      expect(db.rows('pricing_fsm_versions')).toHaveLength(5);
      expect(db.rows('rate_cards')).toHaveLength(1);
      expect(db.rows('rate_card_versions')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('is idempotent — applying it twice leaves one copy of everything', () => {
    const db = createSqliteD1({ files: [SCHEMA], sql: [sql, sql] });
    try {
      expect(db.rows('pricing_fsms')).toHaveLength(5);
      expect(db.rows('rate_card_versions')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('re-applies over a database with live quote sessions, and keeps them', () => {
    // This is the test the one above only looked like. Applying the seed twice
    // to an EMPTY database passed happily with INSERT OR REPLACE, because
    // nothing referenced the rows it was deleting and re-inserting.
    //
    // Production is not empty. pricing_quote_sessions references
    // pricing_fsms(id), pricing_fsm_versions(id) and rate_card_versions(id),
    // all NOT NULL and none with an ON DELETE clause — so the first homeowner
    // to open a quote form against a global template made every subsequent
    // deploy fail with "FOREIGN KEY constraint failed", before the three
    // wrangler deploy steps that follow the seed. Production served a stale
    // build for three hours.
    const db = createSqliteD1({ files: [SCHEMA], sql: [sql] });
    try {
      db.raw.exec(
        "INSERT INTO workspaces (id, name, slug) VALUES ('w1', 'Acme', 'acme')",
      );
      const fsm = db.raw
        .prepare('SELECT id, current_version_id FROM pricing_fsms LIMIT 1')
        .get() as { id: string; current_version_id: string };
      const rateCardVersion = db.raw
        .prepare('SELECT id FROM rate_card_versions LIMIT 1')
        .get() as { id: string };

      db.raw
        .prepare(
          `INSERT INTO pricing_quote_sessions
             (id, workspace_id, fsm_id, fsm_version_id, rate_card_version_id)
           VALUES (?, 'w1', ?, ?, ?)`,
        )
        .run('session-1', fsm.id, fsm.current_version_id, rateCardVersion.id);

      // The next deploy. This is the line that used to throw.
      expect(() => db.raw.exec(sql)).not.toThrow();

      expect(db.rows('pricing_quote_sessions')).toHaveLength(1);
      expect(db.rows('pricing_fsms')).toHaveLength(5);
    } finally {
      db.close();
    }
  });

  it('re-seeds over a live quote without touching what it was priced on', async () => {
    const db = createSqliteD1({
      files: [SCHEMA],
      sql: [
        sql,
        `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme', 'acme');`,
      ],
    });
    try {
      const store = db.db as unknown as D1Like;
      const loaded = await loadFlow(store, 'ws1', 'ev-charger-install');
      expect(loaded).not.toBeNull();
      if (!loaded) return;
      const pinnedGraph = loaded.version.graph_json;

      // A homeowner quotes, pinning both versions.
      await db.db
        .prepare(
          `INSERT INTO pricing_quote_sessions
             (id, workspace_id, fsm_id, fsm_version_id, rate_card_version_id, status)
           VALUES ('s1', 'ws1', ?, ?, ?, 'completed')`,
        )
        .bind(loaded.fsm.id, loaded.version.id, loaded.rateCardVersion.id)
        .run();

      // The next deploy runs the same seed again. This used to be a foreign
      // key violation — and, without the FK, a silent rewrite of the graph
      // that session is the record of.
      db.raw.exec(sql);

      const version = db
        .rows<Record<string, unknown>>('pricing_fsm_versions')
        .find((v) => v['id'] === loaded.version.id);
      expect(version, 'the pinned version was deleted').toBeDefined();
      expect(version?.['graph_json']).toBe(pinnedGraph);
      expect(db.rows('pricing_quote_sessions')).toHaveLength(1);
      expect(db.rows('pricing_fsm_versions')).toHaveLength(5);

      // Now the case that matters: somebody EDITS a seeded machine. Because
      // the version id is a hash of the graph, that publishes a second
      // version beside the first and moves `current_version_id` onto it.
      const edited = JSON.stringify({
        ...loaded.machine,
        name: 'Level 2 EV charger install (revised)',
      });
      await db.db
        .prepare(
          `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
           VALUES ('v-next', ?, 2, ?, 'published') ON CONFLICT(id) DO NOTHING`,
        )
        .bind(loaded.fsm.id, edited)
        .run();
      await db.db
        .prepare(
          `UPDATE pricing_fsms SET current_version_id = 'v-next' WHERE id = ?`,
        )
        .bind(loaded.fsm.id)
        .run();

      // A new form starts on the new graph...
      const current = await loadFlow(store, 'ws1', 'ev-charger-install');
      expect(current?.version.id).toBe('v-next');

      // ...and the quote already given still reads back its own, unchanged.
      const pinned = await loadFlowByVersion(
        store,
        loaded.version.id,
        loaded.rateCardVersion.id,
      );
      expect(pinned?.version.graph_json).toBe(pinnedGraph);
      expect(pinned?.machine.name).toBe('Level 2 EV charger install');
    } finally {
      db.close();
    }
  });

  it('leaves every machine published, loadable and priceable', async () => {
    const db = createSqliteD1({
      files: [SCHEMA],
      sql: [
        sql,
        `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme', 'acme');`,
      ],
    });
    try {
      const store = db.db as unknown as D1Like;
      const flows = await listPublishedFlows(store, 'ws1');
      expect(flows.map((f) => f.slug).sort()).toEqual([
        'circuit-outlet-addition',
        'ev-charger-install',
        'panel-service-upgrade',
        'troubleshooting-callout',
        'whole-home-surge-protection',
      ]);

      const loaded = await loadFlow(store, 'ws1', 'ev-charger-install');
      expect(loaded).not.toBeNull();
      if (!loaded) return;

      // The graph stored is the FLAT one — fragments already inlined, which is
      // the only form the engine evaluates.
      expect(loaded.machine.states.some((s) => s.kind === 'fragment')).toBe(
        false,
      );

      const fixture = readFixture(
        join(REPO, 'seeds', 'pricing', 'fixtures', '01-ev-typical.json'),
      );
      const result = evaluate(
        loaded.machine,
        loaded.rateCard,
        fixture.answers,
        fixture.env ?? {},
      );
      // seeds/pricing/fixtures/01-ev-typical.expected.json — the same range,
      // now produced from a graph that made the whole round trip through SQL.
      expect(result.terminal).toBe('T_standard_install');
      expect(result.low).toBe(1000);
      expect(result.high).toBe(1275);
    } finally {
      db.close();
    }
  });
});
