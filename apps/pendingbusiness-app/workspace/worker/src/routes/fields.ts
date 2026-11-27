/**
 * Field validators for the JSON bodies the write routes accept.
 *
 * Each returns either `{ value }` — the cleaned value to bind — or
 * `{ message }`, a complete sentence naming the field, which the caller wraps
 * in the `jsonError` envelope (routes/onboarding.ts) with the field name. The
 * bounds here mirror the CHECK constraints in migrations/, so a value that
 * passes never turns into a 500 out of D1 (the drift schema-drift.test.ts
 * exists to catch).
 */

export type Checked<T> = { value: T; message?: undefined } | { message: string; value?: undefined };

export interface NumberBounds {
  min: number;
  max: number;
  /** Require a whole number (kids, days, priorities). */
  integer?: boolean;
}

export function numberField(raw: unknown, field: string, bounds: NumberBounds): Checked<number> {
  const { min, max, integer = false } = bounds;
  const kind = integer ? 'a whole number' : 'a number';
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    (integer && !Number.isInteger(raw)) ||
    raw < min ||
    raw > max
  ) {
    return { message: `${field} must be ${kind} between ${min} and ${max}.` };
  }
  return { value: raw };
}

export function stringField(
  raw: unknown,
  field: string,
  opts: { maxLength: number; optional?: boolean },
): Checked<string | null> {
  if (raw === undefined || raw === null || raw === '') {
    if (opts.optional) return { value: null };
    return { message: `${field} is required.` };
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { message: `${field} must be text.` };
  }
  const clean = raw.trim();
  if (clean.length > opts.maxLength) {
    return { message: `${field} must be at most ${opts.maxLength} characters.` };
  }
  return { value: clean };
}

export function oneOfField<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
): Checked<T> {
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    return { message: `${field} must be one of: ${allowed.join(', ')}.` };
  }
  return { value: raw as T };
}

export function booleanField(raw: unknown, field: string): Checked<boolean> {
  if (typeof raw !== 'boolean') return { message: `${field} must be true or false.` };
  return { value: raw };
}

/** A positive integer route param (`/api/x/:id`), or null when it is not one. */
export function idParam(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
