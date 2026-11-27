import { Router, IRequest } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId } from '../lib/response';
import { entity, entityList, toWireList } from '../lib/serialize';
import {
  WIRE_CHAT_MESSAGE,
  WIRE_CHAT_ROOM,
  WIRE_CHAT_UNREAD,
} from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import { sendSmsFallback, SMS_FALLBACK_DAILY_CAP } from '../lib/sms-fallback';
import { assertCanReceiveLeads } from '../lib/lead-billing-gate';
import type { SessionUser } from '../middleware/auth';
import {
  CreateChatRoomSchema,
  PublishTracksSchema,
  PullTracksSchema,
  RenegotiateSchema,
} from '@greenput/shared/validators';

export const chatRouter = Router({ base: '/api/chat' });

/**
 * Who is asking. `requireAuth` attaches `req.user` (the session principal)
 * and `req.workspaceId` — never `req.session`, which is what every handler
 * here used to read and which was therefore `undefined` on every request:
 * each of them threw on `.workspaceId` and answered 500. It went unnoticed
 * because nothing in the product could reach chat (GP-055), and because this
 * file's spec drove no handler with a session at all.
 */
function principal(req: IRequest): {
  userId: string;
  workspaceId: string;
  name: string;
} {
  const user = req.user as SessionUser | undefined;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  return {
    userId: user?.id ?? '',
    workspaceId: (req.workspaceId as string | undefined) ?? '',
    name: name || 'Anonymous',
  };
}

const ROOM_COLUMNS = 'id, name, entity_type, entity_id, created_by, created_at';

