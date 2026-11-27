import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, forbidden, newId } from '../lib/response';
import { entity, entityArray, entityShared } from '../lib/serialize';
import { WIRE_WORKSPACE, WIRE_WORKSPACE_USER } from '@greenput/shared/models';
import { inviteShareLink, maskPhone, toE164 } from '@greenput/shared/utils';
import { NO_PASSWORD } from '../lib/password';
import { credentialCount, issueInvitation } from '../lib/invitations';
import { appOrigin } from '../lib/origins';
import { validate } from '../middleware/validate';
import {
  UpdateWorkspaceSchema,
  InviteUserSchema,
  UpdateUserRoleSchema,
} from '@greenput/shared/validators';

export const workspaceRouter = Router({ base: '/api/workspace' });

// GET /api/workspace — return current workspace
workspaceRouter.get('/', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const workspace = await env.DB.prepare(
    'SELECT id, name, slug, trade, phone, email, street, city, state, zip, license_num, logo_url, service_area, service_radius_miles, service_types, created_at FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<Record<string, unknown>>();

  if (!workspace) return notFound('Workspace');
  return entity(WIRE_WORKSPACE, workspace);
});

// PATCH /api/workspace — update workspace (owner/admin only)
workspaceRouter.patch(
  '/',
  validate(UpdateWorkspaceSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string; role: string } })
      .user;

    if (user.role !== 'owner' && user.role !== 'admin') {
      return forbidden();
    }

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    const allowedFields: Record<string, string> = {
      name: 'name',
      trade: 'trade',
      phone: 'phone',
      email: 'email',
      street: 'street',
      city: 'city',
      state: 'state',
      zip: 'zip',
      licenseNumber: 'license_num',
      logoUrl: 'logo_url',
      // GP-039: Settings → Company edits the area and radius; the service
      // list is a JSON array column.
      serviceArea: 'service_area',
      serviceRadiusMiles: 'service_radius_miles',
      serviceTypes: 'service_types',
    };

    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];

    // `Workspace.address` is a nested object on the wire (see WIRE_WORKSPACE),
    // and that is what the settings form sends. Flatten it back onto the four
    // columns; a caller sending the flat keys directly still works.
    const flattened: Record<string, unknown> = { ...body };
    const address = flattened['address'];
    delete flattened['address'];
    if (address && typeof address === 'object' && !Array.isArray(address)) {
      for (const [key, val] of Object.entries(
        address as Record<string, unknown>,
      )) {
        if (val !== undefined) flattened[key] = val;
      }
    }

    // `trade` is the first entry of `service_types` (see /api/auth/register):
    // a caller replacing the list without naming a trade moves `trade` with
    // it, so apps/tenant-site — which still reads the one string — keeps
    // agreeing with the list.
    const serviceTypes = flattened['serviceTypes'];
    if (
      Array.isArray(serviceTypes) &&
      serviceTypes.length > 0 &&
      flattened['trade'] === undefined
    ) {
      flattened['trade'] = serviceTypes[0];
    }

    for (const [key, val] of Object.entries(flattened)) {
      const col = allowedFields[key] ?? key;
      if (Object.values(allowedFields).includes(col)) {
        sets.push(`${col} = ?`);
        vals.push(col === 'service_types' ? JSON.stringify(val) : val);
      }
    }

    vals.push(workspaceId);

    await env.DB.prepare(
      `UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
     VALUES (?, ?, ?, 'workspace', ?, 'updated', ?)`,
    )
      .bind(newId(), workspaceId, user.id, workspaceId, now)
      .run();

    const updated = await env.DB.prepare(
      'SELECT id, name, slug, trade, phone, email, street, city, state, zip, license_num, logo_url, service_area, service_radius_miles, service_types, created_at FROM workspaces WHERE id = ?',
    )
      .bind(workspaceId)
      .first<Record<string, unknown>>();

    return entity(WIRE_WORKSPACE, updated);
  },
);

// GET /api/workspace/users — list workspace members
workspaceRouter.get('/users', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const rows = await env.DB.prepare(
    'SELECT id, first_name, last_name, email, role, last_seen_at, created_at, updated_at FROM users WHERE workspace_id = ? ORDER BY created_at ASC',
  )
    .bind(workspaceId)
    .all();

  return entityArray(WIRE_WORKSPACE_USER, rows.results);
});

