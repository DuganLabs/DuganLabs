import { afterEach, describe, expect, it } from 'vitest';
import type { ChatRoom, ChatUnread } from '@greenput/shared/models';
import { renderChatListRoute, subjectLabel } from './chat-list.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';

const ROOMS: ChatRoom[] = [
  {
    id: 'room-job',
    name: '#1001 200A Panel Upgrade',
    entityType: 'job',
    entityId: 'j1',
    createdBy: 'u1',
    createdAt: '2026-09-14T10:00:00.000Z',
  },
  {
    id: 'room-cust',
    name: 'Alex Rivera',
    entityType: 'customer',
    entityId: 'c1',
    createdBy: 'u1',
    createdAt: '2026-09-13T10:00:00.000Z',
  },
  {
    id: 'room-crew',
    name: 'Crew',
    createdBy: 'u1',
    createdAt: '2026-09-12T10:00:00.000Z',
  },
];

function serve(
  fake: FakeFetcher,
  rooms: ChatRoom[],
  unread: ChatUnread[] = [],
): void {
  fake.respond('/api/chat/unread', () => jsonResponse({ data: unread }));
  fake.respond('/api/chat/rooms', () => {
    const last = fake.calls[fake.calls.length - 1];
    if (last?.method === 'POST') {
      const body = last.body as { name: string };
      return jsonResponse(
        {
          data: {
            id: 'room-created',
            name: body.name,
            createdBy: 'u1',
            createdAt: '2026-09-14T12:00:00.000Z',
          },
        },
        { status: 201 },
      );
    }
    return jsonResponse({
      data: rooms,
      meta: { total: rooms.length, page: 1, perPage: 50 },
    });
  });
}

function q<T extends Element = HTMLElement>(testid: string): T {
  const node = document.querySelector<T>(`[data-testid="${testid}"]`);
  if (!node) throw new Error(`no ${testid}`);
  return node;
}

describe('renderChatListRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
  });

  async function mount(fake: FakeFetcher): Promise<HTMLElement> {
    history.replaceState(null, '', '/chat');
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderChatListRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    return view.element;
  }

  it('lists the rooms GET /api/chat/rooms answers, each linked to /chat/:id, with what it is about and its unread count', async () => {
    const fake = createFakeFetch();
    serve(fake, ROOMS, [
      { roomId: 'room-cust', name: 'Alex Rivera', unreadCount: 3 },
    ]);
    const root = await mount(fake);

    expect(root.querySelector('h1')?.textContent).toBe('Messages');
    expect(
      fake.calls.some((c) => c.method === 'GET' && c.url === '/api/chat/rooms'),
    ).toBe(true);
    expect(
      fake.calls.some(
        (c) => c.method === 'GET' && c.url === '/api/chat/unread',
      ),
    ).toBe(true);

    const rows = q('chat-list-rooms').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    const links = [...rows].map((r) =>
      r.querySelector('a')?.getAttribute('href'),
    );
    expect(links).toEqual([
      '/chat/room-job',
      '/chat/room-cust',
      '/chat/room-crew',
    ]);
    expect(rows[0]?.textContent).toContain('#1001 200A Panel Upgrade');
    expect(rows[0]?.textContent).toContain('About a job');
    expect(rows[1]?.textContent).toContain('Alex Rivera');
    expect(rows[1]?.textContent).toContain('About a customer');
    expect(rows[1]?.querySelector('[data-bn-unread]')?.textContent).toBe(
      '3 new',
    );
    expect(rows[0]?.querySelector('[data-bn-unread]')).toBeNull();
    expect(rows[2]?.textContent).toContain('The crew');
    expect(q('chat-list-empty').hasAttribute('hidden')).toBe(true);
  });

  it('shows an honest empty state', async () => {
    const fake = createFakeFetch();
    serve(fake, []);
    await mount(fake);
    expect(q('chat-list-empty').hasAttribute('hidden')).toBe(false);
    expect(q('chat-list-empty').textContent).toContain('press Message');
    expect(q('chat-list-rooms').hasAttribute('hidden')).toBe(true);
  });

  it('says when the list could not be loaded', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/chat/unread', () => jsonResponse({ data: [] }));
    fake.respond('/api/chat/rooms', () =>
      jsonResponse(
        { error: { code: 'BOOM', message: 'Chat is down' } },
        { status: 500 },
      ),
    );
    await mount(fake);
    expect(q('chat-list-error').hasAttribute('hidden')).toBe(false);
    expect(q('chat-list-error').textContent).toBe(
      'Could not load conversations: Chat is down',
    );
  });

  it('New conversation creates a room through the client and opens it', async () => {
    const fake = createFakeFetch();
    serve(fake, []);
    const root = await mount(fake);

    q('chat-list-new').click();
    await tick();
    expect(root.querySelector('[data-bn-panel] h2')?.textContent).toBe(
      'New conversation',
    );
    const input = q<HTMLInputElement>('chat-list-form-name');
    input.value = 'Saturday crew';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    q('panel-submit').click();
    await tick();
    await tick();

    const post = fake.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/chat/rooms');
    expect(post?.body).toEqual({ name: 'Saturday crew' });
    expect(window.location.pathname).toBe('/chat/room-created');
  });

  it('will not post a nameless conversation', async () => {
    const fake = createFakeFetch();
    serve(fake, []);
    const root = await mount(fake);
    q('chat-list-new').click();
    await tick();
    q('panel-submit').click();
    await tick();
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('Give the conversation a name.');
    expect(q('chat-list-form-name').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('subjectLabel', () => {
  it('names what a room is about', () => {
    expect(subjectLabel({ entityType: 'customer' })).toBe('About a customer');
    expect(subjectLabel({ entityType: 'job' })).toBe('About a job');
    expect(subjectLabel({})).toBe('The crew');
  });
});
