import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound } from '../lib/response';
import { newId } from '../lib/response';

export const scheduleRouter = Router({ base: '/api/schedule' });

/**
 * Schedule-management enrollment (migration 038). Configuration, not a
 * paid tier: an enrollment row opts one team member in for auto-booking
 * within the scope the row names — TIME (which of their availability
 * windows are exposed; empty list = all), SERVICE ('' = every service),
 * TEAM (the member named). Delivery itself lives on the lead:
 * POST /api/leads/:id/deliver consults these rows.
 */

async function readJson(req: IRequest): Promise<unknown> {
  try {
    return await (req as unknown as Request).json();
  } catch {
    return null;
  }
}

// GET /api/schedule/enrollments
scheduleRouter.get('/enrollments', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  const rows = await env.DB.prepare(
    `SELECT id, user_id, service_type, window_ids_json, enabled, created_at
       FROM schedule_delivery_enrollments
      WHERE workspace_id = ? ORDER BY created_at ASC`,
  )
    .bind(workspaceId)
    .all<{
      id: string;
      user_id: string;
      service_type: string;
      window_ids_json: string;
      enabled: number;
      created_at: string;
    }>();
  return json(
    rows.results.map((r) => ({
      id: r.id,
      userId: r.user_id,
      serviceType: r.service_type,
      windowIds: JSON.parse(r.window_ids_json) as string[],
      enabled: r.enabled === 1,
      createdAt: r.created_at,
    })),
  );
});

// POST /api/schedule/enrollments { userId, serviceType?, windowIds? }
scheduleRouter.post('/enrollments', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  const body = (await readJson(req)) as {
    userId?: unknown;
    serviceType?: unknown;
    windowIds?: unknown;
  } | null;
  if (!body || typeof body.userId !== 'string' || body.userId.length === 0) {
    return error('userId is required', 400);
  }
  const serviceType =
    typeof body.serviceType === 'string' ? body.serviceType : '';
  const windowIds = Array.isArray(body.windowIds)
    ? body.windowIds.filter((w): w is string => typeof w === 'string')
    : [];
  // The enrolled member must belong to this workspace (TEAM axis).
  const member = await env.DB.prepare(
    `SELECT user_id FROM user_workspaces WHERE workspace_id = ? AND user_id = ?`,
  )
    .bind(workspaceId, body.userId)
    .first();
  if (!member) return error('That user is not a member of this workspace', 404);
  const id = newId();
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO schedule_delivery_enrollments
       (id, workspace_id, user_id, service_type, window_ids_json, enabled, created_at, updated_at)
     VALUES (?,?,?,?,?,1,?,?)`,
  )
    .bind(
      id,
      workspaceId,
      body.userId,
      serviceType,
      JSON.stringify(windowIds),
      nowIso,
      nowIso,
    )
    .run();
  return json(
    { id, userId: body.userId, serviceType, windowIds, enabled: true },
    201,
  );
});

// DELETE /api/schedule/enrollments/:id
scheduleRouter.delete('/enrollments/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  const res = await env.DB.prepare(
    `DELETE FROM schedule_delivery_enrollments WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .run();
  if (!res.meta.changes) return notFound('Enrollment');
  return json({ deleted: true });
});
