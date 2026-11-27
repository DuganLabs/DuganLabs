import type { ApiClient } from '@basenative/fetch';
import type { ChangeOrder } from '@greenput/shared/models';

/** One proposed line: cents, signed — a credit is a negative unit price. */
export interface ChangeOrderLineInput {
  readonly type?: 'labor' | 'material';
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

/** What `POST /api/change-orders` accepts: exactly one of jobId / estimateId. */
export interface ProposeChangeOrder {
  readonly jobId?: string;
  readonly estimateId?: string;
  readonly title: string;
  readonly reason?: string;
  readonly lineItems: readonly ChangeOrderLineInput[];
}

/**
 * Change orders: the only way a job's (or a sent estimate's) price moves.
 * Proposed by anyone on the team; approved or rejected — once — by office
 * and up, recording the homeowner's decision. Approving applies the lines.
 */
export interface ChangeOrdersApi {
  list(filter: {
    jobId?: string;
    estimateId?: string;
  }): Promise<{ data: ChangeOrder[] }>;
  get(id: string): Promise<{ data: ChangeOrder }>;
  propose(payload: ProposeChangeOrder): Promise<{ data: ChangeOrder }>;
  approve(id: string, note?: string): Promise<{ data: ChangeOrder }>;
  reject(id: string, note?: string): Promise<{ data: ChangeOrder }>;
}

export function createChangeOrdersApi(api: ApiClient): ChangeOrdersApi {
  return {
    list: (filter) => {
      const query: Record<string, string> = {};
      if (filter.jobId) query['jobId'] = filter.jobId;
      if (filter.estimateId) query['estimateId'] = filter.estimateId;
      return api.get('/api/change-orders', query);
    },
    get: (id) => api.get(`/api/change-orders/${id}`),
    propose: (payload) => api.post('/api/change-orders', payload),
    approve: (id, note = '') =>
      api.post(`/api/change-orders/${id}/approve`, { note }),
    reject: (id, note = '') =>
      api.post(`/api/change-orders/${id}/reject`, { note }),
  };
}
