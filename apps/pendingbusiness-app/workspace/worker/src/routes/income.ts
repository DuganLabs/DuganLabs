/**
 * /api/income-sources — CRUD over the `income_sources` table, which existed
 * from 0001_init.sql with no write path: the dashboard's income ledger and
 * the projected MAGI could only ever show the seed rows. Every statement is
 * scoped by `user_id` from the session (see auth/session.ts), so a wrong id
 * and another user's id are the same 404.
 */
import type { Env } from '../env.js';
import { sessionUserId, authRequired } from '../auth/session.js';
import { INCOME_TYPES, type IncomeSource } from '@pendingbusiness/core';
import { jsonError } from './onboarding.js';
import { booleanField, idParam, numberField, oneOfField, stringField } from './fields.js';

/** Mirrored in apps/site/src/lib/settings-forms.ts for the form's `max`. */
export const MAX_GROSS_ANNUAL = 10_000_000;
export const MAX_LABEL_LENGTH = 120;

const COLUMNS = 'id, user_id, label, type, gross_annual, employer, has_401k_match';

interface Row {
  id: number;
  user_id: number;
  label: string;
  type: string;
  gross_annual: number;
  employer: string | null;
  has_401k_match: number;
}

export function incomeSourceFromRow(r: Row): IncomeSource {
  return {
    id: r.id,
    userId: r.user_id,
    label: r.label,
    type: r.type as IncomeSource['type'],
    grossAnnual: r.gross_annual,
    employer: r.employer,
    has401kMatch: r.has_401k_match === 1,
  };
}

type Fields = Omit<IncomeSource, 'id' | 'userId'>;

/**
 * Validates `body` field by field. With `partial`, absent keys are skipped
 * (PATCH); without it every required field must be present (POST). Unknown
 * keys are refused so a misspelt field cannot look like a successful save.
 */
function readFields(body: unknown, partial: boolean): { fields: Partial<Fields> } | Response {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError(
      400,
      'INVALID_BODY',
      'Expected { label, type, grossAnnual, employer?, has401kMatch? }.',
    );
  }
  const b = body as Record<string, unknown>;
  const known = ['label', 'type', 'grossAnnual', 'employer', 'has401kMatch'];
  for (const key of Object.keys(b)) {
    if (!known.includes(key)) {
      return jsonError(
        400,
        'UNKNOWN_FIELD',
        `"${key}" is not an income source field. Expected any of: ${known.join(', ')}.`,
        key,
      );
    }
  }
  const fields: Partial<Fields> = {};
  const has = (k: string) => k in b;

  if (has('label') || !partial) {
    const c = stringField(b.label, 'label', { maxLength: MAX_LABEL_LENGTH });
    if (c.message !== undefined) return jsonError(400, 'INVALID_INPUT', c.message, 'label');
    fields.label = c.value as string;
  }
  if (has('type') || !partial) {
    const c = oneOfField(b.type, 'type', INCOME_TYPES);
    if (c.message !== undefined) return jsonError(400, 'INVALID_INPUT', c.message, 'type');
    fields.type = c.value;
  }
  if (has('grossAnnual') || !partial) {
    const c = numberField(b.grossAnnual, 'grossAnnual', { min: 0, max: MAX_GROSS_ANNUAL });
    if (c.message !== undefined) return jsonError(400, 'INVALID_INPUT', c.message, 'grossAnnual');
    fields.grossAnnual = c.value;
  }
  if (has('employer')) {
    const c = stringField(b.employer, 'employer', { maxLength: MAX_LABEL_LENGTH, optional: true });
    if (c.message !== undefined) return jsonError(400, 'INVALID_INPUT', c.message, 'employer');
    fields.employer = c.value;
  } else if (!partial) {
    fields.employer = null;
  }
  if (has('has401kMatch')) {
    const c = booleanField(b.has401kMatch, 'has401kMatch');
    if (c.message !== undefined) return jsonError(400, 'INVALID_INPUT', c.message, 'has401kMatch');
    fields.has401kMatch = c.value;
  } else if (!partial) {
    fields.has401kMatch = false;
  }
  if (partial && Object.keys(fields).length === 0) {
    return jsonError(
      400,
      'EMPTY_BODY',
      `Nothing to update. Send at least one of: ${known.join(', ')}.`,
    );
  }
  return { fields };
}

async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Body must be JSON.');
  }
}

function notFound(): Response {
  return jsonError(404, 'NOT_FOUND', 'Income source not found.');
}

export async function listIncomeSources(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const rows = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM income_sources WHERE user_id = ? ORDER BY id`,
  )
    .bind(userId)
    .all<Row>();
  return Response.json({ incomeSources: rows.results.map(incomeSourceFromRow) });
}

export async function postIncomeSource(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const read = readFields(body, false);
  if (read instanceof Response) return read;
  const f = read.fields as Fields;

  const row = await env.DB.prepare(
    `INSERT INTO income_sources (user_id, label, type, gross_annual, employer, has_401k_match) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  )
    .bind(userId, f.label, f.type, f.grossAnnual, f.employer, f.has401kMatch ? 1 : 0)
    .first<Row>();
  if (!row) return jsonError(500, 'DB_ERROR', 'Failed to save the income source.');
  return Response.json({ incomeSource: incomeSourceFromRow(row) }, { status: 201 });
}

export async function patchIncomeSource(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const id = idParam(params.id);
  if (id == null) return jsonError(400, 'BAD_PARAM', 'Income source id required.');
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const read = readFields(body, true);
  if (read instanceof Response) return read;
  const f = read.fields;

  // Column names are fixed here; only values are bound.
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (f.label !== undefined) set('label', f.label);
  if (f.type !== undefined) set('type', f.type);
  if (f.grossAnnual !== undefined) set('gross_annual', f.grossAnnual);
  if (f.employer !== undefined) set('employer', f.employer);
  if (f.has401kMatch !== undefined) set('has_401k_match', f.has401kMatch ? 1 : 0);

  const row = await env.DB.prepare(
    `UPDATE income_sources SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING ${COLUMNS}`,
  )
    .bind(...values, id, userId)
    .first<Row>();
  if (!row) return notFound();
  return Response.json({ incomeSource: incomeSourceFromRow(row) });
}

export async function deleteIncomeSource(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const id = idParam(params.id);
  if (id == null) return jsonError(400, 'BAD_PARAM', 'Income source id required.');
  const result = await env.DB.prepare('DELETE FROM income_sources WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes === 0) return notFound();
  return Response.json({ ok: true, id });
}
