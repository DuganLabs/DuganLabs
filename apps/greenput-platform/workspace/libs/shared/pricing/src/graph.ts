import type {
  Edge,
  Fragment,
  LineItem,
  Machine,
  ResolvedTerminal,
  State,
  Terminal,
} from './types.ts';

/**
 * Splice every `fragment` state's sub-graph into the machine.
 *
 * A fragment has one entry and a `__return__` edge target. Inlining prefixes
 * every internal state id with `<including state>__`, rewrites internal targets,
 * and splices the including state's own `next` list in wherever `__return__`
 * appears. The including state itself becomes a pass-through checkpoint, which
 * is why fixture paths contain both `panel_check__include` and
 * `panel_check__include__panel_location`.
 *
 * Shared endings are merged last, and only when something in the assembled
 * machine actually routes to them — including from inside a fragment.
 */
export function inlineFragments(
  machine: Machine,
  fragments: Record<string, Fragment>,
  sharedTerminals: Terminal[],
): Machine {
  const out: Machine = {
    ...machine,
    states: [],
    terminals: [...(machine.terminals || [])],
  };

  const emit = (s: State) => out.states.push(s);

  for (const s of machine.states || []) {
    if (s.kind !== 'fragment') {
      emit(s);
      continue;
    }
    const frag = fragments[s.fragment as string];
    if (!frag)
      throw new Error(`${machine.slug}: unknown fragment "${s.fragment}"`);
    const pfx = `${s.id}__`;
    const localIds = new Set(frag.states.map((x) => x.id));
    const rewrite = (target: string) =>
      localIds.has(target) ? pfx + target : target;

    emit({
      id: s.id,
      kind: 'checkpoint',
      _fragment_entry: s.fragment,
      next: [{ always: true, go: pfx + frag.entry }],
    });

    for (const fs of frag.states) {
      const copy = JSON.parse(JSON.stringify(fs)) as State;
      copy.id = pfx + fs.id;
      copy._from_fragment = frag.id;
      copy.next = [];
      for (const edge of fs.next || []) {
        if (edge.go === '__return__') {
          for (const cont of s.next || []) copy.next.push({ ...cont });
        } else {
          copy.next.push({ ...edge, go: rewrite(edge.go) });
        }
      }
      emit(copy);
    }
  }

  const assembled = JSON.stringify({
    s: out.states,
    t: out.terminals,
    h: machine.honesty,
    o: machine.overlays,
  });
  for (const t of sharedTerminals) {
    if (out.terminals.some((x) => x.id === t.id)) continue;
    if (!assembled.includes(`"${t.id}"`)) continue;
    out.terminals.push({ ...t, _shared: true });
  }
  return out;
}

/**
 * Apply `extends` to a terminal: inherit the parent's line items, then remove
 * `drop_items`, replace by id from `line_items_override`, and append
 * `line_items_extra`.
 *
 * `_parent_widen` and `_inherits_widen_from` are carried through so
 * `computeSpread` can decide whether the child re-uses the parent's widening
 * rules — a child that does not opt in with `uncertainty.inherit_widen_from`
 * gets only its own.
 */
export function resolveTerminal(
  machine: Machine,
  id: string,
  seen: Set<string> = new Set(),
): ResolvedTerminal {
  const t = machine.terminals.find((x) => x.id === id);
  if (!t) throw new Error(`${machine.slug}: unknown terminal "${id}"`);
  if (!t.extends) return { ...t, line_items: [...(t.line_items || [])] };
  if (seen.has(id))
    throw new Error(`${machine.slug}: extends cycle at "${id}"`);
  seen.add(id);
  const parent = resolveTerminal(machine, t.extends, seen);
  let items: LineItem[] = [...parent.line_items];
  for (const drop of t.drop_items || [])
    items = items.filter((i) => i.id !== drop);
  for (const ov of t.line_items_override || []) {
    const idx = items.findIndex((i) => i.id === ov.id);
    if (idx >= 0) items[idx] = ov;
    else items.push(ov);
  }
  items = items.concat(t.line_items_extra || []);
  return {
    ...parent,
    ...t,
    line_items: items,
    includes: [...(parent.includes || []), ...(t.includes_extra || [])],
    excludes_extra: [
      ...(parent.excludes_extra || []),
      ...(t.excludes_extra || []),
    ],
    uncertainty: { ...(parent.uncertainty || {}), ...(t.uncertainty || {}) },
    _inherits_widen_from: t.uncertainty?.inherit_widen_from || null,
    _parent_widen: parent.uncertainty?.widen || [],
  };
}

/** Every edge out of a state, as authored. Convenience for the validator and UI. */
export function edgesOf(s: State): Edge[] {
  return s.next || [];
}
