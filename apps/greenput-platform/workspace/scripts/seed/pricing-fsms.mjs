#!/usr/bin/env node
/**
 * Pricing FSM seed tool — loader, validator, quote printer and SQL emitter.
 *
 *   node scripts/seed/pricing-fsms.mjs check            # validate every machine, exit non-zero on error
 *   node scripts/seed/pricing-fsms.mjs build [outDir]   # write flattened graphs (fragments inlined)
 *   node scripts/seed/pricing-fsms.mjs quote <fixture>  # run one traversal and print the arithmetic
 *   node scripts/seed/pricing-fsms.mjs quote-all        # run every fixture, print a one-line range each
 *   node scripts/seed/pricing-fsms.mjs verify           # re-run every fixture against its frozen expectation
 *   node scripts/seed/pricing-fsms.mjs expect           # re-freeze expectations after a deliberate change
 *   node scripts/seed/pricing-fsms.mjs sql [out.sql]    # emit idempotent seed SQL
 *   node scripts/seed/pricing-fsms.mjs apply [env] [db] # emit SQL + print the wrangler command
 *
 * WHAT THIS IS, AND WHAT IT NO LONGER IS
 * --------------------------------------
 * It used to carry its own copy of the evaluator — a reference implementation
 * the real engine was supposed to reproduce. It does not any more. The engine
 * lives in `libs/shared/pricing` and this script imports it, so there is exactly
 * one traversal and one piece of pricing arithmetic in the repository. The
 * fixtures in `seeds/pricing/fixtures/` are still the conformance oracle, and
 * `verify` still checks them — but now it is checking the code that actually
 * quotes a homeowner, which is the only version of that check worth having.
 * `libs/shared/pricing/src/evaluate.spec.ts` runs the same eighteen fixtures in
 * the unit-test suite.
 *
 * Node imports the TypeScript engine directly (type stripping, on by default
 * since Node 22.18) — no build step, no second copy.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { evaluate, validate } from '../../libs/shared/pricing/src/index.ts';
import {
  listFixtureFiles,
  loadFlattenedSeed,
} from '../../libs/shared/pricing/src/seed-loader.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SEED_DIR = join(REPO, 'seeds', 'pricing');
const FIXTURE_DIR = join(SEED_DIR, 'fixtures');

const NAMESPACE = 'greenput.pricing-fsm.v1';

// ── Deterministic ids ─────────────────────────────────────────────────────────
// UUID-shaped and stable across runs, so re-seeding is idempotent rather than
// inserting a second copy of everything.
function stableId(...parts) {
  const h = createHash('sha1').update([NAMESPACE, ...parts].join('|')).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ── SQL emitter ───────────────────────────────────────────────────────────────
// The one place that knows the engine's table shape. These four tables are
// declared in schema.sql and created by migrations/010-pricing-fsm.sql; the seed
// JSON itself stays schema-independent, so a rename only lands here.
const TARGET_SCHEMA = {
  fsms: {
    table: 'pricing_fsms',
    cols: ['id', 'workspace_id', 'slug', 'vertical', 'name', 'description', 'current_version_id'],
  },
  fsmVersions: {
    table: 'pricing_fsm_versions',
    cols: ['id', 'fsm_id', 'version_number', 'graph_json', 'status', 'published_at', 'created_by'],
  },
  rateCards: { table: 'rate_cards', cols: ['id', 'workspace_id', 'name'] },
  rateCardVersions: {
    table: 'rate_card_versions',
    cols: ['id', 'rate_card_id', 'version_number', 'rates_json', 'status', 'published_at'],
  },
};
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/**
 * The version id for one published graph: a hash of the graph itself.
 *
 * Content-addressed on purpose. An edit to a seed JSON file mints a NEW
 * version id, which is what lets the version insert below be
 * `ON CONFLICT DO NOTHING` — the old version keeps existing, unchanged, for
 * every quote that pinned it, and the new one takes over as `current`. A
 * version id derived from the slug alone could only ever be rewritten in
 * place, which is the thing that must never happen.
 */
function versionId(kind, slug, payload) {
  return stableId(kind, slug, createHash('sha1').update(payload).digest('hex'));
}

/** `version_number` = one more than whatever that flow already has. */
const nextVersionNumber = (table, fkCol, fkId) =>
  `(SELECT COALESCE(MAX(version_number), 0) + 1 FROM ${table} WHERE ${fkCol} = ${q(fkId)})`;