// ── Create a chat room ──────────────────────────────────────────
//
// A conversation is about something — a customer, a job (GP-055) — and one
// entity gets ONE room: a second POST for the same entity answers the room
// that already exists (200) instead of minting another (201). The platform
// looks first and posts second, but a double-click or two teammates pressing
// Message at once must still land in the same room, so the dedupe lives
// here, where the data is.
chatRouter.post(
  '/rooms',
  validate(CreateChatRoomSchema),
  async (req: IRequest, env: Env) => {
    const { userId, workspaceId } = principal(req);
    const body = (
      req as unknown as {
        validatedBody: {
          entityType?: string;
          entityId?: string;
          name?: string;
        };
      }
    ).validatedBody;

    if (body.entityType && body.entityId) {
      const existing = await env.DB.prepare(
        `SELECT ${ROOM_COLUMNS} FROM chat_rooms
         WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?
         ORDER BY created_at ASC LIMIT 1`,
      )
        .bind(workspaceId, body.entityType, body.entityId)
        .first<Record<string, unknown>>();
      if (existing) return entity(WIRE_CHAT_ROOM, existing);
    }

    const id = newId();
    const now = new Date().toISOString();
    const name = body.name?.trim() || 'Chat Room';

    await env.DB.prepare(
      `INSERT INTO chat_rooms (id, workspace_id, name, entity_type, entity_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        workspaceId,
        name,
        body.entityType || null,
        body.entityId || null,
        userId,
        now,
      )
      .run();

    const row = await env.DB.prepare(
      `SELECT ${ROOM_COLUMNS} FROM chat_rooms WHERE id = ?`,
    )
      .bind(id)
      .first<Record<string, unknown>>();

    return entity(WIRE_CHAT_ROOM, row, {}, 201);
  },
);

// ── Get room info ───────────────────────────────────────────────
chatRouter.get('/rooms/:id', async (req: IRequest, env: Env) => {
  const { workspaceId } = principal(req);

  const room = await env.DB.prepare(
    `SELECT ${ROOM_COLUMNS} FROM chat_rooms WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .first<Record<string, unknown>>();

  if (!room) return notFound('Chat room');
  return entity(WIRE_CHAT_ROOM, room);
});

// ── List rooms ──────────────────────────────────────────────────
//
// `?entityType=customer&entityId=<id>` narrows to the room about one record,
// which is how a Message button finds the conversation that already exists.
chatRouter.get('/rooms', async (req: IRequest, env: Env) => {
  const { workspaceId } = principal(req);
  const url = new URL(req.url);
  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');

  let where = 'WHERE workspace_id = ?';
  const params: unknown[] = [workspaceId];
  if (entityType && entityId) {
    where += ' AND entity_type = ? AND entity_id = ?';
    params.push(entityType, entityId);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT ${ROOM_COLUMNS} FROM chat_rooms ${where}
       ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(...params)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM chat_rooms ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_CHAT_ROOM, rows.results, {
    total: countRow?.total ?? 0,
    page: 1,
    perPage: 50,
  });
});

// ── Create a Calls session ──────────────────────────────────────
chatRouter.post('/rooms/:id/session', async (req: IRequest, env: Env) => {
  if (!env.CALLS_APP_ID || !env.CALLS_APP_SECRET) {
    return error(
      'Video calling is not configured',
      503,
      'CALLS_NOT_CONFIGURED',
    );
  }

  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/apps/${env.CALLS_APP_ID}/sessions/new`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CALLS_APP_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    console.error('Calls session creation failed:', text);
    return error('Failed to create video session', 502, 'CALLS_ERROR');
  }

  const data = (await res.json()) as { sessionId: string };
  return json({ data: { sessionId: data.sessionId } });
});

// ── Publish tracks (SDP offer → Calls API → SDP answer) ────────
chatRouter.post(
  '/rooms/:id/tracks/publish',
  validate(PublishTracksSchema),
  async (req: IRequest, env: Env) => {
    if (!env.CALLS_APP_ID || !env.CALLS_APP_SECRET) {
      return error(
        'Video calling is not configured',
        503,
        'CALLS_NOT_CONFIGURED',
      );
    }

    const body = (
      req as unknown as {
        validatedBody: {
          sessionId: string;
          sdpOffer: string;
          tracks: { location: string; mid?: string; trackName: string }[];
        };
      }
    ).validatedBody;

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${env.CALLS_APP_ID}/sessions/${body.sessionId}/tracks/new`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CALLS_APP_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionDescription: { type: 'offer', sdp: body.sdpOffer },
          tracks: body.tracks,
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('Calls tracks/new failed:', text);
      return error('Failed to publish tracks', 502, 'CALLS_ERROR');
    }

    const data = (await res.json()) as {
      sessionDescription: { type: string; sdp: string };
      tracks: unknown[];
    };
    return json({
      data: {
        sdpAnswer: data.sessionDescription.sdp,
        tracks: data.tracks,
      },
    });
  },
);

// ── Pull remote tracks ──────────────────────────────────────────
chatRouter.post(
  '/rooms/:id/tracks/pull',
  validate(PullTracksSchema),
  async (req: IRequest, env: Env) => {
    if (!env.CALLS_APP_ID || !env.CALLS_APP_SECRET) {
      return error(
        'Video calling is not configured',
        503,
        'CALLS_NOT_CONFIGURED',
      );
    }

    const body = (
      req as unknown as {
        validatedBody: {
          sessionId: string;
          sdpOffer?: string;
          tracks: { location: string; sessionId?: string; trackName: string }[];
        };
      }
    ).validatedBody;

    const payload: Record<string, unknown> = {
      tracks: body.tracks,
    };
    if (body.sdpOffer) {
      payload.sessionDescription = { type: 'offer', sdp: body.sdpOffer };
    }

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${env.CALLS_APP_ID}/sessions/${body.sessionId}/tracks/new`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CALLS_APP_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('Calls pull tracks failed:', text);
      return error('Failed to pull tracks', 502, 'CALLS_ERROR');
    }

    const data = (await res.json()) as {
      sessionDescription?: { type: string; sdp: string };
      tracks: unknown[];
    };
    return json({
      data: {
        sdpAnswer: data.sessionDescription?.sdp ?? null,
        tracks: data.tracks,
      },
    });
  },
);

// ── Renegotiate SDP ─────────────────────────────────────────────
chatRouter.put(
  '/rooms/:id/renegotiate',
  validate(RenegotiateSchema),
  async (req: IRequest, env: Env) => {
    if (!env.CALLS_APP_ID || !env.CALLS_APP_SECRET) {
      return error(
        'Video calling is not configured',
        503,
        'CALLS_NOT_CONFIGURED',
      );
    }

    const body = (
      req as unknown as {
        validatedBody: { sessionId: string; sdpOffer: string };
      }
    ).validatedBody;

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${env.CALLS_APP_ID}/sessions/${body.sessionId}/renegotiate`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${env.CALLS_APP_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionDescription: { type: 'offer', sdp: body.sdpOffer },
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('Calls renegotiate failed:', text);
      return error('Failed to renegotiate', 502, 'CALLS_ERROR');
    }

    const data = (await res.json()) as {
      sessionDescription: { type: string; sdp: string };
    };
    return json({ data: { sdpAnswer: data.sessionDescription.sdp } });
  },
);

