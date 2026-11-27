/// <reference types="@cloudflare/workers-types" />
import { createR2Storage } from '@basenative/upload';
import { sessionAnswers, type D1Like, type QuoteSessionRow } from './store.ts';
import type { Answers, Json } from './types.ts';

/**
 * The panel photo: storing it, and reading it back as an answer.
 *
 * The machines' `photo` screens are the one step whose answer nobody can type
 * — "does this panel have room for the charger" is a thing a licensed
 * electrician reads off an image. `coerceScreenAnswers` takes that screen's
 * status from the REQUEST BODY, which is fine while there is no file (a
 * skipped photo is a legitimate `missing`) but becomes a hole the moment a
 * reviewed verdict can move a price: a homeowner would be able to assert
 * their own panel's capacity.
 *
 * So from here on the photo answer is derived server-side, from
 * `pricing_photo_reviews`, and the client's only capability is uploading a
 * file and getting back nothing but confirmation.
 *
 * Storage is `@basenative/upload`'s R2 adapter, not a bespoke `env.FILES.put`
 * — the org rule is to use the package when one exists, and this is what it
 * exists for. The multipart *parsing* half of that package
 * (`parseMultipart` / `createUploadHandler`) is Node-`Buffer`-and-ctx shaped
 * for a middleware stack Workers do not have; Workers give us
 * `Request.formData()` natively, which is strictly better than re-parsing a
 * body by hand, so the file arrives as a `File` and only the *storage* half
 * of the package is used.
 */

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export const ALLOWED_PHOTO_TYPES: readonly string[] = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

/** Mirrors the machines' `interpretation.status_values`. */
export type PhotoStatus = 'missing' | 'unreviewed' | 'reviewed' | 'unreadable';

export const PHOTO_STATUSES: readonly PhotoStatus[] = Object.freeze([
  'missing',
  'unreviewed',
  'reviewed',
  'unreadable',
]);

export function isPhotoStatus(value: unknown): value is PhotoStatus {
  return (
    typeof value === 'string' &&
    (PHOTO_STATUSES as readonly string[]).includes(value)
  );
}

export type ReviewMethod =
  | 'contractor_review'
  | 'greenput_ops_review'
  | 'automated_classification'
  | 'unresolved';

export interface PhotoReviewRow {
  id: string;
  session_id: string;
  workspace_id: string;
  answer_key: string;
  file_id: string;
  method: ReviewMethod;
  status: PhotoStatus;
  fields_json: string;
  confidence: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export class PhotoError extends Error {
  // Written out rather than declared as constructor parameter properties:
  // `scripts/seed/pricing-fsms.mjs` imports this library straight from Node,
  // whose type-stripping loader refuses that syntax.
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'PhotoError';
    this.code = code;
    this.status = status;
  }
}

/**
 * THE CLASSIFICATION SEAM.
 *
 * Photo interpretation is not solved and this interface does not pretend
 * otherwise. There is no vision model anywhere in either repo, so what ships
 * is `unresolvedClassifier`: it declines, the answer comes out `unreviewed`,
 * the traversal falls back to each interpretation field's
 * `default_when_missing`, and the row lands in a human's review queue. That
 * is greenput-fsm-pricing.md §3(c) and the seed's own resolution_policy.
 *
 * Plugging in automated classification is one object: implement `classify`,
 * return `status: 'reviewed'` with the fields it could read and a calibrated
 * `confidence`, and pass it where `unresolvedClassifier` is passed today.
 * Nothing else changes — `gateReading` already sends a hesitant model back to
 * `unreviewed`.
 */
export interface PhotoReading {
  readonly method: ReviewMethod;
  readonly status: PhotoStatus;
  readonly fields: Readonly<Record<string, Json>>;
  readonly confidence: number | null;
}

export interface PhotoClassifierInput {
  readonly fileId: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly bytes?: Uint8Array;
  readonly answerKey: string;
  readonly vertical: string;
}

