import { describe, it, expect, vi } from 'vitest';
import { pluginsRouter } from './plugins';

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
    SESSIONS: {},
    ENVIRONMENT: 'development',
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  workspaceId = 'ws-1',
  userId = 'user-1',
) {
  const req = new Request(`https://api.greenput.com/api/plugins${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: userId,
    role: 'owner',
  };
  return req;
}

describe('pluginsRouter', () => {
  it('exports pluginsRouter with fetch', () => {
    expect(pluginsRouter).toBeDefined();
    expect(typeof pluginsRouter.fetch).toBe('function');
  });
});

describe('GET /api/plugins/installed', () => {
  it('returns 200 with empty list when none installed', async () => {
    const env = makeEnv();
    const res = await pluginsRouter.fetch(makeReq('/installed'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBe(0);
  });

  it('returns installed plugins with plugin details', async () => {
    const env = makeEnv();
    const installation = {
      id: 'inst-1',
      plugin_id: 'plug-1',
      config: '{}',
      enabled: 1,
      name: 'QuickBooks',
      slug: 'quickbooks',
      category: 'accounting',
    };
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [installation],
    });
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      total: 1,
    });
    const res = await pluginsRouter.fetch(makeReq('/installed'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(body.data.length).toBe(1);
    expect(body.meta.total).toBe(1);
  });

  it('returns pagination meta', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      total: 42,
    });
    const res = await pluginsRouter.fetch(
      makeReq('/installed?page=2&perPage=10'),
      env,
    );
    const body = (await res.json()) as {
      meta: { total: number; page: number; perPage: number };
    };
    expect(body.meta.total).toBe(42);
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(10);
  });
});

describe('GET /api/plugins', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await pluginsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBe(0);
  });

  it('returns available plugins', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        { id: 'plug-1', name: 'QuickBooks', category: 'accounting' },
        { id: 'plug-2', name: 'Mailchimp', category: 'marketing' },
      ],
    });
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      total: 2,
    });
    const res = await pluginsRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(2);
  });

  it('supports category filter', async () => {
    const env = makeEnv();
    await pluginsRouter.fetch(makeReq('/?category=accounting'), env);
    // The query should include the category param — prepare is called with SQL
    expect(env.DB.prepare).toHaveBeenCalled();
  });

  it('supports search query', async () => {
    const env = makeEnv();
    await pluginsRouter.fetch(makeReq('/?q=quickbooks'), env);
    expect(env.DB.prepare).toHaveBeenCalled();
  });
});

describe('GET /api/plugins/:id', () => {
  it('returns 404 when plugin not found', async () => {
    const env = makeEnv();
    const res = await pluginsRouter.fetch(makeReq('/plug-not-found'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with plugin when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'plug-1',
      name: 'QuickBooks',
      slug: 'quickbooks',
      category: 'accounting',
    });
    const res = await pluginsRouter.fetch(makeReq('/plug-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBe('plug-1');
    expect(body.data.name).toBe('QuickBooks');
  });
});

describe('POST /api/plugins/:id/install', () => {
  it('returns 404 when plugin does not exist', async () => {
    const env = makeEnv();
    const res = await pluginsRouter.fetch(
      makeReq('/plug-not-found/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when plugin already installed', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'plug-1', name: 'QuickBooks' }) // plugin exists
      .mockResolvedValueOnce({ id: 'inst-1' }); // already installed
    const res = await pluginsRouter.fetch(
      makeReq('/plug-1/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it('returns 201 on successful install', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'plug-1', name: 'QuickBooks' }) // plugin exists
      .mockResolvedValueOnce(null) // not yet installed
      .mockResolvedValueOnce({
        id: 'inst-new',
        plugin_id: 'plug-1',
        name: 'QuickBooks',
      }); // created
    const res = await pluginsRouter.fetch(
      makeReq('/plug-1/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { apiKey: 'sk-123' } }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { pluginId: string } };
    expect(body.data.pluginId).toBe('plug-1');
  });

  it('returns 201 with empty config (config defaults to {})', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'plug-2', name: 'Mailchimp' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'inst-2',
        plugin_id: 'plug-2',
        name: 'Mailchimp',
      });
    const res = await pluginsRouter.fetch(
      makeReq('/plug-2/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/plugins/:id/config', () => {
  it('returns 404 when plugin not installed', async () => {
    const env = makeEnv();
    const res = await pluginsRouter.fetch(
      makeReq('/plug-not-installed/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { apiKey: 'new-key' } }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when config field is missing', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inst-1',
    });
    const res = await pluginsRouter.fetch(
      makeReq('/plug-1/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful config update', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'inst-1' }) // installation exists
      .mockResolvedValueOnce({
        id: 'inst-1',
        plugin_id: 'plug-1',
        config: '{"apiKey":"new-key"}',
      }); // updated
    const res = await pluginsRouter.fetch(
      makeReq('/plug-1/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { apiKey: 'new-key' } }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { pluginId: string } };
    expect(body.data.pluginId).toBe('plug-1');
  });

  it('returns 200 when toggling enabled flag', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'inst-1' })
      .mockResolvedValueOnce({ id: 'inst-1', plugin_id: 'plug-1', enabled: 0 });
    const res = await pluginsRouter.fetch(
      makeReq('/plug-1/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { apiKey: 'key' }, enabled: false }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/plugins/:id/uninstall', () => {
  it('returns 404 when plugin not installed', async () => {
    const env = makeEnv();
    const res = await pluginsRouter.fetch(
      makeReq('/plug-not-installed/uninstall', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with deleted:true on successful uninstall', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inst-1',
    });
    const res = await pluginsRouter.fetch(
      makeReq('/plug-1/uninstall', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('plugins schema validation', () => {
  it('InstallPluginSchema defaults config to {}', async () => {
    const { InstallPluginSchema } = await import('@greenput/shared/validators');
    const result = InstallPluginSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.config).toEqual({});
  });

  it('InstallPluginSchema accepts custom config', async () => {
    const { InstallPluginSchema } = await import('@greenput/shared/validators');
    const result = InstallPluginSchema.safeParse({
      config: { apiKey: 'sk-123', webhookUrl: 'https://example.com/hook' },
    });
    expect(result.success).toBe(true);
  });

  it('UpdatePluginConfigSchema requires config field', async () => {
    const { UpdatePluginConfigSchema } =
      await import('@greenput/shared/validators');
    expect(UpdatePluginConfigSchema.safeParse({}).success).toBe(false);
  });

  it('UpdatePluginConfigSchema accepts config with enabled toggle', async () => {
    const { UpdatePluginConfigSchema } =
      await import('@greenput/shared/validators');
    const result = UpdatePluginConfigSchema.safeParse({
      config: { apiKey: 'key-123' },
      enabled: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.config).toEqual({ apiKey: 'key-123' });
    }
  });

  it('UpdatePluginConfigSchema rejects non-object config', async () => {
    const { UpdatePluginConfigSchema } =
      await import('@greenput/shared/validators');
    expect(UpdatePluginConfigSchema.safeParse({ config: 'bad' }).success).toBe(
      false,
    );
  });

  it('PluginCategoryEnum validates all valid categories', async () => {
    const { PluginCategoryEnum } = await import('@greenput/shared/validators');
    const categories = [
      'general',
      'communication',
      'accounting',
      'scheduling',
      'marketing',
      'analytics',
    ];
    for (const category of categories) {
      expect(PluginCategoryEnum.safeParse(category).success).toBe(true);
    }
  });

  it('PluginCategoryEnum rejects invalid category', async () => {
    const { PluginCategoryEnum } = await import('@greenput/shared/validators');
    expect(PluginCategoryEnum.safeParse('invalid_category').success).toBe(
      false,
    );
  });
});