// ── Message history (paginated from D1) ────────────────────────
chatRouter.get('/rooms/:id/messages', async (req: IRequest, env: Env) => {
  const { workspaceId } = principal(req);

  // Verify room belongs to workspace
  const room = await env.DB.prepare(
    `SELECT id FROM chat_rooms WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .first();

  if (!room) return notFound('Chat room');

  const url = new URL(req.url);
  const before = url.searchParams.get('before');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);

  let query = `SELECT id, user_id, user_name, content, created_at
               FROM chat_messages WHERE chat_room_id = ?`;
  const params: unknown[] = [req.params.id];

  if (before) {
    query += ` AND created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const { results } = await env.DB.prepare(query)
    .bind(...params)
    .all();

  return json({
    data: toWireList(WIRE_CHAT_MESSAGE, [...(results ?? [])].reverse()),
  });
});

// ── Unread message counts ──────────────────────────────────────
chatRouter.get('/unread', async (req: IRequest, env: Env) => {
  const { userId, workspaceId } = principal(req);

  const { results } = await env.DB.prepare(
    `SELECT cr.id AS id, cr.name AS name,
            COUNT(cm.id) AS unread_count
     FROM chat_rooms cr
     LEFT JOIN chat_messages cm ON cm.chat_room_id = cr.id
       AND cm.created_at > COALESCE(
         (SELECT last_read_at FROM chat_read_receipts
          WHERE user_id = ? AND chat_room_id = cr.id),
         '1970-01-01'
       )
       AND cm.user_id != ?
     WHERE cr.workspace_id = ?
     GROUP BY cr.id
     HAVING unread_count > 0`,
  )
    .bind(userId, userId, workspaceId)
    .all();

  return json({ data: toWireList(WIRE_CHAT_UNREAD, results ?? []) });
});

// ── SMS fallback for offline users — GP-110 step 2 ──────────────────────
//
// The original route took the destination straight off the request body
// and sent it, so any signed-in user of any workspace could send
// arbitrary text to arbitrary phone numbers worldwide on the account
// owner's Twilio bill. Step 1 (#152) closed it at 410. This is the
// reinstated shape GP-110 specifies (lib/sms-fallback.ts has the full
// story): the body names a `recipientUserId` and a message — never a
// phone number — and the number is resolved server-side from the
// teammate's own `users.mobile_phone`, checked against the caller's
// workspace and participation in room `:id`, under a per-workspace
// daily cap counted in D1. A `recipientPhone` in the body is ignored:
// there is no path from request input to the Twilio `To` field.
chatRouter.post('/rooms/:id/sms-fallback', async (req: IRequest, env: Env) => {
  const { userId, workspaceId, name } = principal(req);

  let body: { recipientUserId?: unknown; message?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return error('Request body must be JSON.', 400, 'INVALID_BODY');
  }
  const recipientUserId =
    typeof body.recipientUserId === 'string' ? body.recipientUserId : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!recipientUserId || !message) {
    return error(
      'recipientUserId and a non-empty message are required.',
      400,
      'INVALID_SMS_FALLBACK',
    );
  }
  if (recipientUserId === userId) {
    return error(
      'The SMS fallback reaches a teammate, not yourself.',
      400,
      'INVALID_SMS_FALLBACK',
    );
  }
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_FROM_NUMBER
  ) {
    return error('SMS is not configured.', 503, 'SMS_NOT_CONFIGURED');
  }

  // Contractor SMS is paid from the prepaid usage balance when Stripe
  // is configured. A workspace that cannot receive leads does not get
  // to spend that balance either. Account-recovery OTP is GreenPut's
  // own sign-in and is not this path.
  if (env.STRIPE_SECRET_KEY) {
    const receive = await assertCanReceiveLeads(env, workspaceId);
    if (!receive.ok) {
      return error(
        'This workspace cannot receive leads until a card is on file and any outstanding fee is collected, so GreenPut will not send SMS on its account.',
        409,
        'BILLING_REQUIRED',
      );
    }
  }

  const result = await sendSmsFallback(env, {
    workspaceId,
    roomId: req.params!['id']!,
    senderUserId: userId,
    senderName: name,
    recipientUserId,
    message,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'ROOM_NOT_FOUND':
        return notFound('Chat room');
      case 'RECIPIENT_NOT_FOUND':
        return error(
          'That teammate is not in this workspace.',
          404,
          'RECIPIENT_NOT_FOUND',
        );
      case 'NOT_A_PARTICIPANT':
        return error(
          'That teammate is not a participant in this room.',
          403,
          'NOT_A_PARTICIPANT',
        );
      case 'NO_MOBILE_NUMBER':
        return error(
          'That teammate has not added a mobile number for SMS fallback.',
          422,
          'NO_MOBILE_NUMBER',
        );
      case 'DAILY_CAP_REACHED':
        return error(
          `This workspace has reached its daily SMS fallback cap (${SMS_FALLBACK_DAILY_CAP}).`,
          429,
          'SMS_DAILY_CAP_REACHED',
        );
      case 'USAGE_EXHAUSTED':
        return error(
          'Outbound SMS is blocked until the usage balance covers it. Top-up from the card on file did not collect.',
          409,
          'USAGE_EXHAUSTED',
        );
      case 'SEND_FAILED':
        return error('The SMS could not be sent.', 502, 'SMS_SEND_FAILED');
    }
  }

  return json({
    data: { sent: true, sendsToday: result.sendsToday },
  });
});

