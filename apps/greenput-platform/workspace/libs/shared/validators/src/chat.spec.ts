import { describe, it, expect } from 'vitest';
import {
  CreateChatRoomSchema,
  SendChatMessageSchema,
  ChatSignalSchema,
  JoinChatRoomSchema,
  PublishTracksSchema,
  PullTracksSchema,
  RenegotiateSchema,
} from './chat';

const validUuid = '550e8400-e29b-41d4-a716-446655440001';

describe('CreateChatRoomSchema', () => {
  it('accepts empty object (all optional)', () => {
    const result = CreateChatRoomSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts full input', () => {
    const result = CreateChatRoomSchema.safeParse({
      entityType: 'job',
      entityId: validUuid,
      name: 'Job Discussion',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a seeded, non-UUID entityId — the id a record has is the id it has', () => {
    const result = CreateChatRoomSchema.safeParse({
      entityType: 'customer',
      entityId: 'cust-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty entityId', () => {
    const result = CreateChatRoomSchema.safeParse({ entityId: '' });
    expect(result.success).toBe(false);
  });
});

describe('SendChatMessageSchema', () => {
  it('accepts valid message', () => {
    const result = SendChatMessageSchema.safeParse({ content: 'Hello!' });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = SendChatMessageSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing content', () => {
    const result = SendChatMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding 5000 chars', () => {
    const result = SendChatMessageSchema.safeParse({
      content: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe('ChatSignalSchema', () => {
  it('accepts valid offer signal', () => {
    const result = ChatSignalSchema.safeParse({
      to: 'peer-id',
      type: 'offer',
      data: { sdp: 'v=0' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts ice-candidate signal', () => {
    const result = ChatSignalSchema.safeParse({
      to: 'peer-id',
      type: 'ice-candidate',
      data: { candidate: 'candidate:...' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing to', () => {
    const result = ChatSignalSchema.safeParse({ type: 'offer', data: {} });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = ChatSignalSchema.safeParse({
      to: 'peer',
      type: 'ping',
      data: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('JoinChatRoomSchema', () => {
  it('accepts valid join data', () => {
    const result = JoinChatRoomSchema.safeParse({
      userId: 'u1',
      userName: 'Alice',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing userId', () => {
    const result = JoinChatRoomSchema.safeParse({ userName: 'Alice' });
    expect(result.success).toBe(false);
  });

  it('rejects missing userName', () => {
    const result = JoinChatRoomSchema.safeParse({ userId: 'u1' });
    expect(result.success).toBe(false);
  });

  it('rejects empty userId', () => {
    const result = JoinChatRoomSchema.safeParse({
      userId: '',
      userName: 'Alice',
    });
    expect(result.success).toBe(false);
  });
});

describe('PublishTracksSchema', () => {
  const validTrack = { location: 'local', mid: '0', trackName: 'camera' };

  it('accepts valid publish tracks payload', () => {
    const result = PublishTracksSchema.safeParse({
      sessionId: 'sess-abc',
      sdpOffer: 'v=0\r\n...',
      tracks: [validTrack],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing sessionId', () => {
    const result = PublishTracksSchema.safeParse({
      sdpOffer: 'v=0',
      tracks: [validTrack],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing sdpOffer', () => {
    const result = PublishTracksSchema.safeParse({
      sessionId: 'sess-abc',
      tracks: [validTrack],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty tracks array', () => {
    const result = PublishTracksSchema.safeParse({
      sessionId: 'sess-abc',
      sdpOffer: 'v=0',
      tracks: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('PullTracksSchema', () => {
  const validTrack = {
    location: 'remote',
    trackName: 'camera',
    sessionId: 'peer-sess',
  };

  it('accepts valid pull tracks payload', () => {
    const result = PullTracksSchema.safeParse({
      sessionId: 'sess-abc',
      tracks: [validTrack],
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional sdpOffer', () => {
    const result = PullTracksSchema.safeParse({
      sessionId: 'sess-abc',
      sdpOffer: 'v=0\r\n...',
      tracks: [validTrack],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing sessionId', () => {
    const result = PullTracksSchema.safeParse({ tracks: [validTrack] });
    expect(result.success).toBe(false);
  });

  it('rejects empty tracks array', () => {
    const result = PullTracksSchema.safeParse({
      sessionId: 'sess-abc',
      tracks: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('RenegotiateSchema', () => {
  it('accepts valid renegotiate payload', () => {
    const result = RenegotiateSchema.safeParse({
      sessionId: 'sess-abc',
      sdpOffer: 'v=0\r\n...',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing sessionId', () => {
    const result = RenegotiateSchema.safeParse({ sdpOffer: 'v=0' });
    expect(result.success).toBe(false);
  });

  it('rejects missing sdpOffer', () => {
    const result = RenegotiateSchema.safeParse({ sessionId: 'sess-abc' });
    expect(result.success).toBe(false);
  });

  it('rejects empty sdpOffer', () => {
    const result = RenegotiateSchema.safeParse({
      sessionId: 'sess-abc',
      sdpOffer: '',
    });
    expect(result.success).toBe(false);
  });
});
