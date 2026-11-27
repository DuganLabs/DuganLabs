import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { error, notFound, newId } from '../lib/response';
import { entity, entityArray } from '../lib/serialize';
import {
  WIRE_CHANGE_ORDER,
  WIRE_CHANGE_ORDER_EVENT,
  readEstimateLineItems,
  toWireList,
  type EstimateLineItemType,
} from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';
import {
  CreateChangeOrderSchema,
  DecideChangeOrderSchema,
  type CreateChangeOrderInput,
  type DecideChangeOrderInput,
} from '@greenput/shared/validators';

/**
 * Change orders — the only way a job's (or a sent estimate's) price moves once
 * it exists. PATCH /api/jobs/:id no longer takes `lineItems` or `total`, and
 * PATCH /api/estimates/:id no longer takes `lineItems` past draft; both answer
 * 409 CHANGE_ORDER_REQUIRED and point here.
 *
 *   POST /api/change-orders                propose  (any workspace user)
 *   POST /api/change-orders/:id/approve    record the homeowner's yes (office+)
 *   POST /api/change-orders/:id/reject     record the homeowner's no  (office+)
 *   GET  /api/change-orders?jobId=|estimateId=
 *   GET  /api/change-orders/:id            with its event trail
 *
 * Money is whole cents. A change order's lines are fixed when it is proposed;
 * `price_delta` is their signed sum and `total_before` is the parent's total
 * at that moment. Approving appends the lines to the parent (prefixed with the
 * CO number so the invoice shows where they came from) and moves the parent's
 * total by exactly `price_delta`. Rejecting changes nothing but the record.
 *
 * A change order is decided exactly once. The decision is one D1 batch (one
 * transaction) whose first statement inserts the event only if the change
 * order is still `proposed` and its parent can still take it; every later
 * statement is conditioned on that event row existing. Two racing approvals
 * therefore apply once, and an approval that loses to an invoice applies
 * nothing.
 */
export const changeOrdersRouter = Router({ base: '/api/change-orders' });

/** Jobs past these statuses are billed; a change after that is a new job. */
const CLOSED_JOB_STATUSES = ['invoiced', 'paid', 'cancelled'] as const;
/** A draft is edited directly; rejected/expired estimates are dead. */
const CHANGEABLE_ESTIMATE_STATUSES = ['sent', 'accepted'] as const;

type Ctx = { workspaceId: string; user: { id: string; role: string } };
const ctx = (req: IRequest): Ctx => req as unknown as Ctx;

