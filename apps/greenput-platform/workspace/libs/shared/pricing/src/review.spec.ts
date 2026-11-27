import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { loadFlattenedSeed, readFixture } from './seed-loader.ts';
import { storePanelPhoto } from './photo.ts';
import {
  ReviewNotFoundError,
  fitsInside,
  resolvePhotoReview,
} from './review.ts';
import { createLeadFromQuote } from './lead.ts';
import { step } from './session.ts';
import { completeSession, type D1Like, type QuoteSessionRow } from './store.ts';

/**
 * "Re-evaluation may only move the range INSIDE what was shown."
 *
 * That sentence is in the seeded `T_needs_panel_review` terminal, and these
 * tests are it. Everything runs the real EV machine against the real rate
 * card, so the bands below are the ones a homeowner would actually be shown:
 *
 *   no photo          925 – 2500   (spanning: room in the panel, or not)
 *   photo, unread     925 – 2450   ("your photo's with us")
 *   read: room        1000 – 1275  (the frozen fixture)
 *   read: no room     1700 – 2450  (still inside the span)
 *   read: recalled    no price     (escapes — a person calls)
 */

const ROOT = resolve(__dirname, '../../../..');
const SCHEMA = resolve(ROOT, 'schema.sql');
const SEED_DIR = resolve(ROOT, 'seeds/pricing');
const WS = 'ws-1';
const SESSION = '11111111-1111-4111-8111-111111111111';

const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const ev = machines.find((m) => m.slug === 'ev-charger-install');
if (!ev) throw new Error('the EV machine is missing from seeds/pricing');
const fixture = readFixture(resolve(SEED_DIR, 'fixtures/01-ev-typical.json'));
const READING = (
  fixture.answers['panel_photo'] as { fields: Record<string, unknown> }
).fields;

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

let sqlite: SqliteD1;
let db: D1Like;
let ids = 0;
const newId = () => `id-${(ids += 1)}`;

function fakeBucket() {
  const objects = new Map<string, unknown>();
  return {
    put: async (key: string) => {
      objects.set(key, true);
      return { key };
    },
    get: async () => null,
    delete: async () => undefined,
    head: async () => null,
  } as unknown as R2Bucket;
}

/** The fixture's answers, minus the panel reading nobody has taken yet. */
function answersWithoutReading(): Record<string, unknown> {
  const { ...rest } = fixture.answers as Record<string, unknown>;
  delete rest['panel_photo'];
  return rest;
}

async function loadRow(id: string): Promise<QuoteSessionRow> {
  const row = await sqlite.db
    .prepare('SELECT * FROM pricing_quote_sessions WHERE id = ?')
    .bind(id)
    .first<QuoteSessionRow>();
  if (!row) throw new Error('session vanished');
  return row;
}

/**
 * Take the form to the end with a photo attached but unread, freeze the quote,
 * and hand the contractor the lead — the exact state the review queue acts on.
 */
async function quotedWithUnreadPhoto(): Promise<{ reviewId: string }> {
  const answers = answersWithoutReading();
  await sqlite.db
    .prepare('UPDATE pricing_quote_sessions SET answers = ? WHERE id = ?')
    .bind(JSON.stringify(answers), SESSION)
    .run();

  const stored = await storePanelPhoto({
    bucket: fakeBucket(),
    db,
    workspaceId: WS,
    sessionId: SESSION,
    answerKey: 'panel_photo',
    vertical: 'ev_charger',
    file: new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) as BlobPart],
      'panel.jpg',
      { type: 'image/jpeg' },
    ),
    uploadedBy: 'u-owner',
    newId,
  });

  const row = await loadRow(SESSION);
  const walked = step(ev!, rateCard, {
    ...answers,
    panel_photo: { status: 'unreviewed', fields: {} },
  });
  if (walked.status !== 'complete') throw new Error('form did not finish');
  const frozen = await completeSession(db, row, walked.result);
  await createLeadFromQuote({
    db,
    session: frozen,
    machine: ev!,
    answers: walked.result.answers,
    result: walked.result,
    newId,
  });
  return { reviewId: stored.reviewId };
}

const resolveWith = (
  reviewId: string,
  fields: Record<string, unknown>,
  status: 'reviewed' | 'unreadable' = 'reviewed',
) =>
  resolvePhotoReview({
    db,
    reviewId,
    workspaceId: WS,
    status,
    fields: fields as never,
    reviewedBy: 'u-owner',
    newId,
    now: '2026-09-11T13:00:00.000Z',
  });

