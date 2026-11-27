import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList } from '../lib/serialize';
import { WIRE_INSTALLED_PLUGIN, WIRE_PLUGIN } from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import {
  InstallPluginSchema,
  UpdatePluginConfigSchema,
} from '@greenput/shared/validators';

export const pluginsRouter = Router({ base: '/api/plugins' });

// ── GET /api/plugins/installed ───────────────────────────────────
// Must be defined before /:id to avoid matching "installed" as an id.

pluginsRouter.get('/installed', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT pi.id, pi.workspace_id, pi.plugin_id, pi.config, pi.enabled, pi.installed_at, pi.installed_by,
              p.name, p.slug, p.description, p.version, p.author, p.icon_url, p.category, p.events
       FROM plugin_installations pi
       JOIN plugins p ON pi.plugin_id = p.id
       WHERE pi.workspace_id = ?
       ORDER BY pi.installed_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(workspaceId, limit, offset)
      .all(),
    env.DB.prepare(
      'SELECT COUNT(*) AS total FROM plugin_installations WHERE workspace_id = ?',
    )
      .bind(workspaceId)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_INSTALLED_PLUGIN, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// ── GET /api/plugins ─────────────────────────────────────────────

pluginsRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);

  const category = url.searchParams.get('category');
  const q = url.searchParams.get('q');

  let where = 'WHERE active = 1';
  const params: unknown[] = [];

  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  if (q) {
    where += ' AND (name LIKE ? OR description LIKE ? OR author LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, slug, description, version, author, icon_url, category, events, config_schema, active, created_at
       FROM plugins
       ${where}
       ORDER BY name ASC
       LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM plugins ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_PLUGIN, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// ── GET /api/plugins/:id ─────────────────────────────────────────

pluginsRouter.get('/:id', async (req: IRequest, env: Env) => {
  const pluginId = req.params!['id'];

  const plugin = await env.DB.prepare(
    `SELECT id, name, slug, description, version, author, icon_url, category, events, config_schema, active, created_at
     FROM plugins
     WHERE id = ?`,
  )
    .bind(pluginId)
    .first<Record<string, unknown>>();

  if (!plugin) return notFound('Plugin');
  return entity(WIRE_PLUGIN, plugin);
});

// ── POST /api/plugins/:id/install ────────────────────────────────

pluginsRouter.post(
  '/:id/install',
  validate(InstallPluginSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as Record<string, unknown>).workspaceId as string;
    const user = (req as Record<string, unknown>).user as { id: string };
    const pluginId = req.params!['id'];
    const body = (req as Record<string, unknown>).validatedBody as {
      config: Record<string, unknown>;
    };

    // Verify plugin exists and is active
    const plugin = await env.DB.prepare(
      'SELECT id, name FROM plugins WHERE id = ? AND active = 1',
    )
      .bind(pluginId)
      .first<{ id: string; name: string }>();

    if (!plugin) return notFound('Plugin');

    // Check if already installed
    const existing = await env.DB.prepare(
      'SELECT id FROM plugin_installations WHERE workspace_id = ? AND plugin_id = ?',
    )
      .bind(workspaceId, pluginId)
      .first();

    if (existing) {
      return error('Plugin is already installed', 409, 'ALREADY_INSTALLED');
    }

    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO plugin_installations
         (id, workspace_id, plugin_id, config, enabled, installed_at, installed_by)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        id,
        workspaceId,
        pluginId,
        JSON.stringify(body.config),
        now,
        user.id,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log
         (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'plugin', ?, 'installed', ?, ?)`,
    )
      .bind(
        newId(),
        workspaceId,
        user.id,
        pluginId,
        JSON.stringify({ plugin_name: plugin.name }),
        now,
      )
      .run();

    const installation = await env.DB.prepare(
      `SELECT pi.id, pi.workspace_id, pi.plugin_id, pi.config, pi.enabled, pi.installed_at, pi.installed_by,
              p.name, p.slug, p.description, p.version, p.author, p.icon_url, p.category, p.events
       FROM plugin_installations pi
       JOIN plugins p ON pi.plugin_id = p.id
       WHERE pi.id = ?`,
    )
      .bind(id)
      .first<Record<string, unknown>>();

    return entity(WIRE_INSTALLED_PLUGIN, installation, {}, 201);
  },
);

// ── PATCH /api/plugins/:id/config ────────────────────────────────

pluginsRouter.patch(
  '/:id/config',
  validate(UpdatePluginConfigSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as Record<string, unknown>).workspaceId as string;
    const user = (req as Record<string, unknown>).user as { id: string };
    const pluginId = req.params!['id'];
    const body = (req as Record<string, unknown>).validatedBody as {
      config: Record<string, unknown>;
      enabled?: boolean;
    };

    const existing = await env.DB.prepare(
      'SELECT id FROM plugin_installations WHERE workspace_id = ? AND plugin_id = ?',
    )
      .bind(workspaceId, pluginId)
      .first<{ id: string }>();

    if (!existing) return notFound('Plugin installation');

    const sets: string[] = ['config = ?'];
    const vals: unknown[] = [JSON.stringify(body.config)];

    if (body.enabled !== undefined) {
      sets.push('enabled = ?');
      vals.push(body.enabled ? 1 : 0);
    }

    vals.push(workspaceId, pluginId);

    await env.DB.prepare(
      `UPDATE plugin_installations SET ${sets.join(', ')} WHERE workspace_id = ? AND plugin_id = ?`,
    )
      .bind(...vals)
      .run();

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO activity_log
         (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
       VALUES (?, ?, ?, 'plugin', ?, 'config_updated', ?)`,
    )
      .bind(newId(), workspaceId, user.id, pluginId, now)
      .run();

    const updated = await env.DB.prepare(
      `SELECT pi.id, pi.workspace_id, pi.plugin_id, pi.config, pi.enabled, pi.installed_at, pi.installed_by,
              p.name, p.slug, p.description, p.version, p.author, p.icon_url, p.category, p.events
       FROM plugin_installations pi
       JOIN plugins p ON pi.plugin_id = p.id
       WHERE pi.workspace_id = ? AND pi.plugin_id = ?`,
    )
      .bind(workspaceId, pluginId)
      .first<Record<string, unknown>>();

    return entity(WIRE_INSTALLED_PLUGIN, updated);
  },
);

// ── DELETE /api/plugins/:id/uninstall ────────────────────────────

pluginsRouter.delete('/:id/uninstall', async (req: IRequest, env: Env) => {
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;
  const user = (req as Record<string, unknown>).user as { id: string };
  const pluginId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM plugin_installations WHERE workspace_id = ? AND plugin_id = ?',
  )
    .bind(workspaceId, pluginId)
    .first();

  if (!existing) return notFound('Plugin installation');

  await env.DB.prepare(
    'DELETE FROM plugin_installations WHERE workspace_id = ? AND plugin_id = ?',
  )
    .bind(workspaceId, pluginId)
    .run();

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO activity_log
       (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
     VALUES (?, ?, ?, 'plugin', ?, 'uninstalled', ?)`,
  )
    .bind(newId(), workspaceId, user.id, pluginId, now)
    .run();

  return json({ data: { deleted: true } });
});
