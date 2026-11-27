import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { changeOrderRequired } from '../lib/change-order-required';
import { json, error, notFound, newId, paginate } from '../lib/response';
import {
  entity,
  entityArray,
  entityList,
  entityShared,
  toWire,
  toWireList,
} from '../lib/serialize';
import {
  WIRE_JOB,
  WIRE_JOB_LINE_ITEM,
  WIRE_SCHEDULE_BLOCK,
} from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import { CreateJobSchema, UpdateJobSchema } from '@greenput/shared/validators';
import {
  bookInFreeLane,
  slotDeleteStatement,
  slotInsertStatements,
  slotStartsFor,
  slotTaken,
} from '../lib/job-slots';
import {
  generateInvoiceHtml,
  InvoiceJobRow,
  InvoiceLineItemRow,
  InvoiceCustomerRow,
  InvoiceWorkspaceRow,
} from '@greenput/shared/documents';
import { invoiceShareLink } from '@greenput/shared/utils';
import {
  ROUTE_ONLY_JOB_STATUSES,
  canPatchJobStatus,
  canTransitionJobStatus,
} from '@greenput/shared/models';
import { tenantOrigin } from '../lib/origins';
import { applyDeposit, forfeitDeposit, releaseDeposit } from '../lib/deposits';

export const jobsRouter = Router({ base: '/api/jobs' });

/** The roles a job can be assigned to — the ones the Technicians report counts. */
const ASSIGNABLE_ROLES = ['owner', 'admin', 'tech'] as const;

/**
 * GP-034: `assignedTo` must name a user in THIS workspace with an assignable
 * role. A UUID from another workspace, or an office user, is a 400 — the FK
 * alone would accept any users row, and the report would then credit revenue
 * to someone who cannot appear in it.
 */
async function assigneeRejection(
  env: Env,
  workspaceId: string,
  assignedTo: unknown,
): Promise<Response | null> {
  if (typeof assignedTo !== 'string') return null;
  const placeholders = ASSIGNABLE_ROLES.map(() => '?').join(',');
  const row = await env.DB.prepare(
    `SELECT id FROM users WHERE id = ? AND workspace_id = ? AND role IN (${placeholders})`,
  )
    .bind(assignedTo, workspaceId, ...ASSIGNABLE_ROLES)
    .first<{ id: string }>();
  if (row) return null;
  return error(
    'assignedTo must be an owner, admin or tech in this workspace',
    400,
    'VALIDATION_ERROR',
  );
}

