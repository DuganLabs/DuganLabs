/**
 * The shapes the pricing engine reads.
 *
 * These describe `seeds/pricing/*.json` — machines, fragments, the rate card
 * and the fixtures — as the reference evaluator in
 * `scripts/seed/pricing-fsms.mjs` consumed them before this library existed.
 * They are deliberately permissive: the seed JSON is authored by hand and the
 * validator, not the type system, decides whether a machine is publishable.
 * `seeds/pricing/README.md` is the normative description.
 */

/**
 * A JSON-serialisable value.
 *
 * Used where a value is going into or coming out of a `*_json` column and the
 * shape is the author's, not ours — a photo reading's `fields`, keyed by the
 * machine's own `interpretation.fields` names.
 */
export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };

/** A homeowner's answer. `measurement` answers may arrive as `{value, estimated}`. */
export type AnswerValue = unknown;

/** Everything the traversal knows, keyed by answer key. */
export type Answers = Record<string, AnswerValue>;

/** Environment facts a predicate can read: `in_service_area`, `rate_card_tuned`, `is_weekend`. */
export type EnvFacts = Record<string, unknown>;

// ── Predicates ────────────────────────────────────────────────────────────────

/**
 * A guard. One source (`var` / `env` / `rate_card` / `notice`) combined with one
 * operator, or one of the combinators. `says` is documentation the evaluator
 * ignores.
 */
export interface Predicate {
  always?: boolean;
  all?: Predicate[];
  any?: Predicate[];
  not?: Predicate;
  var?: string;
  env?: string;
  rate_card?: string;
  notice?: string;
  eq?: unknown;
  ne?: unknown;
  in?: unknown[];
  nin?: unknown[];
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  contains?: unknown;
  contains_any?: unknown[];
  count_gte?: number;
  answered?: boolean;
  estimated?: boolean;
  says?: string;
}

/** An ordered, guarded edge out of a state. First match wins. */
export interface Edge {
  when?: Predicate;
  always?: boolean;
  go: string;
  /** Suppresses this edge in the longest-path lint. */
  allow_cycle?: boolean;
  says?: string;
}

// ── Answers as authored ───────────────────────────────────────────────────────

export interface ChoiceOption {
  value: string;
  label: string;
  help?: string;
  [extra: string]: unknown;
}

export interface EstimateOption {
  value: number;
  label: string;
  estimated?: boolean;
}

export interface PhotoShot {
  id: string;
  label: string;
  guidance?: string;
}

export interface PhotoFieldSpec {
  type: string;
  values?: string[];
  default_when_missing: unknown;
}

export interface PhotoInterpretation {
  fields: Record<string, PhotoFieldSpec>;
  status_key: string;
  status_values?: string[];
  resolvers?: string[];
  resolution_policy?: string;
}

/** One field inside a `group` screen. */
export interface GroupField {
  key: string;
  type: string;
  label?: string;
  style?: string;
  required?: boolean;
  exhaustive?: boolean;
  unknown_option?: boolean;
  default?: unknown;
  options?: ChoiceOption[];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  estimate_options?: EstimateOption[];
  [extra: string]: unknown;
}

export interface AnswerSpec {
  type: 'choice' | 'multi_choice' | 'measurement' | 'photo' | 'group';
  key?: string;
  label?: string;
  default?: unknown;
  required?: boolean;
  exhaustive?: boolean;
  unknown_option?: boolean;
  options?: ChoiceOption[];
  fields?: GroupField[];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  estimate_options?: EstimateOption[];
  shots?: PhotoShot[];
  safety_note?: string;
  skippable?: boolean;
  skip_label?: string;
  interpretation?: PhotoInterpretation;
  max_select?: number;
  [extra: string]: unknown;
}

export interface Ask {
  question: string;
  help?: string | null;
  why?: string | null;
  [extra: string]: unknown;
}

/** A rule inside a `derive` state. */
export interface DeriveRule {
  when?: Predicate;
  always?: boolean;
  value?: unknown;
  /** Leaves an already-present value alone. */
  keep?: boolean;
  notice?: string;
  because?: string;
}

