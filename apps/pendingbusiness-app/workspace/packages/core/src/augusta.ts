export interface AugustaResult {
  rentalDays: number;
  dailyRate: number;
  taxFreeIncome: number;
  businessDeduction: number;
  taxBenefit: number;
}

export function augustaBenefit(
  days: number,
  dailyRate: number,
  marginalRate: number,
): AugustaResult {
  const capped = Math.min(days, 14);
  const taxFreeIncome = capped * dailyRate;
  return {
    rentalDays: capped,
    dailyRate,
    taxFreeIncome,
    businessDeduction: taxFreeIncome,
    taxBenefit: round2(taxFreeIncome * marginalRate),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