// GET /api/jobs
jobsRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as any).workspaceId;

  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');

  let where = 'WHERE j.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (status) {
    where += ' AND j.status = ?';
    params.push(status);
  }
  if (q) {
    where +=
      ' AND (j.title LIKE ? OR j.job_number LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT j.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name
      FROM jobs j
      LEFT JOIN customers c ON j.customer_id = c.id
      ${where}
      ORDER BY j.scheduled_start DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id ${where}`,
    )
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  // Fetch line items for each job
  const jobIds = rows.results.map(
    (r: Record<string, unknown>) => r['id'] as string,
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
      const jid = row['job_id'] as string;
      if (!lineItemsByJob.has(jid)) lineItemsByJob.set(jid, []);
      lineItemsByJob.get(jid)!.push(row);
    }
  }

  const data = rows.results.map((r: Record<string, unknown>) => ({
    ...toWire<Record<string, unknown>>(WIRE_JOB, r),
    lineItems: toWireList(
      WIRE_JOB_LINE_ITEM,
      lineItemsByJob.get(r['id'] as string) ?? [],
    ),
  }));

  return json({
    data,
    meta: { total: countRow?.total ?? 0, page, perPage: limit },
  });
});

// GET /api/jobs/schedule — returns time blocks for calendar rendering
jobsRouter.get('/schedule', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const workspaceId = (req as any).workspaceId;

  const start =
    url.searchParams.get('start') || new Date().toISOString().split('T')[0];
  const end =
    url.searchParams.get('end') ||
    new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  const techId = url.searchParams.get('techId');

  // Every status but cancelled: a contractor looking at last week must see
  // the work that happened there, so finished (completed / invoiced / paid)
  // jobs stay on the calendar. Only cancelled work leaves the grid.
  let where = `WHERE j.workspace_id = ? AND j.status IN ('scheduled', 'in_progress', 'completed', 'invoiced', 'paid') AND j.scheduled_start >= ? AND j.scheduled_start <= ?`;
  const params: unknown[] = [
    workspaceId,
    `${start}T00:00:00`,
    `${end}T23:59:59`,
  ];

  // GP-034: the technician filter is the assignee, never created_by — that
  // would filter by whoever typed the job in.
  if (techId) {
    where += ' AND j.assigned_to = ?';
    params.push(techId);
  }

  const rows = await env.DB.prepare(
    `
    SELECT j.id, j.title, j.job_number, j.status, j.scheduled_start, j.scheduled_end,
           j.customer_id, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
           j.street, j.city,
           j.assigned_to, a.first_name AS assignee_first_name, a.last_name AS assignee_last_name
    FROM jobs j
    LEFT JOIN customers c ON j.customer_id = c.id
    LEFT JOIN users a ON j.assigned_to = a.id
    ${where}
    ORDER BY j.scheduled_start ASC
  `,
  )
    .bind(...params)
    .all();

  // Not paginated: a week is a bounded window, and the calendar needs all of it.
  return entityArray(WIRE_SCHEDULE_BLOCK, rows.results);
});

// GET /api/jobs/:id
jobsRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const job = await env.DB.prepare(
    'SELECT * FROM jobs WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params!['id'], workspaceId)
    .first<Record<string, unknown>>();

  if (!job) return notFound('Job');

  const lineItems = await env.DB.prepare(
    'SELECT * FROM job_line_items WHERE job_id = ?',
  )
    .bind(req.params!['id'])
    .all();

  return entity(WIRE_JOB, job, {
    lineItems: toWireList(WIRE_JOB_LINE_ITEM, lineItems.results),
  });
});

// POST /api/jobs
jobsRouter.post(
  '/',
  validate(CreateJobSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const body = (req as any).validatedBody as Record<string, unknown>;

    const rejected = await assigneeRejection(env, workspaceId, body.assignedTo);
    if (rejected) return rejected;

    const id = newId();
    const now = new Date().toISOString();

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

    const status = (body.status as string | undefined) ?? 'scheduled';
    const scheduledStart = (body.scheduledStart as string | undefined) ?? now;
    const scheduledEnd = (body.scheduledEnd as string | undefined) ?? now;
    const lineItems = (body.lineItems as Array<Record<string, unknown>>) ?? [];
    // GP-104: a cancelled job holds no time; everything else claims its
    // half-hours. The job, its slot rows, its line items and the audit row
    // go in ONE batch so a taken slot leaves nothing behind.
    const slotStarts =
      status === 'cancelled' ? [] : slotStartsFor(scheduledStart, scheduledEnd);

    const lane = await bookInFreeLane(env.DB, workspaceId, (lane) => [
      env.DB.prepare(
        `
    INSERT INTO jobs (
      id, workspace_id, opportunity_id, customer_id, job_number, title, status,
      street, city, state, zip, scheduled_start, scheduled_end,
      total, notes, created_at, updated_at, created_by, assigned_to
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
      ).bind(
        id,
        workspaceId,
        body.opportunityId,
        body.customerId,
        jobNumber,
        body.title,
        status,
        body.street ?? '',
        body.city ?? '',
        body.state ?? '',
        body.zip ?? '',
        scheduledStart,
        scheduledEnd,
        body.total ?? 0,
        body.notes ?? '',
        now,
        now,
        user.id,
        (body.assignedTo as string | undefined) ?? null,
      ),
      ...slotInsertStatements(env.DB, {
        workspaceId,
        jobId: id,
        lane,
        slotStarts,
      }),
      ...lineItems.map((li) => {
        // Whole cents: quantity can be fractional (billed hours), and a
        // fractional cent on a line item propagates into the job total and
        // onto the invoice.
        const total = Math.round(
          (Number(li.quantity) || 1) * (Number(li.unitPrice) || 0),
        );
        return env.DB.prepare(
          `
      INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
        ).bind(
          newId(),
          id,
          li.description ?? '',
          li.quantity ?? 1,
          li.unitPrice ?? 0,
          total,
        );
      }),
      env.DB.prepare(
        `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'job', ?, 'created', ?)
  `,
      ).bind(newId(), workspaceId, user.id, id, now),
    ]);
    if (lane === null) return slotTaken();

    const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();
    const items = await env.DB.prepare(
      'SELECT * FROM job_line_items WHERE job_id = ?',
    )
      .bind(id)
      .all();

    return entity(
      WIRE_JOB,
      job,
      { lineItems: toWireList(WIRE_JOB_LINE_ITEM, items.results) },
      201,
    );
  },
);

// PATCH /api/jobs/:id
jobsRouter.patch(
  '/:id',
  validate(UpdateJobSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const jobId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id, status, scheduled_start, scheduled_end FROM jobs WHERE id = ? AND workspace_id = ?',
    )
      .bind(jobId, workspaceId)
      .first<{
        id: string;
        status: string;
        scheduled_start: string;
        scheduled_end: string;
      }>();

    if (!existing) return notFound('Job');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    // A job's price moves only through a change order (routes/change-orders.ts),
    // which keeps who proposed it, who approved it and what it was before.
    // Replacing line items here used to rewrite the price with no trail.
    if (body.lineItems !== undefined || body.total !== undefined) {
      return changeOrderRequired('job');
    }

    // The explicit transition table (JOB_STATUS_TRANSITIONS) gates every
    // status change; invoiced / paid are reached only through their own
    // routes below. A refused move writes nothing, not even the other
    // fields in the same body.
    if (
      body.status !== undefined &&
      !canPatchJobStatus(existing.status, body.status as string)
    ) {
      const to = body.status as string;
      const routeOnly = (ROUTE_ONLY_JOB_STATUSES as readonly string[]).includes(
        to,
      );
      return error(
        routeOnly && canTransitionJobStatus(existing.status, to)
          ? `Use the ${to === 'invoiced' ? 'invoice' : 'mark-paid'} action to move a job to ${to}`
          : `A job cannot move from ${existing.status} to ${to}`,
        409,
        'INVALID_TRANSITION',
      );
    }

    // `assignedTo: null` unassigns and needs no lookup; a string must be one
    // of this workspace's technicians.
    const rejected = await assigneeRejection(env, workspaceId, body.assignedTo);
    if (rejected) return rejected;

    const allowed = [
      'title',
      'status',
      'street',
      'city',
      'state',
      'zip',
      'scheduled_start',
      'scheduled_end',
      'actual_start',
      'actual_end',
      'notes',
      'invoiced_at',
      'paid_at',
      'assigned_to',
    ];

    const camelToSnake: Record<string, string> = {
      scheduledStart: 'scheduled_start',
      scheduledEnd: 'scheduled_end',
      actualStart: 'actual_start',
      actualEnd: 'actual_end',
      invoicedAt: 'invoiced_at',
      paidAt: 'paid_at',
      assignedTo: 'assigned_to',
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

    vals.push(jobId, workspaceId);

    const update = () =>
      env.DB.prepare(
        `UPDATE jobs SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
      ).bind(...vals);
    const audit = () =>
      env.DB.prepare(
        `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'job', ?, 'updated', ?)
  `,
      ).bind(newId(), workspaceId, user.id, jobId, now);

    // GP-104: the update and the slot bookkeeping are one batch. Cancelling
    // frees the job's half-hours; a new schedule (the panel, or the calendar
    // drag, which PATCHes the same way) drops the old rows and claims the new
    // ones in the same transaction, so a job can move onto time it held
    // itself, and a taken slot rolls the whole PATCH back.
    const nextStatus = (body.status as string | undefined) ?? existing.status;
    const scheduleChanged =
      body.scheduledStart !== undefined || body.scheduledEnd !== undefined;
    if (nextStatus === 'cancelled') {
      await env.DB.batch([
        update(),
        slotDeleteStatement(env.DB, jobId),
        audit(),
      ]);
    } else if (scheduleChanged || existing.status === 'cancelled') {
      const slotStarts = slotStartsFor(
        (body.scheduledStart as string | undefined) ?? existing.scheduled_start,
        (body.scheduledEnd as string | undefined) ?? existing.scheduled_end,
      );
      const lane = await bookInFreeLane(env.DB, workspaceId, (lane) => [
        update(),
        slotDeleteStatement(env.DB, jobId),
        ...slotInsertStatements(env.DB, {
          workspaceId,
          jobId,
          lane,
          slotStarts,
        }),
        audit(),
      ]);
      if (lane === null) return slotTaken();
    } else {
      await env.DB.batch([update(), audit()]);
    }

    // Booking-deposit settlement rides the same transitions (fee
    // paper v2 §3, lib/deposits.ts): completing a job applies its
    // deposit in full to the shop; a shop-side cancel releases it in
    // full — the shop cancelling is never a forfeit. The forfeit path
    // is deliberately NOT here: it belongs to the customer's side
    // (withdraw inside the window, or POST /:id/no-show). Deposit
    // failures are recorded on the deposit row, never thrown into
    // the PATCH.
    if (body.status === 'completed' && existing.status !== 'completed') {
      await applyDeposit(env, {
        workspaceId,
        jobId,
        actorUserId: user.id,
      }).catch(() => undefined);
    } else if (body.status === 'cancelled' && existing.status !== 'cancelled') {
      await releaseDeposit(env, {
        workspaceId,
        jobId,
        reason: 'shop_cancel',
        actorUserId: user.id,
      }).catch(() => undefined);
    }

    const updated = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?')
      .bind(jobId)
      .first<Record<string, unknown>>();
    const items = await env.DB.prepare(
      'SELECT * FROM job_line_items WHERE job_id = ?',
    )
      .bind(jobId)
      .all();

    return entity(WIRE_JOB, updated, {
      lineItems: toWireList(WIRE_JOB_LINE_ITEM, items.results),
    });
  },
);

