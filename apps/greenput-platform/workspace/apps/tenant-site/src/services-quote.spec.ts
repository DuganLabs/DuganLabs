import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
// By relative path, as intake-routes.spec.ts does: the seed loader reads
// seeds/pricing/ with node:fs and is kept out of the barrel. Read-only use.
import { loadFlattenedSeed } from '../../../libs/shared/pricing/src/seed-loader';
import handler from './index.js';
import type { Env } from './env.js';
import { flowForService } from './service-flow';

/**
 * Warren's report (2026-11-01): starting a quote from the Services page made
 * him pick the same service twice — once on the card, then again on the
 * /quote picker. A service card that maps to a published flow now starts that
 * flow in one click, landing on its first real question. /quote with no
 * service still shows the picker.
 */

const ROOT = resolve(__dirname, '../../..');
const SEED_DIR = join(ROOT, 'seeds', 'pricing');
const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

let sqlite: SqliteD1;
let env: Env;

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [
      resolve(ROOT, 'schema.sql'),
      resolve(ROOT, 'scripts/preview/seed.sql'),
    ],
    sql: [
      `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Greenput default');`,
      `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
         VALUES ('rcv', 'rc', 1, ${q(JSON.stringify(rateCard))}, 'published');`,
      ...machines.flatMap((m, i) => [
        `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, description, current_version_id)
           VALUES ('fsm${i}', NULL, ${q(m.slug)}, ${q(m.vertical)}, ${q(m.name)}, '', 'fsmv${i}');`,
        `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
           VALUES ('fsmv${i}', 'fsm${i}', 1, ${q(JSON.stringify(m))}, 'published');`,
      ]),
    ],
  });
  env = { DB: sqlite.db, ENVIRONMENT: 'test' };
});
afterEach(() => sqlite.close());

const fetchPage = (url: string, init?: RequestInit) =>
  handler.fetch(new Request(url, { redirect: 'manual', ...init }), env);

/** The card on /services whose heading is `name`. */
function cardFor(html: string, name: string): string {
  const cards = html.split('<li data-bn="bn-info-card">').slice(1);
  const card = cards.find((c) => c.startsWith(`<h2>${name}</h2>`));
  if (!card) throw new Error(`no service card "${name}"`);
  return card.slice(0, card.indexOf('</li>'));
}

const sessions = () => sqlite.rows('pricing_quote_sessions');

describe('Services page → quote, one service pick', () => {
  it('a mapped service starts its flow in one click and opens at the first real question', async () => {
    const services = await fetchPage('https://demo.greenput.com/services');
    expect(services.status).toBe(200);
    const card = cardFor(await services.text(), 'EV Charger Installation');
    expect(card).toContain('<form method="post" action="/quote/start"');
    expect(card).toContain(
      '<input type="hidden" name="flow" value="ev-charger-install">',
    );
    // Rendering the page is a GET: it must not have started anything.
    expect(sessions()).toHaveLength(0);

    const fd = new FormData();
    fd.set('flow', 'ev-charger-install');
    const started = await fetchPage('https://demo.greenput.com/quote/start', {
      method: 'POST',
      body: fd,
    });
    expect(started.status).toBe(303);
    const location = started.headers.get('Location') ?? '';
    expect(location).toMatch(/^\/quote\/s\/[0-9a-f-]{36}$/);
    expect(sessions()).toHaveLength(1);

    const first = await fetchPage(`https://demo.greenput.com${location}`);
    expect(first.status).toBe(200);
    const html = await first.text();
    // A question screen, the first one — not the service picker again.
    expect(html).toContain('name="stateId"');
    expect(html).toContain('Question 1 of about');
    expect(html).not.toContain('Get a real price');
    expect(html).not.toContain('name="flow"');
  });

  it('a service with no matching flow still goes to the picker', async () => {
    const html = await (
      await fetchPage('https://demo.greenput.com/services')
    ).text();
    const card = cardFor(html, 'Ceiling Fan Installation');
    expect(card).not.toContain('action="/quote/start"');
    expect(card).toContain('href="/quote"');
  });

  it('/quote with no service shows the picker with every published flow', async () => {
    const res = await fetchPage('https://demo.greenput.com/quote');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Get a real price');
    expect(html.match(/action="\/quote\/start"/g)).toHaveLength(
      machines.length,
    );
    expect(sessions()).toHaveLength(0);
  });
});

describe('flowForService', () => {
  const flows = machines.map((m) => ({
    slug: m.slug,
    name: m.name,
    vertical: m.vertical,
  }));
  it.each([
    ['EV Charger Installation', 'ev-charger-install'],
    ['ev_charger', 'ev-charger-install'],
    ['ev-charger-install', 'ev-charger-install'],
    ['Tesla Wall Connector install', 'ev-charger-install'],
    ['Panel Upgrade', 'panel-service-upgrade'],
    ['Outlet & Switch Installation', 'circuit-outlet-addition'],
    ['Whole-home surge protection', 'whole-home-surge-protection'],
  ])('maps %s to %s', (service, slug) => {
    expect(flowForService(service, flows)?.slug).toBe(slug);
  });
  it.each([
    'Ceiling Fan Installation',
    'Generator Installation',
    'Whole-Home Rewiring',
  ])('leaves %s unmapped', (service) => {
    expect(flowForService(service, flows)).toBeNull();
  });
  it('never maps to a flow the tenant does not publish', () => {
    expect(
      flowForService(
        'EV Charger Installation',
        flows.filter((f) => f.vertical !== 'ev_charger'),
      ),
    ).toBeNull();
  });
});

describe('workers.dev preview keeps ?slug= through the quote', () => {
  const HOST = 'https://greenput-tenant-staging.example.workers.dev';

  it('carries ?slug= on every same-site link and form', async () => {
    const html = await (await fetchPage(`${HOST}/services?slug=demo`)).text();
    const internal = [
      ...html.matchAll(/\s(?:href|action)="(\/(?!\/)[^"]*)"/g),
    ].map((m) => m[1]);
    const pages = internal.filter(
      (p) => !/^\/(css|js|fonts|img|favicon)/.test(p) && !p.startsWith('/#'),
    );
    expect(pages.length).toBeGreaterThan(5);
    for (const p of pages) expect(p, p).toMatch(/[?&]slug=demo(&|#|$)/);
    expect(html).toContain('action="/quote/start?slug=demo"');
  });

  it('keeps the slug on the redirect into the session', async () => {
    const fd = new FormData();
    fd.set('flow', 'ev-charger-install');
    const started = await fetchPage(`${HOST}/quote/start?slug=demo`, {
      method: 'POST',
      body: fd,
    });
    expect(started.status).toBe(303);
    const location = started.headers.get('Location') ?? '';
    expect(location).toMatch(/^\/quote\/s\/[0-9a-f-]{36}\?slug=demo$/);
    const first = await (await fetchPage(`${HOST}${location}`)).text();
    expect(first).toContain('Question 1 of about');
    expect(first).toMatch(/action="\/quote\/s\/[0-9a-f-]{36}\?slug=demo"/);
  });

  it('leaves real hosts alone', async () => {
    const html = await (
      await fetchPage('https://demo.greenput.com/services?slug=demo')
    ).text();
    expect(html).not.toContain('slug=demo');
  });
});
