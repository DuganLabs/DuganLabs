/**
 * The contractor's side of H1 (docs/pricing-fsm-designs.md §9).
 *
 * `confirmWorkOrder` is the provider input that turns a range into one exact
 * number: the contractor has read the work order and stands behind it. The
 * session is re-evaluated on the versions it started on, with
 * `env.work_order_confirmed`, and when nothing is left to guess the session's
 * band collapses to the exact number — always inside what the homeowner was
 * already shown, because the exact number is the point the range was built
 * around (H6: narrow, never silently widen).
 *
 * `estimateLinesFromQuote` drafts the contractor's estimate from that same
 * quote, line for line, in cents, so the estimate and the quote cannot drift.
 */
import { effectiveAnswers } from './photo.ts';
import { quoteStageOf } from './quote-stage.ts';
import { fitsInside } from './review.ts';
import { step } from './session.ts';
import { loadFlowByVersion, loadSession, sessionEnv } from './store.ts';
import type { D1Like, QuoteSessionRow } from './store.ts';
import type { EvaluationResult, PricedLine } from './types.ts';

export interface EstimateDraftLine {
  type: 'labor' | 'material';
  description: string;
  quantity: number;
  /** Whole cents. */
  unitPrice: number;
}

export interface EstimateDraft {
  lineItems: EstimateDraftLine[];
  /** Lines priced only if needed: left out of the draft, named for the contractor. */
  omitted: PricedLine[];
}

const toCents = (usd: number): number => Math.round(usd * 100);

/** Draft estimate lines from a quote. Pure. Empty when there is no price. */
export function estimateLinesFromQuote(
  result: EvaluationResult,
): EstimateDraft {
  if (quoteStageOf(result) === 'no_price' || !result.lines) {
    return { lineItems: [], omitted: [] };
  }
  const kept = result.lines.filter((l) => l.side !== 'high_only');
  const omitted = result.lines.filter((l) => l.side === 'high_only');
  const lineItems: EstimateDraftLine[] = kept.map((l) => ({
    type: l.kind === 'labour' ? 'labor' : 'material',
    description: l.detail ? `${l.label} (${l.detail})` : l.label,
    quantity: 1,
    unitPrice: toCents(l.cost),
  }));
  if (typeof result.exact === 'number') {
    const sum = lineItems.reduce((s, l) => s + l.unitPrice, 0);
    const gap = toCents(result.exact) - sum;
    if (gap > 0) {
      lineItems.push({
        type: 'labor',
        description:
          'Minimum call-out (the job is smaller than our minimum visit)',
        quantity: 1,
        unitPrice: gap,
      });
    }
  }
  return { lineItems, omitted };
}

export type ConfirmOutcome =
  | { kind: 'not_complete'; blockers: string[]; result?: undefined }
  | { kind: 'no_price'; blockers: string[]; result: EvaluationResult }
  | {
      kind: 'range';
      blockers: string[];
      result: EvaluationResult;
      session: QuoteSessionRow;
    }
  | {
      kind: 'exact';
      blockers: [];
      result: EvaluationResult;
      session: QuoteSessionRow;
    }
  | { kind: 'requires_call'; blockers: string[]; result: EvaluationResult };

/**
 * Record the contractor's confirmation of a finished quote's work order.
 *
 * The caller checks the session belongs to the contractor's workspace.
 */
export async function confirmWorkOrder(
  db: D1Like,
  session: QuoteSessionRow,
  ctx: { newId: () => string; now: string; userId: string },
): Promise<ConfirmOutcome> {
  if (session.status !== 'completed')
    return { kind: 'not_complete', blockers: [] };
  const flow = await loadFlowByVersion(
    db,
    session.fsm_version_id,
    session.rate_card_version_id,
  );
  if (!flow) return { kind: 'not_complete', blockers: [] };

  const env = { ...sessionEnv(session), work_order_confirmed: true };
  const walked = step(
    flow.machine,
    flow.rateCard,
    await effectiveAnswers(db, session),
    env,
  );
  if (walked.status !== 'complete')
    return { kind: 'not_complete', blockers: [] };
  const result = walked.result;
  const stage = quoteStageOf(result);
  if (stage === 'no_price') {
    return { kind: 'no_price', blockers: result.exact_blockers ?? [], result };
  }

  const shown = { low: session.quote_low, high: session.quote_high };
  const exact = stage === 'exact' && typeof result.exact === 'number';
  if (exact && !fitsInside(shown, { low: result.low, high: result.high })) {
    // Cannot happen on the versions the session is pinned to, but if it ever
    // does the price moved outside what the homeowner saw: a conversation,
    // not a silent reprice (H6).
    return { kind: 'requires_call', blockers: [], result };
  }

  if (exact) {
    await db
      .prepare(
        `UPDATE pricing_quote_sessions
            SET env = ?, quote_low = ?, quote_high = ?, quote_json = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        JSON.stringify(env),
        result.low,
        result.high,
        JSON.stringify(result),
        ctx.now,
        session.id,
      )
      .run();
  } else {
    await db
      .prepare(
        `UPDATE pricing_quote_sessions SET env = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(JSON.stringify(env), ctx.now, session.id)
      .run();
  }
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
      'work_order_confirmed',
      JSON.stringify({
        quoteSessionId: session.id,
        shown,
        stage,
        exact: exact ? result.exact : null,
        blockers: result.exact_blockers ?? [],
      }),
      ctx.now,
    )
    .run();

  const fresh = (await loadSession(db, session.id)) as QuoteSessionRow;
  return exact
    ? { kind: 'exact', blockers: [], result, session: fresh }
    : {
        kind: 'range',
        blockers: result.exact_blockers ?? [],
        result,
        session: fresh,
      };
}
