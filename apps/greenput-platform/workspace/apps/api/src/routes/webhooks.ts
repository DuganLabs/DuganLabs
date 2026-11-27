import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList, toWireList } from '../lib/serialize';
import { WIRE_WEBHOOK, WIRE_WEBHOOK_DELIVERY } from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import { dispatchWebhooks } from '../lib/webhooks/dispatcher';
import {
  CreateWebhookSchema,
  UpdateWebhookSchema,
} from '@greenput/shared/validators';

export const webhooksRouter = Router({ base: '/api/webhooks' });

// ── Helpers ──────────────────────────────────────────────────────

/** Generate a random webhook secret (64 hex chars). */
async function generateSecret(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── GET /api/webhooks ────────────────────────────────────────────

webhooksRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, workspace_id, url, events, active, created_at, updated_at
       FROM webhooks
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(workspaceId, limit, offset)
      .all(),
    env.DB.prepare(
      'SELECT COUNT(*) AS total FROM webhooks WHERE workspace_id = ?',
    )
      .bind(workspaceId)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_WEBHOOK, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// ── GET /api/webhooks/:id ────────────────────────────────────────

webhooksRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;
  const webhookId = req.params!['id'];

  const webhook = await env.DB.prepare(
    `SELECT id, workspace_id, url, events, secret, active, created_at, updated_at
     FROM webhooks
     WHERE id = ? AND workspace_id = ?`,
  )
    .bind(webhookId, workspaceId)
    .first<Record<string, unknown>>();

  if (!webhook) return notFound('Webhook');

  // Fetch recent deliveries
  const deliveries = await env.DB.prepare(
    `SELECT id, event_type, status_code, attempts, delivered_at, created_at
     FROM webhook_deliveries
     WHERE webhook_id = ?
     ORDER BY created_at DESC
     LIMIT 25`,
  )
    .bind(webhookId)
    .all();

  return entity(WIRE_WEBHOOK, webhook, {
    deliveries: toWireList(WIRE_WEBHOOK_DELIVERY, deliveries.results),
  });
});

// ── POST /api/webhooks ───────────────────────────────────────────

webhooksRouter.post(
  '/',
  validate(CreateWebhookSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as Record<string, unknown>).workspaceId as string;
    const user = (req as Record<string, unknown>).user as { id: string };
    const body = (req as Record<string, unknown>).validatedBody as {
      url: string;
      events: string[];
    };

    const id = newId();
    const secret = await generateSecret();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO webhooks
         (id, workspace_id, url, events, secret, active, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
      .bind(
        id,
        workspaceId,
        body.url,
        JSON.stringify(body.events),
        secret,
        now,
        now,
        user.id,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log
         (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
       VALUES (?, ?, ?, 'webhook', ?, 'created', ?)`,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    const webhook = await env.DB.prepare(
      'SELECT id, workspace_id, url, events, secret, active, created_at, updated_at FROM webhooks WHERE id = ?',
    )
      .bind(id)
      .first<Record<string, unknown>>();

    return entity(WIRE_WEBHOOK, webhook, {}, 201);
  },
);

// ── PATCH /api/webhooks/:id ──────────────────────────────────────

webhooksRouter.patch(
  '/:id',
  validate(UpdateWebhookSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as Record<string, unknown>).workspaceId as string;
    const user = (req as Record<string, unknown>).user as { id: string };
    const webhookId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id FROM webhooks WHERE id = ? AND workspace_id = ?',
    )
      .bind(webhookId, workspaceId)
      .first();

    if (!existing) return notFound('Webhook');

    const body = (req as Record<string, unknown>).validatedBody as Record<
      string,
      unknown
    >;
    const now = new Date().toISOString();

    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];

    if (body.url !== undefined) {
      sets.push('url = ?');
      vals.push(body.url);
    }
    if (body.events !== undefined) {
      sets.push('events = ?');
      vals.push(JSON.stringify(body.events));
    }
    if (body.active !== undefined) {
      sets.push('active = ?');
      vals.push(body.active ? 1 : 0);
    }

    vals.push(webhookId, workspaceId);

    await env.DB.prepare(
      `UPDATE webhooks SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log
         (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
       VALUES (?, ?, ?, 'webhook', ?, 'updated', ?)`,
    )
      .bind(newId(), workspaceId, user.id, webhookId, now)
      .run();

    const updated = await env.DB.prepare(
      'SELECT id, workspace_id, url, events, secret, active, created_at, updated_at FROM webhooks WHERE id = ?',
    )
      .bind(webhookId)
      .first<Record<string, unknown>>();

    return entity(WIRE_WEBHOOK, updated);
  },
);

// ── DELETE /api/webhooks/:id ─────────────────────────────────────

webhooksRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;
  const user = (req as Record<string, unknown>).user as { id: string };
  const webhookId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM webhooks WHERE id = ? AND workspace_id = ?',
  )
    .bind(webhookId, workspaceId)
    .first();

  if (!existing) return notFound('Webhook');

  await env.DB.prepare('DELETE FROM webhooks WHERE id = ? AND workspace_id = ?')
    .bind(webhookId, workspaceId)
    .run();

  await env.DB.prepare(
    `INSERT INTO activity_log
       (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
     VALUES (?, ?, ?, 'webhook', ?, 'deleted', ?)`,
  )
    .bind(newId(), workspaceId, user.id, webhookId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});

// ── POST /api/webhooks/:id/test ──────────────────────────────────

webhooksRouter.post('/:id/test', async (req: IRequest, env: Env) => {
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;
  const webhookId = req.params!['id'];

  const webhook = await env.DB.prepare(
    'SELECT id, url, secret, events FROM webhooks WHERE id = ? AND workspace_id = ?',
  )
    .bind(webhookId, workspaceId)
    .first<{ id: string; url: string; secret: string; events: string }>();

  if (!webhook) return notFound('Webhook');

  // Dispatch a test.ping event directly to this specific webhook
  try {
    await dispatchWebhooks(env, workspaceId, 'test.ping', {
      message: 'This is a test webhook delivery from Greenput.',
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to send test webhook';
    return error(message, 500, 'WEBHOOK_TEST_FAILED');
  }

  return json({ data: { sent: true } });
});