// POST /api/workspace/users — invite a teammate: the user row AND the link.
//
// The row alone was a dead end (GP-008): sign-in is passkeys only, enrolment
// needs a session, and no invitation ever reached the invitee. Now every
// invite writes a `user_invitations` row and answers `{ data, share }` with
// https://app.greenput.com/accept-invite/<token> and a message for the inviter
// to pass on by hand — nothing sends it. Inviting an email that already exists
// in the workspace is a RE-ISSUE while that user has no passkey (their old
// link dies, a fresh one is returned, 200), which is what makes the recovery
// screen's "ask to be invited again" advice true; once they have enrolled a
// credential it is the 409 it always was, because that account already has
// a way in and a new link would be a second one.
workspaceRouter.post(
  '/users',
  validate(InviteUserSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string; role: string } })
      .user;

    if (user.role !== 'owner' && user.role !== 'admin') {
      return forbidden();
    }

    const body = (req as any).validatedBody as {
      firstName: string;
      lastName: string;
      email: string;
      role: string;
      password?: string;
    };

    const role = body.role;
    const now = new Date().toISOString();
    const origin = appOrigin(env, req.headers.get('origin'));

    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ? AND workspace_id = ?',
    )
      .bind(body.email.toLowerCase().trim(), workspaceId)
      .first<{ id: string }>();

    if (existing) {
      if ((await credentialCount(env, existing.id)) > 0) {
        return error(
          'A user with this email already exists and has a passkey. They can sign in with it.',
          409,
          'DUPLICATE',
        );
      }

      const invitation = await issueInvitation(env, {
        workspaceId,
        userId: existing.id,
        invitedBy: user.id,
        now,
      });

      await env.DB.prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'user', ?, 'reinvited', ?, ?)`,
      )
        .bind(
          newId(),
          workspaceId,
          user.id,
          existing.id,
          JSON.stringify({ email: body.email }),
          now,
        )
        .run();

      const row = await env.DB.prepare(
        'SELECT id, first_name, last_name, email, role, last_seen_at, created_at, updated_at FROM users WHERE id = ?',
      )
        .bind(existing.id)
        .first<Record<string, unknown>>();
      const workspace = await env.DB.prepare(
        'SELECT name FROM workspaces WHERE id = ?',
      )
        .bind(workspaceId)
        .first<{ name: string }>();

      return entityShared(
        WIRE_WORKSPACE_USER,
        row,
        workspace
          ? inviteShareLink(origin, invitation.token, {
              businessName: workspace.name,
              inviteeFirstName: (row?.['first_name'] as string) ?? '',
              expiresAt: invitation.expiresAt,
            })
          : null,
      );
    }

    const id = newId();
    // Passkeys only — an invited teammate enrols one, they are never given a
    // password. See the note in routes/auth.ts where POST /login used to be.
    const passwordHash = NO_PASSWORD;

    await env.DB.prepare(
      `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        workspaceId,
        body.firstName,
        body.lastName,
        body.email.toLowerCase().trim(),
        role,
        passwordHash,
        now,
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
     VALUES (?, ?, ?, 'user', ?, 'created', ?, ?)`,
    )
      .bind(
        newId(),
        workspaceId,
        user.id,
        id,
        JSON.stringify({ email: body.email }),
        now,
      )
      .run();

    const invitation = await issueInvitation(env, {
      workspaceId,
      userId: id,
      invitedBy: user.id,
      now,
    });

    // Read the row back rather than describing it from the request body: the
    // hand-built object left out `updatedAt`, which WorkspaceUser declares.
    const created = await env.DB.prepare(
      'SELECT id, first_name, last_name, email, role, last_seen_at, created_at, updated_at FROM users WHERE id = ?',
    )
      .bind(id)
      .first<Record<string, unknown>>();
    const workspace = await env.DB.prepare(
      'SELECT name FROM workspaces WHERE id = ?',
    )
      .bind(workspaceId)
      .first<{ name: string }>();

    return entityShared(
      WIRE_WORKSPACE_USER,
      created,
      workspace
        ? inviteShareLink(origin, invitation.token, {
            businessName: workspace.name,
            inviteeFirstName: body.firstName,
            expiresAt: invitation.expiresAt,
          })
        : null,
      {},
      201,
    );
  },
);

// PATCH /api/workspace/users/:id — update user role (owner only)
workspaceRouter.patch(
  '/users/:id',
  validate(UpdateUserRoleSchema),
  async (req: IRequest, env: Env) => {
    const currentUser = (
      req as unknown as { user: { id: string; role: string } }
    ).user;
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const targetId = req.params!['id'];

    if (currentUser.role !== 'owner') {
      return forbidden();
    }

    const body = (req as any).validatedBody as { role: string };

    const target = await env.DB.prepare(
      'SELECT id, role FROM users WHERE id = ? AND workspace_id = ?',
    )
      .bind(targetId, workspaceId)
      .first<{ id: string; role: string }>();

    if (!target) return notFound('User');

    // Prevent demoting the last owner
    if (target.role === 'owner' && body.role !== 'owner') {
      const ownerCount = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM users WHERE workspace_id = ? AND role = 'owner'",
      )
        .bind(workspaceId)
        .first<{ cnt: number }>();

      if ((ownerCount?.cnt ?? 0) <= 1) {
        return error(
          'Cannot demote the last owner. Promote another user first.',
          400,
          'LAST_OWNER',
        );
      }
    }

    const now = new Date().toISOString();

    await env.DB.prepare(
      'UPDATE users SET role = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
    )
      .bind(body.role, now, targetId, workspaceId)
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
     VALUES (?, ?, ?, 'user', ?, 'updated', ?, ?)`,
    )
      .bind(
        newId(),
        workspaceId,
        currentUser.id,
        targetId,
        JSON.stringify({ role: body.role }),
        now,
      )
      .run();

    const updatedUser = await env.DB.prepare(
      'SELECT id, first_name, last_name, email, role, last_seen_at, created_at, updated_at FROM users WHERE id = ? AND workspace_id = ?',
    )
      .bind(targetId, workspaceId)
      .first<Record<string, unknown>>();

    return entity(WIRE_WORKSPACE_USER, updatedUser);
  },
);

