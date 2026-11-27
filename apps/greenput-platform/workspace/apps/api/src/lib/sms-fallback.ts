import type { Env } from '../env';
import { newId } from './response';
import { sendContractorSms } from './usage-balance';

/**
 * GP-110 step 2 — the chat SMS fallback, reinstated in its safe shape.
 *
 * Step 1 (#152) closed the original route at 410: it took the destination
 * straight off the request body, so any signed-in user could text any
 * number in the world on the account owner's Twilio bill. This module is
 * the shape GP-110 requires before the route may send again:
 *
 * - The request names a `recipientUserId`, NEVER a phone number. The
 *   number is resolved server-side from `users.mobile_phone` — a new
 *   teammate contact column, set by the teammate. It is deliberately NOT
 *   `users.recovery_phone`: that column is the account-recovery channel,
 *   write-only from the outside, and must never become a chat address.
 * - The recipient must belong to the caller's workspace AND participate
 *   in the room `:id` (they created it, have posted in it, or have a read
 *   receipt for it). A room id from another workspace resolves to
 *   "room not found" — the route never confirms a foreign room exists.
 * - A per-workspace daily cap, counted in D1 (`sms_fallback_sends`),
 *   checked BEFORE the send and incremented only after a successful one.
 *   The cap is a spend ceiling, not a rate: it bounds what a bug or a
 *   stolen session can burn in a day. Step 3 (the Twilio console spend
 *   limit) remains the owner's, per GP-110 — an application cap cannot
 *   protect against a bug in the application.
 */

export const SMS_FALLBACK_DAILY_CAP = 50;

export type SmsFallbackFailure =
  | 'ROOM_NOT_FOUND'
  | 'RECIPIENT_NOT_FOUND'
  | 'NOT_A_PARTICIPANT'
  | 'NO_MOBILE_NUMBER'
  | 'DAILY_CAP_REACHED'
  | 'USAGE_EXHAUSTED'
  | 'SEND_FAILED';

export type SmsFallbackResult =
  | { readonly ok: true; readonly sentTo: string; readonly sendsToday: number }
  | { readonly ok: false; readonly reason: SmsFallbackFailure };

export interface SmsFallbackParams {
  readonly workspaceId: string;
  readonly roomId: string;
  readonly senderUserId: string;
  readonly senderName: string;
  readonly recipientUserId: string;
  readonly message: string;
  /** Injected for tests; the route passes the current instant. */
  readonly now?: Date;
}

/**
 * Resolve a teammate's SMS destination server-side. Returns the user's
 * row only when they belong to `workspaceId`; the caller maps a missing
 * row to RECIPIENT_NOT_FOUND without ever learning whether the user
 * exists in some other workspace.
 */
export async function resolveSmsRecipient(
  env: Env,
  workspaceId: string,
  recipientUserId: string,
): Promise<{ id: string; mobilePhone: string | null } | null> {
  const row = await env.DB.prepare(
    'SELECT id, mobile_phone FROM users WHERE id = ? AND workspace_id = ?',
  )
    .bind(recipientUserId, workspaceId)
    .first<{ id: string; mobile_phone: string | null }>();
  if (!row) return null;
  return { id: row.id, mobilePhone: row.mobile_phone };
}

/** Sends already recorded for this workspace on `day` (a UTC YYYY-MM-DD). */
export async function countSmsFallbackSends(
  env: Env,
  workspaceId: string,
  day: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sms_fallback_sends
     WHERE workspace_id = ? AND substr(created_at, 1, 10) = ?`,
  )
    .bind(workspaceId, day)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function sendSmsFallback(
  env: Env,
  params: SmsFallbackParams,
): Promise<SmsFallbackResult> {
  const now = params.now ?? new Date();
  const day = now.toISOString().slice(0, 10);

  // The room must be the caller's own workspace's room.
  const room = await env.DB.prepare(
    'SELECT id, created_by FROM chat_rooms WHERE id = ? AND workspace_id = ?',
  )
    .bind(params.roomId, params.workspaceId)
    .first<{ id: string; created_by: string }>();
  if (!room) return { ok: false, reason: 'ROOM_NOT_FOUND' };

  const recipient = await resolveSmsRecipient(
    env,
    params.workspaceId,
    params.recipientUserId,
  );
  if (!recipient) return { ok: false, reason: 'RECIPIENT_NOT_FOUND' };

  // Participation: created the room, posted in it, or has read it. A
  // teammate who has never touched the room is not its fallback audience.
  if (room.created_by !== recipient.id) {
    const participation = await env.DB.prepare(
      `SELECT 1 AS x FROM chat_messages
         WHERE chat_room_id = ? AND user_id = ?
       UNION
       SELECT 1 AS x FROM chat_read_receipts
         WHERE chat_room_id = ? AND user_id = ?
       LIMIT 1`,
    )
      .bind(params.roomId, recipient.id, params.roomId, recipient.id)
      .first<{ x: number }>();
    if (!participation) return { ok: false, reason: 'NOT_A_PARTICIPANT' };
  }

  if (!recipient.mobilePhone) {
    return { ok: false, reason: 'NO_MOBILE_NUMBER' };
  }

  const sendsToday = await countSmsFallbackSends(env, params.workspaceId, day);
  if (sendsToday >= SMS_FALLBACK_DAILY_CAP) {
    return { ok: false, reason: 'DAILY_CAP_REACHED' };
  }

  const result = await sendContractorSms(env, {
    workspaceId: params.workspaceId,
    to: recipient.mobilePhone,
    body: `[Greenput] ${params.senderName}: ${params.message}`,
  });
  if (!result.ok) {
    if (result.reason === 'USAGE_EXHAUSTED') {
      return { ok: false, reason: 'USAGE_EXHAUSTED' };
    }
    return { ok: false, reason: 'SEND_FAILED' };
  }

  await env.DB.prepare(
    `INSERT INTO sms_fallback_sends
       (id, workspace_id, chat_room_id, sender_user_id, recipient_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId(),
      params.workspaceId,
      params.roomId,
      params.senderUserId,
      recipient.id,
      now.toISOString(),
    )
    .run();

  return {
    ok: true,
    sentTo: recipient.mobilePhone,
    sendsToday: sendsToday + 1,
  };
}
