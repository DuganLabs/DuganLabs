import type { ApiClient } from '@basenative/fetch';
import type { ApiKey, ApiKeyCreated } from '@greenput/shared/models';

// `ApiKey` used to be re-declared here in snake_case, which matched the raw D1
// rows the API handed out and contradicted libs/shared/models. It now comes
// from the one place shared types live (CLAUDE.md §2.4), and the response is
// serialized through the wire contract, so the two cannot drift.
export type { ApiKey, ApiKeyCreated };

export interface ApiKeysApi {
  list(): Promise<{ data: ApiKey[] }>;
  create(payload: {
    name: string;
    scopes: string[];
  }): Promise<{ data: ApiKeyCreated }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
}

export function createApiKeysApi(api: ApiClient): ApiKeysApi {
  return {
    list: () => api.get('/api/api-keys'),
    create: (payload) => api.post('/api/api-keys', payload),
    delete: (id) => api.delete(`/api/api-keys/${id}`),
  };
}
