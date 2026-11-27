import type { ApiClient } from '@basenative/fetch';
import type { ApiResponse, AuditEntry } from '@greenput/shared/models';

export type AuditFilter = {
  page?: number;
  perPage?: number;
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
};

export interface AuditApi {
  list(params?: AuditFilter): Promise<ApiResponse<AuditEntry[]>>;
}

export function createAuditApi(api: ApiClient): AuditApi {
  return {
    list(params: AuditFilter = {}): Promise<ApiResponse<AuditEntry[]>> {
      return api.get<ApiResponse<AuditEntry[]>>('/api/audit', params);
    },
  };
}
