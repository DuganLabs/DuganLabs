import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, paginate } from '../lib/response';

export const auditRouter = Router({ base: '/api/audit' });

// GET /api/audit — List audit log entries with filters
auditRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const { limit, offset, page } = paginate(url);

  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');
  const userId = url.searchParams.get('userId');
  const action = url.searchParams.get('action');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let where = 'WHERE a.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (entityType) {
    where += ' AND a.entity_type = ?';
    params.push(entityType);
  }
  if (entityId) {
    where += ' AND a.entity_id = ?';
    params.push(entityId);
  }
  if (userId) {
    where += ' AND a.user_id = ?';
    params.push(userId);
  }
  if (action) {
    where += ' AND a.action = ?';
    params.push(action);
  }
  if (from) {
    where += ' AND a.created_at >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND a.created_at <= ?';
    params.push(to);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT a.*, u.first_name, u.last_name
      FROM activity_log a
      LEFT JOIN users u ON a.user_id = u.id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM activity_log a ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return json({
    data: rows.results,
    meta: { total: countRow?.total ?? 0, page, perPage: limit },
  });
});

// GET /api/audit/:entityType/:entityId — Get all entries for a specific entity
auditRouter.get('/:entityType/:entityId', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const entityType = req.params!['entityType'];
  const entityId = req.params!['entityId'];

  const rows = await env.DB.prepare(
    `
    SELECT a.*, u.first_name, u.last_name
    FROM activity_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.workspace_id = ? AND a.entity_type = ? AND a.entity_id = ?
    ORDER BY a.created_at DESC
  `,
  )
    .bind(workspaceId, entityType, entityId)
    .all();

  return json({ data: rows.results });
});