// DELETE /api/jobs/:id
jobsRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const jobId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM jobs WHERE id = ? AND workspace_id = ?',
  )
    .bind(jobId, workspaceId)
    .first();

  if (!existing) return notFound('Job');

  // Line items and job_slots (GP-104) cascade via FK
  await env.DB.prepare('DELETE FROM jobs WHERE id = ? AND workspace_id = ?')
    .bind(jobId, workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'job', ?, 'deleted', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, jobId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});

// GET /api/jobs/:id/invoice — render invoice as HTML
jobsRouter.get('/:id/invoice', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const jobId = req.params!['id'];

  const job = await env.DB.prepare(
    'SELECT * FROM jobs WHERE id = ? AND workspace_id = ?',
  )
    .bind(jobId, workspaceId)
    .first<Record<string, unknown>>();

  if (!job) return notFound('Job');

  const status = job['status'] as string;
  if (status !== 'invoiced' && status !== 'paid') {
    return error(
      'Invoice is only available for jobs with status invoiced or paid',
    );
  }

  const [lineItemsResult, customer, workspace] = await Promise.all([
    env.DB.prepare('SELECT * FROM job_line_items WHERE job_id = ?')
      .bind(jobId)
      .all(),
    env.DB.prepare('SELECT * FROM customers WHERE id = ?')
      .bind(job['customer_id'] as string)
      .first<Record<string, unknown>>(),
    env.DB.prepare('SELECT * FROM workspaces WHERE id = ?')
      .bind(workspaceId)
      .first<Record<string, unknown>>(),
  ]);

  if (!customer)
    return error('Customer not found for this job', 404, 'NOT_FOUND');
  if (!workspace) return error('Workspace not found', 404, 'NOT_FOUND');

  const invoiceJob: InvoiceJobRow = {
    id: job['id'] as string,
    job_number: job['job_number'] as string,
    title: job['title'] as string,
    invoiced_at: (job['invoiced_at'] as string | null) ?? null,
    paid_at: (job['paid_at'] as string | null) ?? null,
    total: job['total'] as number,
    notes: job['notes'] as string,
    street: job['street'] as string,
    city: job['city'] as string,
    state: job['state'] as string,
    zip: job['zip'] as string,
  };

  const invoiceLineItems: InvoiceLineItemRow[] = lineItemsResult.results.map(
    (li: Record<string, unknown>) => ({
      id: li['id'] as string,
      description: li['description'] as string,
      quantity: li['quantity'] as number,
      unit_price: li['unit_price'] as number,
      total: li['total'] as number,
    }),
  );

  const invoiceCustomer: InvoiceCustomerRow = {
    first_name: customer['first_name'] as string,
    last_name: customer['last_name'] as string,
    company: (customer['company'] as string | null) ?? null,
    email: customer['email'] as string,
    phone: customer['phone'] as string,
    street: customer['street'] as string,
    city: customer['city'] as string,
    state: customer['state'] as string,
    zip: customer['zip'] as string,
  };

  const invoiceWorkspace: InvoiceWorkspaceRow = {
    name: workspace['name'] as string,
    slug: (workspace['slug'] as string | null) ?? null,
    phone: workspace['phone'] as string,
    email: workspace['email'] as string,
    street: workspace['street'] as string,
    city: workspace['city'] as string,
    state: workspace['state'] as string,
    zip: workspace['zip'] as string,
    license_num: (workspace['license_num'] as string | null) ?? null,
    logo_url: (workspace['logo_url'] as string | null) ?? null,
  };

  const html = generateInvoiceHtml({
    job: invoiceJob,
    lineItems: invoiceLineItems,
    customer: invoiceCustomer,
    workspace: invoiceWorkspace,
  });

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// POST /api/jobs/:id/invoice — mark invoiced and mint the share link.
//
// This used to flip the status and nothing else: "Send invoice" in the
// platform changed a row to Invoiced and nothing reached the homeowner, not
// even a URL, because GET /:id/invoice above sits behind the contractor's own
// session. Now it mints `jobs.invoice_token`, the capability behind the public
// page at <tenant origin>/invoice/<token> (apps/tenant-site), and answers
// `{ data, share }` with that URL and a message the contractor pastes into
// their own email or SMS (GP-008). Nothing is sent from here, and the copy
// never says it was.
jobsRouter.post('/:id/invoice', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const jobId = req.params!['id'];

  const job = await env.DB.prepare(
    'SELECT * FROM jobs WHERE id = ? AND workspace_id = ?',
  )
    .bind(jobId, workspaceId)
    .first<Record<string, unknown>>();

  if (!job) return notFound('Job');
  if (job['status'] !== 'completed')
    return error('Job must be completed before invoicing');

  const now = new Date().toISOString();
  // A random UUID, never the job id or number: the token IS the
  // authorisation to read the invoice, so it must not be derivable.
  const invoiceToken = newId();
  await env.DB.prepare(
    'UPDATE jobs SET status = ?, invoiced_at = ?, invoice_token = ?, updated_at = ? WHERE id = ?',
  )
    .bind('invoiced', now, invoiceToken, now, jobId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'job', ?, 'invoiced', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, jobId, now)
    .run();

  const updated = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<Record<string, unknown>>();
  const updatedItems = await env.DB.prepare(
    'SELECT * FROM job_line_items WHERE job_id = ?',
  )
    .bind(jobId)
    .all();

  // The link, built on the workspace's public address. A workspace with no
  // slug has no address, and then there is no `share` — not a broken one.
  const workspace = await env.DB.prepare(
    'SELECT name, slug, custom_hostname, custom_domain_status FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<{
      name: string;
      slug: string | null;
      custom_hostname: string | null;
      custom_domain_status: string | null;
    }>();
  const customer = await env.DB.prepare(
    'SELECT first_name FROM customers WHERE id = ?',
  )
    .bind(job['customer_id'] as string)
    .first<{ first_name: string }>();
  const origin = workspace ? tenantOrigin(env, workspace) : null;
  const share =
    workspace && origin
      ? invoiceShareLink(origin, invoiceToken, {
          businessName: workspace.name,
          customerFirstName: customer?.first_name ?? null,
          jobTitle: job['title'] as string,
        })
      : null;

  return entityShared(WIRE_JOB, updated, share, {
    lineItems: toWireList(WIRE_JOB_LINE_ITEM, updatedItems.results),
  });
});

