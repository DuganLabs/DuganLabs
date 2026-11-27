/**
 * `/chat/:id` — WebSocket-backed messaging + Cloudflare Calls WebRTC video.
 *
 * Reached from `/chat` (the list) and from the Message action on a customer
 * or a job (GP-055); the header names the room and links back to what it
 * is about.
 *
 * Architecture:
 *   - Durable Object WS at `wss://api.greenput.com/api/chat/rooms/:id/ws`
 *     carries join, text, typing, read-receipt, participant-* events. The
 *     socket goes to the API ORIGIN (`chatSocketUrl`), not the page's host:
 *     on app.greenput.com the API is a different origin, and a socket to
 *     `window.location.host` would be answered by the static site.
 *   - WebRTC offer/answer flows through Cloudflare Calls via the
 *     `/session`, `/tracks/publish`, `/tracks/pull`, `/renegotiate`
 *     endpoints. Each user publishes their own audio + video tracks
 *     and pulls every remote participant's tracks.
 *   - On disconnect we close the peer connection, stop local tracks,
 *     and back off reconnection up to 5 attempts.
 *
 * Reconnect: exponential backoff (2^attempt * 1s, capped at 30s).
 */

import { computed, effect, signal } from '@basenative/runtime';
import { createResource, resolveGreenPutApiBase } from '@basenative/fetch';
import type { ChatMessage, ChatRoom } from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { formatRelativeTime } from '../../lib/format.js';
import type { RouteView } from '../types.js';

interface RemoteParticipant {
  userId: string;
  name: string;
  sessionId?: string;
  tracks: { trackName: string; mid: string; kind: 'audio' | 'video' }[];
}

