import { z } from 'zod';

export const CreateChatRoomSchema = z.object({
  entityType: z.string().max(50).optional(),
  // Any id the workspace's own records carry: API-minted ids are UUIDs, but
  // seeded and imported rows are not, and a customer that cannot be messaged
  // because of the shape of its id is a bug, not a validation (GP-055).
  entityId: z.string().min(1).max(100).optional(),
  name: z.string().max(255).optional(),
});

export const SendChatMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(5000),
});

export const ChatSignalSchema = z.object({
  to: z.string().min(1, 'to is required'),
  type: z.enum(['offer', 'answer', 'ice-candidate']),
  data: z.unknown(),
});

export const JoinChatRoomSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  userName: z.string().min(1, 'userName is required').max(100),
});

const trackInfoSchema = z.object({
  location: z.string().min(1),
  mid: z.string().optional(),
  trackName: z.string().min(1),
  sessionId: z.string().optional(),
});

export const PublishTracksSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  sdpOffer: z.string().min(1, 'sdpOffer is required'),
  tracks: z.array(trackInfoSchema).min(1, 'At least one track is required'),
});

export const PullTracksSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  sdpOffer: z.string().optional(),
  tracks: z.array(trackInfoSchema).min(1, 'At least one track is required'),
});

export const RenegotiateSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  sdpOffer: z.string().min(1, 'sdpOffer is required'),
});

export type CreateChatRoomInput = z.infer<typeof CreateChatRoomSchema>;
export type SendChatMessageInput = z.infer<typeof SendChatMessageSchema>;
export type ChatSignalInput = z.infer<typeof ChatSignalSchema>;
export type JoinChatRoomInput = z.infer<typeof JoinChatRoomSchema>;
export type PublishTracksInput = z.infer<typeof PublishTracksSchema>;
export type PullTracksInput = z.infer<typeof PullTracksSchema>;
export type RenegotiateInput = z.infer<typeof RenegotiateSchema>;
