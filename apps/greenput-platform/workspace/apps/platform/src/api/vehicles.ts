import type { ApiClient } from '@basenative/fetch';
import type { ApiResponse, Vehicle } from '@greenput/shared/models';

export type VehicleListParams = {
  page?: number;
  perPage?: number;
  q?: string;
  status?: string;
};

export interface VehiclesApi {
  list(params?: VehicleListParams): Promise<ApiResponse<Vehicle[]>>;
  create(payload: Partial<Vehicle>): Promise<{ data: Vehicle }>;
  update(id: string, patch: Partial<Vehicle>): Promise<{ data: Vehicle }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
}

export function createVehiclesApi(api: ApiClient): VehiclesApi {
  return {
    list: (params = {}) => api.get('/api/vehicles', params),
    create: (payload) => api.post('/api/vehicles', payload),
    update: (id, patch) => api.patch(`/api/vehicles/${id}`, patch),
    delete: (id) => api.delete(`/api/vehicles/${id}`),
  };
}
