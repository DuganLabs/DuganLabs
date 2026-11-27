import { ficaSE, ficaW2 } from '../tax/fica.js';

export interface ScorpComparison {
  soleProp: { fica: number };
  scorp: { w2Portion: number; distributionPortion: number; fica: number };
  ficaSavings: number;
}

export function compareSoleVsScorp(netProfit: number, w2Ratio = 0.5): ScorpComparison {
  const soleFica = ficaSE(netProfit).total;
  const w2Portion = netProfit * w2Ratio;
  const distributionPortion = netProfit - w2Portion;
  const scorpFica = ficaW2(w2Portion).total;
  return {
    soleProp: { fica: round2(soleFica) },
    scorp: {
      w2Portion: round2(w2Portion),
      distributionPortion: round2(distributionPortion),
      fica: round2(scorpFica),
    },
    ficaSavings: round2(soleFica - scorpFica),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
