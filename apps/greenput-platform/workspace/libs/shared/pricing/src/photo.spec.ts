import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  ALLOWED_PHOTO_TYPES,
  AUTOMATED_CONFIDENCE_FLOOR,
  MAX_PHOTO_BYTES,
  PhotoError,
  effectiveAnswers,
  gateReading,
  isPhotoStatus,
  listPendingReviews,
  loadPhotoReview,
  photoAnswerOf,
  readPhoto,
  recordReview,
  sanitizeFilename,
  storePanelPhoto,
  unresolvedClassifier,
  withPhotoReadings,
  type PhotoClassifier,
} from './photo.ts';
import type { D1Like, QuoteSessionRow } from './store.ts';

/**
 * The panel photo: what the server keeps, and who is allowed to say what it
 * shows.
 *
 * The interesting assertions here are all the same assertion: a verdict about
 * a homeowner's panel is server-held. Nothing a request body contains can
 * become one, an automated reading has to clear a confidence floor before it
 * counts, and everything else lands in a queue for a person.
 */

const ROOT = resolve(__dirname, '../../../..');
const SCHEMA = resolve(ROOT, 'schema.sql');
const WS = 'ws-1';
const SESSION = 'sess-1';

let sqlite: SqliteD1;
let db: D1Like;
let ids = 0;
const newId = () => `id-${(ids += 1)}`;

/** An R2-shaped bucket that keeps what it is given. */
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

let bucket: ReturnType<typeof fakeBucket>;

const jpeg = (name = 'panel.jpg') =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) as BlobPart], name, {
    type: 'image/jpeg',
  });

const session = (overrides: Partial<QuoteSessionRow> = {}): QuoteSessionRow =>
  ({
    id: SESSION,
    workspace_id: WS,
    fsm_id: 'fsm',
    fsm_version_id: 'fsmv',
    rate_card_version_id: 'rcv',
    lead_id: null,
    status: 'in_progress',
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
    completed_at: null,
    ...overrides,
  }) as QuoteSessionRow;

const store = (file = jpeg(), answerKey = 'panel_photo') =>
  storePanelPhoto({
    bucket: bucket as unknown as R2Bucket,
    db,
    workspaceId: WS,
    sessionId: SESSION,
    answerKey,
    vertical: 'ev_charger',
    file,
    uploadedBy: 'u-owner',
    newId,
    now: '2026-09-11T12:00:00.000Z',
  });

beforeEach(() => {
  ids = 0;
  bucket = fakeBucket();
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      `INSERT INTO workspaces (id, name, slug) VALUES ('${WS}', 'Acme', 'acme');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u-owner', '${WS}', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Default');`,
      `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
         VALUES ('rcv', 'rc', 1, '{}', 'published');`,
      `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name)
         VALUES ('fsm', NULL, 'ev-charger-install', 'ev_charger', 'EV');`,
      `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
         VALUES ('fsmv', 'fsm', 1, '{}', 'published');`,
      `INSERT INTO pricing_quote_sessions (id, workspace_id, fsm_id, fsm_version_id, rate_card_version_id, answers, env)
         VALUES ('${SESSION}', '${WS}', 'fsm', 'fsmv', 'rcv', '{}', '{}');`,
    ],
  });
  db = sqlite.db as unknown as D1Like;
});

afterEach(() => sqlite.close());

