import type { ApiClient } from '@basenative/fetch';
import type {
  Address,
  ApiResponse,
  ContactInfo,
  Customer,
} from '@greenput/shared/models';

export type CustomerListParams = {
  page?: number;
  perPage?: number;
  q?: string;
};

/**
 * What `PATCH /api/customers/:id` accepts: any subset of the customer, and
 * inside `contact` / `address` any subset of their fields
 * (`UpdateCustomerSchema` folds only the nested keys it was sent). The
 * detail route (GP-003) sends only what changed.
 */
export type CustomerPatch = Omit<Partial<Customer>, 'contact' | 'address'> & {
  readonly contact?: Partial<ContactInfo>;
  readonly address?: Partial<Address>;
};

export interface CustomersApi {
  list(params?: CustomerListParams): Promise<ApiResponse<Customer[]>>;
  get(id: string): Promise<{ data: Customer }>;
  create(payload: Partial<Customer>): Promise<{ data: Customer }>;
  update(id: string, patch: CustomerPatch): Promise<{ data: Customer }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
}

export function createCustomersApi(api: ApiClient): CustomersApi {
  return {
    list: (params = {}) => api.get('/api/customers', params),
    get: (id) => api.get(`/api/customers/${id}`),
    create: (payload) => api.post('/api/customers', payload),
    update: (id, patch) => api.patch(`/api/customers/${id}`, patch),
    delete: (id) => api.delete(`/api/customers/${id}`),
  };
}
