import type { ApiClient } from '@basenative/fetch';
import type { ApiResponse, Campaign } from '@greenput/shared/models';

export type CampaignListParams = {
  page?: number;
  perPage?: number;
  status?: string;
  channel?: string;
};

export interface CampaignsApi {
  list(params?: CampaignListParams): Promise<ApiResponse<Campaign[]>>;
  create(payload: Partial<Campaign>): Promise<{ data: Campaign }>;
  update(id: string, patch: Partial<Campaign>): Promise<{ data: Campaign }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
}

export function createCampaignsApi(api: ApiClient): CampaignsApi {
  return {
    list: (params = {}) => api.get('/api/campaigns', params),
    create: (payload) => api.post('/api/campaigns', payload),
    update: (id, patch) => api.patch(`/api/campaigns/${id}`, patch),
    delete: (id) => api.delete(`/api/campaigns/${id}`),
  };
}
