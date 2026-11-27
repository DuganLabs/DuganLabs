import { evalPredicate, rawValue } from './predicates.ts';
import { catGet, rcGet } from './rate-card.ts';
import type {
  EvalContext,
  PricedLine,
  Quantity,
  ResolvedTerminal,
  Uncertainty,
  WidenRule,
} from './types.ts';

/** Round to a step (0.25 hr, $25). A falsy step means no rounding. */
export const roundTo = (v: number, step?: number): number =>
  step ? Math.round(v / step) * step : v;

/** Money and quantities are carried to two decimals, as the fixtures record them. */
export const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A line item's quantity: `base`, then every `per` term, then `modifiers` in
 * array order, then `min`/`max`, then `round_to`.
 *
 * `of_item` reads another line item's already-computed quantity, which is why
 * `computed` is threaded through and why the validator insists the source is
 * priced first.
 */
export function evalQty(
  q: Quantity | undefined,
  ctx: EvalContext,
  computed: Map<string, number>,
): number {
  if (!q) return 1;
  if (q.of_item) {
    const src = computed.get(q.of_item);
    if (src === undefined)
      throw new Error(`of_item "${q.of_item}" not computed before use`);
    const v = src * (q.factor as number);
    return roundTo(v, q.round_to);
  }
  let v = q.base ?? 0;
  for (const p of q.per || []) {
    let base: number;
    if ('rate_card' in p && p.rate_card !== undefined) {
      base = Number(rcGet(ctx.rateCard, p.rate_card) ?? 0);
    } else {
      let a = rawValue(ctx.answers[p.of as string]);
      if (a === undefined || a === null) a = p.default ?? 0;
      base = Array.isArray(a) ? a.length : Number(a);
      if (p.minus) base = Math.max(0, base - p.minus);
    }
    v += base * (p.rate ?? 1);
  }
  for (const m of q.modifiers || []) {
    if (!evalPredicate(m.when || { always: m.always === true }, ctx)) continue;
    if (m.op === 'add') v += m.value;
    else if (m.op === 'multiply') v *= m.value;
    else if (m.op === 'set') v = m.value;
  }
  if (q.min !== undefined && q.min !== null) v = Math.max(q.min, v);
  if (q.max !== undefined && q.max !== null) v = Math.min(q.max, v);
  return roundTo(v, q.round_to);
}

export interface PricedTerminal {
  lines: PricedLine[];
  /** The point estimate: every line except the `high_only` ones. */
  point: number;
  /** The point estimate including `high_only` lines — the top of the band builds off this. */
  pointHigh: number;
}

/**
 * Price a terminal's line items.
 *
 * Two passes: everything that produces a cost of its own, then `adjustment`
 * lines, which multiply the labour subtotal and so have to see it complete.
 * A line that prices to exactly zero is dropped rather than shown — a $0 row
 * on a quote is noise, not information.
 */
export function priceTerminal(
  terminal: ResolvedTerminal,
  ctx: EvalContext,
): PricedTerminal {
  const rc = ctx.rateCard;
  const markup = 1 + Number(rcGet(rc, 'materials.markup_pct')) / 100;
  const tax = 1 + Number(rcGet(rc, 'materials.sales_tax_pct')) / 100;
  const defaultWaste = Number(rcGet(rc, 'materials.waste_pct_default'));

  const lines: PricedLine[] = [];
  const computed = new Map<string, number>();
  let labourSubtotal = 0;

  for (const item of terminal.line_items || []) {
    if (item.kind === 'adjustment') continue;
    if (item.when && !evalPredicate(item.when, ctx)) continue;
    const qty = evalQty(item.qty, ctx, computed);
    computed.set(item.id, qty);
    if (qty <= 0) continue;

    // Every branch below assigns both, or throws — an unknown line kind must
    // never price as zero and slip into a quote unnoticed.
    let cost: number;
    let detail: string;
    if (item.kind === 'labour') {
      const rate = Number(rcGet(rc, item.rate as string));
      cost = qty * rate;
      detail = `${r2(qty)} hr x $${rate}/hr`;
      labourSubtotal += cost;
    } else if (item.kind === 'material') {
      const c = catGet(rc, item.catalog as string);
      if (!c) throw new Error(`unknown catalog item "${item.catalog}"`);
      const waste =
        item.waste_pct === null || item.waste_pct === undefined
          ? c.unit === 'ft'
            ? defaultWaste
            : 0
          : item.waste_pct;
      const q = qty * (1 + waste / 100);
      cost = q * c.cost * markup * tax;
      detail =
        `${r2(qty)}${c.unit === 'ft' ? ' ft' : ''} x $${c.cost}` +
        (waste ? ` +${waste}% waste` : '') +
        ` x ${markup} markup`;
    } else if (item.kind === 'allowance') {
      const c = catGet(rc, item.catalog as string) as { cost: number };
      cost = qty * c.cost * tax;
      detail = `${r2(qty)} x $${c.cost} at cost (allowance, no markup)`;
    } else if (item.kind === 'fee' || item.kind === 'sub') {
      const rate = Number(rcGet(rc, item.rate as string));
      cost = qty * rate;
      detail = `${r2(qty)} x $${rate}`;
    } else {
      throw new Error(`unknown line-item kind "${item.kind}"`);
    }
    if (r2(cost) === 0) continue;
    lines.push({
      id: item.id,
      label: item.label,
      kind: item.kind,
      qty: r2(qty),
      cost: r2(cost),
      detail,
      side: item.range_side || 'both',
    });
  }

  for (const item of terminal.line_items || []) {
    if (item.kind !== 'adjustment') continue;
    if (item.when && !evalPredicate(item.when, ctx)) continue;
    const mult = Number(rcGet(rc, item.multiply_by_rate_card as string));
    const delta = labourSubtotal * (mult - 1);
    lines.push({
      id: item.id,
      label: item.label,
      kind: 'adjustment',
      qty: mult,
      cost: r2(delta),
      detail: `labour x ${mult}`,
      side: 'both',
    });
  }

  const point = r2(
    lines.filter((l) => l.side !== 'high_only').reduce((s, l) => s + l.cost, 0),
  );
  const pointHigh = r2(lines.reduce((s, l) => s + l.cost, 0));
  return { lines, point, pointHigh };
}

