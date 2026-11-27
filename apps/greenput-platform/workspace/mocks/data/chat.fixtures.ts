export interface ChatRoomFixture {
  id: string;
  workspaceId: string;
  name: string;
  entityType?: string;
  entityId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageFixture {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
}

let roomCounter = 0;
let messageCounter = 0;

export function createChatRoom(
  overrides: Partial<ChatRoomFixture> = {},
): ChatRoomFixture {
  roomCounter++;
  return {
    id: `room-${roomCounter}`,
    workspaceId: 'ws-1',
    name: `Chat Room ${roomCounter}`,
    createdBy: 'usr-1',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

export function createChatMessage(
  overrides: Partial<ChatMessageFixture> = {},
): ChatMessageFixture {
  messageCounter++;
  return {
    id: `msg-${messageCounter}`,
    roomId: 'room-1',
    senderId: 'usr-1',
    senderName: 'Test User',
    content: `Message ${messageCounter}`,
    createdAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

export function resetChatCounters(): void {
  roomCounter = 0;
  messageCounter = 0;
}
