import type { ApiClient } from '@basenative/fetch';
import type { Branding } from '@greenput/shared/models';

export interface BrandingApi {
  get(): Promise<{ data: Branding }>;
  update(patch: Partial<Branding>): Promise<{ data: Branding }>;
}

export function createBrandingApi(api: ApiClient): BrandingApi {
  return {
    get: () => api.get('/api/branding'),
    update: (patch) => api.patch('/api/branding', patch),
  };
}
