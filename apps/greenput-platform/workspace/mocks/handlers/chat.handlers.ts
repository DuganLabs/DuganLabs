import { http, HttpResponse } from 'msw';
import { createChatRoom, createChatMessage } from '../data/chat.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getChatRoomsSuccess = http.get('*/api/chat/rooms', async () => {
  return HttpResponse.json({
    data: [
      createChatRoom({ id: 'room-1', name: 'General' }),
      createChatRoom({
        id: 'room-2',
        name: 'Job #J-001',
        entityType: 'job',
        entityId: 'job-1',
      }),
    ],
    meta: { total: 2, page: 1, perPage: 25 },
  });
});

export const createChatRoomSuccess = http.post('*/api/chat/rooms', async () => {
  return HttpResponse.json({ data: createChatRoom() }, { status: 201 });
});

export const getChatRoomMessagesSuccess = http.get(
  '*/api/chat/rooms/:id/messages',
  async ({ params }) => {
    return HttpResponse.json({
      data: [
        createChatMessage({
          roomId: params['id'] as string,
          content: 'Hello, team!',
        }),
        createChatMessage({
          roomId: params['id'] as string,
          content: 'On my way to the job site.',
        }),
      ],
      meta: { total: 2, page: 1, perPage: 50 },
    });
  },
);

export const sendChatMessageSuccess = http.post(
  '*/api/chat/rooms/:id/messages',
  async ({ params }) => {
    return HttpResponse.json(
      { data: createChatMessage({ roomId: params['id'] as string }) },
      { status: 201 },
    );
  },
);

// ── Error handlers ──────────────────────────────────────────

export const getChatRoomsError500 = http.get('*/api/chat/rooms', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Default export ──────────────────────────────────────────

export const chatHandlers = [
  getChatRoomsSuccess,
  createChatRoomSuccess,
  getChatRoomMessagesSuccess,
  sendChatMessageSuccess,
];
