/**
 * Where a quote is on its way to a price (docs/pricing-fsm-designs.md §9 H1):
 *
 *   no price  →  a range  →  one exact number
 *
 * - `no_price` — the work order is not answered far enough to price, or the
 *   outcome refuses, refers or escalates.
 * - `range` — priced, but something is still a guess: a widen rule fired, a
 *   line is priced only if it turns out to be needed, the photo is unread, the
 *   contractor's prices are unfinished, or the contractor has not confirmed
 *   the work order.
 * - `exact` — nothing left to guess and the contractor has confirmed the work
 *   order. One number, to the cent: the sum of the priced lines (never below
 *   the minimum job), which is what the contractor's estimate then shows.
 *
 * The provider's confirmation arrives as `env.work_order_confirmed === true`.
 * Homeowner answers alone never produce an exact number: the base spread is
 * there because self-reported answers have not been checked by anyone who
 * will do the work.
 */
import { r2 } from './pricing.ts';
import type { EvaluationResult, PricedLine, WidenRule } from './types.ts';

export type QuoteStage = 'no_price' | 'range' | 'exact';

export const QUOTE_STAGES: readonly QuoteStage[] = [
  'no_price',
  'range',
  'exact',
];

export const NOT_CONFIRMED =
  'The contractor has not confirmed the work order yet.';

export interface StageInput {
  lines: PricedLine[];
  point: number;
  pointHigh: number;
  reasons: Array<Partial<WidenRule>>;
  minimumJob: number;
  confirmed: boolean;
}

export interface StageOutcome {
  stage: 'range' | 'exact';
  exact?: number;
  blockers: string[];
}

/** Decide the stage of a priced single-outcome quote. Pure. */
export function stageOfPriced(input: StageInput): StageOutcome {
  const blockers: string[] = [];
  for (const r of input.reasons || []) {
    blockers.push(
      typeof r.because === 'string' && r.because
        ? r.because
        : 'An uncertainty rule still applies.',
    );
  }
  for (const l of input.lines) {
    if (l.side === 'high_only') {
      blockers.push(
        `"${l.label}" is priced only if it turns out to be needed.`,
      );
    }
  }
  if (
    input.pointHigh !== input.point &&
    !input.lines.some((l) => l.side === 'high_only')
  ) {
    blockers.push('Part of the job is priced as a range of time or materials.');
  }
  if (!input.confirmed) blockers.push(NOT_CONFIRMED);
  if (blockers.length > 0) return { stage: 'range', blockers };
  const exact = Math.max(r2(input.point), input.minimumJob);
  return { stage: 'exact', exact, blockers };
}

/**
 * The stage of a result that may have been stored before stages existed
 * (`pricing_quote_sessions.quote_json`). A stored result without `stage` was
 * never exact: exact needs the contractor's confirmation, which is newer.
 */
export function quoteStageOf(
  result:
    | Pick<EvaluationResult, 'kind' | 'low' | 'high' | 'stage'>
    | null
    | undefined,
): QuoteStage {
  if (!result) return 'no_price';
  if (result.stage && QUOTE_STAGES.includes(result.stage)) return result.stage;
  if (result.low === null || result.low === undefined) return 'no_price';
  if (result.high === null || result.high === undefined) return 'no_price';
  return 'range';
}

const whole = (n: number): string => `$${n.toLocaleString('en-US')}`;
const cents = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A quote in words, for notes, summaries and lead lists: one number to the
 * cent when exact, `$low–$high` when a range, `null` when there is no price.
 * Never used on marketing pages, which show no homeowner price at all.
 */
export function formatQuotePrice(
  result:
    | Pick<EvaluationResult, 'kind' | 'low' | 'high' | 'stage' | 'exact'>
    | null
    | undefined,
): string | null {
  const stage = quoteStageOf(result);
  if (stage === 'no_price' || !result) return null;
  if (stage === 'exact' && typeof result.exact === 'number')
    return cents(result.exact);
  return `${whole(result.low as number)}–${whole(result.high as number)}`;
}
