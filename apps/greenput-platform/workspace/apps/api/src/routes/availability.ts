// /api/availability — when a contractor works (GP-101).
//
// The recurring week (`workspace_availability`), the dated exceptions
// (`workspace_availability_exceptions`) and the booking policy columns on
// `workspaces`, read and replaced as ONE thing. A partial week is not a
// meaningful state, so PUT is a full replacement applied in a single
// `db.batch()` — D1 runs a batch as one transaction, so a rejected statement
// leaves the previous week intact rather than half of each.
//
// This is the only screen in the product that can make a contractor bookable,
// and `bookable` is computed here from the rows, never stored: a timezone AND
// at least one open weekday. A workspace with no rows is NOT bookable, never
// "always open". Slot generation is GP-102 and reads this; it must refuse to
// run without a timezone rather than guess UTC.

import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { newId, notFound } from '../lib/response';
import { entity, toWireList } from '../lib/serialize';
import {
  WIRE_AVAILABILITY_DAY,
  WIRE_AVAILABILITY_EXCEPTION,
  WIRE_WORKSPACE_AVAILABILITY,
  type AvailabilityDay,
  type AvailabilityException,
} from '@greenput/shared/models';
import { isBookable } from '@greenput/shared/utils';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';
import {
  UpdateAvailabilitySchema,
  type UpdateAvailabilityInput,
} from '@greenput/shared/validators';

export const availabilityRouter = Router({ base: '/api/availability' });

const SELECT_POLICY =
  'SELECT timezone, booking_lead_hours, booking_horizon_days, travel_buffer_minutes, concurrent_jobs FROM workspaces WHERE id = ?';
const SELECT_WEEK =
  'SELECT id, weekday, opens_at, closes_at, is_open FROM workspace_availability WHERE workspace_id = ? ORDER BY weekday ASC';
const SELECT_EXCEPTIONS =
  'SELECT id, date, opens_at, closes_at, is_open, reason FROM workspace_availability_exceptions WHERE workspace_id = ? ORDER BY date ASC';

/** The whole GET body, also what PUT answers with after writing. */
async function readAvailability(
  env: Env,
  workspaceId: string,
): Promise<Response> {
  const policy = await env.DB.prepare(SELECT_POLICY)
    .bind(workspaceId)
    .first<Record<string, unknown>>();
  if (!policy) return notFound('Workspace');

  const [weekRows, exceptionRows] = await Promise.all([
    env.DB.prepare(SELECT_WEEK)
      .bind(workspaceId)
      .all<Record<string, unknown>>(),
    env.DB.prepare(SELECT_EXCEPTIONS)
      .bind(workspaceId)
      .all<Record<string, unknown>>(),
  ]);

  const week = toWireList<AvailabilityDay>(
    WIRE_AVAILABILITY_DAY,
    weekRows.results,
  );
  const exceptions = toWireList<AvailabilityException>(
    WIRE_AVAILABILITY_EXCEPTION,
    exceptionRows.results,
  );
  const timezone =
    typeof policy['timezone'] === 'string' ? policy['timezone'] : null;

  return entity(WIRE_WORKSPACE_AVAILABILITY, policy, {
    bookable: isBookable({ timezone, week, exceptions }),
    week,
    exceptions,
  });
}

// GET /api/availability — the week, the exceptions and the booking policy
availabilityRouter.get(
  '/',
  requireRole('admin'),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    return readAvailability(env, workspaceId);
  },
);

// PUT /api/availability — replace all of it, atomically
availabilityRouter.put(
  '/',
  requireRole('admin'),
  validate(UpdateAvailabilitySchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (req as unknown as { validatedBody: UpdateAvailabilityInput })
      .validatedBody;
    const now = new Date().toISOString();

    const exists = await env.DB.prepare(
      'SELECT id FROM workspaces WHERE id = ?',
    )
      .bind(workspaceId)
      .first<{ id: string }>();
    if (!exists) return notFound('Workspace');

    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE workspaces
            SET timezone = ?, booking_lead_hours = ?, booking_horizon_days = ?,
                travel_buffer_minutes = ?, concurrent_jobs = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(
        body.timezone,
        body.bookingLeadHours,
        body.bookingHorizonDays,
        body.travelBufferMinutes,
        body.concurrentJobs,
        now,
        workspaceId,
      ),
      env.DB.prepare(
        'DELETE FROM workspace_availability WHERE workspace_id = ?',
      ).bind(workspaceId),
      env.DB.prepare(
        'DELETE FROM workspace_availability_exceptions WHERE workspace_id = ?',
      ).bind(workspaceId),
    ];

    for (const day of body.week) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO workspace_availability (id, workspace_id, weekday, opens_at, closes_at, is_open) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(
          newId(),
          workspaceId,
          day.weekday,
          day.opensAt ?? null,
          day.closesAt ?? null,
          day.isOpen ? 1 : 0,
        ),
      );
    }

    for (const exception of body.exceptions) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO workspace_availability_exceptions (id, workspace_id, date, opens_at, closes_at, is_open, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          newId(),
          workspaceId,
          exception.date,
          exception.opensAt ?? null,
          exception.closesAt ?? null,
          exception.isOpen ? 1 : 0,
          exception.reason || null,
        ),
      );
    }

    stmts.push(
      env.DB.prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
         VALUES (?, ?, ?, 'workspace', ?, 'availability_updated', ?, ?)`,
      ).bind(
        newId(),
        workspaceId,
        user.id,
        workspaceId,
        JSON.stringify({
          timezone: body.timezone,
          openDays: body.week.filter((d) => d.isOpen).length,
          exceptions: body.exceptions.length,
        }),
        now,
      ),
    );

    await env.DB.batch(stmts);

    return readAvailability(env, workspaceId);
  },
);