export interface State {
  id: string;
  kind: 'question' | 'derive' | 'defaults' | 'checkpoint' | 'fragment';
  next?: Edge[];
  /** `question` */
  answer?: AnswerSpec;
  ask?: Ask;
  /** `derive` writes one key; `defaults` writes a map of them. */
  sets?: string | Record<string, unknown>;
  rules?: DeriveRule[];
  explain?: string;
  /** `fragment` — the id of the fragment to splice in. */
  fragment?: string;
  /** Set by `inlineFragments`. */
  _fragment_entry?: string;
  _from_fragment?: string;
  [extra: string]: unknown;
}

// ── Terminals ─────────────────────────────────────────────────────────────────

export interface Quantity {
  base?: number;
  per?: Array<{
    of?: string;
    rate_card?: string;
    rate?: number;
    minus?: number;
    default?: number;
  }>;
  modifiers?: Array<{
    when?: Predicate;
    always?: boolean;
    op: 'add' | 'multiply' | 'set';
    value: number;
    because?: string;
  }>;
  min?: number | null;
  max?: number | null;
  round_to?: number;
  /** Reads another line item's computed quantity. That item must be priced first. */
  of_item?: string;
  factor?: number;
}

export interface LineItem {
  id: string;
  kind: 'labour' | 'material' | 'allowance' | 'fee' | 'sub' | 'adjustment';
  label: string;
  when?: Predicate;
  qty?: Quantity;
  /** `labour` / `fee` / `sub` — a rate-card path. */
  rate?: string;
  /** `material` / `allowance` — a parts-list key. */
  catalog?: string;
  waste_pct?: number | null;
  /** `adjustment` — a rate-card multiplier applied to the labour subtotal. */
  multiply_by_rate_card?: string;
  /** `high_only` puts the line in the top of the range only. */
  range_side?: 'both' | 'high_only';
  [extra: string]: unknown;
}

export interface WidenRule {
  when: Predicate;
  add_pct: number;
  because: string;
}

export interface Uncertainty {
  base_spread_pct?: number | null;
  extra_spread_pct?: number;
  extra_spread_because?: string;
  flat_pad_usd?: number | null;
  widen?: WidenRule[];
  inherit_widen_from?: string | null;
  [extra: string]: unknown;
}

export interface Addon {
  id: string;
  label: string;
  when?: Predicate;
  flat_usd?: number;
  flat_usd_is_placeholder?: boolean;
  qty?: Quantity;
  rate?: string;
}

/** One sentence a terminal shows when its guard fires. */
export interface Condition {
  when?: Predicate;
  always?: boolean;
  say: string;
}

export interface Presentation {
  conditions?: Condition[];
  [extra: string]: unknown;
}

export interface Terminal {
  id: string;
  kind:
    | 'quote'
    | 'quote_with_condition'
    | 'span'
    | 'no_quote'
    | 'urgent'
    | 'referral'
    | 'overlay';
  title?: string;
  line_items?: LineItem[];
  /** `extends` support. */
  extends?: string;
  drop_items?: string[];
  line_items_override?: LineItem[];
  line_items_extra?: LineItem[];
  includes?: string[];
  includes_extra?: string[];
  excludes_extra?: string[];
  uncertainty?: Uncertainty;
  presentation?: Presentation;
  addons?: Addon[];
  /** `span` — the terminals whose bands this one brackets. */
  spans?: string[];
  alternatives?: Array<{ terminal: string; [extra: string]: unknown }>;
  indicative?: { terminal?: string; [extra: string]: unknown };
  /** Set by `inlineFragments` when a shared ending is merged in. */
  _shared?: boolean;
  [extra: string]: unknown;
}

/** A terminal with `extends` already applied. */
export interface ResolvedTerminal extends Terminal {
  line_items: LineItem[];
  _inherits_widen_from?: string | null;
  _parent_widen?: WidenRule[];
  _refused_because?: string;
}

// ── Machines ──────────────────────────────────────────────────────────────────

export interface Honesty {
  refuse_to_quote_when?: Array<{ when: Predicate; because: string }>;
  on_exceed_max_spread?: string;
  [extra: string]: unknown;
}

export interface MachineMeta {
  homeowner_title?: string;
  homeowner_intro?: string;
  typical_question_count?: number;
  longest_path_question_count?: number;
  progress_style?: string;
  [extra: string]: unknown;
}

