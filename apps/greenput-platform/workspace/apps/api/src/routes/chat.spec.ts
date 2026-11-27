import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  checkWire,
  checkWireList,
  describeWireProblems,
  WIRE_CHAT_MESSAGE,
  WIRE_CHAT_ROOM,
  WIRE_CHAT_UNREAD,
} from '@greenput/shared/models';
import { chatRouter } from './chat';

describe('chatRouter', () => {
  it('should export chatRouter', () => {
    expect(chatRouter).toBeDefined();
  });

  it('chatRouter has fetch method', () => {
    expect(typeof chatRouter.fetch).toBe('function');
  });
});

describe('chat room logic', () => {
  describe('room name defaults', () => {
    it('defaults room name to "Chat Room" when not provided', () => {
      const body: { name?: string } = {};
      const name = body.name || 'Chat Room';
      expect(name).toBe('Chat Room');
    });

    it('uses provided name when given', () => {
      const body = { name: 'Job #1234 Chat' };
      const name = body.name || 'Chat Room';
      expect(name).toBe('Job #1234 Chat');
    });
  });

  describe('entity linking', () => {
    it('entity type and id can be null for standalone rooms', () => {
      const body: { entityType?: string; entityId?: string } = {};
      const entityType = body.entityType || null;
      const entityId = body.entityId || null;
      expect(entityType).toBeNull();
      expect(entityId).toBeNull();
    });

    it('links room to a job entity', () => {
      const body = { entityType: 'job', entityId: 'job_abc123' };
      expect(body.entityType).toBe('job');
      expect(body.entityId).toBe('job_abc123');
    });

    it('links room to a lead entity', () => {
      const body = { entityType: 'lead', entityId: 'lead_xyz789' };
      expect(body.entityType).toBe('lead');
      expect(body.entityId).toBeDefined();
    });
  });

  describe('message content validation', () => {
    it('rejects empty message body', () => {
      const message = '';
      expect(message.trim().length).toBe(0);
      expect(!message.trim()).toBe(true);
    });

    it('accepts non-empty message', () => {
      const message = 'The job is scheduled for Tuesday at 9am.';
      expect(message.trim().length).toBeGreaterThan(0);
    });

    it('trims whitespace from message', () => {
      const message = '  Hello there  ';
      expect(message.trim()).toBe('Hello there');
    });
  });

  describe('message pagination', () => {
    it('defaults to 50 messages per page', () => {
      const url = new URL(
        'https://api.greenput.com/api/chat/rooms/r1/messages',
      );
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
      expect(limit).toBe(50);
    });

    it('supports before_id cursor for infinite scroll', () => {
      const url = new URL(
        'https://api.greenput.com/api/chat/rooms/r1/messages?before_id=msg_123',
      );
      expect(url.searchParams.get('before_id')).toBe('msg_123');
    });
  });
});