// ── WebSocket upgrade (proxied to Durable Object) ───────────────
//
// Mounted in index.ts BEHIND requireAuth, so `req.user` is the verified
// session principal. The identity and the room id ride to the Durable Object
// on the URL, and the DO trusts those over anything the socket later says in
// its `join` frame — otherwise a signed-in user could claim any name, or read
// and write another workspace's room by naming its id in the frame. The room
// is checked against the caller's workspace here, before any DO is touched.
//
// The 101 the DO answers is returned as-is: a Response carrying a WebSocket
// cannot be rebuilt (`new Response(res.body, …)` loses it), which is why
// index.ts and the error handler pass a 101 through untouched.
chatRouter.get('/rooms/:id/ws', async (req: IRequest, env: Env) => {
  const upgradeHeader = req.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return error('Expected WebSocket upgrade', 426, 'UPGRADE_REQUIRED');
  }

  const { userId, workspaceId, name } = principal(req);
  const room = await env.DB.prepare(
    `SELECT id FROM chat_rooms WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .first();
  if (!room) return notFound('Chat room');

  const url = new URL(req.url);
  url.searchParams.set('roomId', req.params.id);
  url.searchParams.set('userId', userId);
  url.searchParams.set('userName', name);

  const roomId = env.CHAT_ROOM.idFromName(req.params.id);
  const roomStub = env.CHAT_ROOM.get(roomId);
  return roomStub.fetch(new Request(url.toString(), { headers: req.headers }));
});