export interface Machine {
  slug: string;
  name: string;
  vertical: string;
  version?: number;
  entry: string;
  states: State[];
  terminals: Terminal[];
  includes_fragments?: string[];
  overlays?: Array<{ when: Predicate; apply: string }>;
  honesty?: Honesty;
  meta?: MachineMeta;
  [extra: string]: unknown;
}

export interface Fragment {
  id: string;
  kind?: string;
  entry: string;
  states: State[];
  [extra: string]: unknown;
}

export interface SharedTerminalsDoc {
  kind: 'shared_terminals';
  terminals: Terminal[];
}

// ── Rate card ─────────────────────────────────────────────────────────────────

export interface CatalogEntry {
  cost: number;
  unit?: string;
  label?: string;
  [extra: string]: unknown;
}

/**
 * The contractor's numbers. Every leaf may be either a bare value or a
 * `{value, ...}` wrapper carrying provenance — `rcGet` unwraps both.
 */
export interface RateCard {
  slug: string;
  name: string;
  materials: {
    catalog: Record<string, CatalogEntry>;
    [extra: string]: unknown;
  };
  [extra: string]: unknown;
}

// ── Evaluation results ────────────────────────────────────────────────────────

export interface PricedLine {
  id: string;
  label: string;
  kind: string;
  qty: number;
  cost: number;
  detail: string;
  side: 'both' | 'high_only';
}

export interface SpanPart {
  id: string;
  /**
   * The spanned terminal's own title — what a homeowner reads. Required, not
   * optional: every part is built in one place (`evaluate`), and a part with
   * no title is exactly the bug that put `T_subpanel_required` on a page.
   */
  title: string;
  lines: PricedLine[];
  point: number;
  pointHigh: number;
  spread: number;
  uncapped: number;
  cap: number;
  reasons: Array<Partial<WidenRule>>;
  low: number;
  high: number;
  minimum_applied: boolean;
}

export interface EvaluatedAddon {
  id: string;
  label: string;
  cost: number;
  qty?: number;
  placeholder?: boolean;
}

/**
 * What `evaluate()` returns. `kind` follows the terminal reached, except that a
 * spread above the ceiling turns any outcome into `no_quote` — a range that
 * wide is not a price.
 */
/**
 * What a terminal tells the person to do next.
 *
 * Authored per terminal in seeds/pricing. `surface_phone_immediately` is set
 * on T_urgent_dispatch: the contractor's number has to be reachable without
 * scrolling, because the body above it says to switch a breaker off and stop
 * using the circuit.
 */
export interface TerminalNextStep {
  cta?: string;
  alt_cta?: string;
  cost_promise?: string | null;
  surface_phone_immediately?: boolean;
}

export interface EvaluationResult {
  terminal: string;
  kind: string;
  path: string[];
  notices: string[];
  answers: Answers;
  low: number | null;
  high: number | null;
  /**
   * The terminal's authored presentation. Carried on EVERY outcome, not only
   * `kind: 'quote'` — these used to be dropped for every other kind, so a
   * homeowner who answered "I can smell burning" was shown "No price yet"
   * while the machine's own body text said to get out and call 911.
   */
  title?: string;
  summary?: string;
  body?: string;
  next_step?: TerminalNextStep;
  lines?: PricedLine[];
  point?: number;
  point_high?: number;
  spread_pct?: number;
  spread_reasons?: Array<Partial<WidenRule>>;
  minimum_applied?: boolean;
  addons?: EvaluatedAddon[];
  conditions?: string[];
  spans?: SpanPart[];
  refused_because?: string | null;
  indicative?: { low: number; high: number; not_a_quote: true };
  /**
   * Where this quote is on its way to a price: no price → range → one exact
   * number (docs/pricing-fsm-designs.md §9 H1). See `quote-stage.ts`.
   */
  stage?: 'no_price' | 'range' | 'exact';
  /** The one exact number, to the cent. Set only when `stage === 'exact'`. */
  exact?: number;
  /**
   * What still stands between a priced quote and one exact number, in words a
   * contractor can act on. Empty when exact; absent when there is no price.
   */
  exact_blockers?: string[];
}

/** The mutable bundle a traversal carries. */
export interface EvalContext {
  rateCard: RateCard;
  answers: Answers;
  env: EnvFacts;
  notices: Set<string>;
}