interface ReadReceipt {
  userId: string;
  name: string;
  lastReadAt: string;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const TYPING_CLEAR_MS = 3000;

/** What the route says when the API answers `CALLS_NOT_CONFIGURED`. */
export const VIDEO_UNAVAILABLE_MESSAGE =
  'Video calling is not set up for this workspace yet. Messaging still works.';

/**
 * The WebSocket address for a room: the same origin every other request
 * goes to (`resolveGreenPutApiBase`), with `wss:` in place of `https:`. When
 * the resolver has no answer — localhost, the static e2e build — the API is
 * served from the page's own host, and the socket follows the page's scheme.
 */
export function chatSocketUrl(
  roomId: string,
  options: {
    readonly apiBase?: string;
    readonly location?: { readonly protocol: string; readonly host: string };
  } = {},
): string {
  const apiBase = options.apiBase ?? resolveGreenPutApiBase();
  const location = options.location ?? window.location;
  const origin = apiBase
    ? apiBase.replace(/^http/, 'ws')
    : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
  return `${origin}/api/chat/rooms/${encodeURIComponent(roomId)}/ws`;
}

/** Where the room's subject lives, for the header link. */
export function subjectHref(
  room: Pick<ChatRoom, 'entityType' | 'entityId'>,
): { readonly href: string; readonly label: string } | null {
  if (!room.entityId) return null;
  if (room.entityType === 'customer') {
    return { href: `/customers/${room.entityId}`, label: 'Open customer' };
  }
  if (room.entityType === 'job') {
    return { href: `/jobs/${room.entityId}`, label: 'Open job' };
  }
  return null;
}

const CHAT_SHEET = defineSheet(`
[data-bn-chat] {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: calc(100dvh - var(--gp-shell-h));
  background: var(--gp-surface);
}
[data-bn-chat-header] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--gp-space-3) var(--gp-space-5);
  border-bottom: 1px solid var(--gp-rule);
  gap: var(--gp-space-3);
}
[data-bn-chat-header] h1 {
  margin: 0;
  font-family: var(--gp-font-display);
  font-size: var(--gp-text-xl);
}
[data-bn-chat-header] [data-bn-secondary] { font-size: var(--gp-text-sm); }
[data-bn-chat-header] [data-bn-chat-back] {
  display: inline-flex;
  align-items: center;
  min-block-size: var(--gp-tap-min);
  color: var(--gp-text-muted);
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-medium);
  text-decoration: none;
}
[data-bn-chat-header] [data-bn-chat-back]:hover,
[data-bn-chat-header] [data-bn-chat-back]:focus-visible {
  color: var(--gp-primary);
  text-decoration: underline;
}
[data-bn-chat-body] {
  display: grid;
  grid-template-columns: 1fr 18rem;
  min-height: 0;
}
[data-bn-chat-stream] {
  display: grid;
  grid-template-rows: 1fr auto;
  min-height: 0;
}
[data-bn-chat-messages] {
  overflow-y: auto;
  padding: var(--gp-space-4);
  display: grid;
  gap: var(--gp-space-2);
  align-content: end;
}
[data-bn-chat-msg] {
  max-width: 75%;
  padding: var(--gp-space-2) var(--gp-space-3);
  border-radius: var(--gp-radius-md);
  background: var(--gp-surface-sunk);
  display: grid;
  gap: 2px;
}
[data-bn-chat-msg][data-bn-own] {
  justify-self: end;
  background: var(--gp-primary);
  color: var(--gp-primary-fg);
}
[data-bn-chat-msg] strong { font-size: var(--gp-text-xs); opacity: 0.8; }
[data-bn-chat-msg] [data-bn-msg-meta] {
  font-size: 0.6875rem;
  opacity: 0.6;
}
[data-bn-typing] {
  padding: var(--gp-space-2) var(--gp-space-4);
  font-size: var(--gp-text-sm);
  color: var(--gp-text-muted);
  font-style: italic;
}
[data-bn-chat-input] {
  display: flex;
  gap: var(--gp-space-2);
  padding: var(--gp-space-3) var(--gp-space-4);
  border-top: 1px solid var(--gp-rule);
}
[data-bn-chat-input] input {
  flex: 1;
}
[data-bn-chat-side] {
  display: grid;
  grid-template-rows: auto 1fr auto;
  border-inline-start: 1px solid var(--gp-rule);
  background: var(--gp-ink-25);
}
[data-bn-call-area] {
  padding: var(--gp-space-3);
  display: grid;
  gap: var(--gp-space-2);
  border-bottom: 1px solid var(--gp-rule);
}
[data-bn-call-area][hidden] { display: none; }
[data-bn-call-area] video {
  width: 100%;
  background: var(--gp-surface-ink);
  border-radius: var(--gp-radius-md);
  aspect-ratio: 16 / 10;
  object-fit: cover;
}
[data-bn-participants] {
  padding: var(--gp-space-3);
  overflow-y: auto;
  display: grid;
  gap: var(--gp-space-2);
  align-content: start;
}
[data-bn-participant] {
  display: flex;
  align-items: center;
  gap: var(--gp-space-2);
  padding: var(--gp-space-2);
  border-radius: var(--gp-radius-md);
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
}
[data-bn-participant] [data-bn-avatar] {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--gp-radius-full);
  background: var(--gp-primary);
  color: var(--gp-primary-fg);
  display: grid;
  place-items: center;
  font-size: var(--gp-text-xs);
  font-weight: 600;
}
[data-bn-call-actions] {
  display: flex;
  gap: var(--gp-space-2);
  padding: var(--gp-space-3);
  border-top: 1px solid var(--gp-rule);
}
[data-bn-call-actions] [data-bn-button] { flex: 1; }
[data-bn-call-actions] [data-bn-button][data-bn-active] {
  background: var(--gp-success);
  color: white;
}
[data-bn-readers] {
  font-size: var(--gp-text-xs);
  color: var(--gp-text-muted);
  padding: 0 var(--gp-space-4) var(--gp-space-2);
}
[data-bn-status-pill] {
  display: inline-flex;
  align-items: center;
  gap: var(--gp-space-1);
  padding: 2px var(--gp-space-2);
  border-radius: var(--gp-radius-full);
  background: var(--gp-null-bg);
  font-size: var(--gp-text-xs);
}
[data-bn-status-pill][data-bn-online]::before {
  content: '';
  width: 0.4rem;
  height: 0.4rem;
  border-radius: var(--gp-radius-full);
  background: var(--gp-success);
}
[data-bn-status-pill][data-bn-offline]::before {
  content: '';
  width: 0.4rem;
  height: 0.4rem;
  border-radius: var(--gp-radius-full);
  background: var(--gp-text-subtle);
}
@media (max-width: 720px) {
  [data-bn-chat-body] { grid-template-columns: 1fr; }
  [data-bn-chat-side] { display: none; }
}
`);

export interface ChatRouteParams {
  readonly id: string;
}

export function renderChatRoute(
  deps: PlatformDeps,
  params: ChatRouteParams,
): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(CHAT_SHEET);

