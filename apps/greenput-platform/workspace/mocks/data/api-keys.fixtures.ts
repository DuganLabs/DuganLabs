import type { ApiKey } from '@greenput/shared/models';

// This used to declare its own snake_case shape, citing a file
// (apps/platform/src/app/shared/services/api.service.ts) that was deleted with
// the Angular app — so the pact these fixtures generate described a response
// `/api/api-keys` does not send. The shared model is the contract; the endpoint
// serializes through it (see WIRE_API_KEY in libs/shared/models/src/wire.ts).
export type ApiKeyFixture = ApiKey;

let counter = 0;

export function createApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  counter++;
  return {
    id: `key-${counter}`,
    workspaceId: 'ws-1',
    name: `API Key ${counter}`,
    keyPrefix: `gp_abc${counter}`,
    scopes: ['read', 'leads'],
    createdAt: '2025-01-15T10:00:00Z',
    createdBy: 'usr-1',
    ...overrides,
  };
}

export function createApiKeyList(n: number): ApiKeyFixture[] {
  return Array.from({ length: n }, () => createApiKey());
}

export function resetApiKeyCounter(): void {
  counter = 0;
}
