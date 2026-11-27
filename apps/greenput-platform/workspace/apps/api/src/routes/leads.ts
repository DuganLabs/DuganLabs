import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList, toWire } from '../lib/serialize';
import { WIRE_LEAD } from '@greenput/shared/models';
import { quoteLeadFee } from '../lib/lead-meter';
import {
  assertCanReceiveLeads,
  CARD_REQUIRED_MESSAGE,
  DELIVERY_PAUSED_MESSAGE,
} from '../lib/lead-billing-gate';
import { resolveLeadRate } from '../lib/lead-rate-card';
import { validate } from '../middleware/validate';
import {
  CreateLeadSchema,
  UpdateLeadSchema,
  ConvertLeadSchema,
  WithdrawLeadSchema,
} from '@greenput/shared/validators';
import { withdrawLead } from '@greenput/shared/pricing';
import {
  deliverLead,
  undoDelivery,
  DeliveryError,
} from '../lib/schedule-delivery';
import { UnmappedLeadServiceError } from '../lib/lead-rate-card';
import {
  forfeitDeposit,
  isInsideCancelWindow,
  releaseDeposit,
  type SettleOutcome,
} from '../lib/deposits';

export const leadsRouter = Router({ base: '/api/leads' });

// GET /api/leads
leadsRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as any).workspaceId;

  const status = url.searchParams.get('status');
  const source = url.searchParams.get('source');
  const q = url.searchParams.get('q');

  let where = 'WHERE l.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (status) {
    where += ' AND l.status = ?';
    params.push(status);
  }
  if (source) {
    where += ' AND l.source = ?';
    params.push(source);
  }
  if (q) {
    where +=
      ' AND (l.first_name LIKE ? OR l.last_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT l.*, c.name AS campaign_name
      FROM leads l
      LEFT JOIN campaigns c ON l.campaign_id = c.id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM leads l ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_LEAD, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/leads/:id
leadsRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const lead = await env.DB.prepare(
    'SELECT * FROM leads WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params!['id'], workspaceId)
    .first();

  if (!lead) return notFound('Lead');
  return entity(WIRE_LEAD, lead);
});

// POST /api/leads
leadsRouter.post(
  '/',
  validate(CreateLeadSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const body = (req as any).validatedBody as Record<string, unknown>;

    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `
    INSERT INTO leads (
      id, workspace_id, first_name, last_name, email, phone, preferred_contact,
      street, city, state, zip, status, source, campaign_id,
      service_type, estimated_value, notes, created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
      .bind(
        id,
        workspaceId,
        body.firstName,
        body.lastName,
        body.email ?? '',
        body.phone ?? '',
        body.preferredContact ?? 'phone',
        body.street ?? '',
        body.city ?? '',
        body.state ?? '',
        body.zip ?? '',
        body.status ?? 'new',
        body.source ?? 'manual',
        body.campaignId ?? null,
        body.serviceType ?? '',
        body.estimatedValue ?? null,
        body.notes ?? '',
        now,
        now,
        user.id,
      )
      .run();

    // Log activity
    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'lead', ?, 'created', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    // No billing event here. The lead fee is owed by the workspace the
    // lead BOOKS with, at booking commit — never at row creation and
    // never at a staff accept click (WS-1) — see lib/lead-meter.ts.

    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();

    return entity(WIRE_LEAD, lead, {}, 201);
  },
);

// PATCH /api/leads/:id
leadsRouter.patch(
  '/:id',
  validate(UpdateLeadSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const leadId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id FROM leads WHERE id = ? AND workspace_id = ?',
    )
      .bind(leadId, workspaceId)
      .first();

    if (!existing) return notFound('Lead');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    const allowed = [
      'first_name',
      'last_name',
      'email',
      'phone',
      'preferred_contact',
      'street',
      'city',
      'state',
      'zip',
      'status',
      'source',
      'campaign_id',
      'service_type',
      'estimated_value',
      'notes',
    ];

    // Map camelCase body to snake_case columns
    const camelToSnake: Record<string, string> = {
      firstName: 'first_name',
      lastName: 'last_name',
      preferredContact: 'preferred_contact',
      campaignId: 'campaign_id',
      serviceType: 'service_type',
      estimatedValue: 'estimated_value',
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

    // 'qualified' is a lifecycle signal, not just a pipeline label —
    // the accept transition requires qualified_at IS NOT NULL
    // (see POST /:id/accept below). Stamp it here too, atomically, so the
    // existing kanban "move to qualified" action (a plain PATCH) keeps
    // working AND satisfies that invariant, without a caller having to know
    // about a separate endpoint. COALESCE makes this idempotent — re-PATCHing
    // status='qualified' never resets an earlier qualified_at.
    if (body.status === 'qualified') {
      sets.push('qualified_at = COALESCE(qualified_at, ?)');
      vals.push(now);
    }

    vals.push(leadId, workspaceId);

    await env.DB.prepare(
      `UPDATE leads SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'lead', ?, 'updated', ?)
  `,
    )
      .bind(newId(), workspaceId, user.id, leadId, now)
      .run();

    const updated = await env.DB.prepare('SELECT * FROM leads WHERE id = ?')
      .bind(leadId)
      .first<Record<string, unknown>>();

    return entity(WIRE_LEAD, updated);
  },
);

// DELETE /api/leads/:id
leadsRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const leadId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM leads WHERE id = ? AND workspace_id = ?',
  )
    .bind(leadId, workspaceId)
    .first();

  if (!existing) return notFound('Lead');

  await env.DB.prepare('DELETE FROM leads WHERE id = ? AND workspace_id = ?')
    .bind(leadId, workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'lead', ?, 'deleted', ?)
  `,
  )
    .bind(newId(), workspaceId, user.id, leadId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});

