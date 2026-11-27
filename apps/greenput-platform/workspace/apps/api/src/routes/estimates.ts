import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { changeOrderRequired } from '../lib/change-order-required';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList, entityShared } from '../lib/serialize';
import { proposalShareLink } from '@greenput/shared/utils';
import { tenantOrigin } from '../lib/origins';
import {
  WIRE_ESTIMATE,
  type EstimateLineItemType,
} from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import {
  CreateEstimateSchema,
  UpdateEstimateSchema,
} from '@greenput/shared/validators';
import {
  confirmWorkOrder,
  estimateLinesFromQuote,
  loadSession,
  type D1Like,
} from '@greenput/shared/pricing';

export const estimatesRouter = Router({ base: '/api/estimates' });

/**
 * The line items to STORE, derived rather than trusted.
 *
 * `CreateEstimateSchema`/`UpdateEstimateSchema` validate a line item down to
 * {description, quantity, unitPrice} — zod strips everything else — so the
 * `id` and `total` a client sends never reached the database, and every
 * estimate written through the API held line items with no `total` at all.
 * `EstimateLineItem` declares both, and apps/tenant-site's public proposal page
 * renders `total` per row, so it printed nothing for each line.
 *
 * `total` is now computed here (whole cents — see the MONEY note in
 * libs/shared/models/src/wire.ts) and `id` is minted here, which is also the
 * only way a line total can be trusted to match its own quantity and price.
 *
 * `type` (labor | material) is stored as its own field. Before the validator
 * declared it, the platform editor folded it into the description as a
 * `[labor] ` prefix that the customer's proposal then printed (GP-038); the
 * rows written that way are read back through `readEstimateLineItems`.
 */
function storedLineItems(input: ReadonlyArray<Record<string, unknown>>): Array<{
  id: string;
  type: EstimateLineItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}> {
  return input.map((li) => {
    const quantity = Number(li['quantity']) || 1;
    const unitPrice = Math.round(Number(li['unitPrice']) || 0);
    return {
      id: typeof li['id'] === 'string' && li['id'] ? li['id'] : newId(),
      type: li['type'] === 'material' ? 'material' : 'labor',
      description: String(li['description'] ?? ''),
      quantity,
      unitPrice,
      total: Math.round(quantity * unitPrice),
    };
  });
}

