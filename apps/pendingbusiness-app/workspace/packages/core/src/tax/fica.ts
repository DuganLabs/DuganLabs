import { SS_WAGE_BASE_2026, MEDICARE_ADDITIONAL_THRESHOLD_MFJ } from './brackets-2026.js';

const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const MEDICARE_ADDITIONAL = 0.009;
const SE_DOUBLE = 2;

export interface FicaBreakdown {
  socialSecurity: number;
  medicare: number;
  medicareAdditional: number;
  total: number;
}

export function ficaW2(wages: number, filingStatusMfjMagi?: number): FicaBreakdown {
  const socialSecurity = Math.min(wages, SS_WAGE_BASE_2026) * SS_RATE;
  const medicare = wages * MEDICARE_RATE;
  const magi = filingStatusMfjMagi ?? wages;
  const over = Math.max(0, magi - MEDICARE_ADDITIONAL_THRESHOLD_MFJ);
  const medicareAdditional = over * MEDICARE_ADDITIONAL;
  return {
    socialSecurity,
    medicare,
    medicareAdditional,
    total: socialSecurity + medicare + medicareAdditional,
  };
}

export function ficaSE(seNet: number, filingStatusMfjMagi?: number): FicaBreakdown {
  const seEarningsBase = seNet * 0.9235;
  const socialSecurity = Math.min(seEarningsBase, SS_WAGE_BASE_2026) * SS_RATE * SE_DOUBLE;
  const medicare = seEarningsBase * MEDICARE_RATE * SE_DOUBLE;
  const magi = filingStatusMfjMagi ?? seNet;
  const over = Math.max(0, magi - MEDICARE_ADDITIONAL_THRESHOLD_MFJ);
  const medicareAdditional = over * MEDICARE_ADDITIONAL;
  return {
    socialSecurity,
    medicare,
    medicareAdditional,
    total: socialSecurity + medicare + medicareAdditional,
  };
}
