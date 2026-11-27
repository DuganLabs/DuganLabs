import type { Webhook, ApiResponse } from '@greenput/shared/models';

let counter = 0;

export function createWebhook(overrides: Partial<Webhook> = {}): Webhook {
  counter++;
  return {
    id: `wh-${counter}`,
    workspaceId: 'ws-1',
    url: `https://example.com/webhook/${counter}`,
    events: ['lead.created', 'job.completed'],
    secret: `secret-${counter}`,
    active: true,
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

export function createWebhookList(
  n: number,
  overrides: Partial<Webhook> = {},
): Webhook[] {
  return Array.from({ length: n }, () => createWebhook(overrides));
}

export function createWebhookResponse(
  webhooks: Webhook[] = createWebhookList(2),
): ApiResponse<Webhook[]> {
  return {
    data: webhooks,
    meta: { total: webhooks.length, page: 1, perPage: 25 },
  };
}

export function createEmptyWebhookResponse(): ApiResponse<Webhook[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  };
}

export function resetWebhookCounter(): void {
  counter = 0;
}