// POST /api/leads/:id/convert — Lead → Opportunity
leadsRouter.post(
  '/:id/convert',
  validate(ConvertLeadSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as any).workspaceId;
    const user = (req as any).user;
    const leadId = req.params!['id'];

    const lead = await env.DB.prepare(
      'SELECT * FROM leads WHERE id = ? AND workspace_id = ?',
    )
      .bind(leadId, workspaceId)
      .first<Record<string, unknown>>();

    if (!lead) return notFound('Lead');
    if (lead['status'] === 'converted')
      return error('Lead is already converted');

    const body = (req as any).validatedBody as {
      title?: string;
      value?: number;
    };
    const now = new Date().toISOString();
    const oppId = newId();

    await env.DB.prepare(
      `
    INSERT INTO opportunities (
      id, workspace_id, lead_id, title, status, value, service_type,
      notes, created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
      .bind(
        oppId,
        workspaceId,
        leadId,
        body.title ??
          `${lead['first_name']} ${lead['last_name']} — ${lead['service_type'] ?? 'Service'}`,
        'open',
        body.value ?? lead['estimated_value'] ?? 0,
        lead['service_type'] ?? '',
        '',
        now,
        now,
        user.id,
      )
      .run();

    await env.DB.prepare(
      `
    UPDATE leads
    SET status = 'converted', converted_to_opportunity_id = ?, updated_at = ?
    WHERE id = ?
  `,
    )
      .bind(oppId, now, leadId)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
    VALUES (?, ?, ?, 'lead', ?, 'converted', ?, ?)
  `,
    )
      .bind(
        newId(),
        workspaceId,
        user.id,
        leadId,
        JSON.stringify({ opportunityId: oppId }),
        now,
      )
      .run();

    return json({ data: { opportunityId: oppId } }, 201);
  },
);