beforeEach(() => {
  ids = 0;
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      `INSERT INTO workspaces (id, name, slug) VALUES ('${WS}', 'Acme', 'acme');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u-owner', '${WS}', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Default');`,
      `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
         VALUES ('rcv', 'rc', 1, ${q(JSON.stringify(rateCard))}, 'published');`,
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, current_version_id)
         VALUES ('fsm', NULL, 'ev-charger-install', 'ev_charger', 'EV', 'fsmv');`,
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
         VALUES ('fsmv', 'fsm', 1, ${q(JSON.stringify(ev))}, 'published');`,
      `INSERT INTO pricing_quote_sessions (id, workspace_id, fsm_id, fsm_version_id, rate_card_version_id, answers, env)
         VALUES ('${SESSION}', '${WS}', 'fsm', 'fsmv', 'rcv', '{}', '{}');`,
    ],
  });
  db = sqlite.db as unknown as D1Like;
});

afterEach(() => sqlite.close());

describe('fitsInside', () => {
  it('is the narrowing rule and nothing more', () => {
    expect(
      fitsInside({ low: 925, high: 2450 }, { low: 1000, high: 1275 }),
    ).toBe(true);
    // The identical band is inside itself.
    expect(fitsInside({ low: 925, high: 2450 }, { low: 925, high: 2450 })).toBe(
      true,
    );
    // A dollar over the top is over the top.
    expect(
      fitsInside({ low: 925, high: 2450 }, { low: 1000, high: 2451 }),
    ).toBe(false);
    expect(fitsInside({ low: 925, high: 2450 }, { low: 924, high: 1275 })).toBe(
      false,
    );
    // No price at all is not "inside" anything — that is the case the rule is
    // for, not an edge case it forgot.
    expect(
      fitsInside({ low: 925, high: 2450 }, { low: null, high: null }),
    ).toBe(false);
    expect(fitsInside({ low: null, high: null }, { low: 1, high: 2 })).toBe(
      false,
    );
  });
});