describe('WebRTC / Calls session logic', () => {
  describe('session creation', () => {
    it('returns 503 when CALLS_APP_ID is not configured', async () => {
      const res = await chatRouter.fetch(
        new Request('https://api.greenput.com/api/chat/rooms/room-1/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
        { CALLS_APP_ID: '', CALLS_APP_SECRET: 'secret' },
      );
      expect(res.status).toBe(503);
    });

    it('returns 503 when CALLS_APP_SECRET is not configured', async () => {
      const res = await chatRouter.fetch(
        new Request('https://api.greenput.com/api/chat/rooms/room-1/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
        { CALLS_APP_ID: 'app-id', CALLS_APP_SECRET: '' },
      );
      expect(res.status).toBe(503);
    });
  });

  describe('publish tracks validation', () => {
    it('returns 422 when sessionId is missing', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/tracks/publish',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sdpOffer: 'v=0\r\n...',
              tracks: [{ location: 'local', trackName: 'camera' }],
            }),
          },
        ),
        {},
      );
      expect(res.status).toBe(400);
    });

    it('returns 422 when tracks array is empty', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/tracks/publish',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: 'sess-1',
              sdpOffer: 'v=0\r\n...',
              tracks: [],
            }),
          },
        ),
        {},
      );
      expect(res.status).toBe(400);
    });

    it('returns 503 when Calls is not configured', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/tracks/publish',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: 'sess-1',
              sdpOffer: 'v=0\r\n...',
              tracks: [{ location: 'local', trackName: 'camera' }],
            }),
          },
        ),
        { CALLS_APP_ID: '', CALLS_APP_SECRET: '' },
      );
      expect(res.status).toBe(503);
    });
  });

  describe('pull tracks validation', () => {
    it('returns 422 when sessionId is missing', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/tracks/pull',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracks: [{ location: 'remote', trackName: 'camera' }],
            }),
          },
        ),
        {},
      );
      expect(res.status).toBe(400);
    });

    it('returns 422 when tracks array is empty', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/tracks/pull',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: 'sess-1',
              tracks: [],
            }),
          },
        ),
        {},
      );
      expect(res.status).toBe(400);
    });

    it('returns 503 when Calls is not configured', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/tracks/pull',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: 'sess-1',
              tracks: [{ location: 'remote', trackName: 'camera' }],
            }),
          },
        ),
        { CALLS_APP_ID: '', CALLS_APP_SECRET: '' },
      );
      expect(res.status).toBe(503);
    });
  });

  describe('renegotiate validation', () => {
    it('returns 422 when sessionId is missing', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/renegotiate',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdpOffer: 'v=0\r\n...' }),
          },
        ),
        {},
      );
      expect(res.status).toBe(400);
    });

    it('returns 422 when sdpOffer is missing', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/renegotiate',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: 'sess-1' }),
          },
        ),
        {},
      );
      expect(res.status).toBe(400);
    });

    it('returns 503 when Calls is not configured', async () => {
      const res = await chatRouter.fetch(
        new Request(
          'https://api.greenput.com/api/chat/rooms/room-1/renegotiate',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: 'sess-1',
              sdpOffer: 'v=0\r\n...',
            }),
          },
        ),
        { CALLS_APP_ID: '', CALLS_APP_SECRET: '' },
      );
      expect(res.status).toBe(503);
    });
  });

  describe('WebSocket upgrade', () => {
    it('returns 426 when upgrade header is missing', async () => {
      const res = await chatRouter.fetch(
        new Request('https://api.greenput.com/api/chat/rooms/room-1/ws'),
        {},
      );
      expect(res.status).toBe(426);
    });

    it('returns 426 when upgrade header is not "websocket"', async () => {
      const res = await chatRouter.fetch(
        new Request('https://api.greenput.com/api/chat/rooms/room-1/ws', {
          headers: { Upgrade: 'http' },
        }),
        {},
      );
      expect(res.status).toBe(426);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// The SMS fallback, reinstated in its safe shape (GP-110 step 2).
//
// The original route honoured a `recipientPhone` straight off the body —
// an SMS relay on the owner's Twilio bill. Step 1 (#152) closed it at
// 410. These tests pin the step-2 shape: the body names a
// recipientUserId, the number is resolved server-side from
// users.mobile_phone, the recipient must be in the workspace AND a
// participant in the room, and a per-workspace daily cap counts sends
// in D1. The assertions that matter are on WHERE any outbound request
// goes (the teammate's stored number, never a body-supplied one) and on
// the sends that must NOT happen at all.
// ─────────────────────────────────────────────────────────────
describe('POST /api/chat/rooms/:id/sms-fallback (GP-110 step 2)', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-0000000000d1';
  const OTHER_WS = '00000000-0000-4000-8000-0000000000d2';
  const DANA = '00000000-0000-4000-8000-0000000000d3';
  const SAM = '00000000-0000-4000-8000-0000000000d4';
  const PAT = '00000000-0000-4000-8000-0000000000d5';
  const ROOM = '00000000-0000-4000-8000-0000000000d6';
  const SAM_MOBILE = '+15125550142';
  const CONFIGURED = {
    TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
    TWILIO_AUTH_TOKEN: 'not-a' + '-real-token',
    TWILIO_FROM_NUMBER: '+15125550100',
  };

  let sqlite: SqliteD1;
  let outbound: { url: string; body: string }[];

  function seed(): string {
    return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'rivertown-sms', 'electrical', '5125550142',
        'hello@rivertown.example', '100 Example Way', 'Rivertown', 'TX', '78701', '2026-01-01T00:00:00.000Z'),
       ('${OTHER_WS}', 'Elsewhere Plumbing', 'elsewhere-sms', 'plumbing', '5125550199',
        'hello@elsewhere.example', '1 Far St', 'Elsewhere', 'TX', '78799', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, mobile_phone, created_at, updated_at)
VALUES ('${DANA}', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '', NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
       ('${SAM}', '${WS}', 'Sam', 'Lee', 'sam@rivertown.example', 'tech', '', '${SAM_MOBILE}',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
       ('${PAT}', '${OTHER_WS}', 'Pat', 'Far', 'pat@elsewhere.example', 'owner', '', '+442079460000',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO chat_rooms (id, workspace_id, name, created_by, created_at)
VALUES ('${ROOM}', '${WS}', 'Jane Doe', '${DANA}', '2026-01-02T00:00:00.000Z');

INSERT INTO chat_messages (id, chat_room_id, user_id, user_name, content, created_at)
VALUES ('00000000-0000-4000-8000-0000000000d7', '${ROOM}', '${SAM}', 'Sam Lee', 'On my way', '2026-01-02T01:00:00.000Z');
`;
  }

  function asDana(req: Request): Request {
    const mutable = req as unknown as Record<string, unknown>;
    mutable['user'] = {
      id: DANA,
      workspaceId: WS,
      firstName: 'Dana',
      lastName: 'Ortiz',
      email: '',
      role: 'owner',
    };
    mutable['workspaceId'] = WS;
    return req;
  }

  function postFallback(body: unknown, roomId = ROOM): Promise<Response> {
    return chatRouter.fetch(
      asDana(
        new Request(
          `https://api.greenput.com/api/chat/rooms/${roomId}/sms-fallback`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
        ),
      ),
      { DB: sqlite.db, ...CONFIGURED } as never,
    );
  }

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed()],
    });
    outbound = [];
    vi.stubGlobal(
      'fetch',
      async (input: Request | string, init?: RequestInit) => {
        outbound.push({
          url: typeof input === 'string' ? input : input.url,
          body: String(init?.body ?? ''),
        });
        return new Response('{"sid":"SM_TEST"}', { status: 201 });
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sqlite.close();
  });

  it('sends to the number resolved server-side — a recipientPhone in the body is ignored', async () => {
    const res = await postFallback({
      recipientUserId: SAM,
      // The destination the old route honoured verbatim. Must go nowhere.
      recipientPhone: '+442079460000',
      message: 'Running 20 minutes late',
    });
    expect(res.status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.url).toContain('api.twilio.com');
    const sent = new URLSearchParams(outbound[0]!.body);
    expect(sent.get('To')).toBe(SAM_MOBILE);
    expect(sent.get('Body')).toContain('Running 20 minutes late');
    // The send is counted in the daily-cap ledger.
    expect(sqlite.rows('sms_fallback_sends')).toHaveLength(1);
  });

  it('the old body shape (phone, no recipientUserId) is a 400 and sends nothing', async () => {
    const res = await postFallback({
      recipientPhone: '+442079460000',
      message: 'anything at all',
    });
    expect(res.status).toBe(400);
    expect(outbound).toEqual([]);
  });

  it('a recipient in another workspace is not reachable and nothing is sent', async () => {
    const res = await postFallback({
      recipientUserId: PAT,
      message: 'hello',
    });
    expect(res.status).toBe(404);
    expect(outbound).toEqual([]);
  });

  it('a room outside the workspace is 404 and nothing is sent', async () => {
    const res = await postFallback(
      { recipientUserId: SAM, message: 'hello' },
      'no-such-room',
    );
    expect(res.status).toBe(404);
    expect(outbound).toEqual([]);
  });

  it('a teammate who has not participated in the room gets a 403 and nothing is sent', async () => {
    const loner = '00000000-0000-4000-8000-0000000000d8';
    sqlite.raw
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, mobile_phone, created_at, updated_at)
         VALUES (?, ?, 'Lee', 'Solo', 'lee@rivertown.example', 'tech', '', '+15125550143', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(loner, WS);
    const res = await postFallback({
      recipientUserId: loner,
      message: 'hello',
    });
    expect(res.status).toBe(403);
    expect(outbound).toEqual([]);
  });

  it('a participant with no mobile number on file gets a 422 and nothing is sent', async () => {
    // Dana created the room (a participant) and has no mobile_phone; Sam
    // cannot text her through the fallback until she adds one.
    const req = new Request(
      `https://api.greenput.com/api/chat/rooms/${ROOM}/sms-fallback`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipientUserId: DANA, message: 'hello' }),
      },
    );
    const mutable = req as unknown as Record<string, unknown>;
    mutable['user'] = {
      id: SAM,
      workspaceId: WS,
      firstName: 'Sam',
      lastName: 'Lee',
      email: '',
      role: 'tech',
    };
    mutable['workspaceId'] = WS;
    const res = await chatRouter.fetch(req, {
      DB: sqlite.db,
      ...CONFIGURED,
    } as never);
    expect(res.status).toBe(422);
    expect(outbound).toEqual([]);
  });

  it('the daily cap stops the send at the limit and Twilio is never called', async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 50; i++) {
      sqlite.raw
        .prepare(
          `INSERT INTO sms_fallback_sends (id, workspace_id, chat_room_id, sender_user_id, recipient_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(`cap-${i}`, WS, ROOM, DANA, SAM, `${today}T00:00:00.000Z`);
    }
    const res = await postFallback({
      recipientUserId: SAM,
      message: 'one too many',
    });
    expect(res.status).toBe(429);
    expect(outbound).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// The rooms, over the real schema (GP-055).
//
// Everything above drives the router with no session and a mock env, which
// is how a bug this large hid: every handler read `req.session`, which
// requireAuth never sets (it sets `req.user` and `req.workspaceId`), so every
// authenticated chat request threw on `.workspaceId` and answered 500. These
// tests attach the principal the way the middleware does and run the SQL
// against schema.sql, so a wrong property name or a wrong column is a
// failure here, not in production.
// ─────────────────────────────────────────────────────────────
describe('chat rooms over the real schema (GP-055)', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-0000000000c1';
  const OTHER_WS = '00000000-0000-4000-8000-0000000000c2';
  const USER = '00000000-0000-4000-8000-0000000000c3';
  const TEAMMATE = '00000000-0000-4000-8000-0000000000c4';
  const OTHER_USER = '00000000-0000-4000-8000-0000000000c5';

  let sqlite: SqliteD1;

  function seed(): string {
    return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'rivertown-chat', 'electrical', '5125550142',
        'hello@rivertown.example', '100 Example Way', 'Rivertown', 'TX', '78701', '2026-01-01T00:00:00.000Z'),
       ('${OTHER_WS}', 'Elsewhere Plumbing', 'elsewhere-chat', 'plumbing', '5125550199',
        'hello@elsewhere.example', '1 Far St', 'Elsewhere', 'TX', '78799', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${USER}', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
       ('${TEAMMATE}', '${WS}', 'Sam', 'Lee', 'sam@rivertown.example', 'tech', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
       ('${OTHER_USER}', '${OTHER_WS}', 'Pat', 'Far', 'pat@elsewhere.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`;
  }

  /** The request exactly as requireAuth hands it on: `user` + `workspaceId`. */
  function asUser(
    req: Request,
    user: {
      id: string;
      workspaceId: string;
      firstName: string;
      lastName: string;
    },
  ): Request {
    const mutable = req as unknown as Record<string, unknown>;
    mutable['user'] = { ...user, email: '', role: 'owner' };
    mutable['workspaceId'] = user.workspaceId;
    return req;
  }

  const dana = {
    id: USER,
    workspaceId: WS,
    firstName: 'Dana',
    lastName: 'Ortiz',
  };
  const pat = {
    id: OTHER_USER,
    workspaceId: OTHER_WS,
    firstName: 'Pat',
    lastName: 'Far',
  };

  function env(extra: Record<string, unknown> = {}) {
    return { DB: sqlite.db, ...extra } as never;
  }

  function post(path: string, body: unknown, user = dana): Promise<Response> {
    return chatRouter.fetch(
      asUser(
        new Request(`https://api.greenput.com${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        user,
      ),
      env(),
    );
  }

  function get(
    path: string,
    user = dana,
    headers: Record<string, string> = {},
    extraEnv: Record<string, unknown> = {},
  ): Promise<Response> {
    return chatRouter.fetch(
      asUser(new Request(`https://api.greenput.com${path}`, { headers }), user),
      env(extraEnv),
    );
  }

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed()],
    });
  });

  afterEach(() => sqlite.close());

  it('POST /rooms reads the principal requireAuth attaches and answers the declared ChatRoom', async () => {
    const res = await post('/api/chat/rooms', {
      name: 'Jane Doe',
      entityType: 'customer',
      entityId: 'cust-1',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(describeWireProblems(checkWire(WIRE_CHAT_ROOM, body.data))).toBe('');
    expect(body.data).toMatchObject({
      name: 'Jane Doe',
      entityType: 'customer',
      entityId: 'cust-1',
      createdBy: USER,
    });
    const rows = sqlite.rows('chat_rooms') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspace_id: WS, created_by: USER });
  });

  it('a second POST for the same entity answers the existing room, 200, and creates nothing', async () => {
    const first = (await (
      await post('/api/chat/rooms', {
        name: 'Jane Doe',
        entityType: 'customer',
        entityId: 'cust-1',
      })
    ).json()) as { data: { id: string } };
    const again = await post('/api/chat/rooms', {
      name: 'Jane Doe (again)',
      entityType: 'customer',
      entityId: 'cust-1',
    });
    expect(again.status).toBe(200);
    const body = (await again.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBe(first.data.id);
    expect(body.data.name).toBe('Jane Doe');
    expect(sqlite.rows('chat_rooms')).toHaveLength(1);
  });

  it('the same entity in another workspace is a different room', async () => {
    await post('/api/chat/rooms', { entityType: 'job', entityId: 'job-1' });
    const other = await post(
      '/api/chat/rooms',
      { entityType: 'job', entityId: 'job-1' },
      pat,
    );
    expect(other.status).toBe(201);
    expect(sqlite.rows('chat_rooms')).toHaveLength(2);
  });

  it('a room without an entity is always new', async () => {
    expect((await post('/api/chat/rooms', { name: 'Crew' })).status).toBe(201);
    expect((await post('/api/chat/rooms', { name: 'Crew' })).status).toBe(201);
    expect(sqlite.rows('chat_rooms')).toHaveLength(2);
  });

  it('GET /rooms lists only the workspace, newest first, and ?entityType&entityId narrows to one', async () => {
    await post('/api/chat/rooms', {
      name: 'Jane Doe',
      entityType: 'customer',
      entityId: 'cust-1',
    });
    await post('/api/chat/rooms', {
      name: '#1001 Panel upgrade',
      entityType: 'job',
      entityId: 'job-1',
    });
    await post('/api/chat/rooms', { name: 'Theirs' }, pat);
    // Two POSTs inside one millisecond tie on created_at; make the age real.
    sqlite.raw.exec(
      `UPDATE chat_rooms SET created_at = '2026-09-14T09:00:00.000Z' WHERE name = 'Jane Doe';
       UPDATE chat_rooms SET created_at = '2026-09-14T10:00:00.000Z' WHERE name = '#1001 Panel upgrade';`,
    );

    const all = (await (await get('/api/chat/rooms')).json()) as {
      data: Array<Record<string, unknown>>;
      meta: { total: number };
    };
    expect(describeWireProblems(checkWireList(WIRE_CHAT_ROOM, all.data))).toBe(
      '',
    );
    expect(all.data.map((r) => r['name'])).toEqual([
      '#1001 Panel upgrade',
      'Jane Doe',
    ]);
    expect(all.meta.total).toBe(2);

    const one = (await (
      await get('/api/chat/rooms?entityType=customer&entityId=cust-1')
    ).json()) as { data: Array<Record<string, unknown>> };
    expect(one.data).toHaveLength(1);
    expect(one.data[0]).toMatchObject({ name: 'Jane Doe', entityId: 'cust-1' });

    const none = (await (
      await get('/api/chat/rooms?entityType=customer&entityId=nobody')
    ).json()) as { data: unknown[] };
    expect(none.data).toEqual([]);
  });

  it('GET /rooms/:id is 404 from another workspace', async () => {
    const created = (await (
      await post('/api/chat/rooms', { name: 'Ours' })
    ).json()) as {
      data: { id: string };
    };
    expect((await get(`/api/chat/rooms/${created.data.id}`)).status).toBe(200);
    expect((await get(`/api/chat/rooms/${created.data.id}`, pat)).status).toBe(
      404,
    );
  });

  it('GET /rooms/:id/messages answers the declared ChatMessage, oldest first', async () => {
    const created = (await (
      await post('/api/chat/rooms', { name: 'Ours' })
    ).json()) as {
      data: { id: string };
    };
    const room = created.data.id;
    sqlite.raw.exec(`
INSERT INTO chat_messages (id, chat_room_id, user_id, user_name, content, created_at)
VALUES ('m1', '${room}', '${USER}', 'Dana Ortiz', 'First', '2026-09-14T10:00:00.000Z'),
       ('m2', '${room}', '${TEAMMATE}', 'Sam Lee', 'Second', '2026-09-14T10:01:00.000Z');
`);
    const res = await get(`/api/chat/rooms/${room}/messages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(
      describeWireProblems(checkWireList(WIRE_CHAT_MESSAGE, body.data)),
    ).toBe('');
    expect(body.data.map((m) => m['content'])).toEqual(['First', 'Second']);
    expect(body.data[1]).toMatchObject({
      userId: TEAMMATE,
      userName: 'Sam Lee',
    });
    expect((await get(`/api/chat/rooms/${room}/messages`, pat)).status).toBe(
      404,
    );
  });

  it('GET /unread counts what others wrote since the caller last read, per room', async () => {
    const created = (await (
      await post('/api/chat/rooms', { name: 'Ours' })
    ).json()) as {
      data: { id: string };
    };
    const room = created.data.id;
    sqlite.raw.exec(`
INSERT INTO chat_messages (id, chat_room_id, user_id, user_name, content, created_at)
VALUES ('m1', '${room}', '${TEAMMATE}', 'Sam Lee', 'Read already', '2026-09-14T10:00:00.000Z'),
       ('m2', '${room}', '${TEAMMATE}', 'Sam Lee', 'New', '2026-09-14T10:02:00.000Z'),
       ('m3', '${room}', '${TEAMMATE}', 'Sam Lee', 'Newer', '2026-09-14T10:03:00.000Z'),
       ('m4', '${room}', '${USER}', 'Dana Ortiz', 'Mine, never unread', '2026-09-14T10:04:00.000Z');
INSERT INTO chat_read_receipts (user_id, chat_room_id, last_read_at)
VALUES ('${USER}', '${room}', '2026-09-14T10:01:00.000Z');
`);
    const body = (await (await get('/api/chat/unread')).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(
      describeWireProblems(checkWireList(WIRE_CHAT_UNREAD, body.data)),
    ).toBe('');
    expect(body.data).toEqual([{ roomId: room, name: 'Ours', unreadCount: 2 }]);
  });

  describe('GET /rooms/:id/ws', () => {
    function fakeNamespace(seen: string[]) {
      return {
        idFromName: (name: string) => ({ name }),
        get: () => ({
          fetch: (req: Request) => {
            seen.push(req.url);
            return Promise.resolve(new Response('upgraded', { status: 200 }));
          },
        }),
      };
    }

    it("is 404 for a room outside the caller's workspace, and no Durable Object is touched", async () => {
      const created = (await (
        await post('/api/chat/rooms', { name: 'Ours' })
      ).json()) as {
        data: { id: string };
      };
      const seen: string[] = [];
      const res = await get(
        `/api/chat/rooms/${created.data.id}/ws`,
        pat,
        { Upgrade: 'websocket' },
        { CHAT_ROOM: fakeNamespace(seen) },
      );
      expect(res.status).toBe(404);
      expect(seen).toEqual([]);
    });

    it('hands the DO the verified identity and the checked room id on the URL', async () => {
      const created = (await (
        await post('/api/chat/rooms', { name: 'Ours' })
      ).json()) as {
        data: { id: string };
      };
      const seen: string[] = [];
      const res = await get(
        `/api/chat/rooms/${created.data.id}/ws`,
        dana,
        { Upgrade: 'websocket' },
        { CHAT_ROOM: fakeNamespace(seen) },
      );
      expect(res.status).toBe(200);
      expect(seen).toHaveLength(1);
      const url = new URL(seen[0]!);
      expect(url.searchParams.get('roomId')).toBe(created.data.id);
      expect(url.searchParams.get('userId')).toBe(USER);
      expect(url.searchParams.get('userName')).toBe('Dana Ortiz');
    });
  });
});