// POST /api/leads/:id/qualify — mark a lead qualified (a real, contactable,
// in-scope request) without going through the general PATCH. Equivalent to
// PATCHing status:'qualified' (which also stamps qualified_at — see above),
// offered as an explicit action for a future "Qualify" UI control. Idempotent:
// qualifying twice never resets an earlier qualified_at.
leadsRouter.post('/:id/qualify', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const leadId = req.params!['id'];

  const lead = await env.DB.prepare(
    'SELECT * FROM leads WHERE id = ? AND workspace_id = ?',
  )
    .bind(leadId, workspaceId)
    .first<Record<string, unknown>>();

  if (!lead) return notFound('Lead');
  if (lead['withdrawn_at']) {
    return error(
      'Lead has been withdrawn and cannot be qualified',
      409,
      'LEAD_WITHDRAWN',
    );
  }

  const now = new Date().toISOString();

  if (!lead['qualified_at']) {
    await env.DB.prepare(
      `UPDATE leads SET status = 'qualified', qualified_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND qualified_at IS NULL`,
    )
      .bind(now, now, leadId, workspaceId)
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
       VALUES (?, ?, ?, 'lead', ?, 'qualified', ?)`,
    )
      .bind(newId(), workspaceId, user.id, leadId, now)
      .run();
  }

  const updated = await env.DB.prepare('SELECT * FROM leads WHERE id = ?')
    .bind(leadId)
    .first<Record<string, unknown>>();

  return entity(WIRE_LEAD, updated);
});

// GET /api/leads/:id/fee — the per-lead fee a booking of this lead
// will bill, quoted before anything commits. Same quoteLeadFee()
// lookup that recordLeadMeter() uses (rate card, then the workspace
// override), so the figure shown here is the figure that lands in
// lead_meter_events.price_usd when the lead books. Whole US dollars —
// one of the two deliberate non-cents amounts (CLAUDE.md §5.0.1).
//
// A service with no explicit rate-card entry is a 422, never a $0 quote:
// the old substring inference priced "evaluation" as an EV-charger lead
// and silently quoted $0 for anything it did not recognise.
leadsRouter.get('/:id/fee', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const lead = await env.DB.prepare(
    'SELECT id, service_type FROM leads WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params!['id'], workspaceId)
    .first<{ id: string; service_type: string | null }>();

  if (!lead) return notFound('Lead');
  const rate = await quoteLeadFee(
    env,
    workspaceId,
    String(lead.service_type ?? ''),
  );
  if (!rate) {
    return error(
      `No per-lead rate for service "${lead.service_type ?? ''}" — it is not in the rate card's explicit service map.`,
      422,
      'UNMAPPED_SERVICE',
    );
  }
  const receive = await assertCanReceiveLeads(env, workspaceId);
  return json({
    data: {
      leadId: lead.id,
      vertical: rate.vertical,
      priceUsd: rate.priceUsd,
      receive,
    },
  });
});

// POST /api/leads/:id/accept — a lead state transition, NOT a billing
// event (WS-1, canonical model v14). The fee bills at BOOKING commit
// (schedule-aware delivery) and only there; this click used to fire
// recordLeadMeter + the charge, which billed shops for leads that had
// never booked. A lead is accepted by whichever workspace RECEIVES it
// (today: the workspace it was captured under — lead portability across
// workspaces doesn't exist yet, see greenput-consent-model.md),
// independent of who originated the traffic. Requires qualified_at
// IS NOT NULL. The response keeps its historical shape — meterEvent
// and charge are always null now, because accept creates neither.
leadsRouter.post('/:id/accept', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const leadId = req.params!['id'];

  const lead = await env.DB.prepare(
    'SELECT * FROM leads WHERE id = ? AND workspace_id = ?',
  )
    .bind(leadId, workspaceId)
    .first<Record<string, unknown>>();

  if (!lead) return notFound('Lead');
  if (lead['withdrawn_at']) {
    return error(
      'Lead has been withdrawn and cannot be accepted',
      409,
      'LEAD_WITHDRAWN',
    );
  }
  if (!lead['qualified_at']) {
    return error(
      'Lead must be qualified before it can be accepted',
      400,
      'NOT_QUALIFIED',
    );
  }

  // The rate check runs BEFORE any mutation, unchanged from the
  // accept-billing era: a lead whose service has no explicit rate-card
  // entry cannot be accepted (its booking could never be priced, and a
  // silent $0 must stay impossible). The operator adds the service to
  // lead-rate-card.ts.
  if (!resolveLeadRate(String(lead['service_type'] ?? ''))) {
    return error(
      `No per-lead rate for service "${String(lead['service_type'] ?? '')}" — it is not in the rate card's explicit service map.`,
      422,
      'UNMAPPED_SERVICE',
    );
  }

  const now = new Date().toISOString();

  if (lead['accepted_at']) {
    // Already accepted — the transition is idempotent, and accept
    // never bills, so there is nothing to double here.
    return json({
      data: {
        lead: toWire(WIRE_LEAD, lead),
        meterEvent: null,
        alreadyAccepted: true,
        charge: null,
      },
    });
  }

  // Card on file, and no outstanding failed charge, before any write.
  // NOTE (WS-1): this gate predates fee-at-booking — it gated the
  // accept-time charge. It is left exactly where it was: delivery
  // relies on the same gate, and whether a cardless shop may still
  // *accept* (while being unable to book) is a portal-behavior
  // decision for the parent, not something this change silently moves.
  const receive = await assertCanReceiveLeads(env, workspaceId);
  if (!receive.ok) {
    return error(receive.message, 409, receive.code);
  }

  // Guarded by `accepted_at IS NULL`: D1/SQLite executes each statement
  // atomically, so of two concurrent accept requests exactly one sees
  // `changes: 1` here — the loser falls through to the idempotent branch
  // below.
  const result = await env.DB.prepare(
    `UPDATE leads SET accepted_at = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL`,
  )
    .bind(now, now, leadId, workspaceId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    const current = await env.DB.prepare('SELECT * FROM leads WHERE id = ?')
      .bind(leadId)
      .first<Record<string, unknown>>();
    return json({
      data: {
        lead: current ? toWire(WIRE_LEAD, current) : null,
        meterEvent: null,
        alreadyAccepted: true,
        charge: null,
      },
    });
  }

  // No meter row, no charge: the fee fires at booking commit only
  // (lib/schedule-delivery.ts via recordLeadMeter + chargeBookedLeadFee).
  await env.DB.prepare(
    `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
     VALUES (?, ?, ?, 'lead', ?, 'accepted', ?, ?)`,
  )
    .bind(newId(), workspaceId, user.id, leadId, JSON.stringify({}), now)
    .run();

  const updated = await env.DB.prepare('SELECT * FROM leads WHERE id = ?')
    .bind(leadId)
    .first<Record<string, unknown>>();

  return json({
    data: {
      lead: updated ? toWire(WIRE_LEAD, updated) : null,
      meterEvent: null,
      alreadyAccepted: false,
      charge: null,
    },
  });
});

