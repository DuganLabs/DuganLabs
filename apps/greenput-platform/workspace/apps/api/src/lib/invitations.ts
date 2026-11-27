import type { Env } from '../env';
import { newId } from './response';

/**
 * Teammate invitations (GP-008).
 *
 * Sign-in is passkeys only, and passkey enrolment needs a session, so a user
 * row created by POST /api/workspace/users could never sign in: no
 * invitation reached them, and the recovery screen's advice to "ask to be
 * invited again" hit a 409. A `user_invitations` row is the way in — one
 * token, one session, and the inviter passes the link on by hand because
 * nothing here sends mail.
 */

/** How long an invitation link works. Long enough for a weekend, no longer. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How many passkeys this user has enrolled. Zero means they have never signed in. */
export async function credentialCount(
  env: Env,
  userId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM webauthn_credentials WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ cnt: number }>();
  return Number(row?.cnt ?? 0);
}

export interface IssuedInvitation {
  token: string;
  expiresAt: string;
}

/**
 * Mint a fresh invitation for a user, retiring any they have not used.
 *
 * Deleting the open rows rather than leaving them is what makes a re-invite
 * a re-issue: the link the owner read out last week stops working the moment
 * a new one exists, so there is exactly one live way in per invited user.
 */
export async function issueInvitation(
  env: Env,
  args: {
    workspaceId: string;
    userId: string;
    invitedBy: string;
    now: string;
  },
): Promise<IssuedInvitation> {
  const token = newId();
  const expiresAt = new Date(
    new Date(args.now).getTime() + INVITATION_TTL_MS,
  ).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM user_invitations WHERE user_id = ? AND accepted_at IS NULL',
    ).bind(args.userId),
    env.DB.prepare(
      `INSERT INTO user_invitations (id, workspace_id, user_id, token, invited_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newId(),
      args.workspaceId,
      args.userId,
      token,
      args.invitedBy,
      expiresAt,
      args.now,
    ),
  ]);
  return { token, expiresAt };
}

/** An invitation row joined to the user and workspace it admits. */
export interface InvitationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  expires_at: string;
  accepted_at: string | null;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  workspace_name: string;
}

export async function findInvitation(
  env: Env,
  token: string,
): Promise<InvitationRow | null> {
  return env.DB.prepare(
    `SELECT i.id, i.workspace_id, i.user_id, i.expires_at, i.accepted_at,
            u.first_name, u.last_name, u.email, u.role,
            w.name AS workspace_name
     FROM user_invitations i
     JOIN users u ON u.id = i.user_id
     JOIN workspaces w ON w.id = i.workspace_id
     WHERE i.token = ?`,
  )
    .bind(token)
    .first<InvitationRow>();
}

export type InvitationState = 'open' | 'used' | 'expired';

export function invitationState(
  row: Pick<InvitationRow, 'accepted_at' | 'expires_at'>,
  now: string,
): InvitationState {
  if (row.accepted_at) return 'used';
  if (row.expires_at <= now) return 'expired';
  return 'open';
}

/**
 * Stamp the invitation as used. Conditional on it still being open, so two
 * concurrent accepts of one token cannot both mint a session: the UPDATE
 * that changes zero rows lost, and its caller must not sign anyone in.
 */
export async function consumeInvitation(
  env: Env,
  id: string,
  now: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    'UPDATE user_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND expires_at > ?',
  )
    .bind(now, id, now)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}
