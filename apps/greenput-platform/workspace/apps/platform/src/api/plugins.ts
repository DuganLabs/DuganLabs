import type { ApiClient } from '@basenative/fetch';
import type {
  ApiResponse,
  InstalledPlugin,
  Plugin,
} from '@greenput/shared/models';

// This composite was declared here, which put a response shape outside the one
// place shared types live (CLAUDE.md §2.4) and let it drift from the columns
// `GET /api/plugins/installed` actually selects. It is `InstalledPlugin` in
// libs/shared/models now, mapped by WIRE_INSTALLED_PLUGIN.
export type InstalledPluginRow = InstalledPlugin;

export type PluginListParams = {
  page?: number;
  perPage?: number;
  category?: string;
  q?: string;
};

export interface PluginsApi {
  list(params?: PluginListParams): Promise<ApiResponse<Plugin[]>>;
  installed(): Promise<ApiResponse<InstalledPluginRow[]>>;
  install(
    pluginId: string,
    config?: Record<string, unknown>,
  ): Promise<{ data: InstalledPlugin }>;
  /** Takes the PLUGIN id, not the installation id — the API resolves the
   *  installation by (workspace_id, plugin_id). */
  uninstall(pluginId: string): Promise<{ data: { deleted: boolean } }>;
}

export function createPluginsApi(api: ApiClient): PluginsApi {
  return {
    list: (params = {}) => api.get('/api/plugins', params),
    installed: () => api.get('/api/plugins/installed'),
    install: (pluginId, config = {}) =>
      api.post(`/api/plugins/${pluginId}/install`, { config }),
    uninstall: (pluginId) => api.delete(`/api/plugins/${pluginId}/uninstall`),
  };
}
