import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, forbidden, newId } from '../lib/response';

export const complianceRouter = Router({ base: '/api/compliance' });

/** Only workspace owners may access compliance endpoints */
function requireOwner(req: IRequest): Response | undefined {
  const user = (req as unknown as { user: { id: string; role: string } }).user;
  if (user.role !== 'owner') {
    return forbidden();
  }
  return undefined;
}

// GET /api/compliance/export — Export all workspace data as JSON
complianceRouter.get('/export', async (req: IRequest, env: Env) => {
  const blocked = requireOwner(req);
  if (blocked) return blocked;

  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const [workspace, users, customers, leads, opportunities, jobs, payments] =
    await Promise.all([
      env.DB.prepare('SELECT * FROM workspaces WHERE id = ?')
        .bind(workspaceId)
        .first(),
      env.DB.prepare(
        'SELECT id, workspace_id, first_name, last_name, email, role, created_at, updated_at, last_seen_at FROM users WHERE workspace_id = ?',
      )
        .bind(workspaceId)
        .all(),
      env.DB.prepare('SELECT * FROM customers WHERE workspace_id = ?')
        .bind(workspaceId)
        .all(),
      env.DB.prepare('SELECT * FROM leads WHERE workspace_id = ?')
        .bind(workspaceId)
        .all(),
      env.DB.prepare('SELECT * FROM opportunities WHERE workspace_id = ?')
        .bind(workspaceId)
        .all(),
      env.DB.prepare('SELECT * FROM jobs WHERE workspace_id = ?')
        .bind(workspaceId)
        .all(),
      env.DB.prepare('SELECT * FROM payments WHERE workspace_id = ?')
        .bind(workspaceId)
        .all(),
    ]);

  return json({
    data: {
      exportedAt: new Date().toISOString(),
      workspace,
      users: users.results,
      customers: customers.results,
      leads: leads.results,
      opportunities: opportunities.results,
      jobs: jobs.results,
      payments: payments.results,
    },
  });
});

// POST /api/compliance/delete-request — Request workspace data deletion
complianceRouter.post('/delete-request', async (req: IRequest, env: Env) => {
  const blocked = requireOwner(req);
  if (blocked) return blocked;

  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const user = (req as unknown as { user: { id: string; role: string } }).user;

  // Check for existing pending deletion request
  const existing = await env.DB.prepare(
    "SELECT id FROM deletion_requests WHERE workspace_id = ? AND status = 'pending'",
  )
    .bind(workspaceId)
    .first();

  if (existing) {
    return error(
      'A deletion request is already pending for this workspace',
      409,
      'DELETION_ALREADY_PENDING',
    );
  }

  const id = newId();
  const now = new Date().toISOString();
  // 30-day grace period
  const scheduledAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await env.DB.prepare(
    `INSERT INTO deletion_requests (id, workspace_id, requested_by, status, scheduled_deletion_at, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(id, workspaceId, user.id, scheduledAt, now)
    .run();

  // Log to activity log
  await env.DB.prepare(
    `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
     VALUES (?, ?, ?, 'workspace', ?, 'deletion_requested', ?, ?)`,
  )
    .bind(
      newId(),
      workspaceId,
      user.id,
      workspaceId,
      JSON.stringify({ scheduled_deletion_at: scheduledAt }),
      now,
    )
    .run();

  return json(
    {
      data: {
        id,
        workspaceId,
        status: 'pending',
        scheduledDeletionAt: scheduledAt,
        createdAt: now,
      },
    },
    201,
  );
});
