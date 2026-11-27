/**
 * Reading and filling the three data forms on /settings — household profile,
 * income source, liability — against the markup `scripts/partials.mjs`
 * renders for them.
 *
 * The forms are the one place the worker's numeric bounds appear in the
 * browser, and they appear as `min` / `max` / `step` on the controls rather
 * than as a second table here: `readNumber` validates from the control's own
 * attributes, so the partial is the single client-side source of a bound and
 * a mismatch with the worker shows up in test/settings.test.ts, not in a 400
 * the user has to read.
 *
 * Two fields are entered as percentages and stored as fractions — the S-Corp
 * salary share and a liability's APR. The conversion lives here, in both
 * directions, so `0.09` never reaches a person and `9` never reaches the DB.
 */
import type {
  HouseholdProfile,
  IncomeSource,
  IncomeType,
  Liability,
  LiabilityType,
} from '@pendingbusiness/core';
import { INCOME_TYPES, LIABILITY_TYPES } from '@pendingbusiness/core';

export type FormRead<T> = { ok: true; body: T } | { ok: false; field: string; message: string };

/**
 * API field → form control name, where they differ. Everything else is the
 * same name on both sides, so a worker 400 naming a field can be pointed at
 * a control without a lookup table for the common case.
 */
const CONTROL_FOR_FIELD: Readonly<Record<string, string>> = {
  scorpSalarySplit: 'scorpSalarySplitPercent',
  rateApr: 'rateAprPercent',
};

function control(form: HTMLFormElement, name: string): HTMLInputElement | HTMLSelectElement | null {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el : null;
}

/** The control's visible label, for a message a person reads. */
function labelOf(form: HTMLFormElement, name: string): string {
  const el = control(form, name);
  const label = el?.id ? form.querySelector(`label[for="${el.id}"]`) : null;
  return label?.textContent?.trim() || name;
}

function fail<T>(form: HTMLFormElement, name: string, message: string): FormRead<T> {
  return { ok: false, field: name, message: `${labelOf(form, name)} ${message}` };
}

/**
 * A numeric control, validated from its own `min` / `max` / `step`. Blank is
 * an error for a required control and `null` otherwise; a value outside the
 * bounds is refused here with the same sentence shape the worker would use,
 * so the user sees one voice whichever side catches it.
 */
function readNumber(form: HTMLFormElement, name: string): FormRead<number | null> {
  const el = control(form, name);
  if (!(el instanceof HTMLInputElement)) return fail(form, name, 'is missing from the form.');
  const raw = el.value.trim();
  if (raw === '') {
    if (el.required) return fail(form, name, 'is required.');
    return { ok: true, body: null };
  }
  const n = Number(raw);
  const min = el.min === '' ? Number.NEGATIVE_INFINITY : Number(el.min);
  const max = el.max === '' ? Number.POSITIVE_INFINITY : Number(el.max);
  const integer = el.step === '1';
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    const kind = integer ? 'a whole number' : 'a number';
    const range =
      Number.isFinite(min) && Number.isFinite(max)
        ? ` between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}`
        : '';
    return fail(form, name, `must be ${kind}${range}.`);
  }
  return { ok: true, body: n };
}

function readRequiredNumber(form: HTMLFormElement, name: string): FormRead<number> {
  const r = readNumber(form, name);
  if (!r.ok) return r;
  if (r.body === null) return fail(form, name, 'is required.');
  return { ok: true, body: r.body };
}

function readText(
  form: HTMLFormElement,
  name: string,
  opts: { required: boolean },
): FormRead<string | null> {
  const el = control(form, name);
  if (!el) return fail(form, name, 'is missing from the form.');
  const value = el.value.trim();
  if (value === '') {
    if (opts.required) return fail(form, name, 'is required.');
    return { ok: true, body: null };
  }
  const max = el instanceof HTMLInputElement && el.maxLength > 0 ? el.maxLength : Infinity;
  if (value.length > max) return fail(form, name, `must be at most ${max} characters.`);
  return { ok: true, body: value };
}

function readChoice<T extends string>(
  form: HTMLFormElement,
  name: string,
  allowed: readonly T[],
): FormRead<T> {
  const el = control(form, name);
  const value = el?.value ?? '';
  if (!allowed.includes(value as T))
    return fail(form, name, `must be one of: ${allowed.join(', ')}.`);
  return { ok: true, body: value as T };
}

function setValue(form: HTMLFormElement, name: string, value: string): void {
  const el = control(form, name);
  if (el) el.value = value;
}

/** 0.0899 → 8.99, without the float noise `* 100` alone leaves behind. */
export function fractionToPercent(fraction: number): number {
  return Number((fraction * 100).toFixed(4));
}
/** 8.99 → 0.0899. */
export function percentToFraction(percent: number): number {
  return Number((percent / 100).toFixed(6));
}

/**
 * Point `aria-invalid` at the control a message is about — the worker's
 * `error.field` or a local read's `field` — and clear it everywhere else.
 * Returns the control so the caller can focus it.
 */
export function markInvalid(form: HTMLFormElement, field: string | null): Element | null {
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  if (!field) return null;
  const el = control(form, CONTROL_FOR_FIELD[field] ?? field);
  el?.setAttribute('aria-invalid', 'true');
  return el;
}

