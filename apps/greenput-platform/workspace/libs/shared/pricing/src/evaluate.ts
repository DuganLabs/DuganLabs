import { resolveTerminal } from './graph.ts';
import { evalPredicate } from './predicates.ts';
import {
  bandFrom,
  computeSpread,
  evalQty,
  priceTerminal,
  r2,
} from './pricing.ts';
import { rcGet } from './rate-card.ts';
import { traverse } from './traverse.ts';
import { stageOfPriced } from './quote-stage.ts';
import type {
  Answers,
  Condition,
  EnvFacts,
  EvalContext,
  EvaluatedAddon,
  EvaluationResult,
  Machine,
  RateCard,
  ResolvedTerminal,
  SpanPart,
  Terminal,
  TerminalNextStep,
} from './types.ts';

/**
 * The presentation conditions that fire for this outcome, in author order.
 *
 * Read-only over the terminal: extras are appended to a local copy, never to
 * `terminal.presentation`, which `resolveTerminal` shares with the machine.
 */
function sayConditions(
  terminal: ResolvedTerminal,
  ctx: EvalContext,
  extra: Condition[] = [],
): string[] {
  return [...(terminal.presentation?.conditions ?? []), ...extra]
    .filter((c) => evalPredicate(c.when || { always: c.always === true }, ctx))
    .map((c) => c.say);
}

/** The environment facts every evaluation starts from. */
export const DEFAULT_ENV: EnvFacts = {
  in_service_area: true,
  rate_card_tuned: true,
  is_weekend: false,
};

/**
 * Run one machine to a price.
 *
 * Pure: no clock, no RNG, no lookups — the same graph, rate card, answers and
 * environment always produce the same range. `seeds/pricing/fixtures/*.expected.json`
 * are the frozen outputs of this function and `evaluate.spec.ts` re-runs all
 * eighteen of them.
 *
 * The refusal rules run before pricing, and a spread above the ceiling turns
 * any outcome into a refusal after it: a range that wide is not a price.
 */
/**
 * The authored copy on a terminal: its heading, the one-line summary, the
 * body, and what to do next.
 *
 * Every outcome carries this. Only `kind: 'quote'` used to, and only `title`,
 * so the four endings in seeds/pricing/fragments/shared-terminals.json —
 * including T_urgent_dispatch, whose body is "If you can see smoke or flame,
 * get out and call 911" — reached the page as nothing at all. The homeowner
 * saw the generic "No price yet / someone will be in touch".
 *
 * Terminal is indexed `[extra: string]: unknown`, so these arrive untyped off
 * the JSON. Each is narrowed rather than cast: a machine authored with the
 * wrong type for one field must not take the others down with it.
 */
function presentationOf(terminal: Terminal): {
  title?: string;
  summary?: string;
  body?: string;
  next_step?: TerminalNextStep;
} {
  const out: {
    title?: string;
    summary?: string;
    body?: string;
    next_step?: TerminalNextStep;
  } = {};
  if (typeof terminal.title === 'string') out.title = terminal.title;
  if (typeof terminal['summary'] === 'string')
    out.summary = terminal['summary'];
  if (typeof terminal['body'] === 'string') out.body = terminal['body'];
  const next = terminal['next_step'];
  if (next && typeof next === 'object')
    out.next_step = next as TerminalNextStep;
  return out;
}