export interface PhotoClassifier {
  readonly name: string;
  classify(input: PhotoClassifierInput): Promise<PhotoReading>;
}

/** Present, nobody has looked at it, nothing asserted. */
export const UNREVIEWED: PhotoReading = Object.freeze({
  method: 'unresolved' as const,
  status: 'unreviewed' as const,
  fields: Object.freeze({}),
  confidence: null,
});

export const unresolvedClassifier: PhotoClassifier = {
  name: 'unresolved',
  classify: () => Promise.resolve(UNREVIEWED),
};

/**
 * Minimum confidence an automated classifier must clear before its reading is
 * trusted enough to narrow a band. Below it the answer is downgraded back to
 * `unreviewed` and a human still confirms — "widen until a human confirms"
 * applies to a hesitant model exactly as it does to no model.
 */
export const AUTOMATED_CONFIDENCE_FLOOR = 0.85;

export function gateReading(reading: PhotoReading): PhotoReading {
  if (reading.method !== 'automated_classification') return reading;
  const confidence = reading.confidence;
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < AUTOMATED_CONFIDENCE_FLOOR
  ) {
    return { ...reading, status: 'unreviewed', fields: {} };
  }
  return reading;
}

/**
 * The slice of `@basenative/upload`'s StorageAdapter this module uses.
 *
 * Declared structurally rather than imported because the package's published
 * `StorageAdapter.put` is typed against Node's `Buffer`, and a Worker
 * tsconfig loads `@cloudflare/workers-types` without `@types/node` — so
 * naming that type here would be an unresolvable reference. The adapter only
 * reads `data.length` and hands the value to `bucket.put`, both of which a
 * `Uint8Array` satisfies exactly. Flagged upstream: the adapter's types
 * should accept `Uint8Array`, which is what R2 actually wants.
 */
interface BinaryStorage {
  put(
    filename: string,
    data: Uint8Array,
    metadata?: { contentType?: string; originalName?: string; size?: number },
  ): Promise<{ key: string }>;
}

/** Strip anything that could escape the key prefix or confuse R2. */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 128) : 'panel-photo';
}

export interface StorePhotoInput {
  readonly bucket: R2Bucket;
  readonly db: D1Like;
  readonly workspaceId: string;
  readonly sessionId: string;
  /** The machine's answer key for this screen, e.g. 'panel_photo'. */
  readonly answerKey: string;
  readonly vertical: string;
  readonly file: File;
  readonly uploadedBy: string;
  readonly classifier?: PhotoClassifier;
  readonly newId: () => string;
  readonly now?: string;
}

export interface StoredPhoto {
  readonly reviewId: string;
  readonly fileId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly r2Key: string;
  readonly reading: PhotoReading;
}

/**
 * Store the photo, record the file, and open its review.
 *
 * Re-taking the photo for the same screen replaces the review rather than
 * accumulating one per attempt — and clears any earlier verdict, because a
 * previous reading described a different image.
 */
