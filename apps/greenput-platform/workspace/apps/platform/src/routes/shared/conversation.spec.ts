import { afterEach, describe, expect, it } from 'vitest';
import { findOrCreateRoom, messageAction } from './conversation.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';

const ROOM = {
  id: 'room-9',
  name: 'Jane Doe',
  entityType: 'customer',
  entityId: 'c1',
  createdBy: 'u1',
  createdAt: '2026-09-14T00:00:00.000Z',
};

/** The lookup answers `existing`; a POST answers the room it was asked for. */
function serve(fake: FakeFetcher, existing: unknown[]): void {
  fake.respond('/api/chat/rooms', () => {
    const last = fake.calls[fake.calls.length - 1];
    if (last?.method === 'POST') {
      const body = last.body as Record<string, unknown>;
      return jsonResponse(
        { data: { ...ROOM, id: 'room-new', name: body['name'] } },
        { status: 201 },
      );
    }
    return jsonResponse({
      data: existing,
      meta: { total: existing.length, page: 1, perPage: 50 },
    });
  });
}

const SUBJECT = {
  entityType: 'customer' as const,
  entityId: 'c1',
  name: 'Jane Doe',
};

describe('findOrCreateRoom', () => {
  it('asks for the room about this record and opens it without creating another', async () => {
    const fake = createFakeFetch();
    serve(fake, [ROOM]);
    const deps = buildTestDeps({ fetch: fake.fetch });
    const room = await findOrCreateRoom(deps, SUBJECT);
    expect(room.id).toBe('room-9');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('GET');
    expect(fake.calls[0]?.url).toContain('entityType=customer');
    expect(fake.calls[0]?.url).toContain('entityId=c1');
  });

  it('creates the room, named after the record, when none exists', async () => {
    const fake = createFakeFetch();
    serve(fake, []);
    const deps = buildTestDeps({ fetch: fake.fetch });
    const room = await findOrCreateRoom(deps, SUBJECT);
    expect(room.id).toBe('room-new');
    const post = fake.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/chat/rooms');
    expect(post?.body).toEqual({
      name: 'Jane Doe',
      entityType: 'customer',
      entityId: 'c1',
    });
  });
});

describe('messageAction', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
  });

  it('is a labelled button that goes to /chat/:id', async () => {
    const fake = createFakeFetch();
    serve(fake, [ROOM]);
    const deps = buildTestDeps({ fetch: fake.fetch });
    const errors: string[] = [];
    const action = messageAction({
      deps,
      subject: SUBJECT,
      testId: 'x-message',
      onError: (m) => errors.push(m),
    });
    dispose = action.dispose;
    document.body.append(action.element);
    expect(action.element.textContent).toBe('Message');
    expect(action.element.getAttribute('data-testid')).toBe('x-message');

    action.element.click();
    await tick();
    await tick();
    expect(window.location.pathname).toBe('/chat/room-9');
    expect(errors).toEqual([]);
  });

  it('says what went wrong instead of navigating', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/chat/rooms', () =>
      jsonResponse(
        { error: { code: 'BOOM', message: 'Chat is down' } },
        { status: 500 },
      ),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const errors: string[] = [];
    const action = messageAction({
      deps,
      subject: SUBJECT,
      testId: 'x-message',
      onError: (m) => errors.push(m),
    });
    dispose = action.dispose;
    document.body.append(action.element);
    action.element.click();
    await tick();
    await tick();
    expect(errors).toEqual(['Could not open the conversation: Chat is down']);
    expect(window.location.pathname).toBe('/');
    expect((action.element as HTMLButtonElement).disabled).toBe(false);
  });
});
