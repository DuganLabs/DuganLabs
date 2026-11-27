import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList, toWire, toWireList } from '../lib/serialize';
import {
  WIRE_CUSTOMER,
  WIRE_JOB,
  WIRE_JOB_LINE_ITEM,
} from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from '@greenput/shared/validators';

export const customersRouter = Router({ base: '/api/customers' });

// GET /api/customers
customersRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as any).workspaceId;

  const q = url.searchParams.get('q');

  let where = 'WHERE c.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (q) {
    where +=
      ' AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.company LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT c.*
      FROM customers c
      ${where}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM customers c ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_CUSTOMER, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/customers/:id
customersRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const customerId = req.params!['id'];

  const customer = await env.DB.prepare(
    'SELECT * FROM customers WHERE id = ? AND workspace_id = ?',
  )
    .bind(customerId, workspaceId)
    .first<Record<string, unknown>>();

  if (!customer) return notFound('Customer');

  // Include job history
  const jobs = await env.DB.prepare(
    'SELECT * FROM jobs WHERE customer_id = ? AND workspace_id = ? ORDER BY scheduled_start DESC',
  )
    .bind(customerId, workspaceId)
    .all();

  // The nested jobs carry their line items too: `Job` declares `lineItems`, so
  // handing back a Job without them would be a response that does not match the
  // model it claims to be — the whole class of bug this contract exists to stop.
  const jobIds = jobs.results.map(
    (row) => (row as Record<string, unknown>)['id'] as string,
  );
  const lineItemsByJob = new Map<string, Record<string, unknown>[]>();
  if (jobIds.length > 0) {
    const placeholders = jobIds.map(() => '?').join(',');
    const lineItems = await env.DB.prepare(
      `SELECT * FROM job_line_items WHERE job_id IN (${placeholders})`,
    )
      .bind(...jobIds)
      .all();
    for (const li of lineItems.results) {
      const row = li as Record<string, unknown>;
      const jobId = row['job_id'] as string;
      if (!lineItemsByJob.has(jobId)) lineItemsByJob.set(jobId, []);
      lineItemsByJob.get(jobId)!.push(row);
    }
  }

  return entity(WIRE_CUSTOMER, customer, {
    jobs: jobs.results.map((row) => ({
      ...toWire<Record<string, unknown>>(
        WIRE_JOB,
        row as Record<string, unknown>,
      ),
      lineItems: toWireList(
        WIRE_JOB_LINE_ITEM,
        lineItemsByJob.get((row as Record<string, unknown>)['id'] as string) ??
          [],
      ),
    })),
  });
});

// POST /api/customers
customersRouter.post(
  '/',
  validate(CreateCustomerSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const body = (req as any).validatedBody as Record<string, unknown>;

    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `
    INSERT INTO customers (
      id, workspace_id, first_name, last_name, company, email, phone,
      preferred_contact, street, city, state, zip, notes,
      consent_given_at, consent_method, total_job_value, job_count,
      created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
      .bind(
        id,
        workspaceId,
        body.firstName,
        body.lastName,
        body.company ?? null,
        body.email ?? '',
        body.phone ?? '',
        body.preferredContact ?? 'phone',
        body.street ?? '',
        body.city ?? '',
        body.state ?? '',
        body.zip ?? '',
        body.notes ?? '',
        body.consentGivenAt ?? null,
        body.consentMethod ?? null,
        0,
        0,
        now,
        now,
        user.id,
      )
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'customer', ?, 'created', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    const customer = await env.DB.prepare(
      'SELECT * FROM customers WHERE id = ?',
    )
      .bind(id)
      .first<Record<string, unknown>>();
    return entity(WIRE_CUSTOMER, customer, {}, 201);
  },
);

// PATCH /api/customers/:id
customersRouter.patch(
  '/:id',
  validate(UpdateCustomerSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const customerId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id FROM customers WHERE id = ? AND workspace_id = ?',
    )
      .bind(customerId, workspaceId)
      .first();

    if (!existing) return notFound('Customer');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    const allowed = [
      'first_name',
      'last_name',
      'company',
      'email',
      'phone',
      'preferred_contact',
      'street',
      'city',
      'state',
      'zip',
      'notes',
      'consent_given_at',
      'consent_method',
    ];

    const camelToSnake: Record<string, string> = {
      firstName: 'first_name',
      lastName: 'last_name',
      preferredContact: 'preferred_contact',
      consentGivenAt: 'consent_given_at',
      consentMethod: 'consent_method',
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

    vals.push(customerId, workspaceId);

    await env.DB.prepare(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'customer', ?, 'updated', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, customerId, now)
      .run();

    const updated = await env.DB.prepare('SELECT * FROM customers WHERE id = ?')
      .bind(customerId)
      .first<Record<string, unknown>>();
    return entity(WIRE_CUSTOMER, updated);
  },
);

// DELETE /api/customers/:id
customersRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const customerId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM customers WHERE id = ? AND workspace_id = ?',
  )
    .bind(customerId, workspaceId)
    .first();

  if (!existing) return notFound('Customer');

  // Check for active jobs
  const activeJobs = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM jobs WHERE customer_id = ? AND status NOT IN ('paid', 'cancelled')",
  )
    .bind(customerId)
    .first<{ cnt: number }>();

  if (activeJobs && activeJobs.cnt > 0) {
    return error('Cannot delete customer with active jobs');
  }

  await env.DB.prepare(
    'DELETE FROM customers WHERE id = ? AND workspace_id = ?',
  )
    .bind(customerId, workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'customer', ?, 'deleted', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, customerId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});