/** The workspace's next estimate number, E-1001 upward. */
async function nextEstimateNumber(
  env: Env,
  workspaceId: string,
): Promise<string> {
  const lastEstimate = await env.DB.prepare(
    'SELECT estimate_number FROM estimates WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(workspaceId)
    .first<{ estimate_number: string }>();
  const lastNum = lastEstimate
    ? parseInt(lastEstimate.estimate_number.replace('E-', ''), 10)
    : 1000;
  return `E-${lastNum + 1}`;
}

// GET /api/estimates
estimatesRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');

  let where = 'WHERE e.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (status) {
    where += ' AND e.status = ?';
    params.push(status);
  }
  if (q) {
    where += ' AND (e.title LIKE ? OR e.estimate_number LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT e.*, o.title AS opportunity_title
      FROM estimates e
      LEFT JOIN opportunities o ON e.opportunity_id = o.id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM estimates e ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_ESTIMATE, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// POST /api/estimates/from-quote/:sessionId
//
// H1's last step (docs/pricing-fsm-designs.md §9): the contractor drafts the
// estimate FROM the homeowner's finished quote. That confirms the work order,
// which is the provider input that lets the quote collapse from a range to one
// exact number — if nothing is left to guess. The draft is priced at that
// number and linked to the quote (estimates.quote_session_id).
//
// When something IS left to guess (a utility fee the shop can't know yet, a
// line priced only if needed) the quote stays a range, the draft is priced at
// the point, and the notes say exactly what is still open. Either way the
// estimate is a draft: the contractor reviews it before anyone sees it.
estimatesRouter.post(
  '/from-quote/:sessionId',
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    let body: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === 'object')
        body = parsed as Record<string, unknown>;
    } catch {
      // No body: every field is optional.
    }

    const db = env.DB as unknown as D1Like;
    const session = await loadSession(
      db,
      String(req.params?.['sessionId'] ?? ''),
    );
    if (!session || session.workspace_id !== workspaceId)
      return notFound('Quote');
    if (session.status !== 'completed')
      return error(
        'The homeowner has not finished this quote yet.',
        409,
        'QUOTE_NOT_COMPLETE',
      );

    // The opportunity: named, or the newest one on the quote's lead.
    let opportunityId: string | null =
      typeof body['opportunityId'] === 'string' ? body['opportunityId'] : null;
    if (opportunityId) {
      const opp = await env.DB.prepare(
        'SELECT id FROM opportunities WHERE id = ? AND workspace_id = ?',
      )
        .bind(opportunityId, workspaceId)
        .first();
      if (!opp) return error('Opportunity not found', 404, 'NOT_FOUND');
    } else if (session.lead_id) {
      const opp = await env.DB.prepare(
        `SELECT id FROM opportunities WHERE lead_id = ? AND workspace_id = ?
          ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(session.lead_id, workspaceId)
        .first<{ id: string }>();
      opportunityId = opp?.id ?? null;
    }
    if (!opportunityId)
      return error(
        'This quote has no opportunity yet. Pass opportunityId.',
        422,
        'OPPORTUNITY_REQUIRED',
      );

    const now = new Date().toISOString();
    const confirmed = await confirmWorkOrder(db, session, {
      newId,
      now,
      userId: user.id,
    });
    if (confirmed.kind === 'not_complete')
      return error(
        'The homeowner has not finished this quote yet.',
        409,
        'QUOTE_NOT_COMPLETE',
      );
    if (confirmed.kind === 'no_price')
      return error(
        'This quote has no price to draft from. Call the homeowner.',
        409,
        'QUOTE_NO_PRICE',
      );
    if (confirmed.kind === 'requires_call')
      return error(
        'The price moved outside the range the homeowner saw. Call them before drafting.',
        409,
        'QUOTE_REQUIRES_CALL',
      );

    const { result } = confirmed;
    const draft = estimateLinesFromQuote(result);
    const lineItems = storedLineItems(
      draft.lineItems as unknown as Array<Record<string, unknown>>,
    );
    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const taxRate = Number(body['taxRate']) || 0;
    const taxAmount = Math.round(subtotal * (taxRate / 100));
    const total = subtotal + taxAmount;

    const open = [
      ...confirmed.blockers,
      ...draft.omitted.map(
        (l) =>
          `Not included: ${l.label}, priced only if it turns out to be needed.`,
      ),
    ];
    const notes = [
      typeof body['notes'] === 'string' ? body['notes'] : '',
      open.length
        ? `Still open before this is one exact number:\n${open.map((b) => `- ${b}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const id = newId();
    const estimateNumber = await nextEstimateNumber(env, workspaceId);
    await env.DB.prepare(
      `
    INSERT INTO estimates (
      id, workspace_id, opportunity_id, customer_id, estimate_number, title, status,
      line_items, subtotal, tax_rate, tax_amount, total, notes, valid_until,
      quote_session_id, created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
      .bind(
        id,
        workspaceId,
        opportunityId,
        typeof body['customerId'] === 'string' ? body['customerId'] : null,
        estimateNumber,
        typeof body['title'] === 'string' && body['title']
          ? body['title']
          : 'Estimate from online quote',
        'draft',
        JSON.stringify(lineItems),
        subtotal,
        taxRate,
        taxAmount,
        total,
        notes,
        typeof body['validUntil'] === 'string' ? body['validUntil'] : null,
        session.id,
        now,
        now,
        user.id,
      )
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
    VALUES (?, ?, ?, 'estimate', ?, 'created_from_quote', ?, ?)
  `,
    )
      .bind(
        newId(),
        workspaceId,
        user.id,
        id,
        JSON.stringify({ quoteSessionId: session.id, stage: confirmed.kind }),
        now,
      )
      .run();

    const estimate = await env.DB.prepare(
      'SELECT * FROM estimates WHERE id = ?',
    )
      .bind(id)
      .first<Record<string, unknown>>();
    return entity(
      WIRE_ESTIMATE,
      estimate,
      {
        quote: {
          stage: confirmed.kind,
          exact: result.exact ?? null,
          low: result.low ?? null,
          high: result.high ?? null,
          blockers: confirmed.blockers,
          omitted: draft.omitted.map((l) => l.label),
        },
      },
      201,
    );
  },
);

// GET /api/estimates/:id
estimatesRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const estimate = await env.DB.prepare(
    'SELECT * FROM estimates WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params!['id'], workspaceId)
    .first<Record<string, unknown>>();

  if (!estimate) return notFound('Estimate');
  return entity(WIRE_ESTIMATE, estimate);
});

// POST /api/estimates
estimatesRouter.post(
  '/',
  validate(CreateEstimateSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (req as any).validatedBody as Record<string, unknown>;

    // Verify opportunity belongs to workspace
    const opp = await env.DB.prepare(
      'SELECT id FROM opportunities WHERE id = ? AND workspace_id = ?',
    )
      .bind(body.opportunityId, workspaceId)
      .first();

    if (!opp) return error('Opportunity not found', 404, 'NOT_FOUND');

    const id = newId();
    const now = new Date().toISOString();

    const estimateNumber = await nextEstimateNumber(env, workspaceId);

    // Calculate totals from line items
    const lineItems = storedLineItems(
      (body.lineItems as Array<Record<string, unknown>>) ?? [],
    );
    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const taxRate = Number(body.taxRate) || 0;
    // Rounded: every amount is whole cents (see the MONEY note in
    // libs/shared/models/src/wire.ts), and a percentage of a cents subtotal is
    // the one arithmetic here that does not land on one by itself —
    // 245000 * 0.0825 is 20212.5.
    const taxAmount = Math.round(subtotal * (taxRate / 100));
    const total = subtotal + taxAmount;

    await env.DB.prepare(
      `
    INSERT INTO estimates (
      id, workspace_id, opportunity_id, customer_id, estimate_number, title, status,
      line_items, subtotal, tax_rate, tax_amount, total, notes, valid_until,
      created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
      .bind(
        id,
        workspaceId,
        body.opportunityId,
        (body.customerId as string) ?? null,
        estimateNumber,
        body.title,
        'draft',
        JSON.stringify(lineItems),
        subtotal,
        taxRate,
        taxAmount,
        total,
        (body.notes as string) ?? '',
        (body.validUntil as string) ?? null,
        now,
        now,
        user.id,
      )
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'estimate', ?, 'created', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    const estimate = await env.DB.prepare(
      'SELECT * FROM estimates WHERE id = ?',
    )
      .bind(id)
      .first<Record<string, unknown>>();
    return entity(WIRE_ESTIMATE, estimate, {}, 201);
  },
);

// PATCH /api/estimates/:id
estimatesRouter.patch(
  '/:id',
  validate(UpdateEstimateSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const estimateId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT * FROM estimates WHERE id = ? AND workspace_id = ?',
    )
      .bind(estimateId, workspaceId)
      .first<Record<string, unknown>>();

    if (!existing) return notFound('Estimate');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    // Once an estimate has gone to the homeowner its price moves only through
    // a change order (routes/change-orders.ts). A draft is still edited here.
    if (
      existing['status'] !== 'draft' &&
      (body.lineItems !== undefined || body.taxRate !== undefined)
    ) {
      return changeOrderRequired('estimate');
    }

    const allowed = [
      'title',
      'status',
      'customer_id',
      'notes',
      'valid_until',
      'tax_rate',
    ];

    const camelToSnake: Record<string, string> = {
      customerId: 'customer_id',
      validUntil: 'valid_until',
      taxRate: 'tax_rate',
    };

    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];

    for (const [key, val] of Object.entries(body)) {
      if (key === 'lineItems') continue;
      const col = camelToSnake[key] ?? key;
      if (allowed.includes(col)) {
        sets.push(`${col} = ?`);
        vals.push(val);
      }
    }

    // Recalculate totals if line items or tax rate changed
    if (body.lineItems !== undefined || body.taxRate !== undefined) {
      const lineItems = storedLineItems(
        body.lineItems !== undefined
          ? (body.lineItems as Array<Record<string, unknown>>)
          : (JSON.parse(existing['line_items'] as string) as Array<
              Record<string, unknown>
            >),
      );

      const taxRate =
        body.taxRate !== undefined
          ? Number(body.taxRate)
          : Number(existing['tax_rate']);

      const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
      const taxAmount = Math.round(subtotal * (taxRate / 100));
      const total = subtotal + taxAmount;

      if (body.lineItems !== undefined) {
        sets.push('line_items = ?');
        vals.push(JSON.stringify(lineItems));
      }
      sets.push('subtotal = ?', 'tax_amount = ?', 'total = ?');
      vals.push(subtotal, taxAmount, total);
    }

    vals.push(estimateId, workspaceId);

    await env.DB.prepare(
      `UPDATE estimates SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'estimate', ?, 'updated', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, estimateId, now)
      .run();

    const updated = await env.DB.prepare('SELECT * FROM estimates WHERE id = ?')
      .bind(estimateId)
      .first<Record<string, unknown>>();
    return entity(WIRE_ESTIMATE, updated);
  },
);

// DELETE /api/estimates/:id — only draft estimates can be deleted
estimatesRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const user = (req as unknown as { user: { id: string } }).user;
  const estimateId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id, status FROM estimates WHERE id = ? AND workspace_id = ?',
  )
    .bind(estimateId, workspaceId)
    .first<Record<string, unknown>>();

  if (!existing) return notFound('Estimate');

  if (existing['status'] !== 'draft') {
    return error('Only draft estimates can be deleted');
  }

  await env.DB.prepare(
    'DELETE FROM estimates WHERE id = ? AND workspace_id = ?',
  )
    .bind(estimateId, workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'estimate', ?, 'deleted', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, estimateId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});

// POST /api/estimates/:id/send — mark sent, and hand back the proposal link.
//
// The status flip was the whole handler; the public proposal page at
// <tenant origin>/proposal/<id> (apps/tenant-site) had existed for as long as
// the product and no screen linked to it. It is keyed on the estimate's UUID,
// which is already an unguessable capability, so no token is minted here:
// the answer is `{ data, share }` with that URL and a message for the
// contractor to paste (GP-008). Nothing is sent from here.
estimatesRouter.post('/:id/send', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const user = (req as unknown as { user: { id: string } }).user;
  const estimateId = req.params!['id'];

  const estimate = await env.DB.prepare(
    'SELECT * FROM estimates WHERE id = ? AND workspace_id = ?',
  )
    .bind(estimateId, workspaceId)
    .first<Record<string, unknown>>();

  if (!estimate) return notFound('Estimate');

  if (estimate['status'] !== 'draft') {
    return error('Only draft estimates can be sent');
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE estimates SET status = ?, sent_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind('sent', now, now, estimateId)
    .run();

  // Update opportunity status to proposal_sent
  await env.DB.prepare(
    'UPDATE opportunities SET status = ?, proposal_sent_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
  )
    .bind('proposal_sent', now, now, estimate['opportunity_id'], workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'estimate', ?, 'sent', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, estimateId, now)
    .run();

  const updated = await env.DB.prepare('SELECT * FROM estimates WHERE id = ?')
    .bind(estimateId)
    .first<Record<string, unknown>>();

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
  const customerId = estimate['customer_id'] as string | null;
  const customer = customerId
    ? await env.DB.prepare('SELECT first_name FROM customers WHERE id = ?')
        .bind(customerId)
        .first<{ first_name: string }>()
    : null;
  const origin = workspace ? tenantOrigin(env, workspace) : null;
  const share =
    workspace && origin
      ? proposalShareLink(origin, estimateId, {
          businessName: workspace.name,
          customerFirstName: customer?.first_name ?? null,
          title: estimate['title'] as string,
        })
      : null;

  return entityShared(WIRE_ESTIMATE, updated, share);
});

// POST /api/estimates/:id/accept — mark estimate as accepted, update opportunity to 'won'
estimatesRouter.post('/:id/accept', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const user = (req as unknown as { user: { id: string } }).user;
  const estimateId = req.params!['id'];

  const estimate = await env.DB.prepare(
    'SELECT * FROM estimates WHERE id = ? AND workspace_id = ?',
  )
    .bind(estimateId, workspaceId)
    .first<Record<string, unknown>>();

  if (!estimate) return notFound('Estimate');

  if (estimate['status'] !== 'sent') {
    return error('Only sent estimates can be accepted');
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE estimates SET status = ?, accepted_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind('accepted', now, now, estimateId)
    .run();

  // Update opportunity status to won
  await env.DB.prepare(
    'UPDATE opportunities SET status = ?, closed_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
  )
    .bind('won', now, now, estimate['opportunity_id'], workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
    VALUES (?, ?, ?, 'estimate', ?, 'accepted', ?, ?)
  `,
  )
    .bind(
      newId(),
      workspaceId,
      user.id,
      estimateId,
      JSON.stringify({ opportunityId: estimate['opportunity_id'] }),
      now,
    )
    .run();

  const updated = await env.DB.prepare('SELECT * FROM estimates WHERE id = ?')
    .bind(estimateId)
    .first<Record<string, unknown>>();
  return entity(WIRE_ESTIMATE, updated);
});
