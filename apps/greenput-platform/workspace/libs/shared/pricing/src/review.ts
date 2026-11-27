import { estimatedValueCents, qualifies } from './lead.ts';
import {
  effectiveAnswers,
  loadPhotoReview,
  recordReview,
  type PhotoReviewRow,
  type PhotoStatus,
} from './photo.ts';
import { step } from './session.ts';
import {
  completeSession,
  loadFlowByVersion,
  loadSession,
  sessionEnv,
  type D1Like,
  type LoadedFlow,
  type QuoteSessionRow,
} from './store.ts';
import type { EvaluationResult, Json } from './types.ts';

/**
 * What happens when a human finally reads the panel photo.
 *
 * The design's honesty rule, from the seeded `T_needs_panel_review` terminal
 * itself:
 *
 *   "Re-evaluation may only move the range INSIDE what was shown. If reading
 *    the photo reveals an outcome above this high end, we do not reprice
 *    silently — we call."
 *
 * That is the whole shape of this module. A review is recorded, the session is
 * re-priced against ITS OWN pinned FSM and rate-card versions — never today's,
 * so a republished flow cannot move a number a contractor already promised —
 * and the new band is compared with the band the homeowner was shown:
 *
 *   inside  → the quote narrows, and if it landed on a priced terminal the
 *             lead qualifies, which is what makes it acceptable and therefore
 *             billable.
 *   outside → nothing is rewritten. The shown quote stands and the outcome is
 *             `requires_call`, which is a person's job, not a silent UPDATE.
 *
 * A reading that arrives before the homeowner has finished the form needs no
 * comparison at all: there is no shown band yet, so the reading is simply
 * stored and the traversal will pick it up through `effectiveAnswers()` when
 * they do finish. That is `pending`, and it is a normal race — ops reviewing a
 * photo faster than a homeowner types their phone number is a success, not an
 * error.
 */

export interface Band {
  readonly low: number | null;
  readonly high: number | null;
}

export type ResolveOutcome =
  /** The reading landed, but the form is not finished; nothing to re-price. */
  | { kind: 'pending'; review: PhotoReviewRow; session: QuoteSessionRow }
  /** The band moved, and it moved inwards. The quote is now this. */
  | {
      kind: 'narrowed';
      review: PhotoReviewRow;
      session: QuoteSessionRow;
      result: EvaluationResult;
      shown: Band;
      revealed: Band;
      qualified: boolean;
      leadId: string | null;
    }
  /** The reading changed nothing a homeowner would notice. */
  | {
      kind: 'unchanged';
      review: PhotoReviewRow;
      session: QuoteSessionRow;
      result: EvaluationResult;
      shown: Band;
    }
  /** The photo revealed something the shown range does not cover. */
  | {
      kind: 'requires_call';
      review: PhotoReviewRow;
      session: QuoteSessionRow;
      result: EvaluationResult;
      shown: Band;
      revealed: Band;
      reason: string;
    };

export interface ResolveInput {
  db: D1Like;
  reviewId: string;
  workspaceId: string;
  status: PhotoStatus;
  fields: Readonly<Record<string, Json>>;
  reviewedBy: string;
  newId: () => string;
  now?: string;
}

export class ReviewNotFoundError extends Error {
  readonly reviewId: string;

  constructor(reviewId: string) {
    super(`No photo review ${reviewId} in this workspace`);
    this.name = 'ReviewNotFoundError';
    this.reviewId = reviewId;
  }
}

const bandOf = (r: { low: number | null; high: number | null }): Band => ({
  low: r.low,
  high: r.high,
});

/**
 * Does the revealed band sit inside the band the homeowner was shown?
 *
 * A revealed band with no price at all (the photo showed a recalled panel, so
 * the machine now refuses to quote) is NOT inside anything — that is exactly
 * the case the rule exists for.
 */
export function fitsInside(shown: Band, revealed: Band): boolean {
  if (shown.low === null || shown.high === null) return false;
  if (revealed.low === null || revealed.high === null) return false;
  return revealed.low >= shown.low && revealed.high <= shown.high;
}

