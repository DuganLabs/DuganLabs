import type { ApiClient } from '@basenative/fetch';
import type { ApiResponse, Opportunity } from '@greenput/shared/models';

export type OpportunityListParams = {
  page?: number;
  perPage?: number;
  status?: string;
};

export interface OpportunitiesApi {
  list(params?: OpportunityListParams): Promise<ApiResponse<Opportunity[]>>;
  get(id: string): Promise<{ data: Opportunity }>;
  create(payload: Partial<Opportunity>): Promise<{ data: Opportunity }>;
  update(
    id: string,
    patch: Partial<Opportunity>,
  ): Promise<{ data: Opportunity }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
  convert(
    id: string,
    payload?: {
      title?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
    },
  ): Promise<{
    data: { jobId: string; customerId: string; jobNumber: string };
  }>;
}

export function createOpportunitiesApi(api: ApiClient): OpportunitiesApi {
  return {
    list: (params = {}) => api.get('/api/opportunities', params),
    get: (id) => api.get(`/api/opportunities/${id}`),
    create: (payload) => api.post('/api/opportunities', payload),
    update: (id, patch) => api.patch(`/api/opportunities/${id}`, patch),
    delete: (id) => api.delete(`/api/opportunities/${id}`),
    convert: (id, payload = {}) =>
      api.post(`/api/opportunities/${id}/convert`, payload),
  };
}
