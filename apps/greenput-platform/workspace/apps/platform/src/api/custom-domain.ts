import type { ApiClient } from '@basenative/fetch';
import type { CustomDomain } from '@greenput/shared/models';

export interface CustomDomainApi {
  get(): Promise<{ data: CustomDomain }>;
  request(hostname: string): Promise<{
    data: CustomDomain & { cloudflareConfigured: boolean };
  }>;
  recheck(): Promise<{ data: CustomDomain & { note?: string } }>;
  remove(): Promise<{ data: { deleted: boolean } }>;
}

export function createCustomDomainApi(api: ApiClient): CustomDomainApi {
  return {
    get: () => api.get('/api/custom-domain'),
    request: (hostname) => api.post('/api/custom-domain', { hostname }),
    recheck: () => api.post('/api/custom-domain/recheck', {}),
    remove: () => api.delete('/api/custom-domain'),
  };
}
