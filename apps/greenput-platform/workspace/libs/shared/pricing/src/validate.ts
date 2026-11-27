import { resolveTerminal } from './graph.ts';
import { catGet, rcGet } from './rate-card.ts';
import type {
  AnswerSpec,
  GroupField,
  Machine,
  RateCard,
  State,
  Terminal,
} from './types.ts';

/**
 * Every answer key a blob of JSON reads — `{"var": k}` in a guard and
 * `{"of": k}` in a quantity.
 *
 * `{"var": k, "answered": …}` is deliberately excluded: asking whether a key
 * was answered is legal on a route that never asks it, which is the whole point
 * of the operator.
 */
export function referencedVars(
  node: unknown,
  acc: Set<string> = new Set(),
): Set<string> {
  if (node === null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach((n) => referencedVars(n, acc));
    return acc;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj['var'] === 'string' && !('answered' in obj))
    acc.add(obj['var'] as string);
  if (typeof obj['of'] === 'string') acc.add(obj['of'] as string);
  for (const v of Object.values(obj)) referencedVars(v, acc);
  return acc;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  /** The number of questions on the longest route through the machine. */
  depth: number;
}

/** The choice-typed answers a screen carries — one, or one per group field. */
function choiceAnswers(s: State): Array<AnswerSpec | GroupField> {
  if (s.kind !== 'question' || !s.answer) return [];
  if (s.answer.type === 'group')
    return (s.answer.fields || []).filter((f) => f.type === 'choice');
  if (s.answer.type === 'choice') return [s.answer];
  return [];
}

/** The answer keys a state writes — asked, defaulted, derived or read off a photo. */
function produces(s: State | Record<string, never>): string[] {
  const st = s as State;
  if (st.kind === 'defaults')
    return Object.keys((st.sets ?? {}) as Record<string, unknown>);
  if (st.kind === 'question' && st.answer?.type === 'group')
    return (st.answer.fields || []).map((f) => f.key);
  if (st.kind === 'question' && st.answer)
    return [
      st.answer.key as string,
      ...(st.answer.type === 'photo' && st.answer.interpretation
        ? [
            st.answer.interpretation.status_key,
            ...Object.keys(st.answer.interpretation.fields),
          ]
        : []),
    ];
  if (st.kind === 'derive') return [st.sets as string];
  return [];
}

/**
 * The number of questions on the longest route through the machine. Edges
 * marked `allow_cycle` are skipped, and an edge is never walked twice on one
 * route, so a machine with a loop still terminates here.
 */
export function longestPath(
  machine: Machine,
  states: Map<string, State>,
  terminals: Map<string, Terminal>,
): number {
  let best = 0;
  const walk = (id: string, n: number, seen: Set<string>) => {
    if (n > 40) return;
    if (terminals.has(id)) {
      best = Math.max(best, n);
      return;
    }
    const s = states.get(id);
    if (!s) return;
    const c = s.kind === 'question' ? n + 1 : n;
    for (const e of s.next || []) {
      if (e.allow_cycle) continue;
      const key = `${id}->${e.go}`;
      if (seen.has(key)) continue;
      walk(e.go, c, new Set([...seen, key]));
    }
  };
  walk(machine.entry, 0, new Set());
  return best;
}

/**
 * Everything a machine has to be true before it can face a homeowner.
 *
 * Errors block publishing. The last one is the one that matters most and the
 * hardest to see by eye: a price or a guard that reads an answer some route
 * never collects. It is computed as a "must reach" dataflow to a fixpoint —
 * a key is available at a state only if every route into it produced the key.
 */