  const roomId = params.id;
  const cleanups: Cleanup[] = [];

  const connecting = signal(false);
  const joined = signal(false);
  const callActive = signal(false);
  const audioEnabled = signal(true);
  const videoEnabled = signal(true);
  const errorMsg = signal<string | null>(null);
  const messages = signal<ChatMessage[]>([]);
  const participants = signal<RemoteParticipant[]>([]);
  const typingUsers = signal<string[]>([]);
  const readReceipts = signal<ReadReceipt[]>([]);
  const messageInput = signal('');

  const currentUser = computed(() => {
    const u = deps.auth.user();
    return {
      id: u?.id ?? 'guest',
      name: u ? `${u.firstName} ${u.lastName}` : 'Anonymous',
    };
  });

  // ── the room itself: its name, and what it is about ────────────────────
  const roomResource = createResource<{ data: ChatRoom }>(
    () => deps.chat.getRoom(roomId),
    { auto: true },
  );

  // ── DOM scaffolding ────────────────────────────────────────────────────
  const backLink = el(
    'a',
    { href: '/chat', 'data-bn-chat-back': '', 'data-testid': 'chat-back' },
    '← Messages',
  );
  const headerTitle = el(
    'h1',
    { 'data-testid': 'chat-heading' },
    `Room ${roomId.slice(0, 8)}`,
  );
  const subject = el('span', {
    'data-bn-secondary': '',
    'data-testid': 'chat-subject',
  });
  cleanups.push(
    effect(() => {
      const room = roomResource.data()?.data;
      clear(subject);
      if (!room || typeof room.name !== 'string') return;
      headerTitle.textContent = room.name;
      const link = subjectHref(room);
      if (link) subject.append(el('a', { href: link.href }, link.label));
    }).dispose,
  );
  const statusPill = el('span', { 'data-bn-status-pill': '' });

  const messagesContainer = el('div', { 'data-bn-chat-messages': '' });
  const typingNode = el('p', { 'data-bn-typing': '', hidden: true });
  const messageField = el('input', {
    type: 'text',
    'data-bn-input': '',
    placeholder: 'Type a message…',
    'data-testid': 'chat-input',
    'aria-label': 'Message',
  }) as HTMLInputElement;
  on(messageField, 'input', () => messageInput.set(messageField.value));

  let typingTimeout: ReturnType<typeof setTimeout> | null = null;
  on(messageField, 'keydown', () => {
    if (!ws) return;
    if (typingTimeout) clearTimeout(typingTimeout);
    sendMessage('typing');
    typingTimeout = setTimeout(() => {
      typingTimeout = null;
    }, 1500);
  });

