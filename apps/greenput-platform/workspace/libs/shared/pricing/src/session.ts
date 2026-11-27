import { evaluate } from './evaluate.ts';
import { questionKeys, traverseGraph } from './traverse.ts';
import type {
  AnswerSpec,
  Answers,
  EnvFacts,
  EvalContext,
  EvaluationResult,
  GroupField,
  Machine,
  RateCard,
  State,
} from './types.ts';
import { DEFAULT_ENV } from './evaluate.ts';

/**
 * One screen, ready to render.
 *
 * `index` and `typicalTotal` exist only for the progress indicator; the machine
 * has no fixed length, so `typicalTotal` is the author's declared typical count
 * and `index` can legitimately exceed it on a long route.
 */
export interface Screen {
  stateId: string;
  ask: State['ask'];
  answer: AnswerSpec;
  index: number;
  typicalTotal: number;
}

export type SessionStep =
  | { status: 'question'; screen: Screen; path: string[] }
  | { status: 'complete'; result: EvaluationResult };

/**
 * Walk the machine as far as the answers allow.
 *
 * Answers given so far are the only state a session needs: derived values,
 * defaults and photo interpretations are recomputed on every step, so a session
 * can be resumed, replayed or re-priced against a different rate card without
 * carrying anything stale. When the walk reaches a terminal this hands off to
 * `evaluate()` — the same function the eighteen fixtures pin — so the price a
 * homeowner sees is produced by the conformance-tested path, not a second one.
 */
export function step(
  machine: Machine,
  rateCard: RateCard,
  answers: Answers,
  env: EnvFacts = {},
): SessionStep {
  const ctx: EvalContext = {
    rateCard,
    answers: JSON.parse(JSON.stringify(answers)),
    env: { ...DEFAULT_ENV, ...env },
    notices: new Set<string>(),
  };
  const walk = traverseGraph(machine, ctx, { onUnanswered: 'pause' });
  if (walk.status === 'terminal') {
    return {
      status: 'complete',
      result: evaluate(machine, rateCard, answers, env),
    };
  }
  const asked = walk.path.filter(
    (id) => machine.states.find((s) => s.id === id)?.kind === 'question',
  ).length;
  return {
    status: 'question',
    path: walk.path,
    screen: {
      stateId: walk.state.id,
      ask: walk.state.ask,
      answer: walk.state.answer as AnswerSpec,
      index: asked,
      typicalTotal: machine.meta?.typical_question_count ?? 0,
    },
  };
}

// ── Turning submitted form values into answers ────────────────────────────────

export interface FieldError {
  key: string;
  message: string;
}

export type CoerceResult =
  { ok: true; answers: Answers } | { ok: false; errors: FieldError[] };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

const asString = (v: unknown): string =>
  v === undefined || v === null ? '' : String(v).trim();

/** The key a measurement screen posts its "I'm not sure" ladder under. */
export const estimateKeyFor = (key: string): string => `${key}__estimate`;

/** The key a photo screen posts its status under. */
export const photoStatusKeyFor = (key: string): string => `${key}__status`;

function coerceChoice(
  key: string,
  spec: {
    options?: Array<{ value: string }>;
    required?: boolean;
    default?: unknown;
  },
  raw: unknown,
  errors: FieldError[],
): unknown {
  const v = asString(raw);
  if (!v) {
    // A screen that declares a default has already said what silence means.
    if (spec.default !== undefined) return spec.default;
    if (spec.required === false) return '';
    errors.push({ key, message: 'Please choose one of the options.' });
    return undefined;
  }
  if (!(spec.options || []).some((o) => o.value === v)) {
    errors.push({ key, message: 'Please choose one of the options.' });
    return undefined;
  }
  return v;
}

function coerceMeasurement(
  key: string,
  spec: AnswerSpec | GroupField,
  input: Record<string, unknown>,
  errors: FieldError[],
): unknown {
  // The "I'm not sure" ladder wins when it is picked, and stores
  // `{value, estimated: true}` — which widening rules test for with
  // `{"var": k, "estimated": true}`, costing six points of spread.
  const ladder = asString(input[estimateKeyFor(key)]);
  if (ladder) {
    const option = (spec.estimate_options || []).find(
      (o) => String(o.value) === ladder,
    );
    if (!option) {
      errors.push({ key, message: 'Please choose one of the options.' });
      return undefined;
    }
    return { value: option.value, estimated: true };
  }
  const raw = asString(input[key]);
  if (!raw) {
    if (spec.required === false) return undefined;
    errors.push({
      key,
      message: 'Please enter a number, or pick one of the options.',
    });
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    errors.push({ key, message: 'Please enter a number.' });
    return undefined;
  }
  if (spec.min !== undefined && n < spec.min) {
    errors.push({
      key,
      message: `That looks too small — the smallest we take is ${spec.min}.`,
    });
    return undefined;
  }
  if (spec.max !== undefined && n > spec.max) {
    errors.push({
      key,
      message: `That looks too big — the largest we take is ${spec.max}.`,
    });
    return undefined;
  }
  return n;
}

