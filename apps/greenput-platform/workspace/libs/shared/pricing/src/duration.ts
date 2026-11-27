import type { EvaluationResult, PricedLine } from './types.ts';

/** No job is booked into less than half an hour, whatever the lines add up to. */
export const MIN_DURATION_MINUTES = 30;
/** Durations round up to the slot grid — a 75-minute job books 90. */
export const DURATION_GRANULARITY_MINUTES = 30;

/**
 * Labour hours on a set of priced lines. A `labour` line's `qty` is hours —
 * the renderer already prints `1.5 hr x $110/hr` from it. `high_only` lines
 * are COUNTED: those are the "if the run is harder than it looks" hours, and
 * a slot that is too short is worse than one that is too long.
 */
function labourHours(lines: readonly PricedLine[] | undefined): number {
  let hours = 0;
  for (const line of lines ?? []) {
    if (line.kind !== 'labour') continue;
    if (Number.isFinite(line.qty) && line.qty > 0) hours += line.qty;
  }
  return hours;
}

/**
 * How long to book for a quote — the ONE home of this rule, read by slot
 * generation (`libs/shared/scheduling`) on both the API and the tenant site.
 *
 * Duration comes from the quote, never from the homeowner. A `span` result
 * carries `spans` instead of `lines`; it takes the longest part, because the
 * band is wide precisely because nobody has looked yet. Rounded up to the
 * half hour, never below `MIN_DURATION_MINUTES`.
 */
export function estimatedDurationMinutes(
  result: Pick<EvaluationResult, 'lines' | 'spans'>,
): number {
  const hours =
    result.spans && result.spans.length > 0
      ? Math.max(...result.spans.map((part) => labourHours(part.lines)))
      : labourHours(result.lines);
  const minutes = hours * 60;
  const onGrid =
    Math.ceil(minutes / DURATION_GRANULARITY_MINUTES) *
    DURATION_GRANULARITY_MINUTES;
  return Math.max(MIN_DURATION_MINUTES, onGrid);
}