  const sendBtn = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'chat-send',
    },
    'Send',
  );

  const messageForm = el(
    'form',
    { 'data-bn-chat-input': '' },
    messageField,
    sendBtn,
  );
  on(messageForm, 'submit', (event) => {
    event.preventDefault();
    sendText();
  });

  const localVideo = el('video', {
    autoplay: 'true',
    muted: 'true',
    playsinline: 'true',
    'data-bn-local-video': '',
  }) as HTMLVideoElement;

  const callActions = el('div', { 'data-bn-call-actions': '' });
  const startCallBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'chat-start-call',
    },
    'Start video call',
  );
  const audioToggle = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'chat-toggle-audio',
    },
    'Mute',
  );
  const videoToggle = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'chat-toggle-video',
    },
    'Camera off',
  );
  const hangupBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'danger',
      'data-testid': 'chat-hangup',
    },
    'Hang up',
  );

  function syncCallActions(): void {
    clear(callActions);
    if (!callActive()) {
      callActions.append(startCallBtn);
    } else {
      callActions.append(audioToggle, videoToggle, hangupBtn);
    }
  }
  syncCallActions();
  cleanups.push(
    effect(() => {
      callActive();
      syncCallActions();
    }).dispose,
  );

  const participantsList = el('div', { 'data-bn-participants': '' });
  const callArea = el(
    'div',
    { 'data-bn-call-area': '', hidden: true },
    el('p', { 'data-bn-secondary': '' }, 'Your camera (visible only to you).'),
    localVideo,
  );
  cleanups.push(
    effect(() => {
      if (callActive()) callArea.removeAttribute('hidden');
      else callArea.setAttribute('hidden', '');
    }).dispose,
  );

  const side = el(
    'aside',
    { 'data-bn-chat-side': '' },
    callArea,
    participantsList,
    callActions,
  );

  const readers = el('div', { 'data-bn-readers': '' });
  const stream = el(
    'div',
    { 'data-bn-chat-stream': '' },
    messagesContainer,
    readers,
    typingNode,
    messageForm,
  );

  const root = el(
    'section',
    { 'data-bn-chat': '', 'data-bn-route': 'chat' },
    el(
      'header',
      { 'data-bn-chat-header': '' },
      el('div', {}, backLink, headerTitle, subject),
      statusPill,
    ),
    el('div', { 'data-bn-chat-body': '' }, stream, side),
    el('output', {
      'data-bn-error': '',
      role: 'alert',
      hidden: true,
      'data-testid': 'chat-error',
    }),
  );

  // ── reactive bindings ──────────────────────────────────────────────────
  cleanups.push(
    effect(() => {
      const ok = joined();
      statusPill.setAttribute(ok ? 'data-bn-online' : 'data-bn-offline', '');
      statusPill.removeAttribute(ok ? 'data-bn-offline' : 'data-bn-online');
      statusPill.textContent = connecting()
        ? 'Connecting…'
        : ok
          ? 'Connected'
          : 'Disconnected';
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      audioToggle.textContent = audioEnabled() ? 'Mute' : 'Unmute';
      videoToggle.textContent = videoEnabled() ? 'Camera off' : 'Camera on';
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const list = messages();
      const me = currentUser();
      clear(messagesContainer);
      for (const msg of list) {
        const own = msg.userId === me.id;
        messagesContainer.append(
          el(
            'div',
            {
              'data-bn-chat-msg': '',
              'data-bn-own': own ? '' : null,
            },
            own ? null : el('strong', {}, msg.userName),
            el('span', {}, msg.content),
            el(
              'span',
              { 'data-bn-msg-meta': '' },
              formatRelativeTime(msg.createdAt),
            ),
          ),
        );
      }
      requestAnimationFrame(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      });
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const list = participants();
      clear(participantsList);
      participantsList.append(
        el('p', { 'data-bn-secondary': '' }, `${list.length + 1} in room`),
      );
      const me = currentUser();
      participantsList.append(participantNode(me.name, true));
      for (const p of list) {
        participantsList.append(participantNode(p.name, false));
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const names = typingUsers();
      if (names.length === 0) {
        typingNode.setAttribute('hidden', '');
        return;
      }
      typingNode.removeAttribute('hidden');
      typingNode.textContent =
        names.length === 1
          ? `${names[0]} is typing…`
          : `${names.join(', ')} are typing…`;
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const list = readReceipts();
      const me = currentUser();
      const others = list.filter((r) => r.userId !== me.id);
      readers.textContent = others.length
        ? `Read by ${others.map((r) => r.name).join(', ')}`
        : '';
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const message = errorMsg();
      const node = root.querySelector(
        '[data-testid="chat-error"]',
      ) as HTMLElement;
      if (message) {
        node.textContent = message;
        node.removeAttribute('hidden');
      } else {
        node.setAttribute('hidden', '');
      }
    }).dispose,
  );

  // ── WebSocket + WebRTC plumbing ────────────────────────────────────────
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let localStream: MediaStream | null = null;
  let sessionId: string | null = null;
  let reconnectAttempts = 0;
  const typingClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function sendMessage(
    type: string,
    extra: Record<string, unknown> = {},
  ): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...extra }));
  }

  function sendText(): void {
    const text = messageInput.peek().trim();
    if (!text || !ws) return;
    sendMessage('text', { text, roomId });
    messages.set([
      ...messages.peek(),
      {
        id: crypto.randomUUID(),
        userId: currentUser().id,
        userName: currentUser().name,
        content: text,
        createdAt: new Date().toISOString(),
      },
    ]);
    messageInput.set('');
    messageField.value = '';
  }

  function joinRoom(): void {
    if (typeof WebSocket === 'undefined') return;
    connecting.set(true);
    errorMsg.set(null);
    const wsUrl = chatSocketUrl(roomId);
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      errorMsg.set(err instanceof Error ? err.message : 'WebSocket failed.');
      connecting.set(false);
      return;
    }
    ws.onopen = () => {
      const me = currentUser();
      ws?.send(
        JSON.stringify({
          type: 'join',
          roomId,
          userId: me.id,
          name: me.name,
        }),
      );
      joined.set(true);
      connecting.set(false);
      reconnectAttempts = 0;
    };
    ws.onerror = () => {
      errorMsg.set('WebSocket connection failed.');
      connecting.set(false);
    };
    ws.onclose = () => {
      joined.set(false);
      callActive.set(false);
      attemptReconnect();
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>;
        handleMessage(data);
      } catch {
        // ignore malformed
      }
    };
  }

  function attemptReconnect(): void {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
    setTimeout(() => {
      if (!joined.peek()) joinRoom();
    }, delay);
  }

  function handleMessage(msg: Record<string, unknown>): void {
    const type = String(msg['type']);
    switch (type) {
      case 'room-state': {
        const history = msg['messages'] as ChatMessage[] | undefined;
        if (history) messages.set(history);
        const existing = msg['participants'] as RemoteParticipant[] | undefined;
        if (existing) {
          participants.set(
            existing.filter((p) => p.userId !== currentUser().id),
          );
        }
        sendMessage('read-receipt', { roomId });
        break;
      }
      case 'participant-joined': {
        participants.set([
          ...participants.peek(),
          {
            userId: String(msg['userId']),
            name: String(msg['name']),
            tracks: [],
          },
        ]);
        break;
      }
      case 'participant-left': {
        const id = String(msg['userId']);
        participants.set(participants.peek().filter((p) => p.userId !== id));
        break;
      }
      case 'text': {
        const senderId = String(msg['userId']);
        if (senderId === currentUser().id) break;
        messages.set([
          ...messages.peek(),
          {
            id: String(msg['id']),
            userId: senderId,
            userName: String(msg['userName']),
            content: String(msg['content']),
            createdAt: String(msg['createdAt']),
          },
        ]);
        sendMessage('read-receipt', { roomId });
        break;
      }
      case 'typing': {
        const id = String(msg['userId']);
        const name = String(msg['name']);
        if (id === currentUser().id) break;
        const current = typingUsers.peek();
        if (!current.includes(name)) typingUsers.set([...current, name]);
        const existing = typingClearTimers.get(id);
        if (existing) clearTimeout(existing);
        typingClearTimers.set(
          id,
          setTimeout(() => {
            typingUsers.set(typingUsers.peek().filter((n) => n !== name));
            typingClearTimers.delete(id);
          }, TYPING_CLEAR_MS),
        );
        break;
      }
      case 'read-receipt': {
        const receipt: ReadReceipt = {
          userId: String(msg['userId']),
          name: String(msg['name']),
          lastReadAt: String(msg['lastReadAt']),
        };
        const filtered = readReceipts
          .peek()
          .filter((r) => r.userId !== receipt.userId);
        readReceipts.set([...filtered, receipt]);
        break;
      }
    }
  }

  async function startCall(): Promise<void> {
    errorMsg.set(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      errorMsg.set('Camera + microphone access requires HTTPS.');
      return;
    }
    try {
      // The Calls session first, the camera second: a workspace whose API
      // Worker has no CALLS_APP_ID answers 503 CALLS_NOT_CONFIGURED, and
      // that is said plainly here before anyone is asked for their camera.
      const sessionRes = await deps.chat.createSession(roomId);
      sessionId = sessionRes.data.sessionId ?? null;
      if (!sessionId) throw new Error('No session ID returned.');

      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      localVideo.srcObject = localStream;

      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      });
      const transceivers: { mid: string; kind: string; trackName: string }[] =
        [];
      const me = currentUser();
      for (const track of localStream.getTracks()) {
        const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });
        transceivers.push({
          mid: transceiver.mid ?? '0',
          kind: track.kind,
          trackName: `${me.name}-${track.kind}`,
        });
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const publishRes = await deps.chat.publishTracks(roomId, {
        sessionId,
        sdpOffer: offer.sdp ?? '',
        tracks: transceivers.map((t) => ({
          location: 'local',
          mid: t.mid,
          trackName: t.trackName,
        })),
      });
      if (publishRes.data.sdpAnswer) {
        await pc.setRemoteDescription({
          type: 'answer',
          sdp: publishRes.data.sdpAnswer,
        });
      }
      sendMessage('session-created', { sessionId });
      sendMessage('tracks-published', {
        tracks: transceivers.map((t) => ({
          trackName: t.trackName,
          mid: t.mid,
          kind: t.kind,
        })),
      });
      callActive.set(true);
    } catch (err) {
      errorMsg.set(
        err instanceof Error &&
          'code' in err &&
          err.code === 'CALLS_NOT_CONFIGURED'
          ? VIDEO_UNAVAILABLE_MESSAGE
          : err instanceof Error
            ? err.message
            : 'Could not start call.',
      );
      sessionId = null;
      stopLocalStream();
    }
  }

  function toggleAudio(): void {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    audioEnabled.set(track.enabled);
  }
  function toggleVideo(): void {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    videoEnabled.set(track.enabled);
  }
  function stopLocalStream(): void {
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
  function hangup(): void {
    pc?.close();
    pc = null;
    sessionId = null;
    stopLocalStream();
    callActive.set(false);
  }

  cleanups.push(
    on(startCallBtn, 'click', () => {
      void startCall();
    }),
    on(audioToggle, 'click', toggleAudio),
    on(videoToggle, 'click', toggleVideo),
    on(hangupBtn, 'click', hangup),
  );

  joinRoom();

  return {
    element: root,
    dispose: () => {
      reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
      ws?.close();
      ws = null;
      hangup();
      typingClearTimers.forEach((t) => clearTimeout(t));
      typingClearTimers.clear();
      roomResource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

function participantNode(name: string, self: boolean): HTMLElement {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return el(
    'div',
    { 'data-bn-participant': '' },
    el('span', { 'data-bn-avatar': '', 'aria-hidden': 'true' }, initials),
    el(
      'div',
      {},
      el('strong', {}, name),
      self ? el('span', { 'data-bn-secondary': '' }, 'You') : null,
    ),
  );
}
