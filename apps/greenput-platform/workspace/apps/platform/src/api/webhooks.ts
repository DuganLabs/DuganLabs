import type { ApiClient } from '@basenative/fetch';
import type { ApiResponse, Webhook } from '@greenput/shared/models';

export interface WebhooksApi {
  list(): Promise<ApiResponse<Webhook[]>>;
  create(payload: {
    url: string;
    events: string[];
  }): Promise<{ data: Webhook }>;
  toggle(id: string, active: boolean): Promise<{ data: Webhook }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
}

export function createWebhooksApi(api: ApiClient): WebhooksApi {
  return {
    list: () => api.get('/api/webhooks'),
    create: (payload) => api.post('/api/webhooks', payload),
    toggle: (id, active) => api.patch(`/api/webhooks/${id}`, { active }),
    delete: (id) => api.delete(`/api/webhooks/${id}`),
  };
}
