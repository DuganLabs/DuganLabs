import type { Env } from '../env';

interface Participant {
  userId: string;
  name: string;
  /**
   * The room this socket was upgraded for, from the URL the chat router
   * built after checking the room against the caller's workspace. When
   * present it wins over the `roomId` in any frame — a client naming another
   * room's id in `join` / `text` must not read or write it.
   */
  roomId?: string;
  /** True when the URL carried a verified identity; `join` cannot override it then. */
  verified: boolean;
  sessionId?: string;
  tracks: { trackName: string; mid: string; kind: 'audio' | 'video' }[];
}

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

interface StoredMessage {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
}

export class ChatRoom {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private readonly sessions = new Map<WebSocket, Participant>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/ws')) {
      return this.handleWebSocket(request, url);
    }

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocket(request: Request, url: URL): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server);

    const userId = url.searchParams.get('userId') ?? '';
    const userName = url.searchParams.get('userName') ?? 'Anonymous';
    const roomId = url.searchParams.get('roomId') ?? undefined;

    const participant: Participant = {
      userId,
      name: userName,
      roomId,
      verified: userId !== '',
      tracks: [],
    };
    this.sessions.set(server, participant);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    rawMessage: string | ArrayBuffer,
  ): Promise<void> {
    const participant = this.sessions.get(ws);
    if (!participant) return;

    let msg: WsMessage;
    try {
      msg = JSON.parse(
        typeof rawMessage === 'string'
          ? rawMessage
          : new TextDecoder().decode(rawMessage),
      ) as WsMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, participant, msg);
        break;

      case 'session-created':
        participant.sessionId = msg.sessionId as string;
        this.broadcast(
          {
            type: 'participant-session',
            name: participant.name,
            userId: participant.userId,
            sessionId: participant.sessionId,
          },
          ws,
        );
        break;

      case 'tracks-published':
        participant.tracks = msg.tracks as Participant['tracks'];
        this.broadcast(
          {
            type: 'new-tracks',
            name: participant.name,
            userId: participant.userId,
            sessionId: participant.sessionId,
            tracks: participant.tracks,
          },
          ws,
        );
        break;

      case 'text':
        await this.handleText(ws, participant, msg);
        break;

      case 'typing':
        this.broadcast(
          {
            type: 'typing',
            userId: participant.userId,
            name: participant.name,
          },
          ws,
        );
        break;

      case 'read-receipt':
        await this.handleReadReceipt(ws, participant, msg);
        break;

      default:
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const participant = this.sessions.get(ws);
    if (participant) {
      this.broadcast(
        {
          type: 'participant-left',
          userId: participant.userId,
          name: participant.name,
        },
        ws,
      );
      this.sessions.delete(ws);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async handleJoin(
    ws: WebSocket,
    participant: Participant,
    msg: WsMessage,
  ): Promise<void> {
    if (!participant.verified) {
      if (msg.name) participant.name = msg.name as string;
      if (msg.userId) participant.userId = msg.userId as string;
    }

    this.broadcast(
      {
        type: 'participant-joined',
        userId: participant.userId,
        name: participant.name,
      },
      ws,
    );

    const roomId = participant.roomId ?? (msg.roomId as string | undefined);
    let recentMessages: StoredMessage[] = [];

    if (roomId) {
      try {
        const { results } = await this.env.DB.prepare(
          `SELECT id, user_id, user_name, content, created_at
           FROM chat_messages
           WHERE chat_room_id = ?
           ORDER BY created_at DESC
           LIMIT 50`,
        )
          .bind(roomId)
          .all();

        recentMessages = (results ?? []).reverse().map((r) => ({
          id: r.id as string,
          userId: r.user_id as string,
          userName: r.user_name as string,
          content: r.content as string,
          createdAt: r.created_at as string,
        }));
      } catch {
        // D1 may not be available in some contexts
      }
    }

    ws.send(
      JSON.stringify({
        type: 'room-state',
        participants: [...this.sessions.values()].map((p) => ({
          userId: p.userId,
          name: p.name,
          sessionId: p.sessionId,
          tracks: p.tracks,
        })),
        messages: recentMessages,
      }),
    );
  }

  private async handleText(
    ws: WebSocket,
    participant: Participant,
    msg: WsMessage,
  ): Promise<void> {
    const text = msg.text as string;
    if (!text?.trim()) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const roomId = participant.roomId ?? (msg.roomId as string | undefined);

    const entry: StoredMessage = {
      id,
      userId: participant.userId,
      userName: participant.name,
      content: text,
      createdAt: now,
    };

    // Persist to D1
    if (roomId) {
      try {
        await this.env.DB.prepare(
          `INSERT INTO chat_messages (id, chat_room_id, user_id, user_name, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(id, roomId, participant.userId, participant.name, text, now)
          .run();
      } catch {
        // D1 write failed — message still broadcast in real-time
      }
    }

    this.broadcast({ type: 'text', ...entry });
  }

  private async handleReadReceipt(
    ws: WebSocket,
    participant: Participant,
    msg: WsMessage,
  ): Promise<void> {
    const roomId = participant.roomId ?? (msg.roomId as string | undefined);
    const now = new Date().toISOString();

    if (roomId && participant.userId) {
      try {
        await this.env.DB.prepare(
          `INSERT INTO chat_read_receipts (user_id, chat_room_id, last_read_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, chat_room_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
        )
          .bind(participant.userId, roomId, now)
          .run();
      } catch {
        // D1 write failed
      }
    }

    this.broadcast(
      {
        type: 'read-receipt',
        userId: participant.userId,
        name: participant.name,
        lastReadAt: now,
      },
      ws,
    );
  }

  private broadcast(msg: Record<string, unknown>, exclude?: WebSocket): void {
    const payload = JSON.stringify(msg);
    for (const [socket] of this.sessions) {
      if (socket === exclude) continue;
      try {
        socket.send(payload);
      } catch {
        // dead socket — will be cleaned up on close
      }
    }
  }
}
