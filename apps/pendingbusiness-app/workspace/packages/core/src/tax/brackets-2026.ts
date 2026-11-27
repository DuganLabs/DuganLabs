import type { TaxBracket } from '../types.js';

// 2026 federal brackets published in IRS Rev. Proc. 2025-32. Values here
// are MFJ-only for Phase 1 — Warren is the canonical seed user.
// Ceiling `null` marks the top bracket (no upper bound).
export const FEDERAL_MFJ_2026: readonly TaxBracket[] = [
  {
    jurisdiction: 'federal',
    filingStatus: 'mfj',
    year: 2026,
    floor: 0,
    ceiling: 23_850,
    rate: 0.1,
  },
  {
    jurisdiction: 'federal',
    filingStatus: 'mfj',
    year: 2026,
    floor: 23_850,
    ceiling: 96_950,
    rate: 0.12,
  },
  {
    jurisdiction: 'federal',
    filingStatus: 'mfj',
    year: 2026,
    floor: 96_950,
    ceiling: 206_700,
    rate: 0.22,
  },
  {
    jurisdiction: 'federal',
    filingStatus: 'mfj',
    year: 2026,
    floor: 206_700,
    ceiling: 394_600,
    rate: 0.24,
  },
  {
    jurisdiction: 'federal',
    filingStatus: 'mfj',
    year: 2026,
    floor: 394_600,
    ceiling: 501_050,
    rate: 0.32,
  },
  {
    jurisdiction: 'federal',
    filingStatus: 'mfj',
    year: 2026,
    floor: 501_050,
    ceiling: 751_600,
    rate: 0.35,
  },
  {
    jurisdiction: 'federal',
    filingStatus: 'mfj',
    year: 2026,
    floor: 751_600,
    ceiling: null,
    rate: 0.37,
  },
];

// 2026 California MFJ brackets (FTB; 2025 values carry forward if FTB
// hasn't published 2026 yet — verify and refresh). Numbers are rounded
// to the nearest dollar.
export const CA_MFJ_2026: readonly TaxBracket[] = [
  { jurisdiction: 'ca', filingStatus: 'mfj', year: 2026, floor: 0, ceiling: 21_512, rate: 0.01 },
  {
    jurisdiction: 'ca',
    filingStatus: 'mfj',
    year: 2026,
    floor: 21_512,
    ceiling: 50_998,
    rate: 0.02,
  },
  {
    jurisdiction: 'ca',
    filingStatus: 'mfj',
    year: 2026,
    floor: 50_998,
    ceiling: 80_490,
    rate: 0.04,
  },
  {
    jurisdiction: 'ca',
    filingStatus: 'mfj',
    year: 2026,
    floor: 80_490,
    ceiling: 111_732,
    rate: 0.06,
  },
  {
    jurisdiction: 'ca',
    filingStatus: 'mfj',
    year: 2026,
    floor: 111_732,
    ceiling: 141_212,
    rate: 0.08,
  },
  {
    jurisdiction: 'ca',
    filingStatus: 'mfj',
    year: 2026,
    floor: 141_212,
    ceiling: 721_318,
    rate: 0.093,
  },
  {
    jurisdiction: 'ca',
    filingStatus: 'mfj',
    year: 2026,
    floor: 721_318,
    ceiling: 865_574,
    rate: 0.103,
  },
  {
    jurisdiction: 'ca',
    filingStatus: 'mfj',
    year: 2026,
    floor: 865_574,
    ceiling: 1_442_628,
    rate: 0.113,
  },
  {
    jurisdiction: 'ca',
    filingStatus: 'mfj',
    year: 2026,
    floor: 1_442_628,
    ceiling: null,
    rate: 0.123,
  },
];

export const STANDARD_DEDUCTION_MFJ_2026 = 32_200;
export const SS_WAGE_BASE_2026 = 176_100;
export const MEDICARE_ADDITIONAL_THRESHOLD_MFJ = 250_000;