// POST /api/jobs/:id/paid
jobsRouter.post('/:id/paid', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const jobId = req.params!['id'];

  const job = await env.DB.prepare(
    'SELECT * FROM jobs WHERE id = ? AND workspace_id = ?',
  )
    .bind(jobId, workspaceId)
    .first<Record<string, unknown>>();

  if (!job) return notFound('Job');
  if (job['status'] !== 'invoiced')
    return error('Job must be invoiced before marking as paid');

  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE jobs SET status = ?, paid_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind('paid', now, now, jobId)
    .run();

  // Update customer total_job_value and job_count
  const customerId = job['customer_id'] as string;
  await env.DB.prepare(
    `
    UPDATE customers SET
      total_job_value = total_job_value + ?,
      job_count = job_count + 1,
      updated_at = ?
    WHERE id = ?
  `,
  )
    .bind(job['total'] as number, now, customerId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'job', ?, 'paid', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, jobId, now)
    .run();

  const updated = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<Record<string, unknown>>();
  const updatedItems = await env.DB.prepare(
    'SELECT * FROM job_line_items WHERE job_id = ?',
  )
    .bind(jobId)
    .all();
  return entity(WIRE_JOB, updated, {
    lineItems: toWireList(WIRE_JOB_LINE_ITEM, updatedItems.results),
  });
});