// PUT /api/workspace/users/:id/mobile-phone — set your OWN teammate
// contact number for chat's SMS fallback (GP-110 step 2). Self only: the
// number is the fallback's destination, resolved server-side from the
// user id, so letting anyone set anyone else's would reopen the relay
// GP-110 closed. Deliberately separate from users.recovery_phone — the
// recovery channel is never a chat address. The number is stored in
// E.164 (toE164, the same normaliser the recovery channel uses) and is
// never returned in full by this endpoint — it answers with the mask.
workspaceRouter.put(
  '/users/:id/mobile-phone',
  async (req: IRequest, env: Env) => {
    const currentUser = (req as unknown as { user: { id: string } }).user;
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const targetId = req.params!['id'];

    if (targetId !== currentUser.id) {
      return forbidden();
    }

    let body: { mobilePhone?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return error('Request body must be JSON.', 400, 'INVALID_BODY');
    }
    const raw = typeof body.mobilePhone === 'string' ? body.mobilePhone : '';
    const e164 = raw ? toE164(raw) : null;
    if (!e164) {
      return error(
        'A valid mobile number is required.',
        400,
        'INVALID_MOBILE_PHONE',
      );
    }

    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      'UPDATE users SET mobile_phone = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
    )
      .bind(e164, now, targetId, workspaceId)
      .run();
    if ((result.meta?.changes ?? 0) === 0) return notFound('User');

    return json({ data: { mobilePhone: maskPhone(e164) } });
  },
);

// DELETE /api/workspace/users/:id — remove user (owner only)
workspaceRouter.delete('/users/:id', async (req: IRequest, env: Env) => {
  const currentUser = (req as unknown as { user: { id: string; role: string } })
    .user;
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const targetId = req.params!['id'];

  if (currentUser.role !== 'owner') {
    return forbidden();
  }

  if (targetId === currentUser.id) {
    return error('Cannot remove yourself', 400, 'SELF_REMOVE');
  }

  const target = await env.DB.prepare(
    'SELECT id, role FROM users WHERE id = ? AND workspace_id = ?',
  )
    .bind(targetId, workspaceId)
    .first<{ id: string; role: string }>();

  if (!target) return notFound('User');

  // Prevent removing the last owner
  if (target.role === 'owner') {
    const ownerCount = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM users WHERE workspace_id = ? AND role = 'owner'",
    )
      .bind(workspaceId)
      .first<{ cnt: number }>();

    if ((ownerCount?.cnt ?? 0) <= 1) {
      return error('Cannot remove the last owner.', 400, 'LAST_OWNER');
    }
  }

  await env.DB.prepare('DELETE FROM users WHERE id = ? AND workspace_id = ?')
    .bind(targetId, workspaceId)
    .run();

  await env.DB.prepare(
    `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
     VALUES (?, ?, ?, 'user', ?, 'deleted', ?)`,
  )
    .bind(
      newId(),
      workspaceId,
      currentUser.id,
      targetId,
      new Date().toISOString(),
    )
    .run();

  return json({ data: { deleted: true } });
});