function emitSql({ rateCard, machines }) {
  const SYSTEM_USER = "(SELECT id FROM users ORDER BY created_at LIMIT 1)";

  /**
   * A real upsert: INSERT ... ON CONFLICT(id) DO UPDATE.
   *
   * This used to emit INSERT OR REPLACE, on the stated reasoning that a
   * deterministic id made re-running safe on every deploy. It did not. SQLite's
   * REPLACE is a DELETE followed by an INSERT, not an update — so with foreign
   * keys on, replacing a seeded template row first DELETES it, and
   * pricing_quote_sessions references pricing_fsms(id), pricing_fsm_versions(id)
   * and rate_card_versions(id) with no ON DELETE clause, i.e. NO ACTION.
   *
   * The seed therefore worked on every deploy right up until the first
   * homeowner started a quote session against a template, and from then on
   * failed with "FOREIGN KEY constraint failed" — taking the production deploy
   * down with it, because this step runs before the Worker deploys. Production
   * sat on a stale build for three hours before anyone looked.
   *
   * ON CONFLICT DO UPDATE never deletes, so nothing cascades and no FK is
   * re-checked. The row keeps its identity, and the sessions pointing at it
   * stay valid — which is what "updates the templates in place" was always
   * supposed to mean.
   */
  const upsert = (table, columns, values) => {
    const assignments = columns
      .filter((c) => c !== 'id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    // One statement per line, like every other statement this file emits: the
    // JSON blobs contain newlines and semicolons, so a reader that splits the
    // output on ";\n" corrupts them. Line-per-statement is the only boundary
    // that survives the content.
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT(id) DO UPDATE SET ${assignments};`;
  };

  /**
   * An insert that never rewrites the row it collides with.
   *
   * The two VERSION tables get this rather than `upsert`. A published version
   * is the record of what a homeowner was actually priced against — their
   * session pins its id, and schema.sql backs that with a BEFORE UPDATE
   * trigger — so the only safe thing to do with a version id that already
   * exists is nothing. Because the id is a hash of the payload (`versionId`),
   * "already exists" means "byte-identical", and an edited seed mints a new id
   * instead of colliding.
   *
   * Same line-per-statement rule as `upsert`, for the same reason.
   */
  const insertOnce = (table, columns, values) =>
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT(id) DO NOTHING;`;
  const out = [];
  out.push('-- Greenput pricing FSM seed — GENERATED by scripts/seed/pricing-fsms.mjs. Do not edit by hand.');
  out.push('-- Source of truth: seeds/pricing/*.json. Regenerate with: node scripts/seed/pricing-fsms.mjs sql');
  out.push('-- workspace_id is NULL on every row: these are Greenput global templates a contractor clones.');
  out.push('-- Graphs are stored FLAT (fragments already inlined) — that is the form the engine evaluates.');
  out.push('--');
  out.push('-- PUBLISHED VERSIONS ARE NEVER REWRITTEN. This file runs on every');
  out.push('-- production deploy, and a quote session pins the exact fsm_version_id and');
  out.push('-- rate_card_version_id it was priced against — that pin is the whole');
  out.push('-- reproducibility guarantee, and schema.sql enforces it with a trigger.');
  out.push('-- So version rows are INSERT ... ON CONFLICT DO NOTHING against a');
  out.push('-- CONTENT-ADDRESSED id: re-running changes nothing, and editing a seed');
  out.push("-- publishes a new version alongside the old one rather than over it.");
  out.push('--');
  out.push('-- (It used to be INSERT OR REPLACE, which SQLite implements as DELETE +');
  out.push('-- INSERT. That both slipped past the immutability trigger and, once any');
  out.push('-- homeowner had quoted, failed the foreign key from their session — so the');
  out.push('-- deploy that rewrote a live quote would have been the deploy that broke.)');
  out.push('');

  const rcId = stableId('rate_card', rateCard.slug);
  const rcJson = JSON.stringify(rateCard);
  const rcvId = versionId('rate_card_version', rateCard.slug, rcJson);
  out.push(upsert(TARGET_SCHEMA.rateCards.table, ['id', 'workspace_id', 'name'], [q(rcId), 'NULL', q(rateCard.name)]));
  out.push(
    insertOnce(
      TARGET_SCHEMA.rateCardVersions.table,
      ['id', 'rate_card_id', 'version_number', 'rates_json', 'status', 'published_at'],
      [
        q(rcvId),
        q(rcId),
        nextVersionNumber(TARGET_SCHEMA.rateCardVersions.table, 'rate_card_id', rcId),
        q(rcJson),
        `'published'`,
        `datetime('now')`,
      ],
    ),
  );
  out.push('');

  for (const m of machines) {
    const fsmId = stableId('fsm', m.slug);
    const graph = JSON.stringify(m);
    const verId = versionId('fsm_version', m.slug, graph);
    const description = m.meta?.homeowner_intro ?? '';
    out.push(`-- ${m.name}`);
    // The flow row first: `pricing_fsm_versions.fsm_id` is a real foreign key,
    // while `pricing_fsms.current_version_id` deliberately is not (a flow with
    // nothing published points at nothing). So this order is the only one that
    // applies to an empty database.
    out.push(
      upsert(
        TARGET_SCHEMA.fsms.table,
        ['id', 'workspace_id', 'slug', 'vertical', 'name', 'description', 'current_version_id'],
        [q(fsmId), 'NULL', q(m.slug), q(m.vertical), q(m.name), q(description), q(verId)],
      ),
    );
    out.push(
      insertOnce(
        TARGET_SCHEMA.fsmVersions.table,
        ['id', 'fsm_id', 'version_number', 'graph_json', 'status', 'published_at', 'created_by'],
        [
          q(verId),
          q(fsmId),
          nextVersionNumber(TARGET_SCHEMA.fsmVersions.table, 'fsm_id', fsmId),
          q(graph),
          `'published'`,
          `datetime('now')`,
          SYSTEM_USER,
        ],
      ),
    );
    out.push('');
  }
  return out.join('\n');
}

function buildAll() {
  const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
  return { rateCard, flat: machines };
}

/**
 * The seed SQL for the current seeds/pricing/*.json, as a string.
 *
 * Exported so pricing-fsms.test.mjs can replay it into node:sqlite and assert
 * it survives a redeploy. The CLI below is guarded for the same reason: it used
 * to run on import, so importing this module for any reason ran `check` and
 * called process.exit.
 */
export function buildSeedSql() {
  const { rateCard, flat } = buildAll();
  return emitSql({ rateCard, machines: flat });
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const cmd = isCli ? process.argv[2] || 'check' : null;

if (cmd === 'check') {
  const { rateCard, flat } = buildAll();
  let bad = 0;
  for (const m of flat) {
    const { errors, warnings, depth } = validate(m, rateCard);
    const status = errors.length ? 'FAIL' : 'ok';
    console.log(`\n${status}  ${m.slug}  (${m.states.length} states, ${m.terminals.length} outcomes, longest route ${depth} questions)`);
    for (const e of errors) console.log(`   error   ${e}`);
    for (const w of warnings) console.log(`   warn    ${w}`);
    if (errors.length) bad++;
  }
  console.log('');
  process.exit(bad ? 1 : 0);
}

if (cmd === 'build') {
  const outDir = process.argv[3] || join(SEED_DIR, 'build');
  const { flat } = buildAll();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const m of flat) writeFileSync(join(outDir, `${m.slug}.flat.json`), JSON.stringify(m, null, 2));
  console.log(`wrote ${flat.length} flattened graphs to ${outDir}`);
}

if (cmd === 'sql') {
  const { rateCard, flat } = buildAll();
  const sql = emitSql({ rateCard, machines: flat });
  const out = process.argv[3];
  if (out) { writeFileSync(out, sql + '\n'); console.log(`wrote ${out}`); } else console.log(sql);
}

function runFixture(fixturePath) {
  const fx = readJson(fixturePath);
  const { rateCard, flat } = buildAll();
  const m = flat.find((x) => x.slug === fx.machine);
  if (!m) throw new Error(`no machine "${fx.machine}"`);
  return { fx, result: evaluate(m, rateCard, fx.answers, fx.env || {}) };
}

function printQuote(name, fx, r) {
  console.log(`\n=== ${name} — ${fx.title || fx.machine} ===`);
  console.log(`route: ${r.path.join(' -> ')}`);
  console.log(`outcome: ${r.terminal} (${r.kind})`);
  if (r.kind === 'quote') {
    console.log('');
    for (const l of r.lines) {
      console.log(`  ${(l.label + (l.side === 'high_only' ? ' [high end only]' : '')).padEnd(52)} ${('$' + l.cost.toFixed(2)).padStart(10)}   ${l.detail}`);
    }
    console.log(`  ${'point estimate'.padEnd(52)} ${('$' + r.point.toFixed(2)).padStart(10)}`);
    if (r.point_high !== r.point) console.log(`  ${'point estimate, longer version'.padEnd(52)} ${('$' + r.point_high.toFixed(2)).padStart(10)}`);
    console.log(`  spread: ${r.spread_pct}%`);
    for (const w of r.spread_reasons) console.log(`     +${w.add_pct}%  ${w.because}`);
    console.log(`\n  RANGE  $${r.low.toLocaleString()} - $${r.high.toLocaleString()}`);
    for (const a of r.addons) console.log(`  addon: ${a.label} — $${a.cost}${a.placeholder ? ' (placeholder)' : ''}`);
    for (const c of r.conditions) console.log(`  says: ${c}`);
  } else if (r.kind === 'span') {
    for (const s of r.spans) console.log(`  ${s.id.padEnd(34)} $${s.low.toLocaleString()} - $${s.high.toLocaleString()}  (point $${s.point.toFixed(2)}, spread ${s.spread}%)`);
    console.log(`\n  RANGE  $${r.low.toLocaleString()} - $${r.high.toLocaleString()}`);
  } else {
    console.log(`  no price. ${r.refused_because || '(this outcome does not quote)'}`);
    if (r.indicative) console.log(`  indicative only (NOT a quote): $${r.indicative.low.toLocaleString()} - $${r.indicative.high.toLocaleString()}`);
  }
}

if (cmd === 'quote') {
  const p = process.argv[3];
  const { fx, result } = runFixture(resolve(p));
  printQuote(basename(p), fx, result);
  console.log('');
}

if (cmd === 'apply') {
  // Generate the SQL and hand it straight to wrangler. Nothing is written to the repo:
  // seeds/pricing/*.json is the source of truth, SQL is a transport format.
  //
  // schema.sql is prepended so a brand-new LOCAL database gets the four tables
  // this seed writes to. It is every-table-IF-NOT-EXISTS, so it is safe to
  // replay. A long-lived database gets them from migrations/ instead — never
  // from here. (This used to prepend seeds/pricing/provisional-schema.sql,
  // which was deleted the moment the engine's migration landed, exactly as its
  // header instructed.)
  const env = process.argv[3] || 'local';
  const dbName = process.argv[4] || 'greenput';
  const { rateCard, flat } = buildAll();
  const schema = readFileSync(join(REPO, 'schema.sql'), 'utf8');
  const sql = `${schema}\n${emitSql({ rateCard, machines: flat })}\n`;
  const tmp = join(REPO, 'node_modules', '.cache');
  mkdirSync(tmp, { recursive: true });
  const file = join(tmp, 'pricing-fsms.seed.sql');
  writeFileSync(file, sql);
  const flag = env === 'local' ? '--local' : `--remote --env ${env}`;
  console.log(`wrote ${file} (${(sql.length / 1024).toFixed(0)} KB)`);
  console.log(`now run:  npx wrangler d1 execute ${dbName} ${flag} --file=${file}`);
}

if (cmd === 'expect') {
  // Freeze every fixture's output as a conformance oracle for the engine.
  const files = listFixtureFiles(FIXTURE_DIR);
  for (const f of files) {
    const { result } = runFixture(join(FIXTURE_DIR, f));
    const frozen = {
      _note: 'GENERATED by scripts/seed/pricing-fsms.mjs expect. The real evaluator must reproduce these exactly.',
      terminal: result.terminal, kind: result.kind, low: result.low, high: result.high,
      point: result.point ?? null, spread_pct: result.spread_pct ?? null,
      minimum_applied: result.minimum_applied ?? null,
      refused_because: result.refused_because ?? null,
      indicative: result.indicative ?? null,
      spans: (result.spans || []).map((s) => ({ id: s.id, low: s.low, high: s.high })),
      lines: (result.lines || []).map((l) => ({ id: l.id, qty: l.qty, cost: l.cost, side: l.side })),
      path: result.path,
    };
    writeFileSync(join(FIXTURE_DIR, f.replace('.json', '.expected.json')), JSON.stringify(frozen, null, 2) + '\n');
  }
  console.log(`froze ${files.length} expected outputs`);
}

if (cmd === 'verify') {
  // Re-run every fixture and diff against the frozen expectation.
  const files = listFixtureFiles(FIXTURE_DIR);
  let bad = 0;
  for (const f of files) {
    const expPath = join(FIXTURE_DIR, f.replace('.json', '.expected.json'));
    if (!existsSync(expPath)) { console.log(`MISSING expectation for ${f}`); bad++; continue; }
    const exp = readJson(expPath);
    const { result } = runFixture(join(FIXTURE_DIR, f));
    const same = exp.terminal === result.terminal && exp.low === result.low && exp.high === result.high;
    console.log(`${same ? 'ok  ' : 'FAIL'} ${f.padEnd(38)} ${result.low === null ? 'no quote' : '$' + result.low + ' - $' + result.high} (expected ${exp.low === null ? 'no quote' : '$' + exp.low + ' - $' + exp.high})`);
    if (!same) bad++;
  }
  process.exit(bad ? 1 : 0);
}

if (cmd === 'quote-all') {
  const files = listFixtureFiles(FIXTURE_DIR);
  for (const f of files) {
    const { fx, result } = runFixture(join(FIXTURE_DIR, f));
    printQuote(f.replace('.json', ''), fx, result);
  }
  console.log('');
}