// POST /api/leads/:id/deliver — schedule-aware delivery (item 10b).
// When the shop is enrolled for this lead's service and a slot exists
// inside the configured scope, the job is booked onto the schedule,
// the lead is accepted, and the delivery fee meters — one step, no
// shop-confirm. Out of scope is NOT an error: the response says so
// ({ delivered: false, reason, fallback: 'request_flow' }) and the
// caller keeps the request-and-confirm flow.
leadsRouter.post('/:id/deliver', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const actorUserId = (req as any).user?.id as string;
  let body: { durationMinutes?: unknown } = {};
  try {
    body = (await (req as unknown as Request).json()) as typeof body;
  } catch {
    body = {};
  }
  const durationMinutes =
    typeof body.durationMinutes === 'number' && body.durationMinutes >= 15
      ? Math.floor(body.durationMinutes)
      : undefined;
  try {
    const outcome = await deliverLead(env, {
      workspaceId,
      leadId: req.params.id,
      actorUserId,
      durationMinutes,
    });
    if (!outcome.delivered) {
      if (
        outcome.reason === 'card_required' ||
        outcome.reason === 'delivery_paused'
      ) {
        return error(
          outcome.reason === 'card_required'
            ? CARD_REQUIRED_MESSAGE
            : DELIVERY_PAUSED_MESSAGE,
          409,
          outcome.reason === 'card_required'
            ? 'CARD_REQUIRED'
            : 'DELIVERY_PAUSED',
        );
      }
      return json({ ...outcome, fallback: 'request_flow' });
    }
    return json(outcome);
  } catch (err) {
    if (err instanceof UnmappedLeadServiceError) {
      return json(
        {
          error: {
            code: 'UNMAPPED_SERVICE',
            message:
              "This lead's service has no rate-card mapping, so it cannot be delivered or billed",
            serviceType: err.serviceType,
          },
        },
        422,
      );
    }
    if (err instanceof DeliveryError) {
      const status =
        err.code === 'LEAD_NOT_FOUND'
          ? 404
          : err.code === 'ALREADY_ACCEPTED'
            ? 409
            : 422;
      return json({ error: { code: err.code, message: err.message } }, status);
    }
    throw err;
  }
});

