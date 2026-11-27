import type { ApiClient } from '@basenative/fetch';
import type { DashboardStats } from '@greenput/shared/models';

export interface DashboardApi {
  stats(): Promise<DashboardStats>;
}

export function createDashboardApi(api: ApiClient): DashboardApi {
  return {
    async stats(): Promise<DashboardStats> {
      const res = await api.get<{ data: DashboardStats }>(
        '/api/dashboard/stats',
      );
      return res.data;
    },
  };
}
