import type { ApiClient } from '@basenative/fetch';
import type {
  ApiResponse,
  ChatRoom,
  ChatUnread,
} from '@greenput/shared/models';

export type { ChatRoom, ChatUnread };

/** What `POST /api/chat/rooms` accepts; the API dedupes on `entityType` + `entityId`. */
export interface CreateChatRoomPayload {
  readonly name?: string;
  readonly entityType?: string;
  readonly entityId?: string;
}

/** `GET /api/chat/rooms?entityType=…&entityId=…` — the room about one record. */
export interface ChatRoomFilter {
  readonly entityType: string;
  readonly entityId: string;
}

export type ChatTrack = {
  location: string;
  mid?: string;
  trackName: string;
  sessionId?: string;
};

export type PublishTracksRequest = {
  sessionId: string;
  sdpOffer: string;
  tracks: { location: string; mid: string; trackName: string }[];
};

export type PullTracksRequest = {
  sessionId: string;
  sdpOffer?: string;
  tracks: { location: string; sessionId: string; trackName: string }[];
};

export type TrackResponse = {
  sdpAnswer: string | null;
  tracks: unknown[];
};

export interface ChatApi {
  listRooms(filter?: ChatRoomFilter): Promise<ApiResponse<ChatRoom[]>>;
  createRoom(payload: CreateChatRoomPayload): Promise<{ data: ChatRoom }>;
  getRoom(id: string): Promise<{ data: ChatRoom }>;
  unread(): Promise<{ data: ChatUnread[] }>;
  createSession(roomId: string): Promise<{ data: { sessionId: string } }>;
  publishTracks(
    roomId: string,
    payload: PublishTracksRequest,
  ): Promise<{ data: TrackResponse }>;
  pullTracks(
    roomId: string,
    payload: PullTracksRequest,
  ): Promise<{ data: TrackResponse }>;
  renegotiate(
    roomId: string,
    payload: { sessionId: string; sdpOffer: string },
  ): Promise<{ data: { sdpAnswer: string } }>;
}

export function createChatApi(api: ApiClient): ChatApi {
  return {
    listRooms: (filter) =>
      filter
        ? api.get('/api/chat/rooms', { ...filter })
        : api.get('/api/chat/rooms'),
    createRoom: (payload) => api.post('/api/chat/rooms', payload),
    getRoom: (id) => api.get(`/api/chat/rooms/${id}`),
    unread: () => api.get('/api/chat/unread'),
    createSession: (roomId) =>
      api.post(`/api/chat/rooms/${roomId}/session`, {}),
    publishTracks: (roomId, payload) =>
      api.post(`/api/chat/rooms/${roomId}/tracks/publish`, payload),
    pullTracks: (roomId, payload) =>
      api.post(`/api/chat/rooms/${roomId}/tracks/pull`, payload),
    renegotiate: (roomId, payload) =>
      api.put(`/api/chat/rooms/${roomId}/renegotiate`, payload),
  };
}
