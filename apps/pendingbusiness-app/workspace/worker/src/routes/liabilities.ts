/**
 * /api/liabilities — CRUD over the `liabilities` table (0001_init.sql), which
 * had no write path: the avalanche and the fixed-obligations row could only
 * ever run on the seed loan. Every statement is scoped by `user_id` from the
 * session, so a wrong id and another user's id are the same 404.
 */
import type { Env } from '../env.js';
import { sessionUserId, authRequired } from '../auth/session.js';
import { LIABILITY_TYPES, type Liability } from '@pendingbusiness/core';
import { jsonError } from './onboarding.js';
import { idParam, numberField, oneOfField, stringField } from './fields.js';

/** Mirrored in apps/site/src/lib/settings-forms.ts for the forms' `max`. */
export const MAX_PRINCIPAL = 10_000_000;
export const MAX_MIN_PAYMENT = 1_000_000;
export const MAX_PRIORITY = 1_000;
export const MAX_LABEL_LENGTH = 120;
/** The default `liabilities.priority` (0001_init.sql). */
export const DEFAULT_PRIORITY = 100;

const COLUMNS = 'id, user_id, label, principal, rate_apr, min_payment_monthly, type, priority';

interface Row {
  id: number;
  user_id: number;
  label: string;
  principal: number;
  rate_apr: number;
  min_payment_monthly: number;
  type: string;
  priority: number;
}

export function liabilityFromRow(r: Row): Liability {
  return {
    id: r.id,
    userId: r.user_id,
    label: r.label,
    principal: r.principal,
    rateApr: r.rate_apr,
    minPaymentMonthly: r.min_payment_monthly,
    type: r.type as Liability['type'],
    priority: r.priority,
  };
}

type Fields = Omit<Liability, 'id' | 'userId'>;

function readFields(body: unknown, partial: boolean): { fields: Partial<Fields> } | Response {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError(
      400,
      'INVALID_BODY',
      'Expected { label, type, principal, rateApr, minPaymentMonthly, priority? }.',
    );
  }
  const b = body as Record<string, unknown>;
  const known = ['label', 'type', 'principal', 'rateApr', 'minPaymentMonthly', 'priority'];
  for (const key of Object.keys(b)) {
    if (!known.includes(key)) {
      return jsonError(
        400,
        'UNKNOWN_FIELD',
        `"${key}" is not a liability field. Expected any of: ${known.join(', ')}.`,
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
    const c = oneOfField(b.type, 'type', LIABILITY_TYPES);
    if (c.message !== undefined) return jsonError(400, 'INVALID_INPUT', c.message, 'type');
    fields.type = c.value;
  }
  if (has('principal') || !partial) {
    const c = numberField(b.principal, 'principal', { min: 0, max: MAX_PRINCIPAL });
    if (c.message !== undefined) return jsonError(400, 'INVALID_INPUT', c.message, 'principal');
    fields.principal = c.value;
  }
  if (has('rateApr') || !partial) {
    // A fraction: 0.09 is 9% APR. The settings form converts from percent.
    const c = numberField(b.rateApr, 'rateApr', { min: 0, max: 1 });
    if (c.message !== undefined) {
      return jsonError(400, 'INVALID_INPUT', `${c.message} 0.09 means 9% APR.`, 'rateApr');
    }
    fields.rateApr = c.value;
  }
  if (has('minPaymentMonthly') || !partial) {
    const c = numberField(b.minPaymentMonthly, 'minPaymentMonthly', {
      min: 0,
      max: MAX_MIN_PAYMENT,
    });
    if (c.message !== undefined)
      return jsonError(400, 'INVALID_INPUT', c.message, 'minPaymentMonthly');
    fields.minPaymentMonthly = c.value;
  }
  if (has('priority')) {
    const c = numberField(b.priority, 'priority', { min: 1, max: MAX_PRIORITY, integer: true });
    if (c.message !== undefined) return jsonError(400, 'INVALID_INPUT', c.message, 'priority');
    fields.priority = c.value;
  } else if (!partial) {
    fields.priority = DEFAULT_PRIORITY;
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
  return jsonError(404, 'NOT_FOUND', 'Liability not found.');
}

export async function listLiabilities(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const rows = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM liabilities WHERE user_id = ? ORDER BY priority, rate_apr DESC`,
  )
    .bind(userId)
    .all<Row>();
  return Response.json({ liabilities: rows.results.map(liabilityFromRow) });
}

export async function postLiability(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const read = readFields(body, false);
  if (read instanceof Response) return read;
  const f = read.fields as Fields;

  const row = await env.DB.prepare(
    `INSERT INTO liabilities (user_id, label, principal, rate_apr, min_payment_monthly, type, priority) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  )
    .bind(userId, f.label, f.principal, f.rateApr, f.minPaymentMonthly, f.type, f.priority)
    .first<Row>();
  if (!row) return jsonError(500, 'DB_ERROR', 'Failed to save the liability.');
  return Response.json({ liability: liabilityFromRow(row) }, { status: 201 });
}

export async function patchLiability(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const id = idParam(params.id);
  if (id == null) return jsonError(400, 'BAD_PARAM', 'Liability id required.');
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
  if (f.principal !== undefined) set('principal', f.principal);
  if (f.rateApr !== undefined) set('rate_apr', f.rateApr);
  if (f.minPaymentMonthly !== undefined) set('min_payment_monthly', f.minPaymentMonthly);
  if (f.priority !== undefined) set('priority', f.priority);

  const row = await env.DB.prepare(
    `UPDATE liabilities SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING ${COLUMNS}`,
  )
    .bind(...values, id, userId)
    .first<Row>();
  if (!row) return notFound();
  return Response.json({ liability: liabilityFromRow(row) });
}

export async function deleteLiability(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const id = idParam(params.id);
  if (id == null) return jsonError(400, 'BAD_PARAM', 'Liability id required.');
  const result = await env.DB.prepare('DELETE FROM liabilities WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes === 0) return notFound();
  return Response.json({ ok: true, id });
}