export function validate(
  machine: Machine,
  rateCard: RateCard,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const states = new Map(machine.states.map((s) => [s.id, s]));
  const terminals = new Map(machine.terminals.map((t) => [t.id, t]));
  const exists = (id: string) => states.has(id) || terminals.has(id);

  if (!exists(machine.entry))
    errors.push(`entry "${machine.entry}" does not exist`);

  // 1. every edge points somewhere; 2. nothing after an `always` edge can fire
  for (const s of states.values()) {
    if (!s.next || s.next.length === 0)
      errors.push(`state "${s.id}" is a dead end — nothing follows it`);
    let sawAlways = false;
    for (const e of s.next || []) {
      if (!exists(e.go))
        errors.push(`state "${s.id}" goes to "${e.go}", which does not exist`);
      if (sawAlways)
        errors.push(
          `state "${s.id}": the branch to "${e.go}" can never happen — an earlier branch already catches everything`,
        );
      if (e.always === true || e.when?.always === true) sawAlways = true;
    }
    if (!sawAlways && s.kind !== 'fragment') {
      errors.push(
        `state "${s.id}" has no catch-all branch — some answers would go nowhere`,
      );
    }
    if (
      s.kind === 'derive' &&
      !(s.rules || []).some((r) => r.always === true || r.when?.always === true)
    ) {
      errors.push(`derive "${s.id}" has no catch-all rule`);
    }
    const seen = new Set<string>();
    for (const e of s.next || []) {
      const k = JSON.stringify(e.when || null);
      if (k !== 'null' && seen.has(k))
        warnings.push(
          `state "${s.id}" asks the same question twice — two branches share an identical condition`,
        );
      seen.add(k);
    }
  }

  // 3. every choice option is handled
  const coverage = (s: State, answer: AnswerSpec | GroupField) => {
    const key = answer.key as string;
    const guardedHere = (s.next || []).filter(
      (e) => e.when && referencedVars(e.when).has(key),
    );
    if (guardedHere.length === 0) return;
    const covered = new Set<unknown>();
    for (const e of guardedHere) {
      const p = e.when;
      if (!p) continue;
      if (p.var === key && 'eq' in p) covered.add(p.eq);
      if (p.var === key && 'in' in p)
        (p.in as unknown[]).forEach((v) => covered.add(v));
    }
    for (const o of answer.options || []) {
      if (
        !covered.has(o.value) &&
        !(s.next || []).some((e) => e.always === true)
      ) {
        errors.push(
          `state "${s.id}": you haven't said what happens if they answer "${o.label}"`,
        );
      }
    }
  };
  for (const s of states.values()) {
    for (const ans of choiceAnswers(s)) coverage(s, ans);
  }

  // 4. reachability
  const reachable = new Set([machine.entry]);
  const queue = [machine.entry];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const e of states.get(id)?.next || []) {
      if (!reachable.has(e.go)) {
        reachable.add(e.go);
        if (states.has(e.go)) queue.push(e.go);
      }
    }
  }
  for (const s of states.values())
    if (!reachable.has(s.id))
      errors.push(`state "${s.id}" can never be reached — nothing leads to it`);
  for (const t of terminals.values()) {
    if (reachable.has(t.id)) continue;
    if (t.kind === 'overlay') continue;
    const usedAsSpan = machine.terminals.some(
      (x) =>
        (x.spans || []).includes(t.id) ||
        (x.alternatives || []).some((a) => a.terminal === t.id) ||
        x.indicative?.terminal === t.id,
    );
    if (!usedAsSpan && !t._shared)
      errors.push(`outcome "${t.id}" can never be reached`);
    else if (!usedAsSpan && t._shared)
      warnings.push(`shared outcome "${t.id}" is not used by this machine`);
  }

  // 5. every priced outcome has a price
  for (const t of terminals.values()) {
    if (t.kind !== 'quote' && t.kind !== 'quote_with_condition') continue;
    const r = resolveTerminal(machine, t.id);
    if (!r.line_items || r.line_items.length === 0)
      errors.push(
        `outcome "${t.id}" charges for nothing — it has no priced lines`,
      );
  }

  // 6. rate-card and catalog references resolve
  for (const t of terminals.values()) {
    if (!['quote', 'quote_with_condition'].includes(t.kind)) continue;
    for (const item of resolveTerminal(machine, t.id).line_items) {
      if (item.catalog && !catGet(rateCard, item.catalog))
        errors.push(
          `outcome "${t.id}", line "${item.id}": no parts-list entry "${item.catalog}"`,
        );
      if (item.rate && rcGet(rateCard, item.rate) === undefined)
        errors.push(
          `outcome "${t.id}", line "${item.id}": no rate-card entry "${item.rate}"`,
        );
      if (
        item.multiply_by_rate_card &&
        rcGet(rateCard, item.multiply_by_rate_card) === undefined
      )
        errors.push(
          `outcome "${t.id}", line "${item.id}": no rate-card entry "${item.multiply_by_rate_card}"`,
        );
      if (item.qty?.of_item) {
        const all = resolveTerminal(machine, t.id).line_items;
        const from = all.findIndex((i) => i.id === item.qty?.of_item);
        const self = all.findIndex((i) => i.id === item.id);
        if (from < 0)
          errors.push(
            `outcome "${t.id}", line "${item.id}": refers to "${item.qty.of_item}", which isn't in this outcome`,
          );
        else if (from > self)
          errors.push(
            `outcome "${t.id}", line "${item.id}": refers to "${item.qty.of_item}", which is priced after it`,
          );
      }
    }
  }

  // 7. path-sensitive availability — "must" dataflow to a fixpoint
  const universe = new Set<string>();
  for (const s of states.values()) produces(s).forEach((k) => universe.add(k));
  const preds = new Map<string, string[]>();
  for (const s of states.values())
    for (const e of s.next || []) {
      if (!preds.has(e.go)) preds.set(e.go, []);
      (preds.get(e.go) as string[]).push(s.id);
    }
  const avail = new Map<string, Set<string>>();
  for (const id of [...states.keys(), ...terminals.keys()])
    avail.set(id, id === machine.entry ? new Set() : new Set(universe));
  for (let i = 0; i < 60; i++) {
    let changed = false;
    for (const id of avail.keys()) {
      if (id === machine.entry) continue;
      const ps = preds.get(id) || [];
      if (!ps.length) continue;
      let next: Set<string> | null = null;
      for (const p of ps) {
        const s = new Set([
          ...(avail.get(p) || []),
          ...produces(states.get(p) || ({} as Record<string, never>)),
        ]);
        next = next === null ? s : new Set([...next].filter((k) => s.has(k)));
      }
      if (next && next.size !== (avail.get(id) as Set<string>).size) {
        avail.set(id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const checkRefsWith = (where: string, node: unknown, set: Set<string>) => {
    for (const v of referencedVars(node)) {
      if (!universe.has(v)) continue;
      if (!set.has(v))
        errors.push(
          `${where} uses "${v}", but there's a route here that never asks it`,
        );
    }
  };
  const selfAware = new Map<string, Set<string>>();
  for (const s of states.values())
    selfAware.set(s.id, new Set([...(avail.get(s.id) || []), ...produces(s)]));
  for (const s of states.values()) {
    for (const e of s.next || [])
      if (e.when)
        checkRefsWith(
          `state "${s.id}"`,
          e.when,
          selfAware.get(s.id) as Set<string>,
        );
    if (s.kind === 'derive')
      for (const r of s.rules || [])
        if (r.when)
          checkRefsWith(
            `rule in "${s.id}"`,
            r.when,
            selfAware.get(s.id) as Set<string>,
          );
  }
  for (const t of terminals.values()) {
    if (t.kind === 'overlay' || !avail.has(t.id) || !reachable.has(t.id))
      continue;
    checkRefsWith(
      `outcome "${t.id}"`,
      { l: t.line_items, u: t.uncertainty, p: t.presentation },
      avail.get(t.id) as Set<string>,
    );
  }

  // 8. lints
  for (const s of states.values()) {
    if (s.kind !== 'question') continue;
    if (!s.ask?.why)
      warnings.push(`question "${s.id}" doesn't say why it's being asked`);
    for (const ans of choiceAnswers(s)) {
      if (
        !ans.exhaustive &&
        !ans.unknown_option &&
        !(ans.options || []).some((o) =>
          /not sure|don't know|dont know/i.test(o.label),
        )
      ) {
        warnings.push(
          `question "${s.id}" (${ans.key}) gives no way to say "I don't know"`,
        );
      }
    }
  }
  const depth = longestPath(machine, states, terminals);
  if (depth > 18)
    warnings.push(
      `the longest route asks ${depth} questions — past the point a homeowner finishes`,
    );

  return { errors, warnings, depth };
}
