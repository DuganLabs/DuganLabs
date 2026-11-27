import type { Liability } from '../types.js';

export interface AvalancheAllocation {
  liabilityId: number | null;
  amount: number;
}

export function avalancheTarget(
  liabilities: readonly Liability[],
  surplus: number,
): AvalancheAllocation {
  if (surplus <= 0 || liabilities.length === 0) return { liabilityId: null, amount: 0 };
  const sorted = [...liabilities].sort((a, b) => b.rateApr - a.rateApr);
  const target = sorted[0];
  if (!target) return { liabilityId: null, amount: 0 };
  return { liabilityId: target.id, amount: surplus };
}
