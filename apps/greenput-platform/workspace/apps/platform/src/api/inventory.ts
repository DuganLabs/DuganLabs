import type { ApiClient } from '@basenative/fetch';
import type {
  ApiResponse,
  InventoryItem,
  InventoryTransaction,
  InventoryTransactionType,
} from '@greenput/shared/models';

export type InventoryListParams = {
  page?: number;
  perPage?: number;
  q?: string;
  category?: string;
  lowStock?: boolean;
};

export interface InventoryApi {
  list(params?: InventoryListParams): Promise<ApiResponse<InventoryItem[]>>;
  create(payload: Partial<InventoryItem>): Promise<{ data: InventoryItem }>;
  update(
    id: string,
    patch: Partial<InventoryItem>,
  ): Promise<{ data: InventoryItem }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
  adjust(
    id: string,
    payload: {
      type: InventoryTransactionType;
      quantity: number;
      notes?: string;
    },
  ): Promise<{ data: InventoryTransaction }>;
}

export function createInventoryApi(api: ApiClient): InventoryApi {
  return {
    list: (params = {}) => {
      const query: Record<string, string | number | boolean | undefined> = {
        ...params,
      };
      if (params.lowStock) query['lowStock'] = 'true';
      return api.get('/api/inventory', query);
    },
    create: (payload) => api.post('/api/inventory', payload),
    update: (id, patch) => api.patch(`/api/inventory/${id}`, patch),
    delete: (id) => api.delete(`/api/inventory/${id}`),
    adjust: (id, payload) =>
      api.post(`/api/inventory/${id}/transaction`, payload),
  };
}