/** Why a revealed band could not be applied, in words a contractor can use. */
function escapeReason(shown: Band, revealed: Band): string {
  if (revealed.low === null || revealed.high === null) {
    return 'The photo shows something we will not price from a form. Call them.';
  }
  if (shown.low === null || shown.high === null) {
    return 'There is no range on record to narrow. Call them.';
  }
  if (revealed.high > shown.high) {
    return `The job is bigger than the range we showed (up to $${revealed.high.toLocaleString()} against a quoted top of $${shown.high.toLocaleString()}). Call them before repricing.`;
  }
  return `The photo puts this outside the range we showed ($${shown.low.toLocaleString()}–$${shown.high.toLocaleString()}). Call them before repricing.`;
}

/**
 * Record one human verdict and re-price the session it belongs to.
 *
 * Scoped by workspace throughout: a review id from another contractor's
 * workspace reads as absent, never as forbidden.
 */
export async function resolvePhotoReview(
  input: ResolveInput,
): Promise<ResolveOutcome> {
  const { db, workspaceId, newId } = input;
  const now = input.now ?? new Date().toISOString();

  const review = await recordReview(db, {
    reviewId: input.reviewId,
    workspaceId,
    status: input.status,
    fields: input.fields,
    reviewedBy: input.reviewedBy,
    now,
  });
  if (!review) throw new ReviewNotFoundError(input.reviewId);

  const session = await loadSession(db, review.session_id);
  if (!session || session.workspace_id !== workspaceId) {
    throw new ReviewNotFoundError(input.reviewId);
  }

  // The versions this session started on — not the current ones. This is the
  // reproducibility pin doing its job: a flow republished between the quote
  // and the review must not change the number under either party.
  const flow = await loadFlowByVersion(
    db,
    session.fsm_version_id,
    session.rate_card_version_id,
  );
  if (!flow) throw new ReviewNotFoundError(input.reviewId);

  const walked = step(
    flow.machine,
    flow.rateCard,
    await effectiveAnswers(db, session),
    sessionEnv(session),
  );
  if (walked.status !== 'complete') {
    return { kind: 'pending', review, session };
  }

  const revealed = bandOf(walked.result);

  // Nothing was shown yet (the form completed but was never frozen), so there
  // is nothing to narrow INTO — freeze what the reading produces.
  if (session.status !== 'completed') {
    const frozen = await completeSession(db, session, walked.result, now);
    const qualified = await syncQualification(db, frozen, walked.result, {
      newId,
      now,
      reviewedBy: input.reviewedBy,
      reviewId: review.id,
    });
    return {
      kind: 'narrowed',
      review,
      session: frozen,
      result: walked.result,
      shown: revealed,
      revealed,
      qualified,
      leadId: frozen.lead_id,
    };
  }

  const shown: Band = { low: session.quote_low, high: session.quote_high };

  if (
    walked.result.terminal === session.terminal_id &&
    revealed.low === shown.low &&
    revealed.high === shown.high
  ) {
    return { kind: 'unchanged', review, session, result: walked.result, shown };
  }

  if (!fitsInside(shown, revealed)) {
    const reason = escapeReason(shown, revealed);
    await logQuoteEvent(db, session, {
      newId,
      now,
      userId: input.reviewedBy,
      action: 'quote_requires_call',
      meta: {
        reviewId: review.id,
        answerKey: review.answer_key,
        quoteSessionId: session.id,
        shown,
        revealed,
        revealedTerminal: walked.result.terminal,
        reason,
      },
    });
    return {
      kind: 'requires_call',
      review,
      session,
      result: walked.result,
      shown,
      revealed,
      reason,
    };
  }

  const narrowed = await completeSession(db, session, walked.result, now);
  const qualified = await syncQualification(db, narrowed, walked.result, {
    newId,
    now,
    reviewedBy: input.reviewedBy,
    reviewId: review.id,
  });

  await logQuoteEvent(db, narrowed, {
    newId,
    now,
    userId: input.reviewedBy,
    action: 'quote_narrowed',
    meta: {
      reviewId: review.id,
      answerKey: review.answer_key,
      quoteSessionId: narrowed.id,
      shown,
      revealed,
      terminal: walked.result.terminal,
    },
  });

  return {
    kind: 'narrowed',
    review,
    session: narrowed,
    result: walked.result,
    shown,
    revealed,
    qualified,
    leadId: narrowed.lead_id,
  };
}

