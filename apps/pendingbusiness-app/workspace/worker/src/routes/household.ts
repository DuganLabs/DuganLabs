/**
 * GET / PATCH /api/household — the household profile: the six `users.*`
 * columns added in migrations/0006_household_profile.sql, which every
 * projection on the dashboard is computed from. They used to be literals in
 * routes/situation.ts that every user got identically; now `loadSituation`
 * reads them from the row and this route is the only thing that writes them.
 */
import type { Env } from '../env.js';
import { sessionUserId, authRequired } from '../auth/session.js';
import type { HouseholdProfile } from '@pendingbusiness/core';
import { jsonError } from './onboarding.js';
import { numberField, type NumberBounds } from './fields.js';

/** Mirrored in apps/site/src/lib/settings-forms.ts for the form's `max`. */
export const MAX_HOUSEHOLD_AMOUNT = 1_000_000;
export const MAX_KIDS = 20;
/** IRC §280A(g): the exclusion stops at 14 rental days. */
export const MAX_AUGUSTA_DAYS = 14;

/**
 * Field → column. The only column names that ever reach SQL — the UPDATE
 * below is assembled from these values, never from request keys.
 * schema-drift.test.ts asserts every column here exists in the migrations.
 */
export const HOUSEHOLD_COLUMNS: Readonly<Record<keyof HouseholdProfile, string>> = {
  monthlyLivingExpenses: 'monthly_living_expenses',
  liquidityFloorMonthly: 'liquidity_floor_monthly',
  kidsCount: 'kids_count',
  augustaDays: 'augusta_days',
  augustaDailyRate: 'augusta_daily_rate',
  scorpSalarySplit: 'scorp_salary_split',
};

/** Bounds per field. Each is at least as tight as the column's CHECK. */
export const HOUSEHOLD_BOUNDS: Readonly<Record<keyof HouseholdProfile, NumberBounds>> = {
  monthlyLivingExpenses: { min: 0, max: MAX_HOUSEHOLD_AMOUNT },
  liquidityFloorMonthly: { min: 0, max: MAX_HOUSEHOLD_AMOUNT },
  kidsCount: { min: 0, max: MAX_KIDS, integer: true },
  augustaDays: { min: 0, max: MAX_AUGUSTA_DAYS, integer: true },
  augustaDailyRate: { min: 0, max: MAX_HOUSEHOLD_AMOUNT },
  scorpSalarySplit: { min: 0, max: 1 },
};

export const HOUSEHOLD_FIELDS = Object.keys(HOUSEHOLD_COLUMNS) as (keyof HouseholdProfile)[];

/** Column list for a SELECT that wants the profile alongside other user columns. */
export const HOUSEHOLD_SELECT = HOUSEHOLD_FIELDS.map(f => HOUSEHOLD_COLUMNS[f]).join(', ');

export interface HouseholdRow {
  monthly_living_expenses: number;
  liquidity_floor_monthly: number;
  kids_count: number;
  augusta_days: number;
  augusta_daily_rate: number;
  scorp_salary_split: number;
}

export function householdFromRow(row: HouseholdRow): HouseholdProfile {
  return {
    monthlyLivingExpenses: row.monthly_living_expenses,
    liquidityFloorMonthly: row.liquidity_floor_monthly,
    kidsCount: row.kids_count,
    augustaDays: row.augusta_days,
    augustaDailyRate: row.augusta_daily_rate,
    scorpSalarySplit: row.scorp_salary_split,
  };
}

async function loadHousehold(env: Env, userId: number): Promise<HouseholdProfile | null> {
  const row = await env.DB.prepare(`SELECT ${HOUSEHOLD_SELECT} FROM users WHERE id = ?`)
    .bind(userId)
    .first<HouseholdRow>();
  return row ? householdFromRow(row) : null;
}

function notFound(): Response {
  return jsonError(404, 'NOT_FOUND', 'No profile exists for this user yet.');
}

export async function getHousehold(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const household = await loadHousehold(env, userId);
  if (!household) return notFound();
  return Response.json({ household });
}

/**
 * PATCH /api/household
 * Body: any subset of HouseholdProfile. Unknown keys are refused rather than
 * ignored, so a misspelt field cannot look like a successful save.
 */
export async function patchHousehold(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Body must be JSON.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError(
      400,
      'INVALID_BODY',
      `Expected an object with any of: ${HOUSEHOLD_FIELDS.join(', ')}.`,
    );
  }

  const updates: Array<{ column: string; value: number }> = [];
  for (const key of Object.keys(body)) {
    if (!HOUSEHOLD_FIELDS.includes(key as keyof HouseholdProfile)) {
      return jsonError(
        400,
        'UNKNOWN_FIELD',
        `"${key}" is not a household field. Expected any of: ${HOUSEHOLD_FIELDS.join(', ')}.`,
        key,
      );
    }
    const field = key as keyof HouseholdProfile;
    const checked = numberField(
      (body as Record<string, unknown>)[field],
      field,
      HOUSEHOLD_BOUNDS[field],
    );
    if (checked.message !== undefined)
      return jsonError(400, 'INVALID_INPUT', checked.message, field);
    updates.push({ column: HOUSEHOLD_COLUMNS[field], value: checked.value });
  }
  if (updates.length === 0) {
    return jsonError(
      400,
      'EMPTY_BODY',
      `Nothing to update. Send at least one of: ${HOUSEHOLD_FIELDS.join(', ')}.`,
    );
  }

  // Column names come from HOUSEHOLD_COLUMNS above, never from the request;
  // every value is bound (constitution #8).
  const setClause = updates.map(u => `${u.column} = ?`).join(', ');
  try {
    const result = await env.DB.prepare(`UPDATE users SET ${setClause} WHERE id = ?`)
      .bind(...updates.map(u => u.value), userId)
      .run();
    const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
    if (changes === 0) return notFound();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`patchHousehold: UPDATE users failed for user ${userId}: ${msg}`);
    const checkedColumn = /CHECK constraint failed:\s*([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(msg)?.[1];
    if (checkedColumn) {
      const field =
        HOUSEHOLD_FIELDS.find(f => HOUSEHOLD_COLUMNS[f] === checkedColumn) ?? checkedColumn;
      return jsonError(
        400,
        'CONSTRAINT_VIOLATION',
        `The value provided for "${field}" is not permitted.`,
        field,
      );
    }
    return jsonError(500, 'DB_ERROR', 'Failed to save the household profile.');
  }

  const household = await loadHousehold(env, userId);
  if (!household) return notFound();
  return Response.json({ household });
}