// ── household ───────────────────────────────────────────────

export function fillHouseholdForm(form: HTMLFormElement, p: HouseholdProfile): void {
  setValue(form, 'monthlyLivingExpenses', String(p.monthlyLivingExpenses));
  setValue(form, 'liquidityFloorMonthly', String(p.liquidityFloorMonthly));
  setValue(form, 'kidsCount', String(p.kidsCount));
  setValue(form, 'augustaDays', String(p.augustaDays));
  setValue(form, 'augustaDailyRate', String(p.augustaDailyRate));
  setValue(form, 'scorpSalarySplitPercent', String(fractionToPercent(p.scorpSalarySplit)));
}

export function readHouseholdForm(form: HTMLFormElement): FormRead<HouseholdProfile> {
  const reads = {
    monthlyLivingExpenses: readRequiredNumber(form, 'monthlyLivingExpenses'),
    liquidityFloorMonthly: readRequiredNumber(form, 'liquidityFloorMonthly'),
    kidsCount: readRequiredNumber(form, 'kidsCount'),
    augustaDays: readRequiredNumber(form, 'augustaDays'),
    augustaDailyRate: readRequiredNumber(form, 'augustaDailyRate'),
    scorpSalarySplitPercent: readRequiredNumber(form, 'scorpSalarySplitPercent'),
  };
  for (const r of Object.values(reads)) if (!r.ok) return r;
  const v = (k: keyof typeof reads): number => (reads[k] as { body: number }).body;
  return {
    ok: true,
    body: {
      monthlyLivingExpenses: v('monthlyLivingExpenses'),
      liquidityFloorMonthly: v('liquidityFloorMonthly'),
      kidsCount: v('kidsCount'),
      augustaDays: v('augustaDays'),
      augustaDailyRate: v('augustaDailyRate'),
      scorpSalarySplit: percentToFraction(v('scorpSalarySplitPercent')),
    },
  };
}

// ── income sources ──────────────────────────────────────────

export type IncomeBody = Omit<IncomeSource, 'id' | 'userId'>;

/** The row being edited, or null when the form is adding a new one. */
export function editingId(form: HTMLFormElement): number | null {
  const id = Number(control(form, 'id')?.value ?? '');
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** `null` resets the form to "add a row"; a row puts the form into edit mode. */
export function fillIncomeForm(form: HTMLFormElement, s: IncomeSource | null): void {
  form.reset();
  setValue(form, 'id', s ? String(s.id) : '');
  if (!s) return;
  setValue(form, 'label', s.label);
  setValue(form, 'type', s.type);
  setValue(form, 'grossAnnual', String(s.grossAnnual));
  setValue(form, 'employer', s.employer ?? '');
  setValue(form, 'has401kMatch', s.has401kMatch ? '1' : '0');
}

export function readIncomeForm(form: HTMLFormElement): FormRead<IncomeBody> {
  const label = readText(form, 'label', { required: true });
  if (!label.ok) return label;
  const type = readChoice<IncomeType>(form, 'type', INCOME_TYPES);
  if (!type.ok) return type;
  const gross = readRequiredNumber(form, 'grossAnnual');
  if (!gross.ok) return gross;
  const employer = readText(form, 'employer', { required: false });
  if (!employer.ok) return employer;
  const match = readChoice(form, 'has401kMatch', ['0', '1'] as const);
  if (!match.ok) return match;
  return {
    ok: true,
    body: {
      label: label.body as string,
      type: type.body,
      grossAnnual: gross.body,
      employer: employer.body,
      has401kMatch: match.body === '1',
    },
  };
}

// ── liabilities ─────────────────────────────────────────────

export type LiabilityBody = Omit<Liability, 'id' | 'userId'>;

export function fillLiabilityForm(form: HTMLFormElement, l: Liability | null): void {
  form.reset();
  setValue(form, 'id', l ? String(l.id) : '');
  if (!l) return;
  setValue(form, 'label', l.label);
  setValue(form, 'type', l.type);
  setValue(form, 'principal', String(l.principal));
  setValue(form, 'rateAprPercent', String(fractionToPercent(l.rateApr)));
  setValue(form, 'minPaymentMonthly', String(l.minPaymentMonthly));
  setValue(form, 'priority', String(l.priority));
}

export function readLiabilityForm(form: HTMLFormElement): FormRead<LiabilityBody> {
  const label = readText(form, 'label', { required: true });
  if (!label.ok) return label;
  const type = readChoice<LiabilityType>(form, 'type', LIABILITY_TYPES);
  if (!type.ok) return type;
  const principal = readRequiredNumber(form, 'principal');
  if (!principal.ok) return principal;
  const apr = readRequiredNumber(form, 'rateAprPercent');
  if (!apr.ok) return apr;
  const minPayment = readRequiredNumber(form, 'minPaymentMonthly');
  if (!minPayment.ok) return minPayment;
  const priority = readRequiredNumber(form, 'priority');
  if (!priority.ok) return priority;
  return {
    ok: true,
    body: {
      label: label.body as string,
      type: type.body,
      principal: principal.body,
      rateApr: percentToFraction(apr.body),
      minPaymentMonthly: minPayment.body,
      priority: priority.body,
    },
  };
}
