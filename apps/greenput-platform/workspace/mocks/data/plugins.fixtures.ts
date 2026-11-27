import type { Plugin, PluginInstallation } from '@greenput/shared/models';

let counter = 0;

export function createPlugin(overrides: Partial<Plugin> = {}): Plugin {
  counter++;
  return {
    id: `plg-${counter}`,
    name: `Plugin ${counter}`,
    slug: `plugin-${counter}`,
    description: `Integration plugin number ${counter}`,
    version: '1.0.0',
    author: 'Greenput Team',
    category: 'general',
    events: ['lead.created', 'job.completed'],
    configSchema: {},
    active: true,
    createdAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

export function createPluginList(n: number): Plugin[] {
  return Array.from({ length: n }, (_, i) =>
    createPlugin({
      category: (
        ['general', 'communication', 'accounting', 'scheduling'] as const
      )[i % 4],
    }),
  );
}

export function createPluginResponse(plugins: Plugin[] = createPluginList(4)) {
  return {
    data: plugins,
    meta: { total: plugins.length, page: 1, perPage: 25 },
  };
}

export function createPluginInstallation(
  overrides: Partial<PluginInstallation> = {},
): PluginInstallation {
  return {
    id: 'inst-1',
    workspaceId: 'ws-1',
    pluginId: 'plg-1',
    config: {},
    enabled: true,
    installedAt: '2025-01-15T10:00:00Z',
    installedBy: 'usr-1',
    ...overrides,
  };
}

export function resetPluginCounter(): void {
  counter = 0;
}
