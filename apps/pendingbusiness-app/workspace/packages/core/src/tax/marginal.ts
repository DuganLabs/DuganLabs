import type { TaxBracket } from '../types.js';

export function marginalRate(income: number, brackets: readonly TaxBracket[]): number {
  for (const b of brackets) {
    if (income >= b.floor && (b.ceiling === null || income < b.ceiling)) return b.rate;
  }
  return brackets[brackets.length - 1]?.rate ?? 0;
}

export function stackedMarginal(
  income: number,
  federal: readonly TaxBracket[],
  state: readonly TaxBracket[],
): number {
  return marginalRate(income, federal) + marginalRate(income, state);
}

export function totalTax(income: number, brackets: readonly TaxBracket[]): number {
  let tax = 0;
  for (const b of brackets) {
    if (income <= b.floor) break;
    const ceiling = b.ceiling ?? income;
    const slice = Math.min(income, ceiling) - b.floor;
    if (slice > 0) tax += slice * b.rate;
  }
  return tax;
}
