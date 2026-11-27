import {
  bookInFreeLane,
  findAutoBookSlot,
  slotDeleteStatement,
  slotInsertStatements,
  slotStartsFor,
  type AutoBookBlackout,
  type AutoBookBuffers,
  type AutoBookJob,
  type AutoBookSettings,
  type AutoBookWindow,
} from '@greenput/shared/scheduling';
import type { Env } from '../env';
import { newId } from './response';
import { resolveLeadRate, UnmappedLeadServiceError } from './lead-rate-card';
import { recordLeadMeter } from './lead-meter';
import { chargeBookedLeadFee } from './lead-fee-billing';
import { assertCanReceiveLeads } from './lead-billing-gate';
import { releaseDeposit } from './deposits';
import { sendConsumerSms } from './consent-guard';
import { sendEmail } from '@greenput/shared/notifications';

/**
 * Schedule-aware delivery (gap H3 / plan item 10b).
 *
 * Warren's settled direction (2026-10-15): a delivered lead should land
 * ON the contractor's schedule automatically — the shop-confirm step in
 * the older flow was a build-state gap, not the product intent. Auto-
 * booking is the standard for shops ENROLLED in schedule management,
 * where "enrolled" means configuration, never a paid tier: the shop
 * picks which availability windows are exposed (TIME), which services
 * may auto-book (SERVICE — imperative while FSM pricing coverage is
 * partial), and which team members are in (TEAM, one at a time). See
 * schedule_delivery_enrollments (migration 038).
 *
 * Delivery here is a BOOKING commit, and booking is the billing event
 * (WS-1, canonical model v14: GreenPut charges when a job BOOKS into
 * the contractor's schedule — not at a staff accept click, not at a
 * pool accept). A successful delivery books the job through the same
 * job_slots lane guard every booking path uses, stamps the lead
 * accepted, and fires the rate-card meter to this workspace, linked
 * to the job and delivery it just wrote. Outside configured scope the
 * function returns a typed miss and writes nothing — the caller falls
 * back to the request-and-confirm flow, which stays the exception path.
 *
 * The one-tap undo cancels the job, frees its slots, and marks the
 * delivery undone — but the fee STANDS. A booked job was delivered;
 * declines, cancels and no-shows never un-bill it. The only refund
 * path is refundLeadFee, for proven fraud or platform fault (FR-1.4).
 */

export type DeliveryMissReason =
  'not_enrolled' | 'no_slot_in_scope' | 'card_required' | 'delivery_paused';

export type DeliveryOutcome =
  | {
      delivered: true;
      deliveryId: string;
      jobId: string;
      userId: string;
      slotStart: string;
      slotEnd: string;
      meterEventId: string;
    }
  | { delivered: false; reason: DeliveryMissReason };

export class DeliveryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DeliveryError';
    this.code = code;
  }
}

interface LeadRow {
  id: string;
  service_type: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  accepted_at: string | null;
  withdrawn_at: string | null;
}

const DEFAULT_DURATION_MINUTES = 120;

async function loadLead(
  env: Env,
  workspaceId: string,
  leadId: string,
): Promise<LeadRow | null> {
  return env.DB.prepare(
    `SELECT id, service_type, first_name, last_name, email, phone, street,
            city, state, zip, accepted_at, withdrawn_at
       FROM leads WHERE id = ? AND workspace_id = ?`,
  )
    .bind(leadId, workspaceId)
    .first<LeadRow>();
}

interface EnrollmentRow {
  id: string;
  user_id: string;
  service_type: string;
  window_ids_json: string;
}

