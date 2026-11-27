import type { FilingStatus, TaxBracket } from '../types.js';
import { FEDERAL_MFJ_2026, CA_MFJ_2026 } from './brackets-2026.js';

/**
 * Filing status: the storage vocabulary, the display vocabulary, and — the
 * point of this file — which of those statuses the tax engine can actually
 * compute.
 *
 * These were three different lists before. `users.filing_status` accepts five
 * codes (migrations/0001_init.sql), onboarding offered all five, and the
 * bracket tables carried exactly one: every entry in brackets-2026.ts and
 * every seeded row in 0002_seed_warren.sql is `mfj`. Picking "Single" wrote a
 * valid row and then got MFJ brackets, an MFJ standard deduction and a heading
 * that read "Tax thresholds (2026, MFJ)" — silently wrong numbers, which
 * constitution item 4 ("tax math must be correct") does not allow.
 *
 * `MODELLED_FILING_STATUSES` is derived from the bracket tables rather than
 * typed out, so it cannot drift from them: seed 2026 brackets for another
 * status and it appears here, in the onboarding select, and in the dashboard
 * heading without another edit.
 */

/**
 * Every code `users.filing_status` accepts. This is the storage vocabulary —
 * it must stay in step with the CHECK constraint in migrations/0001_init.sql
 * (worker/test/schema-drift.test.ts enforces that), and it is deliberately
 * wider than the set the engine models: existing rows have to keep loading.
 */
export const FILING_STATUSES: readonly FilingStatus[] = ['single', 'mfj', 'mfs', 'hoh', 'qw'];

/** Long form, for a form control the user reads before choosing. */
export const FILING_LABELS: Readonly<Record<FilingStatus, string>> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  mfs: 'Married filing separately',
  hoh: 'Head of household',
  qw: 'Qualifying surviving spouse',
};

/** Short form, for chrome where the code appears beside other facts. */
export const FILING_SHORT_LABELS: Readonly<Record<FilingStatus, string>> = {
  single: 'Single',
  mfj: 'MFJ',
  mfs: 'MFS',
  hoh: 'HoH',
  qw: 'QSS',
};

/**
 * 2026 bracket tables by filing status. Only the pairs present here can be
 * computed; a status missing from either map is not modelled.
 */
const FEDERAL_2026: Partial<Record<FilingStatus, readonly TaxBracket[]>> = {
  mfj: FEDERAL_MFJ_2026,
};
const CA_2026: Partial<Record<FilingStatus, readonly TaxBracket[]>> = {
  mfj: CA_MFJ_2026,
};

export interface BracketSet {
  federal: readonly TaxBracket[];
  state: readonly TaxBracket[];
}

/**
 * The federal + CA bracket pair for a filing status, or `null` when 2026
 * brackets for it have not been published into this repo yet.
 *
 * Callers must branch on `null` rather than fall back to another status's
 * table — substituting MFJ for a single filer is the exact defect this
 * function exists to make impossible.
 */
export function bracketsFor(status: FilingStatus): BracketSet | null {
  const federal = FEDERAL_2026[status];
  const state = CA_2026[status];
  return federal && state ? { federal, state } : null;
}

/** Narrowing guard for a value arriving from the DB or an HTTP body. */
export function isFilingStatus(value: unknown): value is FilingStatus {
  return typeof value === 'string' && (FILING_STATUSES as readonly string[]).includes(value);
}

/**
 * The statuses the tax engine can compute today — derived, never typed out.
 * Currently `['mfj']`.
 */
export const MODELLED_FILING_STATUSES: readonly FilingStatus[] = FILING_STATUSES.filter(
  s => bracketsFor(s) !== null,
);

/** Is this status one the engine has brackets for? */
export function isModelled(status: FilingStatus): boolean {
  return bracketsFor(status) !== null;
}
