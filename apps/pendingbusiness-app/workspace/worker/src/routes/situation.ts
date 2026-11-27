import type { Env } from '../env.js';
import { sessionUserId, authRequired } from '../auth/session.js';
import type { IncomeSource, Liability, Situation } from '@pendingbusiness/core';
import {
  nextTaxThreshold,
  stackedMarginal,
  bracketsFor,
  FILING_LABELS,
  MODELLED_FILING_STATUSES,
  compareSoleVsScorp,
  augustaBenefit,
  ctcAfterPhaseout,
  saltAfterPhaseout,
} from '@pendingbusiness/core';
import { HOUSEHOLD_SELECT, householdFromRow, type HouseholdRow } from './household.js';

export async function getSituation(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const situation = await loadSituation(env, userId);
  if (!situation)
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'No profile exists for this user yet.' } },
      { status: 404 },
    );

  /*
   * Brackets come from the user's own filing status, never a default. This
   * used to read `stackedMarginal(w2Annual, FEDERAL_MFJ_2026, CA_MFJ_2026)`
   * with the MFJ tables hardcoded and `userRow.filing_status` never consulted
   * by the math at all — so a single filer was handed married-filing-jointly
   * brackets, an MFJ SALT cap and MFJ NIIT/CTC thresholds, under a heading
   * that said MFJ. Refusing is the only correct answer while those tables
   * don't exist: wrong tax numbers are worse than no tax numbers
   * (constitution item 4).
   */
  const brackets = bracketsFor(situation.filingStatus);
  if (!brackets) {
    const supported = MODELLED_FILING_STATUSES.map(s => FILING_LABELS[s]).join(', ');
    return Response.json(
      {
        error: {
          code: 'FILING_STATUS_NOT_MODELLED',
          message: `2026 brackets for ${FILING_LABELS[situation.filingStatus] ?? situation.filingStatus} haven't been published into PendingBusiness yet. Supported today: ${supported}.`,
          field: 'filingStatus',
        },
      },
      { status: 409 },
    );
  }

  const w2Annual = situation.incomeSources
    .filter(s => s.type === 'w2')
    .reduce((sum, s) => sum + s.grossAnnual, 0);

  const marginal = stackedMarginal(w2Annual, brackets.federal, brackets.state);

  // SE-income ladder for S-Corp comparison. The rungs are a presentation
  // choice (comparison points); the salary split is the user's own tax
  // position, from the household profile.
  const scorpLadder = [80_000, 100_000, 145_000, 200_000].map(net => ({
    netProfit: net,
    ...compareSoleVsScorp(net, situation.scorpSalarySplit),
  }));

  // Augusta rule at the user's own days and market rate (household profile).
  const augusta = augustaBenefit(situation.augustaDays, situation.augustaDailyRate, marginal);

  // $2,200 CTC per qualifying child (2026), applied against current MAGI
  const ctcBase = 2_200;
  const ctcAtCurrent = ctcAfterPhaseout(ctcBase, w2Annual, situation.kidsCount);
  // SALT cap 2026 MFJ = $40,400. Safe as a literal only because the guard
  // above has already rejected every status but MFJ; publish another status's
  // brackets and this needs a per-status cap alongside them.
  const saltAtCurrent = saltAfterPhaseout(40_400, w2Annual);

  return Response.json({
    situation,
    projectedMagi: w2Annual,
    stackedMarginal: marginal,
    nextThreshold: nextTaxThreshold(w2Annual),
    scorpLadder,
    augusta,
    ctc: { baseCredit: ctcBase, kids: situation.kidsCount, currentAnnual: ctcAtCurrent },
    salt: { cap2026Base: 40_400, currentAnnual: saltAtCurrent },
  });
}

/**
 * Load one user's situation. `userId` must come from the session
 * (see auth/session.ts) — callers never pass a constant here.
 */
export async function loadSituation(env: Env, userId: number): Promise<Situation | null> {
  const userRow = await env.DB.prepare(
    `SELECT id, email, display_name, filing_status, state, ${HOUSEHOLD_SELECT} FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<
      {
        id: number;
        email: string;
        display_name: string;
        filing_status: string;
        state: string;
      } & HouseholdRow
    >();
  if (!userRow) return null;
  const household = householdFromRow(userRow);

  const incomeRows = await env.DB.prepare(
    'SELECT id, user_id, label, type, gross_annual, employer, has_401k_match FROM income_sources WHERE user_id = ? ORDER BY id',
  )
    .bind(userId)
    .all<{
      id: number;
      user_id: number;
      label: string;
      type: string;
      gross_annual: number;
      employer: string | null;
      has_401k_match: number;
    }>();

  const liabilityRows = await env.DB.prepare(
    'SELECT id, user_id, label, principal, rate_apr, min_payment_monthly, type, priority FROM liabilities WHERE user_id = ? ORDER BY priority, rate_apr DESC',
  )
    .bind(userId)
    .all<{
      id: number;
      user_id: number;
      label: string;
      principal: number;
      rate_apr: number;
      min_payment_monthly: number;
      type: string;
      priority: number;
    }>();

  const incomeSources: IncomeSource[] = incomeRows.results.map(r => ({
    id: r.id,
    userId: r.user_id,
    label: r.label,
    type: r.type as IncomeSource['type'],
    grossAnnual: r.gross_annual,
    employer: r.employer,
    has401kMatch: r.has_401k_match === 1,
  }));

  const liabilities: Liability[] = liabilityRows.results.map(r => ({
    id: r.id,
    userId: r.user_id,
    label: r.label,
    principal: r.principal,
    rateApr: r.rate_apr,
    minPaymentMonthly: r.min_payment_monthly,
    type: r.type as Liability['type'],
    priority: r.priority,
  }));

  // Minimum debt payments plus the household's living expenses. Every figure
  // below comes from the user's own row — nothing in this function is a
  // literal (situation.test.ts reads this file and checks).
  const fixedObligationsMonthly =
    liabilities.reduce((s, l) => s + l.minPaymentMonthly, 0) + household.monthlyLivingExpenses;

  return {
    userId: userRow.id,
    filingStatus: userRow.filing_status as Situation['filingStatus'],
    state: userRow.state,
    incomeSources,
    liabilities,
    fixedObligationsMonthly,
    liquidityFloorMonthly: household.liquidityFloorMonthly,
    kidsCount: household.kidsCount,
    augustaDays: household.augustaDays,
    augustaDailyRate: household.augustaDailyRate,
    scorpSalarySplit: household.scorpSalarySplit,
  };
}
