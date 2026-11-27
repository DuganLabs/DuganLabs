import type { ScenarioInputs, ScenarioResult, Situation, Waterfall } from '../types.js';
import { avalancheTarget } from '../debt/avalanche.js';
import { nextTaxThreshold } from '../tax/thresholds.js';

const SE_TAX_RESERVE_RATE = 0.33;

export function routeCash(situation: Situation, inputs: ScenarioInputs): ScenarioResult {
  const w2GrossAnnual = situation.incomeSources
    .filter(s => s.type === 'w2')
    .reduce((sum, s) => sum + s.grossAnnual, 0);
  const seAnnualProjection = inputs.greenputMonthlyNet * 12 + (inputs.oneTimeIncome ?? 0);
  const magiProjection = w2GrossAnnual + seAnnualProjection;

  const grossIn = inputs.greenputMonthlyNet + (inputs.oneTimeIncome ?? 0);
  const taxReserve = round2(inputs.greenputMonthlyNet * SE_TAX_RESERVE_RATE);
  const fixedObligations = situation.fixedObligationsMonthly;
  const liquidityReserve = situation.liquidityFloorMonthly;

  // The unclamped residual is the one number a short month needs to show.
  // `remaining` stays clamped for the avalanche: allocating a negative
  // surplus to a debt is meaningless (and avalancheTarget guards it anyway).
  const residual = grossIn - taxReserve - fixedObligations - liquidityReserve;
  const shortfall = residual < 0 ? round2(-residual) : 0;
  const remaining = Math.max(0, residual);

  const avalanche = avalancheTarget(situation.liabilities, remaining);
  const afterAvalanche = Math.max(0, remaining - avalanche.amount);

  const waterfall: Waterfall = {
    grossIn: round2(grossIn),
    taxReserve,
    fixedObligations: round2(fixedObligations),
    liquidityReserve: round2(liquidityReserve),
    debtAvalanche: { liabilityId: avalanche.liabilityId, amount: round2(avalanche.amount) },
    discretionary: round2(afterAvalanche),
    shortfall,
  };

  return {
    inputs,
    waterfall,
    nextThreshold: nextTaxThreshold(magiProjection),
    magiProjection: round2(magiProjection),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
