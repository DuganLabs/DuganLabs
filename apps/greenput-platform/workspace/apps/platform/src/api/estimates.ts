import type { ApiClient } from '@basenative/fetch';
import type {
  ApiResponse,
  Estimate,
  ShareableResponse,
} from '@greenput/shared/models';

export type EstimateListParams = {
  page?: number;
  perPage?: number;
  status?: string;
};

/**
 * What `PATCH /api/estimates/:id` accepts (`UpdateEstimateSchema`): title,
 * status, customerId, notes, validUntil (`null` clears it), taxRate and the
 * whole `lineItems` list. Subtotal, tax and total are never sent — the API
 * derives them from the line items and the rate. The detail route (GP-003)
 * sends only what changed.
 */
export type EstimatePatch = Omit<Partial<Estimate>, 'validUntil'> & {
  readonly validUntil?: string | null;
};

export interface EstimatesApi {
  list(params?: EstimateListParams): Promise<ApiResponse<Estimate[]>>;
  get(id: string): Promise<{ data: Estimate }>;
  create(
    payload: Partial<Estimate> & { opportunityId: string },
  ): Promise<{ data: Estimate }>;
  update(id: string, patch: EstimatePatch): Promise<{ data: Estimate }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
  /** Mark sent. `share` is the public proposal link to pass on (GP-008). */
  send(id: string): Promise<ShareableResponse<Estimate>>;
  accept(id: string): Promise<{ data: Estimate }>;
}

export function createEstimatesApi(api: ApiClient): EstimatesApi {
  return {
    list: (params = {}) => api.get('/api/estimates', params),
    get: (id) => api.get(`/api/estimates/${id}`),
    create: (payload) => api.post('/api/estimates', payload),
    update: (id, patch) => api.patch(`/api/estimates/${id}`, patch),
    delete: (id) => api.delete(`/api/estimates/${id}`),
    send: (id) => api.post(`/api/estimates/${id}/send`, {}),
    accept: (id) => api.post(`/api/estimates/${id}/accept`, {}),
  };
}