export async function storePanelPhoto(
  input: StorePhotoInput,
): Promise<StoredPhoto> {
  const { bucket, db, workspaceId, sessionId, answerKey, file, newId } = input;

  if (file.size <= 0) {
    throw new PhotoError('The photo is empty', 'EMPTY_FILE', 400);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new PhotoError(
      `Photo is too large. Maximum size is ${MAX_PHOTO_BYTES / 1024 / 1024} MB`,
      'FILE_TOO_LARGE',
      400,
    );
  }
  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_PHOTO_TYPES.includes(contentType)) {
    throw new PhotoError(
      'Please upload a JPEG, PNG, WebP or HEIC photo',
      'INVALID_FILE_TYPE',
      400,
    );
  }

  const now = input.now ?? new Date().toISOString();
  const fileId = newId();
  const filename = sanitizeFilename(file.name || 'panel-photo');
  const r2Key = `${workspaceId}/quote-session/${sessionId}/${fileId}-${filename}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const storage = createR2Storage({ bucket }) as unknown as BinaryStorage;
  await storage.put(r2Key, bytes, {
    contentType,
    originalName: filename,
    size: bytes.length,
  });

  await db
    .prepare(
      `INSERT INTO files (id, workspace_id, entity_type, entity_id, filename,
                          content_type, size, r2_key, uploaded_by, created_at)
       VALUES (?, ?, 'pricing_quote_session', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      fileId,
      workspaceId,
      sessionId,
      filename,
      contentType,
      bytes.length,
      r2Key,
      input.uploadedBy,
      now,
    )
    .run();

  const reading = gateReading(
    await (input.classifier ?? unresolvedClassifier).classify({
      fileId,
      contentType,
      byteLength: bytes.length,
      bytes,
      answerKey,
      vertical: input.vertical,
    }),
  );

  await db
    .prepare(
      `INSERT INTO pricing_photo_reviews
         (id, session_id, workspace_id, answer_key, file_id, method, status,
          fields_json, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, answer_key) DO UPDATE SET
         file_id = excluded.file_id,
         method = excluded.method,
         status = excluded.status,
         fields_json = excluded.fields_json,
         confidence = excluded.confidence,
         reviewed_by = NULL,
         reviewed_at = NULL,
         created_at = excluded.created_at`,
    )
    .bind(
      newId(),
      sessionId,
      workspaceId,
      answerKey,
      fileId,
      reading.method,
      reading.status,
      JSON.stringify(reading.fields),
      reading.confidence,
      now,
    )
    .run();

  const row = await loadPhotoReview(db, sessionId, answerKey);
  if (!row) {
    throw new PhotoError(
      'Failed to record the photo review',
      'REVIEW_NOT_WRITTEN',
      500,
    );
  }

  return {
    reviewId: row.id,
    fileId,
    filename,
    contentType,
    size: bytes.length,
    r2Key,
    reading,
  };
}

export async function loadPhotoReview(
  db: D1Like,
  sessionId: string,
  answerKey: string,
): Promise<PhotoReviewRow | null> {
  return db
    .prepare(
      'SELECT * FROM pricing_photo_reviews WHERE session_id = ? AND answer_key = ?',
    )
    .bind(sessionId, answerKey)
    .first<PhotoReviewRow>();
}

function parseFields(row: PhotoReviewRow): Record<string, Json> {
  try {
    const parsed: unknown = JSON.parse(row.fields_json);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, Json>)
      : {};
  } catch {
    // A corrupt reading is the same as no reading — never a thrown request.
    return {};
  }
}

/** One photo review as the `{status, fields}` answer the engine reads. */
export function photoAnswerOf(row: PhotoReviewRow): Json {
  return { status: row.status, fields: parseFields(row) } as Json;
}

/**
 * Overlay the server's photo readings onto a session's stored answers.
 *
 * This is the whole point of the table: whatever the client posted for a
 * photo screen, the answer the engine actually prices is the one the server
 * holds. A screen with no uploaded file keeps whatever the session recorded —
 * normally `missing`, which is a legitimate "I'll send it later".
 */
export async function withPhotoReadings(
  db: D1Like,
  sessionId: string,
  answers: Answers,
): Promise<Answers> {
  const rows = (
    await db
      .prepare('SELECT * FROM pricing_photo_reviews WHERE session_id = ?')
      .bind(sessionId)
      .all<PhotoReviewRow>()
  ).results;
  if (rows.length === 0) return answers;

  const merged: Record<string, Json> = { ...(answers as Record<string, Json>) };
  for (const row of rows) {
    // `missing` is never a reading: nothing today reads a panel as absent.
    // It is the mark `rewindTo` / `restartSession` put on a row whose photo
    // the homeowner stepped back past (GP-014). The file stays, the row
    // stays, but no answer stands — the screen is asked again, and a
    // re-upload's upsert brings the row back to `unreviewed`.
    if (row.status === 'missing') continue;
    merged[row.answer_key] = photoAnswerOf(row);
  }
  return merged as Answers;
}