function coerceText(
  key: string,
  field: GroupField,
  raw: unknown,
  errors: FieldError[],
): unknown {
  const v = asString(raw);
  const required = field.required !== false;
  if (!v) {
    if (required)
      errors.push({ key, message: `Please fill in ${field.label ?? 'this'}.` });
    return v;
  }
  if (field.type === 'email' && !EMAIL_PATTERN.test(v)) {
    errors.push({ key, message: 'Please enter a valid email address.' });
    return undefined;
  }
  if (field.type === 'phone' && v.replace(/\D/g, '').length < 10) {
    errors.push({ key, message: 'Please enter a valid phone number.' });
    return undefined;
  }
  if (field.type === 'zip' && !ZIP_PATTERN.test(v)) {
    errors.push({ key, message: 'Please enter a 5-digit ZIP code.' });
    return undefined;
  }
  return v;
}

/**
 * Turn one submitted screen into answers the engine can read.
 *
 * Every key the screen collects is written, including the ones left blank —
 * that is what stops an optional field from re-asking the same screen forever.
 * A `photo` screen writes `{status, fields}`: the traversal never waits for the
 * photo, so a skipped one is a perfectly valid answer of `status: "missing"`.
 */
export function coerceScreenAnswers(
  state: State,
  input: Record<string, unknown>,
): CoerceResult {
  const errors: FieldError[] = [];
  const answers: Answers = {};
  const spec = state.answer;
  if (!spec) return { ok: true, answers };

  if (spec.type === 'group') {
    for (const field of spec.fields || []) {
      let value: unknown;
      if (field.type === 'choice') {
        value = coerceChoice(field.key, field, input[field.key], errors);
      } else if (field.type === 'measurement') {
        value = coerceMeasurement(field.key, field, input, errors);
      } else {
        value = coerceText(field.key, field, input[field.key], errors);
      }
      if (value !== undefined) answers[field.key] = value;
    }
  } else if (spec.type === 'choice') {
    const value = coerceChoice(
      spec.key as string,
      spec,
      input[spec.key as string],
      errors,
    );
    if (value !== undefined) answers[spec.key as string] = value;
  } else if (spec.type === 'multi_choice') {
    const key = spec.key as string;
    const raw = input[key];
    const picked = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
      .map(asString)
      .filter((v) => (spec.options || []).some((o) => o.value === v));
    if (spec.max_select !== undefined && picked.length > spec.max_select) {
      errors.push({
        key,
        message: `Please choose at most ${spec.max_select}.`,
      });
    } else {
      answers[key] = picked;
    }
  } else if (spec.type === 'measurement') {
    const key = spec.key as string;
    const value = coerceMeasurement(key, spec, input, errors);
    if (value !== undefined) answers[key] = value;
  } else if (spec.type === 'photo') {
    const key = spec.key as string;
    // A photo screen stores PRESENCE and nothing else: `missing` (no file, or
    // "I'll send it later") or `unreviewed` (a file is with us). Never
    // `reviewed`, and never any `fields` — a verdict that moves a price is
    // read off the image by a human and lives in `pricing_photo_reviews`,
    // overlaid on the way out by `withPhotoReadings`. Accepting either from
    // the request body would let a homeowner assert their own panel's
    // capacity and price the cheap path.
    const raw = input[key];
    const declared =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? asString((raw as { status?: unknown }).status)
        : asString(input[photoStatusKeyFor(key)]);
    answers[key] = {
      status: declared === 'unreviewed' ? 'unreviewed' : 'missing',
      fields: {},
    };
  }

  if (errors.length > 0) return { ok: false, errors };

  // Every key the screen collects must end up present, or the walk re-asks it.
  for (const key of questionKeys(state)) {
    if (!(key in answers)) answers[key] = '';
  }
  return { ok: true, answers };
}