export async function deliverLead(
  env: Env,
  args: {
    workspaceId: string;
    leadId: string;
    actorUserId: string;
    durationMinutes?: number;
    now?: Date;
  },
): Promise<DeliveryOutcome> {
  const { workspaceId, actorUserId } = args;
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  const lead = await loadLead(env, workspaceId, args.leadId);
  if (!lead) throw new DeliveryError('LEAD_NOT_FOUND', 'Lead not found');
  if (lead.withdrawn_at) {
    throw new DeliveryError(
      'LEAD_WITHDRAWN',
      'A withdrawn lead cannot be delivered',
    );
  }
  if (lead.accepted_at) {
    throw new DeliveryError(
      'ALREADY_ACCEPTED',
      'This lead has already been accepted or delivered',
    );
  }

  // ── Scope gate: enrollment on all three axes at once. ──
  const enrollments = (
    await env.DB.prepare(
      `SELECT id, user_id, service_type, window_ids_json
         FROM schedule_delivery_enrollments
        WHERE workspace_id = ? AND enabled = 1
          AND (service_type = ? OR service_type = '')
        ORDER BY (service_type = '') ASC, created_at ASC`,
    )
      .bind(workspaceId, lead.service_type)
      .all<EnrollmentRow>()
  ).results;
  if (enrollments.length === 0) {
    return { delivered: false, reason: 'not_enrolled' };
  }
  const enrolledUserIds = [...new Set(enrollments.map((e) => e.user_id))];
  const exposedWindowIds = new Map<string, Set<string> | null>();
  for (const e of enrollments) {
    let ids: string[] = [];
    try {
      ids = JSON.parse(e.window_ids_json) as string[];
    } catch {
      // A malformed window list reads as "no windows exposed" — the
      // safe direction for an auto-booking scope.
    }
    const existing = exposedWindowIds.get(e.user_id);
    if (existing === null) continue; // already "all windows"
    if (ids.length === 0) exposedWindowIds.set(e.user_id, null);
    else {
      const merged = new Set([...(existing ?? []), ...ids]);
      exposedWindowIds.set(e.user_id, merged);
    }
  }

  // ── Scheduling inputs (the four tables captured by migration 035). ──
  const settingsRow = await env.DB.prepare(
    `SELECT timezone, travel_buffer_minutes, min_notice_hours, max_lead_time_days
       FROM schedule_settings WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .first<{
      timezone: string | null;
      travel_buffer_minutes: number;
      min_notice_hours: number;
      max_lead_time_days: number | null;
    }>();
  const workspace = await env.DB.prepare(
    `SELECT timezone, name, stripe_account_id, slug, custom_hostname, custom_domain_status
     FROM workspaces WHERE id = ?`,
  )
    .bind(workspaceId)
    .first<{
      timezone: string | null;
      name: string;
      stripe_account_id: string | null;
      slug: string | null;
      custom_hostname: string | null;
      custom_domain_status: string | null;
    }>();
  const settings: AutoBookSettings = {
    timezone: settingsRow?.timezone ?? workspace?.timezone ?? null,
    minNoticeHours: settingsRow?.min_notice_hours ?? 0,
    maxLeadTimeDays: settingsRow?.max_lead_time_days ?? null,
    travelBufferMinutes: settingsRow?.travel_buffer_minutes ?? 0,
  };

  const placeholders = enrolledUserIds.map(() => '?').join(',');
  const windowRows = (
    await env.DB.prepare(
      `SELECT id, user_id, day_of_week, start_minute, end_minute
         FROM availability_windows
        WHERE workspace_id = ? AND active = 1 AND user_id IN (${placeholders})`,
    )
      .bind(workspaceId, ...enrolledUserIds)
      .all<{
        id: string;
        user_id: string;
        day_of_week: number;
        start_minute: number;
        end_minute: number;
      }>()
  ).results;
  const windows: AutoBookWindow[] = windowRows
    .filter((w) => {
      const exposed = exposedWindowIds.get(w.user_id);
      return exposed === null || exposed === undefined || exposed.has(w.id);
    })
    .map((w) => ({
      userId: w.user_id,
      dayOfWeek: w.day_of_week,
      startMinute: w.start_minute,
      endMinute: w.end_minute,
    }));
  // findAutoBookSlot scans techs in window order — enrollment order is
  // the shop's preference, so re-order windows by enrolledUserIds.
  windows.sort(
    (a, b) =>
      enrolledUserIds.indexOf(a.userId) - enrolledUserIds.indexOf(b.userId),
  );

  const blackouts: AutoBookBlackout[] = (
    await env.DB.prepare(
      `SELECT user_id, start_at, end_at FROM availability_blackouts
        WHERE workspace_id = ? AND user_id IN (${placeholders})`,
    )
      .bind(workspaceId, ...enrolledUserIds)
      .all<{ user_id: string; start_at: string; end_at: string }>()
  ).results.map((b) => ({
    userId: b.user_id,
    startAt: b.start_at,
    endAt: b.end_at,
  }));

  const bufferRow = await env.DB.prepare(
    `SELECT pre_buffer_minutes, post_buffer_minutes, min_gap_minutes, max_jobs_per_day
       FROM schedule_buffers
      WHERE workspace_id = ? AND (service_type = ? OR service_type = '')
      ORDER BY (service_type = '') ASC LIMIT 1`,
  )
    .bind(workspaceId, lead.service_type)
    .first<{
      pre_buffer_minutes: number;
      post_buffer_minutes: number;
      min_gap_minutes: number;
      max_jobs_per_day: number | null;
    }>();
  const buffers: AutoBookBuffers = {
    preMinutes: bufferRow?.pre_buffer_minutes ?? 0,
    postMinutes: bufferRow?.post_buffer_minutes ?? 0,
    minGapMinutes: bufferRow?.min_gap_minutes ?? 0,
    maxJobsPerDay: bufferRow?.max_jobs_per_day ?? null,
  };

  const jobs: AutoBookJob[] = (
    await env.DB.prepare(
      `SELECT assigned_to, scheduled_start, scheduled_end FROM jobs
        WHERE workspace_id = ? AND assigned_to IN (${placeholders})
          AND status IN ('scheduled', 'in_progress')`,
    )
      .bind(workspaceId, ...enrolledUserIds)
      .all<{
        assigned_to: string | null;
        scheduled_start: string;
        scheduled_end: string;
      }>()
  ).results.map((j) => ({
    userId: j.assigned_to,
    startUtc: j.scheduled_start,
    endUtc: j.scheduled_end,
  }));

  const slot = findAutoBookSlot({
    windows,
    blackouts,
    buffers,
    settings,
    jobs,
    durationMinutes: args.durationMinutes ?? DEFAULT_DURATION_MINUTES,
    now,
  });
  if (!slot) return { delivered: false, reason: 'no_slot_in_scope' };

  // Priced before anything is written: an unmapped service must never
  // book, exactly as an accept must never bill $0 silently.
  if (!resolveLeadRate(lead.service_type)) {
    throw new UnmappedLeadServiceError(lead.service_type);
  }

  // A card is required, and a failed charge pauses delivery, before the
  // booking write. Out-of-scope misses above stay misses; this one is a
  // refusal the route answers as 409.
  const receive = await assertCanReceiveLeads(env, workspaceId);
  if (!receive.ok) {
    return {
      delivered: false,
      reason:
        receive.code === 'CARD_REQUIRED' ? 'card_required' : 'delivery_paused',
    };
  }

  // ── The booking write: customer + opportunity + job + slots, atomic
  // under the lane guard every booking path shares. ──
  const existingCustomer = await env.DB.prepare(
    `SELECT id FROM customers
      WHERE workspace_id = ?
        AND ((? <> '' AND phone = ?) OR (? <> '' AND email = ?))
      LIMIT 1`,
  )
    .bind(workspaceId, lead.phone, lead.phone, lead.email, lead.email)
    .first<{ id: string }>();
  const customerId = existingCustomer?.id ?? newId();
  const opportunityId = newId();
  const jobId = newId();
  const deliveryId = newId();
  const lastJob = await env.DB.prepare(
    'SELECT job_number FROM jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(workspaceId)
    .first<{ job_number: string }>();
  const lastNum = lastJob
    ? parseInt(lastJob.job_number.replace('#', ''), 10)
    : 1000;
  const jobNumber = `#${(Number.isFinite(lastNum) ? lastNum : 1000) + 1}`;
  const title =
    `${lead.service_type} — ${lead.first_name} ${lead.last_name}`.trim();
  const slotStarts = slotStartsFor(slot.startUtc, slot.endUtc);

  const lane = await bookInFreeLane(env.DB, workspaceId, (lane) => [
    ...(existingCustomer
      ? []
      : [
          env.DB.prepare(
            `INSERT INTO customers (
               id, workspace_id, first_name, last_name, email, phone,
               preferred_contact, street, city, state, zip, notes,
               total_job_value, job_count, created_at, updated_at, created_by
             ) VALUES (?,?,?,?,?,?, 'phone', ?,?,?,?, '', 0, 0, ?, ?, ?)`,
          ).bind(
            customerId,
            workspaceId,
            lead.first_name ?? '',
            lead.last_name ?? '',
            lead.email ?? '',
            lead.phone ?? '',
            lead.street ?? '',
            lead.city ?? '',
            lead.state ?? '',
            lead.zip ?? '',
            nowIso,
            nowIso,
            actorUserId,
          ),
        ]),
    env.DB.prepare(
      `INSERT INTO opportunities (
         id, workspace_id, lead_id, customer_id, title, status, value,
         service_type, notes, closed_at, converted_to_job_id,
         created_at, updated_at, created_by
       ) VALUES (?,?,?,?,?,'won',0,?,'',?,?,?,?,?)`,
    ).bind(
      opportunityId,
      workspaceId,
      lead.id,
      customerId,
      title,
      lead.service_type,
      nowIso,
      jobId,
      nowIso,
      nowIso,
      actorUserId,
    ),
    env.DB.prepare(
      `INSERT INTO jobs (
         id, workspace_id, opportunity_id, customer_id, job_number, title,
         status, street, city, state, zip, scheduled_start, scheduled_end,
         total, notes, created_at, updated_at, created_by, assigned_to
       ) VALUES (?,?,?,?,?,?,'scheduled',?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      jobId,
      workspaceId,
      opportunityId,
      customerId,
      jobNumber,
      title,
      lead.street ?? '',
      lead.city ?? '',
      lead.state ?? '',
      lead.zip ?? '',
      slot.startUtc,
      slot.endUtc,
      0,
      'Auto-booked by schedule-aware delivery',
      nowIso,
      nowIso,
      actorUserId,
      slot.userId,
    ),
    ...slotInsertStatements(env.DB, {
      workspaceId,
      jobId,
      lane,
      slotStarts,
    }),
    env.DB.prepare(
      `UPDATE leads
          SET accepted_at = ?, status = 'accepted',
              converted_to_opportunity_id = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL`,
    ).bind(nowIso, opportunityId, nowIso, lead.id, workspaceId),
    env.DB.prepare(
      `INSERT INTO lead_deliveries
         (id, lead_id, workspace_id, job_id, user_id, slot_start, slot_end, status, created_at)
       VALUES (?,?,?,?,?,?,?,'booked',?)`,
    ).bind(
      deliveryId,
      lead.id,
      workspaceId,
      jobId,
      slot.userId,
      slot.startUtc,
      slot.endUtc,
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?,?,?,'lead',?,'delivered',?,?)`,
    ).bind(
      newId(),
      workspaceId,
      actorUserId,
      lead.id,
      JSON.stringify({ jobId, userId: slot.userId, slotStart: slot.startUtc }),
      nowIso,
    ),
  ]);
  if (lane === null) {
    // The per-user fit was real but every workspace lane at that
    // half-hour is taken — nothing was written; report a scope miss.
    return { delivered: false, reason: 'no_slot_in_scope' };
  }

  // Booking IS the billing event: the booking batch above committed
  // (job 'scheduled', slots, lead_deliveries 'booked'), so the meter
  // row — linked to that job and delivery — then the off-session
  // charge. The card gate already ran. A decline stays pending (the
  // fee stands; undo does not waive it) and does not roll the booking
  // back. It does pause the next delivery. With Stripe configured, the
  // booking text goes out only after the fee is actually collected — a
  // US SMS is under Stripe's minimum, so it is not its own charge, and
  // a paused shop must not keep spending Twilio credit.
  const meter = await recordLeadMeter(env, {
    workspaceId,
    leadId: lead.id,
    serviceType: lead.service_type,
    jobId,
    deliveryId,
  });
  let chargeOutcome: string | null = null;
  if (meter.inserted) {
    const charged = await chargeBookedLeadFee(env, meter.id);
    chargeOutcome = charged.outcome;
  }

  // No deposit is opened at delivery. The booking-deposit model was
  // revoked on 2026-10-20 (Warren): a booking's legitimacy comes from
  // bilateral confirmation, not a card hold, and no homeowner may be
  // sent a deposit link from this path. The engine in lib/deposits.ts
  // stays in place, dormant; a deposit can still be opened manually
  // through POST /api/payments/deposits, and undo/withdraw/job
  // transitions still settle any row that exists.

  // ── Instant notification, best-effort both directions. ──
  const when = new Date(slot.startUtc).toLocaleString('en-US', {
    timeZone: settings.timezone ?? 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const owners = (
    await env.DB.prepare(
      `SELECT u.email FROM user_workspaces uw JOIN users u ON u.id = uw.user_id
        WHERE uw.workspace_id = ? AND uw.role IN ('owner', 'admin') AND u.email <> ''
        LIMIT 3`,
    )
      .bind(workspaceId)
      .all<{ email: string }>()
  ).results;
  for (const owner of owners) {
    const result = await sendEmail(env, {
      to: owner.email,
      subject: `New job auto-booked: ${title}`,
      html:
        `<p>GreenPut delivered a lead straight into your schedule.</p>` +
        `<p><strong>${title}</strong><br>When: ${when}<br>Job: ${jobNumber}</p>` +
        `<p>Not right? Undo the delivery from the lead in GreenPut — ` +
        `the job is cancelled and the slot frees up. The lead fee for ` +
        `this booking still applies.</p>`,
    }).catch(() => ({ success: false }));
    const sent = result.success;
    await env.DB.prepare(
      `INSERT INTO notification_log (id, workspace_id, user_id, channel, event_type, recipient, status)
       VALUES (?, ?, NULL, 'email', 'lead_delivered', ?, ?)`,
    )
      .bind(newId(), workspaceId, owner.email, sent ? 'sent' : 'failed')
      .run()
      .catch(() => undefined);
  }
  const feeCollected = !env.STRIPE_SECRET_KEY || chargeOutcome === 'paid';
  if (lead.phone && feeCollected) {
    await sendConsumerSms(env, {
      workspaceId,
      to: lead.phone,
      body:
        `You're booked with ${workspace?.name ?? 'your contractor'} for ` +
        `${when}. They'll confirm any final details before the visit.`,
    }).catch(() => ({ sent: false as const, reason: 'SEND_FAILED' as const }));
  }

  return {
    delivered: true,
    deliveryId,
    jobId,
    userId: slot.userId,
    slotStart: slot.startUtc,
    slotEnd: slot.endUtc,
    meterEventId: meter.id,
  };
}

export async function undoDelivery(
  env: Env,
  args: { workspaceId: string; leadId: string; actorUserId: string },
): Promise<{ undone: true; jobId: string }> {
  const { workspaceId, actorUserId } = args;
  const nowIso = new Date().toISOString();
  const delivery = await env.DB.prepare(
    `SELECT id, job_id FROM lead_deliveries
      WHERE lead_id = ? AND workspace_id = ? AND status = 'booked'
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(args.leadId, workspaceId)
    .first<{ id: string; job_id: string }>();
  if (!delivery) {
    throw new DeliveryError(
      'NO_ACTIVE_DELIVERY',
      'This lead has no booked delivery to undo',
    );
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND workspace_id = ?`,
    ).bind(nowIso, delivery.job_id, workspaceId),
    slotDeleteStatement(env.DB, delivery.job_id),
    env.DB.prepare(
      `UPDATE lead_deliveries SET status = 'undone', undone_at = ? WHERE id = ?`,
    ).bind(nowIso, delivery.id),
    // No meter write here: undoing a delivery does NOT waive the fee.
    // The booking happened and billed; the fee stands (FR-1.4 — refunds
    // exist only for proven fraud and platform fault, via refundLeadFee).
    env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?,?,?,'lead',?,'delivery_undone',?,?)`,
    ).bind(
      newId(),
      workspaceId,
      actorUserId,
      args.leadId,
      JSON.stringify({ jobId: delivery.job_id }),
      nowIso,
    ),
  ]);
  // An undone delivery is a pre-confirmation exit: a deposit, if one
  // exists for this job, releases in full. Delivery no longer opens
  // one (model revoked 2026-10-20), but a manually opened row can
  // exist and still settles here. Best-effort like the rest of the
  // money leg — a Stripe failure is recorded on the deposit row,
  // never thrown into the undo.
  await releaseDeposit(env, {
    workspaceId,
    jobId: delivery.job_id,
    reason: 'delivery_undone',
    actorUserId,
  }).catch(() => undefined);
  return { undone: true, jobId: delivery.job_id };
}