/**
 * The answers a session should actually be priced on.
 *
 * Every read path — rendering a screen, finishing a form, showing a contractor
 * what came of one — goes through here rather than through `sessionAnswers()`
 * directly, so there is exactly one answer to "what does the server believe
 * about this panel" and it is never the homeowner's to decide.
 */
export async function effectiveAnswers(
  db: D1Like,
  session: QuoteSessionRow,
): Promise<Answers> {
  return withPhotoReadings(db, session.id, sessionAnswers(session));
}

export interface PendingReview {
  readonly reviewId: string;
  readonly sessionId: string;
  readonly answerKey: string;
  readonly fileId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly leadId: string | null;
  readonly leadName: string | null;
  readonly quoteLow: number | null;
  readonly quoteHigh: number | null;
  readonly createdAt: string;
}

/**
 * Photos a human still has to look at, for one workspace.
 *
 * Scoped by the review's own workspace, so a contractor only ever sees photos
 * from sessions that ran on their own flow.
 */
export async function listPendingReviews(
  db: D1Like,
  workspaceId: string,
  limit = 50,
): Promise<PendingReview[]> {
  const rows = (
    await db
      .prepare(
        `SELECT r.id, r.session_id, r.answer_key, r.file_id, r.created_at,
                f.filename, f.content_type,
                s.lead_id, s.quote_low, s.quote_high,
                l.first_name, l.last_name
           FROM pricing_photo_reviews r
           JOIN files f ON f.id = r.file_id
           JOIN pricing_quote_sessions s ON s.id = r.session_id
           LEFT JOIN leads l ON l.id = s.lead_id
          WHERE r.workspace_id = ?
            AND r.status IN ('unreviewed', 'missing')
            AND r.reviewed_at IS NULL
          ORDER BY r.created_at
          LIMIT ?`,
      )
      .bind(workspaceId, limit)
      .all<{
        id: string;
        session_id: string;
        answer_key: string;
        file_id: string;
        created_at: string;
        filename: string;
        content_type: string;
        lead_id: string | null;
        quote_low: number | null;
        quote_high: number | null;
        first_name: string | null;
        last_name: string | null;
      }>()
  ).results;

  return rows.map((row) => ({
    reviewId: row.id,
    sessionId: row.session_id,
    answerKey: row.answer_key,
    fileId: row.file_id,
    filename: row.filename,
    contentType: row.content_type,
    leadId: row.lead_id,
    leadName:
      row.first_name || row.last_name
        ? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
        : null,
    quoteLow: row.quote_low,
    quoteHigh: row.quote_high,
    createdAt: row.created_at,
  }));
}

/** Record what a human read off one photo. */
export async function recordReview(
  db: D1Like,
  input: {
    reviewId: string;
    workspaceId: string;
    status: PhotoStatus;
    fields: Readonly<Record<string, Json>>;
    reviewedBy: string;
    now?: string;
  },
): Promise<PhotoReviewRow | null> {
  const now = input.now ?? new Date().toISOString();
  await db
    .prepare(
      `UPDATE pricing_photo_reviews
          SET method = 'contractor_review', status = ?, fields_json = ?,
              confidence = NULL, reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND workspace_id = ?`,
    )
    .bind(
      input.status,
      JSON.stringify(input.fields),
      input.reviewedBy,
      now,
      input.reviewId,
      input.workspaceId,
    )
    .run();

  return db
    .prepare(
      'SELECT * FROM pricing_photo_reviews WHERE id = ? AND workspace_id = ?',
    )
    .bind(input.reviewId, input.workspaceId)
    .first<PhotoReviewRow>();
}

/** Fetch a stored photo's bytes — used by the contractor's review screen. */
export async function readPhoto(
  bucket: R2Bucket,
  r2Key: string,
): Promise<{ body: ReadableStream; contentType: string } | null> {
  const object = await bucket.get(r2Key);
  if (!object) return null;
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
  };
}