// POST /api/leads/:id/delivery/undo — the one-tap undo: job cancelled,
// slots freed, delivery marked undone. The booking's lead fee STANDS
// (WS-1/FR-1.4): undo is not a waiver, and the lead record keeps the
// history.
leadsRouter.post('/:id/delivery/undo', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const actorUserId = (req as any).user?.id as string;
  try {
    const result = await undoDelivery(env, {
      workspaceId,
      leadId: req.params.id,
      actorUserId,
    });
    return json(result);
  } catch (err) {
    if (err instanceof DeliveryError) {
      return json(
        { error: { code: err.code, message: err.message } },
        err.code === 'NO_ACTIVE_DELIVERY' ? 409 : 422,
      );
    }
    throw err;
  }
});

// POST /api/leads/:id/withdraw — the consumer backs out (e.g. balks at the
// price) before or after acceptance, recorded by the contractor's staff.
//
// The fee rules live in ONE place, `withdrawLead` in libs/shared/pricing,
// which the tenant site's `POST /quote/s/:id/cancel` calls too (GP-105): before
// booking nothing is billed; after booking the fee stands — a `pending` meter
// event stays `pending` and collectible, never waived or deleted by a
// withdrawal; an already-invoiced event is left alone;
// a second withdrawal changes nothing. The booking DEPOSIT settles after it,
// here (lib/deposits.ts): forfeit only when a confirmed booking is withdrawn
// inside the 24h window, a full release otherwise. This route keeps its workspace scoping
// and takes an optional `{ reason }` from the closed set on
// `leads.withdrawn_reason` — validated here, because a migrated database has
// no CHECK on that column. No body at all is still fine.
leadsRouter.post('/:id/withdraw', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;
  const user = (req as any).user;
  const leadId = req.params!['id'];

  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return error('Invalid JSON body', 400, 'INVALID_JSON');
  }
  const parsed = WithdrawLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return error(
      parsed.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
    );
  }

  const outcome = await withdrawLead(env.DB, {
    workspaceId,
    leadId,
    reason: parsed.data.reason ?? null,
    now: new Date().toISOString(),
    actorUserId: user.id,
    newId,
  });
  if (outcome.kind === 'not_found') return notFound('Lead');

  // The booking deposit settles on the same withdrawal (fee paper v2
  // §3, lib/deposits.ts). withdrawLead leaves the pending meter event
  // standing (WS-1: withdrawal never waives), so:
  //   - a CONFIRMED booking withdrawn inside the 24-hour window is the
  //     forfeit case: the deposit is captured with the fee taken first
  //     (the fee is recovered from the forfeit, and forfeitDeposit marks
  //     the meter row waived so it is not billed twice);
  //   - every other withdrawal releases the deposit in full, and the
  //     booking fee remains collectible on the workspace's card.
  // No delivery means no deposit exists and there is nothing to settle.
  // Settlement is idempotent, so a repeated withdrawal can retry a
  // settlement Stripe rejected the first time.
  let depositSettlement: SettleOutcome | null = null;
  const delivery = await env.DB.prepare(
    `SELECT job_id FROM lead_deliveries
      WHERE lead_id = ? AND workspace_id = ?
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(leadId, workspaceId)
    .first<{ job_id: string }>();
  if (delivery) {
    const job = await env.DB.prepare(
      'SELECT scheduled_start FROM jobs WHERE id = ? AND workspace_id = ?',
    )
      .bind(delivery.job_id, workspaceId)
      .first<{ scheduled_start: string }>();
    const confirmed = !!outcome.lead?.['accepted_at'];
    if (
      job &&
      confirmed &&
      isInsideCancelWindow(job.scheduled_start, new Date())
    ) {
      depositSettlement = await forfeitDeposit(env, {
        workspaceId,
        jobId: delivery.job_id,
        reason: 'customer_cancel_inside_window',
        actorUserId: user.id,
      }).catch(() => null);
    } else {
      depositSettlement = await releaseDeposit(env, {
        workspaceId,
        jobId: delivery.job_id,
        reason: 'lead_withdrawn',
        actorUserId: user.id,
      }).catch(() => null);
    }
  }

  return json({
    data: {
      lead: outcome.lead ? toWire(WIRE_LEAD, outcome.lead) : null,
      meterEventAdjustment: outcome.meterEventAdjustment,
      depositSettlement: depositSettlement
        ? {
            settled: depositSettlement.settled,
            status: depositSettlement.deposit?.status ?? null,
          }
        : null,
    },
  });
});
