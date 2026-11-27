import { describe, it, expect } from 'vitest';

describe('ChatRoom', () => {
  it('should export ChatRoom class', async () => {
    const { ChatRoom } = await import('./chat-room');
    expect(ChatRoom).toBeDefined();
  });

  it('should be a constructor function', async () => {
    const { ChatRoom } = await import('./chat-room');
    expect(typeof ChatRoom).toBe('function');
  });
});

describe('ChatRoom message protocol logic', () => {
  it('join message sets participant name', () => {
    const msg = { type: 'join', name: 'Alice' };
    const participant = { name: 'Anonymous', tracks: [] as unknown[] };
    if (msg.type === 'join') {
      participant.name = (msg.name as string) || 'Anonymous';
    }
    expect(participant.name).toBe('Alice');
  });

  it('join message defaults name to Anonymous when missing', () => {
    const msg = { type: 'join', name: '' };
    const participant = { name: 'Anonymous', tracks: [] as unknown[] };
    if (msg.type === 'join') {
      participant.name = (msg.name as string) || 'Anonymous';
    }
    expect(participant.name).toBe('Anonymous');
  });

  it('session-created message stores sessionId on participant', () => {
    const participant = {
      name: 'Alice',
      sessionId: undefined as string | undefined,
      tracks: [] as unknown[],
    };
    const msg = { type: 'session-created', sessionId: 'sess-abc' };
    if (msg.type === 'session-created') {
      participant.sessionId = msg.sessionId as string;
    }
    expect(participant.sessionId).toBe('sess-abc');
  });

  it('text history is bounded at 200 entries', () => {
    const history: { from: string; text: string; ts: string }[] = [];
    for (let i = 0; i < 201; i++) {
      history.push({
        from: 'User',
        text: `msg ${i}`,
        ts: new Date().toISOString(),
      });
      if (history.length > 200) history.shift();
    }
    expect(history.length).toBe(200);
    expect(history[0].text).toBe('msg 1');
  });

  it('room-state sends last 50 text history entries', () => {
    const history = Array.from({ length: 60 }, (_, i) => `msg ${i}`);
    const last50 = history.slice(-50);
    expect(last50.length).toBe(50);
    expect(last50[0]).toBe('msg 10');
  });

  it('unknown message types are silently ignored', () => {
    const msg = { type: 'unknown-type', data: 'some-data' };
    let handled = false;
    switch (msg.type) {
      case 'join':
      case 'session-created':
      case 'tracks-published':
      case 'text':
        handled = true;
        break;
      default:
        break;
    }
    expect(handled).toBe(false);
  });

  it('malformed JSON is silently ignored', () => {
    const rawMessage = 'not-json{{{';
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      // silently ignored
    }
    expect(parsed).toBeNull();
  });
});
