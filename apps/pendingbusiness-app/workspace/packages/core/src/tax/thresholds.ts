import type { TaxThreshold } from '../types.js';

const THRESHOLDS_2026_MFJ: readonly TaxThreshold[] = [
  { name: 'NIIT', amount: 250_000, distance: 0 },
  { name: 'CTC phaseout', amount: 400_000, distance: 0 },
  { name: 'SALT phaseout', amount: 505_000, distance: 0 },
];

export function nextTaxThreshold(magi: number): TaxThreshold {
  for (const t of THRESHOLDS_2026_MFJ) {
    if (magi < t.amount) return { name: t.name, amount: t.amount, distance: t.amount - magi };
  }
  return { name: 'all thresholds crossed', amount: Infinity, distance: 0 };
}

export function ctcAfterPhaseout(baseCredit: number, magi: number, kids: number): number {
  const max = baseCredit * kids;
  const phaseoutStart = 400_000;
  if (magi <= phaseoutStart) return max;
  const over = magi - phaseoutStart;
  const thousandsOver = Math.ceil(over / 1_000);
  const reduction = thousandsOver * 50;
  return Math.max(0, max - reduction);
}

export function saltAfterPhaseout(capBase: number, magi: number): number {
  const phaseoutStart = 505_000;
  const floor = 10_000;
  if (magi <= phaseoutStart) return capBase;
  const reduction = (magi - phaseoutStart) * 0.3;
  return Math.max(floor, capBase - reduction);
}