export interface Spread {
  /** The spread actually used, capped. */
  spread: number;
  /** What it would have been. Above `cap`, the machine must stop quoting. */
  uncapped: number;
  cap: number;
  reasons: Array<Partial<WidenRule>>;
}

/**
 * How wide the range is, in percent: the terminal's base (or the rate card's),
 * plus its own extra, plus every widening rule that fires.
 *
 * A child terminal re-uses its parent's widening rules only when it asks to
 * with `uncertainty.inherit_widen_from`. Rules are de-duplicated by their
 * guard, so inheriting a rule the child also declares does not count twice.
 */
export function computeSpread(
  terminal: ResolvedTerminal,
  ctx: EvalContext,
): Spread {
  const rc = ctx.rateCard;
  const u: Uncertainty = terminal.uncertainty || {};
  let base = u.base_spread_pct;
  if (base === null || base === undefined)
    base = Number(rcGet(rc, 'uncertainty.base_spread_pct'));
  let spread = base + (u.extra_spread_pct || 0);
  const reasons: Array<Partial<WidenRule>> = [];
  if (u.extra_spread_because)
    reasons.push({
      add_pct: u.extra_spread_pct,
      because: u.extra_spread_because,
    });
  const widen: WidenRule[] = [
    ...(terminal._parent_widen && terminal._inherits_widen_from
      ? terminal._parent_widen
      : []),
    ...(u.widen || []),
  ];
  const seen = new Set<string>();
  for (const w of widen) {
    const key = JSON.stringify(w.when);
    if (seen.has(key)) continue;
    if (evalPredicate(w.when, ctx)) {
      spread += w.add_pct;
      reasons.push(w);
      seen.add(key);
    }
  }
  const cap = Number(rcGet(rc, 'uncertainty.max_spread_pct'));
  return { spread: Math.min(spread, cap), uncapped: spread, cap, reasons };
}

export interface Band {
  low: number;
  high: number;
  minimum_applied: boolean;
}

/**
 * Turn a point estimate and a spread into the range a homeowner is shown.
 *
 * The band is skewed, not symmetric: `skew` (0.6 by default) puts 60% of the
 * spread above the point estimate, because electrical surprises are one-tailed.
 *
 * The flat pad is a floor on uncertainty for a normal-sized job. On a small one
 * it would dominate — a $60 pad on a $420 surge protector invents a 30% range
 * out of nothing — so it is capped as a share of the estimate. A terminal may
 * override it outright, which is how the diagnostic call-out gets a pad of
 * exactly zero.
 */
export function bandFrom(
  point: number,
  pointHigh: number,
  spreadPct: number,
  ctx: EvalContext,
  terminalUncertainty: Uncertainty = {},
): Band {
  const rc = ctx.rateCard;
  const skew = Number(rcGet(rc, 'uncertainty.skew'));
  const padBase =
    terminalUncertainty.flat_pad_usd !== undefined &&
    terminalUncertainty.flat_pad_usd !== null
      ? Number(terminalUncertainty.flat_pad_usd)
      : Number(rcGet(rc, 'uncertainty.flat_pad_usd'));
  const padCapPct = Number(rcGet(rc, 'uncertainty.flat_pad_cap_pct') ?? 100);
  const pad = Math.min(padBase, (point * padCapPct) / 100);
  const step = Number(rcGet(rc, 'uncertainty.round_to'));
  const min = Number(rcGet(rc, 'fees.minimum_job'));
  const s = spreadPct / 100;
  let low = point * (1 - (1 - skew) * s) - pad;
  let high = pointHigh * (1 + skew * s) + pad;
  low = Math.floor(low / step) * step;
  const minimum_applied = low < min;
  if (minimum_applied) low = min;
  high = Math.ceil(high / step) * step;
  if (high < low) high = low;
  return { low, high, minimum_applied };
}
