import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList } from '../lib/serialize';
import { WIRE_OPPORTUNITY } from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import {
  CreateOpportunitySchema,
  UpdateOpportunitySchema,
  ConvertOpportunitySchema,
} from '@greenput/shared/validators';
import {
  bookInFreeLane,
  slotInsertStatements,
  slotStartsFor,
  slotTaken,
} from '../lib/job-slots';

/** Default job length when `convert` is called without a `scheduledEnd`. */
const DEFAULT_JOB_DURATION_MS = 2 * 60 * 60 * 1000;

export const opportunitiesRouter = Router({ base: '/api/opportunities' });

// GET /api/opportunities
opportunitiesRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as any).workspaceId;

  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');

  let where = 'WHERE o.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (status) {
    where += ' AND o.status = ?';
    params.push(status);
  }
  if (q) {
    where +=
      ' AND (o.title LIKE ? OR l.first_name LIKE ? OR l.last_name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT o.*, l.first_name AS lead_first_name, l.last_name AS lead_last_name
      FROM opportunities o
      LEFT JOIN leads l ON o.lead_id = l.id
      ${where}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM opportunities o LEFT JOIN leads l ON o.lead_id = l.id ${where}`,
    )
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_OPPORTUNITY, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/opportunities/:id
opportunitiesRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const opp = await env.DB.prepare(
    'SELECT * FROM opportunities WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params!['id'], workspaceId)
    .first<Record<string, unknown>>();

  if (!opp) return notFound('Opportunity');
  return entity(WIRE_OPPORTUNITY, opp);
});

// POST /api/opportunities
opportunitiesRouter.post(
  '/',
  validate(CreateOpportunitySchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const body = (req as any).validatedBody as Record<string, unknown>;

    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `
    INSERT INTO opportunities (
      id, workspace_id, lead_id, customer_id, title, status, value,
      service_type, notes, created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
      .bind(
        id,
        workspaceId,
        body.leadId,
        body.customerId ?? null,
        body.title,
        body.status ?? 'open',
        body.value ?? 0,
        body.serviceType ?? '',
        body.notes ?? '',
        now,
        now,
        user.id,
      )
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'opportunity', ?, 'created', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    const opp = await env.DB.prepare('SELECT * FROM opportunities WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();
    return entity(WIRE_OPPORTUNITY, opp, {}, 201);
  },
);

// PATCH /api/opportunities/:id
opportunitiesRouter.patch(
  '/:id',
  validate(UpdateOpportunitySchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const oppId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id FROM opportunities WHERE id = ? AND workspace_id = ?',
    )
      .bind(oppId, workspaceId)
      .first();

    if (!existing) return notFound('Opportunity');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    const allowed = [
      'title',
      'status',
      'value',
      'service_type',
      'notes',
      'customer_id',
      'proposal_sent_at',
      'closed_at',
    ];

    const camelToSnake: Record<string, string> = {
      serviceType: 'service_type',
      customerId: 'customer_id',
      proposalSentAt: 'proposal_sent_at',
      closedAt: 'closed_at',
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

    // Auto-set proposal_sent_at when status changes to proposal_sent
    if (body.status === 'proposal_sent' && !body.proposalSentAt) {
      sets.push('proposal_sent_at = ?');
      vals.push(now);
    }
    // Auto-set closed_at when status changes to won or lost
    if ((body.status === 'won' || body.status === 'lost') && !body.closedAt) {
      sets.push('closed_at = ?');
      vals.push(now);
    }

    vals.push(oppId, workspaceId);

    await env.DB.prepare(
      `UPDATE opportunities SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'opportunity', ?, 'updated', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, oppId, now)
      .run();

    const updated = await env.DB.prepare(
      'SELECT * FROM opportunities WHERE id = ?',
    )
      .bind(oppId)
      .first<Record<string, unknown>>();
    return entity(WIRE_OPPORTUNITY, updated);
  },
);

// DELETE /api/opportunities/:id
opportunitiesRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const oppId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM opportunities WHERE id = ? AND workspace_id = ?',
  )
    .bind(oppId, workspaceId)
    .first();

  if (!existing) return notFound('Opportunity');

  await env.DB.prepare(
    'DELETE FROM opportunities WHERE id = ? AND workspace_id = ?',
  )
    .bind(oppId, workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'opportunity', ?, 'deleted', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, oppId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});

// POST /api/opportunities/:id/convert — Opportunity → Job + Customer
opportunitiesRouter.post(
  '/:id/convert',
  validate(ConvertOpportunitySchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const oppId = req.params!['id'];

    const opp = await env.DB.prepare(
      'SELECT * FROM opportunities WHERE id = ? AND workspace_id = ?',
    )
      .bind(oppId, workspaceId)
      .first<Record<string, unknown>>();

    if (!opp) return notFound('Opportunity');
    if (opp['converted_to_job_id'])
      return error('Opportunity already converted to a job');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    // Get the related lead for address/contact info
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?')
      .bind(opp['lead_id'])
      .first<Record<string, unknown>>();

    // Generate job number
    const lastJob = await env.DB.prepare(
      'SELECT job_number FROM jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1',
    )
      .bind(workspaceId)
      .first<{ job_number: string }>();

    const lastNum = lastJob
      ? parseInt(lastJob.job_number.replace('#', ''), 10)
      : 1000;
    const jobNumber = `#${lastNum + 1}`;

    const jobId = newId();
    // GP-037: without a schedule the job used to start and end at the same
    // instant — a zero-height block on the calendar. Two hours matches the
    // client's calendar-drop default, so every path that creates a job
    // without an explicit end produces the same duration.
    const scheduledStart = (body.scheduledStart as string | undefined) ?? now;
    const scheduledEnd =
      (body.scheduledEnd as string | undefined) ??
      new Date(
        new Date(scheduledStart).getTime() + DEFAULT_JOB_DURATION_MS,
      ).toISOString();

    // Create or link customer. The customer row is part of the booking
    // batch below, so a taken slot leaves no half-converted opportunity: no
    // customer, no job, no 'won' flip.
    const existingCustomerId = opp['customer_id'] as string | null;
    const customerId = existingCustomerId ?? (lead ? newId() : null);
    const customerStatements = (): D1PreparedStatement[] => {
      if (existingCustomerId || !lead || !customerId) return [];
      return [
        env.DB.prepare(
          `
      INSERT INTO customers (
        id, workspace_id, first_name, last_name, email, phone, preferred_contact,
        street, city, state, zip, notes, total_job_value, job_count,
        created_at, updated_at, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `,
        ).bind(
          customerId,
          workspaceId,
          lead['first_name'],
          lead['last_name'],
          lead['email'] ?? '',
          lead['phone'] ?? '',
          lead['preferred_contact'] ?? 'phone',
          lead['street'] ?? '',
          lead['city'] ?? '',
          lead['state'] ?? '',
          lead['zip'] ?? '',
          '',
          0,
          0,
          now,
          now,
          user.id,
        ),
        env.DB.prepare(
          `
      INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
      VALUES (?, ?, ?, 'customer', ?, 'created', ?)
    `,
        ).bind(newId(), workspaceId, user.id, customerId, now),
      ];
    };

    // GP-104: the job and its half-hour slot rows are written in ONE batch;
    // the PRIMARY KEY on job_slots is the double-booking guard and a
    // collision rolls the whole conversion back.
    const slotStarts = slotStartsFor(scheduledStart, scheduledEnd);
    const lane = await bookInFreeLane(env.DB, workspaceId, (lane) => [
      ...customerStatements(),
      env.DB.prepare(
        `
    INSERT INTO jobs (
      id, workspace_id, opportunity_id, customer_id, job_number, title, status,
      street, city, state, zip, scheduled_start, scheduled_end,
      total, notes, created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
      ).bind(
        jobId,
        workspaceId,
        oppId,
        customerId!,
        jobNumber,
        (body.title as string) ?? opp['title'],
        'scheduled',
        lead?.['street'] ?? '',
        lead?.['city'] ?? '',
        lead?.['state'] ?? '',
        lead?.['zip'] ?? '',
        scheduledStart,
        scheduledEnd,
        opp['value'] ?? 0,
        (body.notes as string) ?? '',
        now,
        now,
        user.id,
      ),
      ...slotInsertStatements(env.DB, {
        workspaceId,
        jobId,
        lane,
        slotStarts,
      }),
      env.DB.prepare(
        `
    UPDATE opportunities
    SET status = 'won', converted_to_job_id = ?, customer_id = ?, closed_at = ?, updated_at = ?
    WHERE id = ?
  `,
      ).bind(jobId, customerId!, now, now, oppId),
      env.DB.prepare(
        `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
    VALUES (?, ?, ?, 'opportunity', ?, 'converted', ?, ?)
  `,
      ).bind(
        newId(),
        workspaceId,
        user.id,
        oppId,
        JSON.stringify({ jobId, customerId }),
        now,
      ),
    ]);
    if (lane === null) return slotTaken();

    return json({ data: { jobId, customerId, jobNumber } }, 201);
  },
);
