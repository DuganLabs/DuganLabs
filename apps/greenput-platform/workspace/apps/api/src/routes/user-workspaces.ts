import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, newId } from '../lib/response';
import { validate } from '../middleware/validate';
import {
  CreateUserWorkspaceSchema,
  SwitchWorkspaceSchema,
} from '@greenput/shared/validators';

export const userWorkspacesRouter = Router({ base: '/api/user/workspaces' });

// GET /api/user/workspaces — list workspaces the current user belongs to
userWorkspacesRouter.get('/', async (req: IRequest, env: Env) => {
  const user = (req as unknown as { user: { id: string } }).user;

  const results = await env.DB.prepare(
    `SELECT w.id, w.name, w.slug, w.trade, w.logo_url, uw.role, uw.joined_at
     FROM user_workspaces uw
     JOIN workspaces w ON uw.workspace_id = w.id
     WHERE uw.user_id = ?
     ORDER BY uw.joined_at ASC`,
  )
    .bind(user.id)
    .all();

  return json({ data: results.results });
});

// POST /api/user/workspaces — create a new workspace (user becomes owner)
userWorkspacesRouter.post(
  '/',
  validate(CreateUserWorkspaceSchema),
  async (req: IRequest, env: Env) => {
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (
      req as unknown as {
        validatedBody: {
          name: string;
          trade?: string;
          phone?: string;
          email?: string;
        };
      }
    ).validatedBody;

    const workspaceId = newId();
    const now = new Date().toISOString();

    // Create workspace
    await env.DB.prepare(
      `INSERT INTO workspaces (id, name, trade, phone, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        workspaceId,
        body.name,
        body.trade ?? 'electrical',
        body.phone ?? '',
        body.email ?? '',
        now,
      )
      .run();

    // Link user as owner
    await env.DB.prepare(
      `INSERT INTO user_workspaces (id, user_id, workspace_id, role, joined_at)
     VALUES (?, ?, ?, 'owner', ?)`,
    )
      .bind(newId(), user.id, workspaceId, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
     VALUES (?, ?, ?, 'workspace', ?, 'created', ?)`,
    )
      .bind(newId(), workspaceId, user.id, workspaceId, now)
      .run();

    return json({ data: { workspaceId, name: body.name, role: 'owner' } }, 201);
  },
);

// POST /api/user/workspaces/switch — switch active workspace
userWorkspacesRouter.post(
  '/switch',
  validate(SwitchWorkspaceSchema),
  async (req: IRequest, env: Env) => {
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (req as unknown as { validatedBody: { workspaceId: string } })
      .validatedBody;

    // Verify user belongs to workspace
    const membership = await env.DB.prepare(
      'SELECT role FROM user_workspaces WHERE user_id = ? AND workspace_id = ?',
    )
      .bind(user.id, body.workspaceId)
      .first<{ role: string }>();

    if (!membership) {
      return error('You are not a member of this workspace', 403, 'NOT_MEMBER');
    }

    // Update session with new workspace_id
    // The session cookie token is available on the request
    const sessionToken = (req as unknown as { sessionToken?: string })
      .sessionToken;
    if (sessionToken) {
      const sessionData = await env.SESSIONS.get(sessionToken);
      if (sessionData) {
        const session = JSON.parse(sessionData) as Record<string, unknown>;
        session['workspaceId'] = body.workspaceId;
        await env.SESSIONS.put(sessionToken, JSON.stringify(session), {
          expirationTtl: 7 * 24 * 60 * 60, // 7 days
        });
      }
    }

    return json({
      data: { workspaceId: body.workspaceId, role: membership.role },
    });
  },
);
