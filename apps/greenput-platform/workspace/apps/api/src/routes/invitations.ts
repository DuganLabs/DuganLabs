import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, newId } from '../lib/response';
import { createSession } from '../lib/session';
import {
  consumeInvitation,
  credentialCount,
  findInvitation,
  invitationState,
} from '../lib/invitations';
import type { InvitationPreview } from '@greenput/shared/models';

/**
 * `/api/auth/invite/:token` — the public half of a teammate invitation
 * (GP-008). No session on either route: the holder has none yet, that is
 * the whole problem this solves. Registered in apps/api/src/index.ts ahead
 * of the `/api/auth/*` catch-all.
 *
 * `accept` mints a session the same way `/api/auth/register` and
 * `/api/auth/otp/verify` do — a proven-possession door — and the platform's
 * accept screen runs passkey enrolment under it straight away. The token is
 * single-use: `consumeInvitation` stamps `accepted_at` conditionally, and a
 * second accept, concurrent or later, changes no row and gets no cookie.
 */
export const invitationsRouter = Router({ base: '/api/auth/invite' });

const REFUSALS = {
  missing: () =>
    error(
      'This invitation link is not valid. Ask a teammate with owner or admin access to invite you again.',
      404,
      'INVITE_NOT_FOUND',
    ),
  used: () =>
    error(
      'This invitation has already been used. Sign in with the passkey you created, or ask to be invited again.',
      410,
      'INVITE_USED',
    ),
  expired: () =>
    error(
      'This invitation has expired. Ask a teammate with owner or admin access to invite you again.',
      410,
      'INVITE_EXPIRED',
    ),
  enrolled: () =>
    error(
      'This account already has a passkey. Sign in with it instead.',
      409,
      'ALREADY_ENROLLED',
    ),
} as const;

// GET /api/auth/invite/:token — who is this for, and is it still open?
invitationsRouter.get('/:token', async (req: IRequest, env: Env) => {
  const token = req.params!['token'];
  const row = await findInvitation(env, token);
  if (!row) return REFUSALS.missing();

  const state = invitationState(row, new Date().toISOString());
  if (state !== 'open') return REFUSALS[state]();

  const preview: InvitationPreview = {
    firstName: row.first_name,
    lastName: row.last_name,
    workspaceName: row.workspace_name,
    expiresAt: row.expires_at,
  };
  return json({ data: preview });
});

// POST /api/auth/invite/:token/accept — burn the token, sign the holder in.
invitationsRouter.post('/:token/accept', async (req: IRequest, env: Env) => {
  const token = req.params!['token'];
  const row = await findInvitation(env, token);
  if (!row) return REFUSALS.missing();

  const now = new Date().toISOString();
  const state = invitationState(row, now);
  if (state !== 'open') return REFUSALS[state]();

  // An invitation exists so that someone with NO credential can enrol one.
  // An account that already has a passkey does not need this door, and a
  // link that opens it anyway would be a second way to take the account over.
  if ((await credentialCount(env, row.user_id)) > 0) {
    return REFUSALS.enrolled();
  }

  if (!(await consumeInvitation(env, row.id, now))) {
    // Lost a race with another accept of the same token — or it expired
    // between the read and the write. Either way, no session.
    return REFUSALS.used();
  }

  const session = await createSession(env, {
    id: row.user_id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
  });

  await env.DB.batch([
    env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(
      now,
      row.user_id,
    ),
    env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
       VALUES (?, ?, ?, 'user', ?, 'invite_accepted', ?)`,
    ).bind(newId(), row.workspace_id, row.user_id, row.user_id, now),
  ]);

  const response = json({
    data: {
      user: {
        id: row.user_id,
        workspaceId: row.workspace_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        role: row.role,
      },
    },
  });
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', session.cookie);
  return new Response(response.body, { status: 200, headers });
});