// POST /api/jobs/:id/no-show — the customer never showed for a scheduled
// job: with an inside-window cancel, one of the two forfeit cases in
// fee paper v2 §3. The job is cancelled and its slots freed — the same
// two statements a cancel uses (GP-104) — and the booking deposit is
// captured with GreenPut's delivered-lead fee taken first and the
// remainder going to the shop for the held slot (lib/deposits.ts).
jobsRouter.post('/:id/no-show', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const jobId = req.params!['id'];

  const job = await env.DB.prepare(
    'SELECT * FROM jobs WHERE id = ? AND workspace_id = ?',
  )
    .bind(jobId, workspaceId)
    .first<Record<string, unknown>>();

  if (!job) return notFound('Job');
  if (job['status'] !== 'scheduled') {
    return error(
      'Only a scheduled job can be marked no-show',
      409,
      'INVALID_STATE',
    );
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
    ).bind('cancelled', now, jobId, workspaceId),
    slotDeleteStatement(env.DB, jobId),
    env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'job', ?, 'no_show', ?, ?)`,
    ).bind(
      newId(),
      workspaceId,
      user.id,
      jobId,
      JSON.stringify({ scheduledStart: job['scheduled_start'] }),
      now,
    ),
  ]);

  const forfeiture = await forfeitDeposit(env, {
    workspaceId,
    jobId,
    reason: 'no_show',
    actorUserId: user.id,
  }).catch(() => null);

  const updated = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<Record<string, unknown>>();

  return entity(WIRE_JOB, updated, {
    deposit: forfeiture?.deposit ?? null,
  });
});
