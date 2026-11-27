import { http, HttpResponse } from 'msw';
import {
  createWebhook,
  createWebhookResponse,
  createEmptyWebhookResponse,
} from '../data/webhooks.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getWebhooksSuccess = http.get('*/api/webhooks', async () => {
  return HttpResponse.json(createWebhookResponse());
});

export const createWebhookSuccess = http.post('*/api/webhooks', async () => {
  return HttpResponse.json({ data: createWebhook() }, { status: 201 });
});

export const toggleWebhookSuccess = http.patch(
  '*/api/webhooks/:id',
  async ({ params }) => {
    return HttpResponse.json({
      data: createWebhook({ id: params['id'] as string }),
    });
  },
);

export const deleteWebhookSuccess = http.delete(
  '*/api/webhooks/:id',
  async () => {
    return HttpResponse.json({ data: { deleted: true } });
  },
);

// ── Empty handlers ──────────────────────────────────────────

export const getWebhooksEmpty = http.get('*/api/webhooks', async () => {
  return HttpResponse.json(createEmptyWebhookResponse());
});

// ── Error handlers ──────────────────────────────────────────

export const getWebhooksError500 = http.get('*/api/webhooks', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Default export ──────────────────────────────────────────

export const webhookHandlers = [
  getWebhooksSuccess,
  createWebhookSuccess,
  toggleWebhookSuccess,
  deleteWebhookSuccess,
];
