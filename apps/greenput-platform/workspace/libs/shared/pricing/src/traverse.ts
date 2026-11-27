import { evalPredicate } from './predicates.ts';
import type { EvalContext, Machine, State } from './types.ts';

/**
 * The answer keys a question screen collects from the homeowner.
 *
 * A `group` screen collects every one of its fields; every other screen
 * collects one. A `photo` screen collects only its own key — the fields it
 * *produces* (`panel_capacity`, `photo_status`, …) are written by the
 * interpretation step, never asked for.
 */
export function questionKeys(s: State): string[] {
  if (s.kind !== 'question' || !s.answer) return [];
  if (s.answer.type === 'group')
    return (s.answer.fields || []).map((f) => f.key);
  return s.answer.key ? [s.answer.key] : [];
}

export interface TraverseOptions {
  /**
   * What to do at a screen whose answers are missing.
   *
   * `throw` is the reference evaluator's behaviour and what `evaluate()` uses:
   * a fixture that skips a required answer is a broken fixture, not a pause.
   * `pause` is how an interactive form walks the same graph one screen at a
   * time — see `session.ts`.
   */
  onUnanswered?: 'throw' | 'pause';
}

export type TraverseResult =
  | { status: 'terminal'; terminalId: string; path: string[] }
  | { status: 'question'; state: State; path: string[] };

/**
 * Walk the machine from its entry, applying `defaults` and `derive` states and
 * interpreting photo answers along the way, until it reaches a terminal (or,
 * in `pause` mode, a screen it cannot answer).
 *
 * Mutates `ctx.answers` and `ctx.notices` — derived values are part of the
 * traversal's output, and `evaluate()` returns them.
 */
export function traverseGraph(
  machine: Machine,
  ctx: EvalContext,
  options: TraverseOptions = {},
): TraverseResult {
  const pause = options.onUnanswered === 'pause';
  const states = new Map(machine.states.map((s) => [s.id, s]));
  const terminals = new Set(machine.terminals.map((t) => t.id));
  let cur = machine.entry;
  const path: string[] = [];
  let guard = 0;

  while (!terminals.has(cur)) {
    if (++guard > 500)
      throw new Error(
        `${machine.slug}: traversal did not terminate (looping at ${cur})`,
      );
    const s = states.get(cur);
    if (!s) throw new Error(`${machine.slug}: no state or terminal "${cur}"`);
    path.push(s.id);

    if (s.kind === 'defaults') {
      for (const [k, v] of Object.entries(
        (s.sets ?? {}) as Record<string, unknown>,
      )) {
        if (!(k in ctx.answers)) ctx.answers[k] = v;
      }
    } else if (s.kind === 'derive') {
      let set = false;
      for (const r of s.rules || []) {
        if (evalPredicate(r.when || { always: r.always === true }, ctx)) {
          if (!r.keep) ctx.answers[s.sets as string] = r.value;
          if (r.notice) ctx.notices.add(r.notice);
          set = true;
          break;
        }
      }
      if (!set)
        throw new Error(`${machine.slug}: derive "${s.id}" matched no rule`);
    } else if (s.kind === 'question') {
      // In pause mode a screen with anything still unanswered is where the
      // walk stops. The screen is the unit: it is re-asked until every key it
      // collects is present, which is also what stops an optional field from
      // looping forever.
      if (pause && questionKeys(s).some((k) => !(k in ctx.answers))) {
        return { status: 'question', state: s, path };
      }

      const answer = s.answer;
      if (!answer)
        throw new Error(
          `${machine.slug}: question "${s.id}" has no answer spec`,
        );

      if (answer.type === 'group') {
        for (const f of answer.fields || []) {
          if (!(f.key in ctx.answers) && f.default !== undefined)
            ctx.answers[f.key] = f.default;
          if (!(f.key in ctx.answers) && f.required !== false) {
            throw new Error(
              `${machine.slug}: fixture has no answer for "${f.key}" (screen ${s.id})`,
            );
          }
        }
      } else {
        const key = answer.key as string;
        if (!(key in ctx.answers) && answer.default !== undefined)
          ctx.answers[key] = answer.default;
        if (!(key in ctx.answers))
          throw new Error(
            `${machine.slug}: fixture has no answer for "${key}" (state ${s.id})`,
          );
        if (answer.type === 'photo') {
          const a = (ctx.answers[key] || {}) as {
            status?: string;
            fields?: Record<string, unknown>;
          };
          const interp = answer.interpretation;
          if (interp) {
            ctx.answers[interp.status_key] = a.status ?? 'missing';
            for (const [f, spec] of Object.entries(interp.fields)) {
              ctx.answers[f] =
                a.fields && f in a.fields
                  ? a.fields[f]
                  : spec.default_when_missing;
            }
          }
        }
      }
    }

    let moved = false;
    for (const e of s.next || []) {
      if (evalPredicate(e.when || { always: e.always === true }, ctx)) {
        cur = e.go;
        moved = true;
        break;
      }
    }
    if (!moved)
      throw new Error(
        `${machine.slug}: state "${s.id}" had no edge that could fire`,
      );
  }
  path.push(cur);
  return { status: 'terminal', terminalId: cur, path };
}

/**
 * The reference evaluator's traversal: answers are complete, so the walk always
 * ends at a terminal. Kept as its own name because every fixture depends on it
 * throwing rather than pausing.
 */
export function traverse(
  machine: Machine,
  ctx: EvalContext,
): { terminalId: string; path: string[] } {
  const r = traverseGraph(machine, ctx);
  if (r.status !== 'terminal')
    throw new Error(`${machine.slug}: traversal paused without a terminal`);
  return { terminalId: r.terminalId, path: r.path };
}
