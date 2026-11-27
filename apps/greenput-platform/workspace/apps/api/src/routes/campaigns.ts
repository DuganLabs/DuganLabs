import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList } from '../lib/serialize';
import { WIRE_CAMPAIGN } from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import {
  CreateCampaignSchema,
  UpdateCampaignSchema,
} from '@greenput/shared/validators';

export const campaignsRouter = Router({ base: '/api/campaigns' });

/**
 * Every campaign read carries `lead_count` — `COUNT(DISTINCT l.id)` over the
 * leads that cite this campaign, the same join `/api/reports/campaigns` uses —
 * beside the typed `leads_generated`, so `WIRE_CAMPAIGN` can derive
 * `leadCount` and /campaigns shows the number /reports divides by (GP-034).
 */
const CAMPAIGN_SELECT = `
  SELECT c.*, COUNT(DISTINCT l.id) AS lead_count
  FROM campaigns c
  LEFT JOIN leads l
    ON l.campaign_id = c.id
    AND l.workspace_id = c.workspace_id`;

/** One campaign with its counted leads; null when it is not in the workspace. */
async function loadCampaign(
  env: Env,
  id: string,
  workspaceId: string,
): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(
    `${CAMPAIGN_SELECT}
     WHERE c.id = ? AND c.workspace_id = ?
     GROUP BY c.id`,
  )
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();
}

// GET /api/campaigns
campaignsRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as any).workspaceId;

  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');

  let where = 'WHERE c.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (status) {
    where += ' AND c.status = ?';
    params.push(status);
  }
  if (q) {
    where += ' AND (c.name LIKE ? OR c.channel LIKE ? OR c.target_area LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `${CAMPAIGN_SELECT}
      ${where}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM campaigns c ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_CAMPAIGN, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/campaigns/:id
campaignsRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const campaign = await loadCampaign(env, req.params!['id'], workspaceId);

  if (!campaign) return notFound('Campaign');
  return entity(WIRE_CAMPAIGN, campaign);
});

// POST /api/campaigns
campaignsRouter.post(
  '/',
  validate(CreateCampaignSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const body = (req as any).validatedBody as Record<string, unknown>;

    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `
    INSERT INTO campaigns (
      id, workspace_id, name, status, channel, target_area, budget, spent,
      leads_generated, start_date, end_date, notes, created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
      .bind(
        id,
        workspaceId,
        body.name,
        body.status ?? 'draft',
        body.channel,
        body.targetArea ?? null,
        body.budget ?? null,
        body.spent ?? 0,
        0,
        body.startDate,
        body.endDate ?? null,
        body.notes ?? '',
        now,
        now,
        user.id,
      )
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'campaign', ?, 'created', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    const campaign = await loadCampaign(env, id, workspaceId);
    return entity(WIRE_CAMPAIGN, campaign, {}, 201);
  },
);

// PATCH /api/campaigns/:id
campaignsRouter.patch(
  '/:id',
  validate(UpdateCampaignSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const campaignId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id FROM campaigns WHERE id = ? AND workspace_id = ?',
    )
      .bind(campaignId, workspaceId)
      .first();

    if (!existing) return notFound('Campaign');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    const allowed = [
      'name',
      'status',
      'channel',
      'target_area',
      'budget',
      'spent',
      'leads_generated',
      'start_date',
      'end_date',
      'notes',
    ];

    const camelToSnake: Record<string, string> = {
      targetArea: 'target_area',
      startDate: 'start_date',
      endDate: 'end_date',
      leadsGenerated: 'leads_generated',
    };

    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];

    for (const [key, val] of Object.entries(body)) {
      const col = camelToSnake[key] ?? key;
      if (allowed.includes(col)) {
        sets.push(`${col} = ?`);
        vals.push(val);
      }
    }

    vals.push(campaignId, workspaceId);

    await env.DB.prepare(
      `UPDATE campaigns SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'campaign', ?, 'updated', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, campaignId, now)
      .run();

    const updated = await loadCampaign(env, campaignId, workspaceId);
    return entity(WIRE_CAMPAIGN, updated);
  },
);

// DELETE /api/campaigns/:id
campaignsRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const campaignId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM campaigns WHERE id = ? AND workspace_id = ?',
  )
    .bind(campaignId, workspaceId)
    .first();

  if (!existing) return notFound('Campaign');

  await env.DB.prepare(
    'DELETE FROM campaigns WHERE id = ? AND workspace_id = ?',
  )
    .bind(campaignId, workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'campaign', ?, 'deleted', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, campaignId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});
