export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh' | 'qw';
export type Jurisdiction = 'federal' | 'ca';

/**
 * Storage vocabularies for `income_sources.type` and `liabilities.type`. Each
 * must stay in step with the CHECK constraint in migrations/0001_init.sql —
 * worker/test/schema-drift.test.ts reads both sides and fails when they
 * diverge, which is the drift that turned onboarding into a 500 once already.
 * The write routes (worker/src/routes/income.ts, liabilities.ts) validate
 * against these arrays, and the settings selects offer exactly these values.
 */
export const INCOME_TYPES = ['w2', 'se', 'k1', 'other'] as const;
export type IncomeType = (typeof INCOME_TYPES)[number];
export const LIABILITY_TYPES = ['personal_loan', 'mortgage', 'student', 'cc', 'other'] as const;
export type LiabilityType = (typeof LIABILITY_TYPES)[number];

export const INCOME_TYPE_LABELS: Readonly<Record<IncomeType, string>> = {
  w2: 'W-2',
  se: 'Self-employed',
  k1: 'K-1',
  other: 'Other',
};
export const LIABILITY_TYPE_LABELS: Readonly<Record<LiabilityType, string>> = {
  personal_loan: 'Personal loan',
  mortgage: 'Mortgage',
  student: 'Student loan',
  cc: 'Credit card',
  other: 'Other',
};

export interface TaxBracket {
  jurisdiction: Jurisdiction;
  filingStatus: FilingStatus;
  year: number;
  floor: number;
  ceiling: number | null;
  rate: number;
}

export interface IncomeSource {
  id: number;
  userId: number;
  label: string;
  type: IncomeType;
  grossAnnual: number;
  employer: string | null;
  has401kMatch: boolean;
}

export interface Liability {
  id: number;
  userId: number;
  label: string;
  principal: number;
  rateApr: number;
  minPaymentMonthly: number;
  type: LiabilityType;
  priority: number;
}

/**
 * The household facts a user enters once and every projection is computed
 * from — the `users.*` columns added in migrations/0006_household_profile.sql,
 * read and written through `/api/household`. These used to be literals in the
 * worker (`+ 5_000`, `200`, `3`, `augustaBenefit(14, 350, …)`, a `0.5` salary
 * split) that were the same for every user; a zero here is visibly wrong,
 * which is better than a plausible number that is silently someone else's.
 */
export interface HouseholdProfile {
  /** Rent, utilities, insurance, groceries — what leaves monthly before debt and spending. */
  monthlyLivingExpenses: number;
  /** Cash set aside every month before anything is routed to debt. */
  liquidityFloorMonthly: number;
  /** Qualifying children for the child tax credit. */
  kidsCount: number;
  /** Days per year the home is rented to the business under the Augusta rule (0–14). */
  augustaDays: number;
  /** Market daily rate for that rental. */
  augustaDailyRate: number;
  /** Fraction of S-Corp net profit paid as W-2 salary in the comparison ladder (0–1). */
  scorpSalarySplit: number;
}

export interface Situation {
  userId: number;
  filingStatus: FilingStatus;
  state: string;
  incomeSources: IncomeSource[];
  liabilities: Liability[];
  /** Sum of liability minimum payments plus `HouseholdProfile.monthlyLivingExpenses`. */
  fixedObligationsMonthly: number;
  liquidityFloorMonthly: number;
  kidsCount: number;
  augustaDays: number;
  augustaDailyRate: number;
  scorpSalarySplit: number;
}

export interface ScenarioInputs {
  greenputMonthlyNet: number;
  oneTimeIncome?: number;
}

export interface Waterfall {
  grossIn: number;
  taxReserve: number;
  fixedObligations: number;
  liquidityReserve: number;
  debtAvalanche: { liabilityId: number | null; amount: number };
  discretionary: number;
  /**
   * The amount by which reserves and obligations exceed gross in, as a
   * positive number; 0 when the month covers itself. Positive-signed to
   * match how outflows render, so the interface carries one sign convention.
   */
  shortfall: number;
}

export interface TaxThreshold {
  name: string;
  amount: number;
  distance: number;
}

export interface ScenarioResult {
  inputs: ScenarioInputs;
  waterfall: Waterfall;
  nextThreshold: TaxThreshold;
  magiProjection: number;
}