type Line = {
  id: string;
  type: EstimateLineItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

type Parent =
  | { kind: 'job'; id: string; status: string; total: number }
  | {
      kind: 'estimate';
      id: string;
      status: string;
      total: number;
      subtotal: number;
      taxRate: number;
      lineItems: string;
      updatedAt: string;
    };

async function loadParent(
  env: Env,
  workspaceId: string,
  ref: { jobId?: string | null; estimateId?: string | null },
): Promise<Parent | null> {
  if (ref.jobId) {
    const row = await env.DB.prepare(
      'SELECT id, status, total FROM jobs WHERE id = ? AND workspace_id = ?',
    )
      .bind(ref.jobId, workspaceId)
      .first<{ id: string; status: string; total: number }>();
    return row
      ? {
          kind: 'job',
          id: row.id,
          status: row.status,
          total: Math.round(Number(row.total) || 0),
        }
      : null;
  }
  if (ref.estimateId) {
    const row = await env.DB.prepare(
      'SELECT id, status, total, subtotal, tax_rate, line_items, updated_at FROM estimates WHERE id = ? AND workspace_id = ?',
    )
      .bind(ref.estimateId, workspaceId)
      .first<{
        id: string;
        status: string;
        total: number;
        subtotal: number;
        tax_rate: number;
        line_items: string;
        updated_at: string;
      }>();
    return row
      ? {
          kind: 'estimate',
          id: row.id,
          status: row.status,
          total: Math.round(Number(row.total) || 0),
          subtotal: Math.round(Number(row.subtotal) || 0),
          taxRate: Number(row.tax_rate) || 0,
          lineItems: row.line_items,
          updatedAt: row.updated_at,
        }
      : null;
  }
  return null;
}

/** Why this parent cannot take a change order now, or null if it can. */
function parentRefusal(parent: Parent): Response | null {
  if (parent.kind === 'job') {
    if ((CLOSED_JOB_STATUSES as readonly string[]).includes(parent.status)) {
      return error(
        `This job is ${parent.status}; it can no longer take a change order.`,
        409,
        'JOB_CLOSED',
      );
    }
    return null;
  }
  if (parent.status === 'draft') {
    return error(
      'This estimate is still a draft: edit its line items directly.',
      409,
      'EDIT_THE_DRAFT',
    );
  }
  if (
    !(CHANGEABLE_ESTIMATE_STATUSES as readonly string[]).includes(parent.status)
  ) {
    return error(
      `This estimate is ${parent.status}; it can no longer take a change order.`,
      409,
      'ESTIMATE_CLOSED',
    );
  }
  return null;
}

/** The parent's total after `delta`; for an estimate tax is recomputed. */
function totalsAfter(parent: Parent, delta: number) {
  if (parent.kind === 'job') return { total: parent.total + delta };
  const subtotal = parent.subtotal + delta;
  const taxAmount = Math.round(subtotal * (parent.taxRate / 100));
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}

function storedLines(input: CreateChangeOrderInput['lineItems']): Line[] {
  return input.map((li) => ({
    id: newId(),
    type: li.type,
    description: li.description,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    total: Math.round(li.quantity * li.unitPrice),
  }));
}

async function readWithEvents(
  env: Env,
  workspaceId: string,
  id: string,
  status = 200,
) {
  const row = await env.DB.prepare(
    'SELECT * FROM change_orders WHERE id = ? AND workspace_id = ?',
  )
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();
  if (!row) return notFound('Change order');
  const { results } = await env.DB.prepare(
    'SELECT * FROM change_order_events WHERE change_order_id = ? ORDER BY created_at, rowid',
  )
    .bind(id)
    .all<Record<string, unknown>>();
  return entity(
    WIRE_CHANGE_ORDER,
    row,
    { events: toWireList(WIRE_CHANGE_ORDER_EVENT, results ?? []) },
    status,
  );
}

function activity(
  env: Env,
  c: Ctx,
  parent: { kind: 'job' | 'estimate'; id: string },
  action: string,
  meta: Record<string, unknown>,
  now: string,
) {
  // activity_log.entity_type has no 'change_order' (widening that CHECK needs
  // a table rebuild), so the entry lands on the job or estimate it changes.
  return env.DB.prepare(
    `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId(),
    c.workspaceId,
    c.user.id,
    parent.kind,
    parent.id,
    action,
    JSON.stringify(meta),
    now,
  );
}

// GET /api/change-orders?jobId=…|estimateId=…
changeOrdersRouter.get('/', async (req: IRequest, env: Env) => {
  const { workspaceId } = ctx(req);
  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  const estimateId = url.searchParams.get('estimateId');
  let sql = 'SELECT * FROM change_orders WHERE workspace_id = ?';
  const binds: unknown[] = [workspaceId];
  if (jobId) {
    sql += ' AND job_id = ?';
    binds.push(jobId);
  }
  if (estimateId) {
    sql += ' AND estimate_id = ?';
    binds.push(estimateId);
  }
  sql += ' ORDER BY created_at DESC, rowid DESC LIMIT 200';
  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>();
  return entityArray(WIRE_CHANGE_ORDER, results ?? []);
});

// GET /api/change-orders/:id
changeOrdersRouter.get('/:id', async (req: IRequest, env: Env) =>
  readWithEvents(env, ctx(req).workspaceId, String(req.params?.['id'] ?? '')),
);

// POST /api/change-orders
changeOrdersRouter.post(
  '/',
  validate(CreateChangeOrderSchema),
  async (req: IRequest, env: Env) => {
    const c = ctx(req);
    const body = (req as unknown as { validatedBody: CreateChangeOrderInput })
      .validatedBody;

    const parent = await loadParent(env, c.workspaceId, body);
    if (!parent) return notFound(body.jobId ? 'Job' : 'Estimate');
    const refused = parentRefusal(parent);
    if (refused) return refused;

    const lines = storedLines(body.lineItems);
    const delta = lines.reduce((sum, l) => sum + l.total, 0);
    if (totalsAfter(parent, delta).total < 0) {
      return error(
        'This change would take the price below zero.',
        422,
        'NEGATIVE_TOTAL',
      );
    }

    const last = await env.DB.prepare(
      'SELECT MAX(CAST(SUBSTR(number, 4) AS INTEGER)) AS n FROM change_orders WHERE workspace_id = ?',
    )
      .bind(c.workspaceId)
      .first<{ n: number | null }>();
    const number = `CO-${(last?.n ?? 1000) + 1}`;

    const id = newId();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO change_orders (id, workspace_id, job_id, estimate_id, number, title, reason, status,
           line_items, price_delta, total_before, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        c.workspaceId,
        parent.kind === 'job' ? parent.id : null,
        parent.kind === 'estimate' ? parent.id : null,
        number,
        body.title,
        body.reason ?? '',
        JSON.stringify(lines),
        delta,
        parent.total,
        now,
        now,
        c.user.id,
      ),
      env.DB.prepare(
        `INSERT INTO change_order_events (id, workspace_id, change_order_id, action, actor_user_id, note, created_at)
         VALUES (?, ?, ?, 'proposed', ?, ?, ?)`,
      ).bind(newId(), c.workspaceId, id, c.user.id, body.reason ?? '', now),
      activity(
        env,
        c,
        parent,
        'change_order_proposed',
        { changeOrderId: id, number, priceDelta: delta },
        now,
      ),
    ]);

    return readWithEvents(env, c.workspaceId, id, 201);
  },
);

async function decide(
  req: IRequest,
  env: Env,
  action: 'approved' | 'rejected',
) {
  const c = ctx(req);
  const id = String(req.params?.['id'] ?? '');
  const body = (req as unknown as { validatedBody: DecideChangeOrderInput })
    .validatedBody;

  const co = await env.DB.prepare(
    'SELECT * FROM change_orders WHERE id = ? AND workspace_id = ?',
  )
    .bind(id, c.workspaceId)
    .first<Record<string, unknown>>();
  if (!co) return notFound('Change order');
  if (co['status'] !== 'proposed') {
    return error(
      `This change order was already ${String(co['status'])}.`,
      409,
      'ALREADY_DECIDED',
    );
  }

  const parent = await loadParent(env, c.workspaceId, {
    jobId: co['job_id'] as string | null,
    estimateId: co['estimate_id'] as string | null,
  });
  if (!parent) return notFound('Job or estimate');
  if (action === 'approved') {
    const refused = parentRefusal(parent);
    if (refused) return refused;
  }

  const delta = Math.round(Number(co['price_delta']) || 0);
  const after = totalsAfter(parent, delta);
  if (action === 'approved' && after.total < 0) {
    return error(
      'This change would take the price below zero.',
      422,
      'NEGATIVE_TOTAL',
    );
  }

  const now = new Date().toISOString();
  const eventId = newId();
  const number = String(co['number']);
  const lines = readEstimateLineItems(co['line_items']);

  // The guard the whole batch hangs on: the event row exists only if, inside
  // this transaction, the change order was still proposed and (on approval)
  // the parent was still in the state we computed against.
  let parentGuard = '';
  const parentBinds: unknown[] = [];
  if (action === 'approved' && parent.kind === 'job') {
    parentGuard = ` AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status NOT IN (${CLOSED_JOB_STATUSES.map(() => '?').join(', ')}))`;
    parentBinds.push(parent.id, ...CLOSED_JOB_STATUSES);
  } else if (action === 'approved' && parent.kind === 'estimate') {
    parentGuard =
      ' AND EXISTS (SELECT 1 FROM estimates WHERE id = ? AND updated_at = ?)';
    parentBinds.push(parent.id, parent.updatedAt);
  }
  const ifEvent = 'EXISTS (SELECT 1 FROM change_order_events WHERE id = ?)';

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO change_order_events (id, workspace_id, change_order_id, action, actor_user_id, note, total_after, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM change_orders WHERE id = ? AND status = 'proposed')${parentGuard}`,
    ).bind(
      eventId,
      c.workspaceId,
      id,
      action,
      c.user.id,
      body.note ?? '',
      action === 'approved' ? after.total : null,
      now,
      id,
      ...parentBinds,
    ),
    env.DB.prepare(
      `UPDATE change_orders SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ?
       WHERE id = ? AND ${ifEvent}`,
    ).bind(action, c.user.id, now, body.note ?? '', now, id, eventId),
  ];

  if (action === 'approved' && parent.kind === 'job') {
    for (const l of lines) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO job_line_items (id, job_id, description, quantity, unit_price, total)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${ifEvent}`,
        ).bind(
          newId(),
          parent.id,
          `${number}: ${l.description}`,
          l.quantity,
          l.unitPrice,
          l.total,
          eventId,
        ),
      );
    }
    stmts.push(
      env.DB.prepare(
        `UPDATE jobs SET total = total + ?, updated_at = ? WHERE id = ? AND ${ifEvent}`,
      ).bind(delta, now, parent.id, eventId),
    );
  } else if (action === 'approved' && parent.kind === 'estimate') {
    const merged = [
      ...readEstimateLineItems(parent.lineItems),
      ...lines.map((l) => ({
        ...l,
        description: `${number}: ${l.description}`,
      })),
    ];
    const t = after as { subtotal: number; taxAmount: number; total: number };
    stmts.push(
      env.DB.prepare(
        `UPDATE estimates SET line_items = ?, subtotal = ?, tax_amount = ?, total = ?, updated_at = ?
         WHERE id = ? AND ${ifEvent}`,
      ).bind(
        JSON.stringify(merged),
        t.subtotal,
        t.taxAmount,
        t.total,
        now,
        parent.id,
        eventId,
      ),
    );
  }

  stmts.push(
    env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ifEvent}`,
    ).bind(
      newId(),
      c.workspaceId,
      c.user.id,
      parent.kind,
      parent.id,
      `change_order_${action}`,
      JSON.stringify({ changeOrderId: id, number, priceDelta: delta }),
      now,
      eventId,
    ),
  );

  await env.DB.batch(stmts);

  const applied = await env.DB.prepare(
    'SELECT 1 AS ok FROM change_order_events WHERE id = ?',
  )
    .bind(eventId)
    .first<{ ok: number }>();
  if (!applied) {
    const now2 = await env.DB.prepare(
      'SELECT status FROM change_orders WHERE id = ?',
    )
      .bind(id)
      .first<{ status: string }>();
    if (now2 && now2.status !== 'proposed') {
      return error(
        `This change order was already ${now2.status}.`,
        409,
        'ALREADY_DECIDED',
      );
    }
    return error(
      'The job or estimate changed while this was being decided. Reload and try again.',
      409,
      'PARENT_CHANGED',
    );
  }
  return readWithEvents(env, c.workspaceId, id);
}

// POST /api/change-orders/:id/approve
changeOrdersRouter.post(
  '/:id/approve',
  requireRole('office'),
  validate(DecideChangeOrderSchema),
  (req: IRequest, env: Env) => decide(req, env, 'approved'),
);

// POST /api/change-orders/:id/reject
changeOrdersRouter.post(
  '/:id/reject',
  requireRole('office'),
  validate(DecideChangeOrderSchema),
  (req: IRequest, env: Env) => decide(req, env, 'rejected'),
);