describe('resolvePhotoReview', () => {
  it('narrows the shown range and qualifies the lead', async () => {
    const { reviewId } = await quotedWithUnreadPhoto();
    const before = sqlite.rows<Record<string, unknown>>('leads')[0];
    expect(before['status']).toBe('new');
    expect(before['qualified_at']).toBeNull();

    const outcome = await resolveWith(reviewId, READING);

    expect(outcome.kind).toBe('narrowed');
    if (outcome.kind !== 'narrowed') throw new Error('unreachable');
    expect(outcome.shown).toEqual({ low: 925, high: 2450 });
    expect(outcome.revealed).toEqual({ low: 1000, high: 1275 });
    expect(outcome.result.terminal).toBe('T_standard_install');
    expect(outcome.qualified).toBe(true);

    // The session now carries the narrowed quote, pinned to the same versions.
    const row = await loadRow(SESSION);
    expect(row.quote_low).toBe(1000);
    expect(row.quote_high).toBe(1275);
    expect(row.terminal_id).toBe('T_standard_install');
    expect(row.fsm_version_id).toBe('fsmv');
    expect(row.rate_card_version_id).toBe('rcv');

    const lead = sqlite.rows<Record<string, unknown>>('leads')[0];
    expect(lead['status']).toBe('qualified');
    expect(lead['qualified_at']).toBe('2026-09-11T13:00:00.000Z');
    expect(lead['estimated_value']).toBe(113750); // cents, GP-111
    // Qualification is not billing.
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);

    const log = sqlite
      .rows<Record<string, unknown>>('activity_log')
      .map((r) => r['action']);
    expect(log).toContain('qualified');
    expect(log).toContain('quote_narrowed');
  });

  it('narrows to the expensive outcome too, because it was in the span', async () => {
    const { reviewId } = await quotedWithUnreadPhoto();
    const outcome = await resolveWith(reviewId, {
      ...READING,
      panel_capacity: 'full_needs_subpanel',
    });

    expect(outcome.kind).toBe('narrowed');
    if (outcome.kind !== 'narrowed') throw new Error('unreachable');
    expect(outcome.result.terminal).toBe('T_subpanel_required');
    // Higher than the fixture, still inside the band the homeowner saw.
    expect(outcome.revealed.high).toBeLessThanOrEqual(2450);
    expect(outcome.qualified).toBe(true);
    expect((await loadRow(SESSION)).terminal_id).toBe('T_subpanel_required');
  });

  it('refuses to reprice, and asks for a phone call, when the photo escapes the range', async () => {
    const { reviewId } = await quotedWithUnreadPhoto();

    // A recalled panel brand. The machine will not put a price on this at all,
    // which is exactly the outcome the shown range does not cover.
    const outcome = await resolveWith(reviewId, {
      ...READING,
      panel_capacity: 'hazard_panel',
      panel_brand: 'federal_pacific',
    });

    expect(outcome.kind).toBe('requires_call');
    if (outcome.kind !== 'requires_call') throw new Error('unreachable');
    expect(outcome.shown).toEqual({ low: 925, high: 2450 });
    expect(outcome.revealed).toEqual({ low: null, high: null });
    expect(outcome.reason).toMatch(/call them/i);

    // NOTHING was rewritten. The homeowner's quote is the one they were shown.
    const row = await loadRow(SESSION);
    expect(row.quote_low).toBe(925);
    expect(row.quote_high).toBe(2450);
    expect(row.terminal_id).toBe('T_needs_panel_review');

    // And the lead did not silently qualify off a price nobody stands behind.
    const lead = sqlite.rows<Record<string, unknown>>('leads')[0];
    expect(lead['status']).toBe('new');
    expect(lead['qualified_at']).toBeNull();

    // The reading itself IS recorded — a hazard we noticed must not be lost
    // because it could not be priced.
    const review = sqlite.rows<Record<string, unknown>>(
      'pricing_photo_reviews',
    )[0];
    expect(review['status']).toBe('reviewed');
    expect(JSON.parse(String(review['fields_json']))['panel_capacity']).toBe(
      'hazard_panel',
    );
    expect(
      sqlite
        .rows<Record<string, unknown>>('activity_log')
        .map((r) => r['action']),
    ).toContain('quote_requires_call');
  });

  it('reports an unreadable photo as leaving the range where it was', async () => {
    const { reviewId } = await quotedWithUnreadPhoto();
    // Reviewed, but nothing could be made out. `unreadable` is a status the
    // machine prices from, and it is not `unreviewed`, so the band moves.
    const outcome = await resolveWith(reviewId, {}, 'unreadable');
    expect(['narrowed', 'unchanged', 'requires_call']).toContain(outcome.kind);
    // Whatever it is, the session never leaves the versions it was quoted on.
    const row = await loadRow(SESSION);
    expect(row.fsm_version_id).toBe('fsmv');
  });

  it('records a reading that beats the homeowner to the finish line', async () => {
    // Ops reviews the photo while the form is still being filled in.
    await sqlite.db
      .prepare('UPDATE pricing_quote_sessions SET answers = ? WHERE id = ?')
      .bind(
        JSON.stringify({ charger_location: 'attached_garage_inside' }),
        SESSION,
      )
      .run();
    const stored = await storePanelPhoto({
      bucket: fakeBucket(),
      db,
      workspaceId: WS,
      sessionId: SESSION,
      answerKey: 'panel_photo',
      vertical: 'ev_charger',
      file: new File([new Uint8Array([1, 2, 3, 4]) as BlobPart], 'p.jpg', {
        type: 'image/jpeg',
      }),
      uploadedBy: 'u-owner',
      newId,
    });

    const outcome = await resolveWith(stored.reviewId, READING);
    expect(outcome.kind).toBe('pending');
    // The reading is stored, so the price they eventually see is the narrow
    // one — no second pass needed.
    const review = sqlite.rows<Record<string, unknown>>(
      'pricing_photo_reviews',
    )[0];
    expect(review['status']).toBe('reviewed');
    expect((await loadRow(SESSION)).status).toBe('in_progress');
  });

  it('will not resolve a review belonging to another workspace', async () => {
    const { reviewId } = await quotedWithUnreadPhoto();
    await sqlite.db
      .prepare(
        `INSERT INTO workspaces (id, name, slug) VALUES ('ws-2', 'Other', 'other')`,
      )
      .run();

    await expect(
      resolvePhotoReview({
        db,
        reviewId,
        workspaceId: 'ws-2',
        status: 'reviewed',
        fields: READING as never,
        reviewedBy: 'u-owner',
        newId,
      }),
    ).rejects.toBeInstanceOf(ReviewNotFoundError);

    // Untouched.
    expect((await loadRow(SESSION)).quote_low).toBe(925);
  });

  it('prices against the version the quote was pinned to, not the current one', async () => {
    const { reviewId } = await quotedWithUnreadPhoto();

    // Publish a version 2 whose standard install costs far more, and point the
    // flow at it — exactly what a contractor tuning their rates would do.
    const dearer = JSON.parse(JSON.stringify(rateCard)) as {
      labor: { electrician_hourly: { value: number } };
    };
    dearer.labor.electrician_hourly.value = 400;
    await sqlite.db
      .prepare(
        `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
         VALUES ('rcv2', 'rc', 2, ?, 'published')`,
      )
      .bind(JSON.stringify(dearer))
      .run();

    const outcome = await resolveWith(reviewId, READING);
    expect(outcome.kind).toBe('narrowed');
    if (outcome.kind !== 'narrowed') throw new Error('unreachable');
    // The frozen fixture's numbers, from the pinned card — not the new one.
    expect(outcome.revealed).toEqual({ low: 1000, high: 1275 });
    expect((await loadRow(SESSION)).rate_card_version_id).toBe('rcv');
  });
});