export function evaluate(
  machine: Machine,
  rateCard: RateCard,
  answers: Answers,
  env: EnvFacts = {},
): EvaluationResult {
  const ctx: EvalContext = {
    rateCard,
    answers: JSON.parse(JSON.stringify(answers)),
    env: { ...DEFAULT_ENV, ...env },
    notices: new Set<string>(),
  };
  const { terminalId, path } = traverse(machine, ctx);
  let terminal: ResolvedTerminal = resolveTerminal(machine, terminalId);

  // Honesty gate: refuse-to-quote rules run before pricing.
  for (const r of machine.honesty?.refuse_to_quote_when || []) {
    if (evalPredicate(r.when, ctx) && terminal.kind === 'quote') {
      terminal = resolveTerminal(
        machine,
        machine.honesty?.on_exceed_max_spread || 'T_site_visit_required',
      );
      terminal = { ...terminal, _refused_because: r.because };
      break;
    }
  }

  if (terminal.kind === 'span') {
    const parts: SpanPart[] = (terminal.spans || []).map((id) => {
      const t = resolveTerminal(machine, id);
      const p = priceTerminal(t, ctx);
      const sp = computeSpread(t, ctx);
      return {
        id,
        // A homeowner is being shown the real shape of their uncertainty, so
        // each end of it needs the name its own terminal gave it. Without
        // this the page can only print the terminal id. A span target with
        // no title is an authoring bug for the seed lint, not a reason to
        // hand the page `undefined`, so the id stands in.
        title: typeof t.title === 'string' ? t.title : id,
        ...p,
        ...sp,
        ...bandFrom(p.point, p.pointHigh, sp.spread, ctx, t.uncertainty || {}),
      };
    });
    const blown = parts.find((p) => p.uncapped > p.cap);
    if (blown) {
      // Same shape as the honesty gate above: resolve the refusal terminal
      // and read the presentation off THAT. Reading it off `terminal` put
      // the withdrawn quote's own heading and summary above "we cannot price
      // this". Resolved here, not hoisted, so a machine with no such terminal
      // only throws on the path that needs it.
      const refusalId =
        machine.honesty?.on_exceed_max_spread || 'T_site_visit_required';
      const refusal = resolveTerminal(machine, refusalId);
      return {
        terminal: refusalId,
        kind: 'no_quote',
        path,
        ...presentationOf(refusal),
        notices: [...ctx.notices],
        refused_because: `Uncertainty on the "${blown.id}" outcome reached ${blown.uncapped}%, above the ${blown.cap}% ceiling. A range that wide is not a price.`,
        indicative: {
          low: Math.min(...parts.map((p) => p.low)),
          high: Math.max(...parts.map((p) => p.high)),
          not_a_quote: true,
        },
        low: null,
        high: null,
        stage: 'no_price',
        answers: ctx.answers,
      };
    }
    return {
      terminal: terminalId,
      kind: 'span',
      // An unread photo is a guess by definition: a span is never exact.
      stage: 'range',
      path,
      ...presentationOf(terminal),
      notices: [...ctx.notices],
      spans: parts,
      // A spanning terminal is the "we have not read your photo yet" branch,
      // and its whole job is to say so. Its `presentation.conditions` are
      // authored against `photo_status` — "Your photo's with us, nothing more
      // needed from you" against "send one now and we can usually halve
      // this" — so a span that returned only two numbers would drop the one
      // sentence that tells a homeowner what to do next.
      title: terminal.title,
      conditions: sayConditions(terminal, ctx),
      low: Math.min(...parts.map((p) => p.low)),
      high: Math.max(...parts.map((p) => p.high)),
      answers: ctx.answers,
    };
  }

  if (terminal.kind !== 'quote' && terminal.kind !== 'quote_with_condition') {
    return {
      terminal: terminalId,
      kind: terminal.kind,
      path,
      ...presentationOf(terminal),
      notices: [...ctx.notices],
      low: null,
      high: null,
      stage: 'no_price',
      refused_because:
        typeof terminal['_refused_because'] === 'string'
          ? terminal['_refused_because']
          : null,
      answers: ctx.answers,
    };
  }

  const priced = priceTerminal(terminal, ctx);
  const spread = computeSpread(terminal, ctx);
  if (spread.uncapped > spread.cap) {
    // As on the span path: the words on the page are the refusal's, not the
    // priced terminal's.
    const refusalId =
      machine.honesty?.on_exceed_max_spread || 'T_site_visit_required';
    const refusal = resolveTerminal(machine, refusalId);
    return {
      terminal: refusalId,
      kind: 'no_quote',
      path,
      ...presentationOf(refusal),
      low: null,
      high: null,
      stage: 'no_price',
      refused_because: `Uncertainty reached ${spread.uncapped}%, above the ${spread.cap}% ceiling.`,
      answers: ctx.answers,
      notices: [...ctx.notices],
    };
  }
  const band = bandFrom(
    priced.point,
    priced.pointHigh,
    spread.spread,
    ctx,
    terminal.uncertainty || {},
  );
  // Built as a local list, never written back onto the terminal.
  // `resolveTerminal` copies a terminal shallowly, so `terminal.presentation`
  // is the machine's own object: appending to it would make `evaluate()`
  // impure — the same answers evaluated twice would carry the minimum-job
  // sentence twice, and a machine loaded once and used for many quotes would
  // accumulate it forever.
  const extraConditions: Condition[] = [];
  if (band.minimum_applied) {
    extraConditions.push({
      always: true,
      say: `This job is smaller than our minimum call-out, so it's priced at the minimum of $${Number(
        rcGet(rateCard, 'fees.minimum_job'),
      )}. If you have anything else you've been meaning to get done while we're there, now is the time to mention it — you're paying for the hour either way.`,
    });
  }
  const addons: EvaluatedAddon[] = (terminal.addons || [])
    .filter((a) => !a.when || evalPredicate(a.when, ctx))
    .map((a) => {
      if (a.flat_usd)
        return {
          id: a.id,
          label: a.label,
          cost: a.flat_usd,
          placeholder: !!a.flat_usd_is_placeholder,
        };
      const qty = evalQty(a.qty, ctx, new Map());
      return {
        id: a.id,
        label: a.label,
        qty,
        cost: r2(qty * Number(rcGet(rateCard, a.rate as string))),
      };
    });
  const conditions = sayConditions(terminal, ctx, extraConditions);
  // H1: a priced quote is a range until nothing is left to guess and the
  // contractor has confirmed the work order; then it is one exact number, and
  // low and high both carry it so every consumer of the band sees one price.
  const staged = stageOfPriced({
    lines: priced.lines,
    point: priced.point,
    pointHigh: priced.pointHigh,
    reasons: spread.reasons,
    minimumJob: Number(rcGet(rateCard, 'fees.minimum_job')),
    confirmed: ctx.env['work_order_confirmed'] === true,
  });

  return {
    terminal: terminalId,
    kind: 'quote',
    path,
    ...presentationOf(terminal),
    lines: priced.lines,
    point: priced.point,
    point_high: priced.pointHigh,
    spread_pct: spread.spread,
    spread_reasons: spread.reasons,
    low: staged.stage === 'exact' ? staged.exact! : band.low,
    high: staged.stage === 'exact' ? staged.exact! : band.high,
    minimum_applied: band.minimum_applied,
    stage: staged.stage,
    ...(staged.stage === 'exact' ? { exact: staged.exact } : {}),
    exact_blockers: staged.blockers,
    addons,
    conditions,
    notices: [...ctx.notices],
    answers: ctx.answers,
  };
}
