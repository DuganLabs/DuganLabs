import { http, HttpResponse } from 'msw';
import {
  createPluginResponse,
  createPluginInstallation,
} from '../data/plugins.fixtures';

export const getPluginsSuccess = http.get(
  '*/api/plugins',
  async ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/installed')) {
      return HttpResponse.json({
        data: [],
        meta: { total: 0, page: 1, perPage: 25 },
      });
    }
    return HttpResponse.json(createPluginResponse());
  },
);

export const getInstalledPluginsSuccess = http.get(
  '*/api/plugins/installed',
  async () => {
    return HttpResponse.json({
      data: [],
      meta: { total: 0, page: 1, perPage: 25 },
    });
  },
);

export const installPluginSuccess = http.post(
  '*/api/plugins/:id/install',
  async () => {
    return HttpResponse.json(
      { data: createPluginInstallation() },
      { status: 201 },
    );
  },
);

export const uninstallPluginSuccess = http.delete(
  '*/api/plugins/installed/:id',
  async () => {
    return HttpResponse.json({ data: { deleted: true } });
  },
);

export const pluginHandlers = [
  getInstalledPluginsSuccess,
  getPluginsSuccess,
  installPluginSuccess,
  uninstallPluginSuccess,
];
