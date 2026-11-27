import type { Env } from '../env.js';
import { sessionUserId, authRequired } from '../auth/session.js';
import { routeCash } from '@pendingbusiness/core';
import { loadSituation } from './situation.js';

/** Mirrored in apps/site/src/main.ts as MAX_SCENARIO_INPUT for the live preview. */
const MAX_SCENARIO_INPUT = 1_000_000;

export async function listScenarios(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const rows = await env.DB.prepare(
    'SELECT id, label, inputs_json, computed_json, created_at FROM scenarios WHERE user_id = ? ORDER BY id DESC LIMIT 20',
  )
    .bind(userId)
    .all<{
      id: number;
      label: string;
      inputs_json: string;
      computed_json: string;
      created_at: string;
    }>();
  const scenarios = rows.results.map(r => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    inputs: JSON.parse(r.inputs_json),
    result: JSON.parse(r.computed_json),
  }));
  return Response.json({ scenarios });
}

export async function postScenario(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_JSON', message: 'Body must be JSON.' } },
      { status: 400 },
    );
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json(
      {
        error: {
          code: 'INVALID_BODY',
          message: 'Expected { greenputMonthlyNet, oneTimeIncome? }.',
        },
      },
      { status: 400 },
    );
  }

  const { greenputMonthlyNet, oneTimeIncome, persist } = body as {
    greenputMonthlyNet?: unknown;
    oneTimeIncome?: unknown;
    persist?: unknown;
  };

  if (
    typeof greenputMonthlyNet !== 'number' ||
    !Number.isFinite(greenputMonthlyNet) ||
    greenputMonthlyNet < 0 ||
    greenputMonthlyNet > MAX_SCENARIO_INPUT
  ) {
    return Response.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: `greenputMonthlyNet must be a number between 0 and ${MAX_SCENARIO_INPUT}.`,
          field: 'greenputMonthlyNet',
        },
      },
      { status: 400 },
    );
  }
  if (
    oneTimeIncome !== undefined &&
    (typeof oneTimeIncome !== 'number' ||
      !Number.isFinite(oneTimeIncome) ||
      oneTimeIncome < 0 ||
      oneTimeIncome > MAX_SCENARIO_INPUT)
  ) {
    return Response.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: `oneTimeIncome must be a number between 0 and ${MAX_SCENARIO_INPUT}.`,
          field: 'oneTimeIncome',
        },
      },
      { status: 400 },
    );
  }

  // Defaults to false: a caller that forgets the flag gets a computation,
  // not a row. The dashboard's live preview used to write a scenario on
  // every debounced keystroke, burying the runs the user chose to keep.
  if (persist !== undefined && typeof persist !== 'boolean') {
    return Response.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'persist must be a boolean.',
          field: 'persist',
        },
      },
      { status: 400 },
    );
  }

  const situation = await loadSituation(env, userId);
  if (!situation) {
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'No profile exists for this user yet.' } },
      { status: 404 },
    );
  }

  const inputs =
    oneTimeIncome === undefined ? { greenputMonthlyNet } : { greenputMonthlyNet, oneTimeIncome };
  const result = routeCash(situation, inputs);

  if (persist === true) {
    await env.DB.prepare(
      'INSERT INTO scenarios (user_id, label, inputs_json, computed_json) VALUES (?, ?, ?, ?)',
    )
      .bind(userId, `scenario-${Date.now()}`, JSON.stringify(inputs), JSON.stringify(result))
      .run();
  }

  return Response.json(result);
}

/**
 * DELETE /api/scenarios/:id
 *
 * Scoped by `user_id` as well as `id`, so a wrong id and another user's id
 * are the same 404 to the caller and no session can touch a row it does
 * not own (tenancy.test.ts holds that line).
 */
export async function deleteScenario(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json(
      { error: { code: 'BAD_PARAM', message: 'Scenario id required.' } },
      { status: 400 },
    );
  }

  const result = await env.DB.prepare('DELETE FROM scenarios WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes === 0) {
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'Scenario not found.' } },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, id });
}