/**
 * Bring the lead's qualification into line with the re-priced quote.
 *
 * Qualification is one-way here. A review that turns a spanning band into a
 * real price qualifies the lead — the state `POST /api/leads/:id/accept` and
 * booking both require. A review that goes the other way does NOT
 * un-qualify: by then the lead may already be booked and its fee charged
 * (the fee bills at booking, WS-1), and silently revoking that is a billing
 * event dressed up as a data fix. The escape hatch for that case is the
 * withdraw route — and even there the fee billed at booking stands
 * (WS-1); only `refundLeadFee` reverses it (fraud or platform fault).
 */
async function syncQualification(
  db: D1Like,
  session: QuoteSessionRow,
  result: EvaluationResult,
  ctx: {
    newId: () => string;
    now: string;
    reviewedBy: string;
    reviewId: string;
  },
): Promise<boolean> {
  if (!session.lead_id) return false;

  // Cents, like every writer of this column (GP-111).
  const value = estimatedValueCents(result);

  const lead = await db
    .prepare(
      'SELECT id, status, qualified_at FROM leads WHERE id = ? AND workspace_id = ?',
    )
    .bind(session.lead_id, session.workspace_id)
    .first<{ id: string; status: string; qualified_at: string | null }>();
  if (!lead) return false;

  const nowQualifies = qualifies(result);
  const wasQualified = lead.qualified_at !== null;

  await db
    .prepare(
      `UPDATE leads
          SET estimated_value = ?,
              status = CASE WHEN ? = 1 AND status = 'new' THEN 'qualified' ELSE status END,
              qualified_at = COALESCE(qualified_at, CASE WHEN ? = 1 THEN ? END),
              updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
    )
    .bind(
      value,
      nowQualifies ? 1 : 0,
      nowQualifies ? 1 : 0,
      ctx.now,
      ctx.now,
      lead.id,
      session.workspace_id,
    )
    .run();

  if (nowQualifies && !wasQualified) {
    await db
      .prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
         VALUES (?,?,?,'lead',?,'qualified',?,?)`,
      )
      .bind(
        ctx.newId(),
        session.workspace_id,
        ctx.reviewedBy,
        lead.id,
        JSON.stringify({
          source: 'photo_review',
          reviewId: ctx.reviewId,
          quoteSessionId: session.id,
          terminal: result.terminal,
          low: result.low,
          high: result.high,
        }),
        ctx.now,
      )
      .run();
  }

  return nowQualifies;
}

/**
 * Log against the lead when there is one, and against the workspace when there
 * is not — `activity_log.entity_type` is a CHECK-constrained enum and a quote
 * session is not one of its members.
 */
async function logQuoteEvent(
  db: D1Like,
  session: QuoteSessionRow,
  ctx: {
    newId: () => string;
    now: string;
    userId: string;
    action: string;
    meta: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(
      ctx.newId(),
      session.workspace_id,
      ctx.userId,
      session.lead_id ? 'lead' : 'workspace',
      session.lead_id ?? session.workspace_id,
      ctx.action,
      JSON.stringify(ctx.meta),
      ctx.now,
    )
    .run();
}

/** Re-read one review after resolving it, for a route that wants to echo it. */
export async function reloadReview(
  db: D1Like,
  sessionId: string,
  answerKey: string,
): Promise<PhotoReviewRow | null> {
  return loadPhotoReview(db, sessionId, answerKey);
}

export type { LoadedFlow };
