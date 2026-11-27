import { rcGet } from './rate-card.ts';
import type { EvalContext, Predicate } from './types.ts';

/**
 * Unwrap a `{value, estimated}` measurement answer down to its value. A bare
 * answer passes through; an array (a multi_choice answer) is left alone.
 */
export function rawValue(v: unknown): unknown {
  return v && typeof v === 'object' && !Array.isArray(v) && 'value' in v
    ? (v as { value: unknown }).value
    : v;
}

/** The value a predicate's source names. */
export function readVarOf(p: Predicate, ctx: EvalContext): unknown {
  if ('var' in p && p.var !== undefined) return rawValue(ctx.answers[p.var]);
  if ('env' in p && p.env !== undefined) return ctx.env[p.env];
  if ('rate_card' in p && p.rate_card !== undefined)
    return rcGet(ctx.rateCard, p.rate_card);
  if ('notice' in p && p.notice !== undefined) return ctx.notices.has(p.notice);
  return undefined;
}

/**
 * Evaluate one guard. Operators are checked in a fixed order, so a predicate
 * carrying two of them uses the first listed here — that is the reference
 * evaluator's behaviour and the fixtures depend on it.
 *
 * A bare `{notice: "x"}` asks whether the notice was raised; `{notice: "x",
 * eq: …}` compares it instead, which is why the `notice` shortcut is guarded
 * on `eq` being absent.
 */
export function evalPredicate(
  p: Predicate | null | undefined,
  ctx: EvalContext,
): boolean {
  if (!p) return true;
  if (p.always === true) return true;
  if (p.all) return p.all.every((q) => evalPredicate(q, ctx));
  if (p.any) return p.any.some((q) => evalPredicate(q, ctx));
  if (p.not) return !evalPredicate(p.not, ctx);
  if ('notice' in p && !('eq' in p)) return ctx.notices.has(p.notice as string);

  const v = readVarOf(p, ctx);

  if ('estimated' in p) {
    const a = ctx.answers[p.var as string];
    return (
      Boolean(
        a && typeof a === 'object' && (a as { estimated?: unknown }).estimated,
      ) === p.estimated
    );
  }
  if ('eq' in p) return v === p.eq;
  if ('ne' in p) return v !== p.ne;
  if ('in' in p) return (p.in as unknown[]).includes(v);
  if ('nin' in p) return !(p.nin as unknown[]).includes(v);
  if ('lt' in p) return Number(v) < (p.lt as number);
  if ('lte' in p) return Number(v) <= (p.lte as number);
  if ('gt' in p) return Number(v) > (p.gt as number);
  if ('gte' in p) return Number(v) >= (p.gte as number);
  if ('contains_any' in p)
    return (
      Array.isArray(v) &&
      (p.contains_any as unknown[]).some((x) => v.includes(x))
    );
  if ('contains' in p) return Array.isArray(v) && v.includes(p.contains);
  if ('count_gte' in p)
    return (Array.isArray(v) ? v.length : 0) >= (p.count_gte as number);
  if ('answered' in p) return (v !== undefined && v !== null) === p.answered;
  throw new Error(`unsupported predicate: ${JSON.stringify(p)}`);
}