describe('storePanelPhoto', () => {
  it('stores the bytes, records the file, and opens an unresolved review', async () => {
    const stored = await store();

    expect(bucket.objects.size).toBe(1);
    expect(stored.r2Key).toBe(`${WS}/quote-session/${SESSION}/id-1-panel.jpg`);
    // The bytes are not round-tripped through any text encoding.
    expect([...(bucket.objects.get(stored.r2Key)?.body ?? [])]).toEqual([
      0xff, 0xd8, 0xff, 0xe0,
    ]);

    const file = sqlite.rows<Record<string, unknown>>('files')[0];
    expect(file['entity_type']).toBe('pricing_quote_session');
    expect(file['entity_id']).toBe(SESSION);
    expect(file['r2_key']).toBe(stored.r2Key);
    expect(file['size']).toBe(4);

    const review = await loadPhotoReview(db, SESSION, 'panel_photo');
    expect(review?.status).toBe('unreviewed');
    expect(review?.method).toBe('unresolved');
    expect(review?.fields_json).toBe('{}');
    expect(review?.confidence).toBeNull();
    expect(review?.reviewed_at).toBeNull();
  });

  it('refuses anything that is not a photo we can read', async () => {
    await expect(
      store(new File([] as BlobPart[], 'empty.jpg', { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'EMPTY_FILE' });

    await expect(
      store(
        new File([new Uint8Array([1, 2, 3]) as BlobPart], 'invoice.pdf', {
          type: 'application/pdf',
        }),
      ),
    ).rejects.toBeInstanceOf(PhotoError);

    const huge = new File([new Uint8Array(16) as BlobPart], 'big.jpg', {
      type: 'image/jpeg',
    });
    Object.defineProperty(huge, 'size', { value: MAX_PHOTO_BYTES + 1 });
    await expect(store(huge)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });

    // Nothing was written for any of them.
    expect(sqlite.rows('files')).toHaveLength(0);
    expect(sqlite.rows('pricing_photo_reviews')).toHaveLength(0);
    expect(bucket.objects.size).toBe(0);

    // The list is the one a phone camera actually produces.
    expect(ALLOWED_PHOTO_TYPES).toContain('image/heic');
  });

  it('replaces the review when the photo is retaken, clearing the old verdict', async () => {
    const first = await store();
    await recordReview(db, {
      reviewId: first.reviewId,
      workspaceId: WS,
      status: 'reviewed',
      fields: { panel_capacity: 'spare_capable' },
      reviewedBy: 'u-owner',
    });

    const second = await store(jpeg('better.jpg'));

    // One review per screen, not one per attempt.
    expect(sqlite.rows('pricing_photo_reviews')).toHaveLength(1);
    const review = await loadPhotoReview(db, SESSION, 'panel_photo');
    expect(review?.file_id).toBe(second.fileId);
    // A verdict describes an image. A different image has no verdict yet.
    expect(review?.status).toBe('unreviewed');
    expect(review?.fields_json).toBe('{}');
    expect(review?.reviewed_by).toBeNull();
    // Both files survive: the earlier one is evidence, not garbage.
    expect(sqlite.rows('files')).toHaveLength(2);
  });
});

describe('sanitizeFilename', () => {
  it('strips anything that could escape the key prefix', () => {
    // Separators become underscores and the leading dots go, so the result
    // can neither traverse out of the prefix nor land as a dotfile.
    expect(sanitizeFilename('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFilename('..')).toBe('panel-photo');
    expect(sanitizeFilename('')).toBe('panel-photo');
    expect(sanitizeFilename('my panel (1).JPG')).toBe('my_panel__1_.JPG');
    expect(sanitizeFilename('a'.repeat(500))).toHaveLength(128);
  });
});

describe('the classification seam', () => {
  it('ships declining to guess, which is what leaves the range wide', async () => {
    const reading = await unresolvedClassifier.classify({
      fileId: 'f',
      contentType: 'image/jpeg',
      byteLength: 4,
      answerKey: 'panel_photo',
      vertical: 'ev_charger',
    });
    expect(reading.status).toBe('unreviewed');
    expect(reading.fields).toEqual({});
    expect(reading.method).toBe('unresolved');
  });

  it('sends a hesitant model back to the human queue', () => {
    const confident = {
      method: 'automated_classification' as const,
      status: 'reviewed' as const,
      fields: { panel_capacity: 'spare_capable' },
      confidence: AUTOMATED_CONFIDENCE_FLOOR,
    };
    expect(gateReading(confident)).toEqual(confident);

    const hesitant = { ...confident, confidence: 0.6 };
    expect(gateReading(hesitant)).toMatchObject({
      status: 'unreviewed',
      fields: {},
    });
    // A model that reports no confidence at all is a hesitant model.
    expect(gateReading({ ...confident, confidence: null })).toMatchObject({
      status: 'unreviewed',
    });

    // A human is never second-guessed by the floor.
    const human = {
      method: 'contractor_review' as const,
      status: 'reviewed' as const,
      fields: { panel_capacity: 'full_needs_subpanel' },
      confidence: null,
    };
    expect(gateReading(human)).toEqual(human);
  });

  it('lets a classifier plug in with no other change', async () => {
    const classifier: PhotoClassifier = {
      name: 'test',
      classify: async () => ({
        method: 'automated_classification',
        status: 'reviewed',
        fields: { panel_capacity: 'spare_capable', panel_spaces_free: 4 },
        confidence: 0.97,
      }),
    };
    await storePanelPhoto({
      bucket: bucket as unknown as R2Bucket,
      db,
      workspaceId: WS,
      sessionId: SESSION,
      answerKey: 'panel_photo',
      vertical: 'ev_charger',
      file: jpeg(),
      uploadedBy: 'u-owner',
      classifier,
      newId,
    });

    const review = await loadPhotoReview(db, SESSION, 'panel_photo');
    expect(review?.method).toBe('automated_classification');
    expect(review?.status).toBe('reviewed');
    expect(JSON.parse(review?.fields_json ?? '{}')).toEqual({
      panel_capacity: 'spare_capable',
      panel_spaces_free: 4,
    });
    // And it is therefore no longer anyone's job to look at.
    expect(await listPendingReviews(db, WS)).toHaveLength(0);
  });
});

describe('withPhotoReadings', () => {
  it('overrides whatever the client stored for that screen', async () => {
    const stored = await store();
    await recordReview(db, {
      reviewId: stored.reviewId,
      workspaceId: WS,
      status: 'reviewed',
      fields: { panel_capacity: 'full_needs_subpanel' },
      reviewedBy: 'u-owner',
    });

    // The homeowner's own claim about their panel, as it would arrive.
    const claimed = {
      panel_photo: {
        status: 'reviewed',
        fields: { panel_capacity: 'spare_capable' },
      },
      charger_location: 'attached_garage_inside',
    };
    const merged = await withPhotoReadings(db, SESSION, claimed);

    expect(merged['panel_photo']).toEqual({
      status: 'reviewed',
      fields: { panel_capacity: 'full_needs_subpanel' },
    });
    // Everything else is untouched.
    expect(merged['charger_location']).toBe('attached_garage_inside');
  });

  it('leaves answers alone when no photo has been uploaded', async () => {
    const answers = { panel_photo: { status: 'missing', fields: {} } };
    expect(await withPhotoReadings(db, SESSION, answers)).toBe(answers);
  });

  it('reads a corrupt stored reading as no reading rather than throwing', async () => {
    const stored = await store();
    await sqlite.db
      .prepare('UPDATE pricing_photo_reviews SET fields_json = ? WHERE id = ?')
      .bind('not json', stored.reviewId)
      .run();

    const merged = await withPhotoReadings(db, SESSION, {});
    expect(merged['panel_photo']).toEqual({ status: 'unreviewed', fields: {} });
  });

  it('holds no reading for a photo the homeowner stepped back past', async () => {
    const stored = await store();
    await recordReview(db, {
      reviewId: stored.reviewId,
      workspaceId: WS,
      status: 'reviewed',
      fields: { panel_capacity: 'full_needs_subpanel' },
      reviewedBy: 'u-owner',
    });
    // The mark `rewindTo` / `restartSession` leave on the row (GP-014).
    await sqlite.db
      .prepare(
        `UPDATE pricing_photo_reviews SET status = 'missing' WHERE id = ?`,
      )
      .bind(stored.reviewId)
      .run();

    // Nothing stands: the photo screen will be asked again.
    expect(await withPhotoReadings(db, SESSION, {})).toEqual({});
    // And a re-upload's upsert brings the same row back into force.
    await store();
    expect((await withPhotoReadings(db, SESSION, {}))['panel_photo']).toEqual({
      status: 'unreviewed',
      fields: {},
    });
    expect(sqlite.rows('pricing_photo_reviews')).toHaveLength(1);
  });

  it('is what effectiveAnswers() layers over the session row', async () => {
    const stored = await store();
    await recordReview(db, {
      reviewId: stored.reviewId,
      workspaceId: WS,
      status: 'unreadable',
      fields: {},
      reviewedBy: 'u-owner',
    });
    const answers = await effectiveAnswers(
      db,
      session({ answers: JSON.stringify({ charge_speed: '32a' }) }),
    );
    expect(answers).toEqual({
      charge_speed: '32a',
      panel_photo: { status: 'unreadable', fields: {} },
    });
  });
});

describe('the review queue', () => {
  it('lists only this workspace, and only what is still unread', async () => {
    const stored = await store();
    const listed = await listPendingReviews(db, WS);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      reviewId: stored.reviewId,
      sessionId: SESSION,
      answerKey: 'panel_photo',
      filename: 'panel.jpg',
      contentType: 'image/jpeg',
      leadId: null,
      leadName: null,
    });

    // Another contractor's queue is empty, not forbidden.
    await sqlite.db
      .prepare(
        `INSERT INTO workspaces (id, name, slug) VALUES ('ws-2', 'Other', 'other')`,
      )
      .run();
    expect(await listPendingReviews(db, 'ws-2')).toHaveLength(0);

    await recordReview(db, {
      reviewId: stored.reviewId,
      workspaceId: WS,
      status: 'reviewed',
      fields: { panel_capacity: 'spare_capable' },
      reviewedBy: 'u-owner',
      now: '2026-09-11T13:00:00.000Z',
    });
    expect(await listPendingReviews(db, WS)).toHaveLength(0);
  });

  it('records who read it and when', async () => {
    const stored = await store();
    const updated = await recordReview(db, {
      reviewId: stored.reviewId,
      workspaceId: WS,
      status: 'reviewed',
      fields: { panel_capacity: 'spare_capable', panel_main_amps: 200 },
      reviewedBy: 'u-owner',
      now: '2026-09-11T13:00:00.000Z',
    });
    expect(updated).toMatchObject({
      method: 'contractor_review',
      status: 'reviewed',
      reviewed_by: 'u-owner',
      reviewed_at: '2026-09-11T13:00:00.000Z',
    });
    expect(photoAnswerOf(updated!)).toEqual({
      status: 'reviewed',
      fields: { panel_capacity: 'spare_capable', panel_main_amps: 200 },
    });
  });

  it("will not let one workspace resolve another workspace's review", async () => {
    const stored = await store();
    await sqlite.db
      .prepare(
        `INSERT INTO workspaces (id, name, slug) VALUES ('ws-2', 'Other', 'other')`,
      )
      .run();

    const result = await recordReview(db, {
      reviewId: stored.reviewId,
      workspaceId: 'ws-2',
      status: 'reviewed',
      fields: { panel_capacity: 'spare_capable' },
      reviewedBy: 'u-owner',
    });
    expect(result).toBeNull();
    expect((await loadPhotoReview(db, SESSION, 'panel_photo'))?.status).toBe(
      'unreviewed',
    );
  });
});

describe('readPhoto', () => {
  it('streams back exactly what was put, and null for a key that is not there', async () => {
    const stored = await store();
    const object = await readPhoto(bucket as unknown as R2Bucket, stored.r2Key);
    expect(object?.contentType).toBe('image/jpeg');
    const bytes = new Uint8Array(
      await new Response(object!.body).arrayBuffer(),
    );
    expect([...bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0]);

    expect(await readPhoto(bucket as unknown as R2Bucket, 'nope')).toBeNull();
  });
});

describe('isPhotoStatus', () => {
  it("accepts the machines' four status values and nothing else", () => {
    for (const s of ['missing', 'unreviewed', 'reviewed', 'unreadable']) {
      expect(isPhotoStatus(s)).toBe(true);
    }
    expect(isPhotoStatus('approved')).toBe(false);
    expect(isPhotoStatus(undefined)).toBe(false);
    expect(isPhotoStatus(null)).toBe(false);
  });
});
