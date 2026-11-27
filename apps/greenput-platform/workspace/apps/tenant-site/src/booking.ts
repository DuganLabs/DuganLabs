/// <reference types="@cloudflare/workers-types" />
import {
  isDemoWorkspaceSlug,
  LEAD_METER_INSERT_SQL,
  OUTSTANDING_LEAD_FEES_SQL,
  priceUsdForWorkspaceRow,
  resolveLeadRate,
  WORKSPACE_LEAD_FEE_SQL,
  WORKSPACE_STRIPE_CUSTOMER_SQL,
  type LeadWithdrawnReason,
  type ReceiveBlockCode,
  type WorkspaceLeadFeeRow,
} from '@greenput/shared/models';
import {
  attributionUserId,
  estimatedDurationMinutes,
  estimatedValueCents,
  formatQuotePrice,
  qualifies,
  withdrawLead,
  type D1Like,
  type EvaluationResult,
  type LoadedFlow,
  type MeterEventAdjustment,
  type QuoteSessionRow,
} from '@greenput/shared/pricing';
import {
  bookInFreeLane,
  generateSlots,
  slotDeleteStatement,
  slotInsertStatements,
  slotStartsFor,
  type BookedInterval,
  type Slot,
} from '@greenput/shared/scheduling';
import {
  isBookable,
  type DatedHours,
  type WeekdayHours,
} from '@greenput/shared/utils';

/**
 * Booking the job a homeowner was just quoted (GP-103).
 *
 * The tenant site reads the same rows the API's availability screen writes
 * (GP-101), turns them into slots with the same generator the API will use
 * (GP-102), and writes the job through the same `job_slots` batch as
 * `POST /api/jobs` (GP-104). Nothing here is a second definition of any of
 * those — this file is the D1 plumbing between them and the quote session.
 *
 * Two rules the rest of the site depends on:
 *
 * - A workspace that has not said when it works, or in which zone, is NOT
 *   bookable. `offerSlots` answers `null` and the quote page keeps today's
 *   "someone will be in touch" card. Never an empty picker, never UTC.
 * - Only a PRICED outcome books. `qualifies()` in the pricing library is the
 *   one definition of that: a `span` is a band nobody has narrowed yet, and
 *   `no_quote` / `urgent` / `referral` carry no price at all.
 *
 * A homeowner's booking is a booking commit, so it bills the contractor's
 * per-lead fee exactly as schedule-aware delivery does (WS-1): the same
 * rate card and the same meter insert, from the shared models library,
 * in the same batch as the job. See `bookQuotedJob`.
 *
 * Change-or-cancel (GP-105) is the same capability. `cancelQuotedJob` frees
 * the slot and withdraws the lead in ONE batch through `withdrawLead` — the
 * function the staff route uses, so the fee rules cannot drift — and
 * `rescheduleQuotedJob` moves the job through `bookInFreeLane`, so a
 * homeowner changing a time never passes through a state with no slot.
 */

const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;

/** The booking policy and hours of a workspace that can be booked. */
export interface BookingPolicy {
  readonly timezone: string;
  readonly leadHours: number;
  readonly horizonDays: number;
  readonly travelBufferMinutes: number;
  readonly concurrency: number;
  readonly week: readonly WeekdayHours[];
  readonly exceptions: readonly DatedHours[];
}

interface PolicyRow {
  timezone: string | null;
  booking_lead_hours: number | null;
  booking_horizon_days: number | null;
  travel_buffer_minutes: number | null;
  concurrent_jobs: number | null;
}

interface WeekRow {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  is_open: number;
}

interface ExceptionRow extends WeekRow {
  date: string;
}

const SELECT_POLICY =
  'SELECT timezone, booking_lead_hours, booking_horizon_days, travel_buffer_minutes, concurrent_jobs FROM workspaces WHERE id = ?';
const SELECT_WEEK =
  'SELECT weekday, opens_at, closes_at, is_open FROM workspace_availability WHERE workspace_id = ? ORDER BY weekday ASC';
const SELECT_EXCEPTIONS =
  'SELECT date, opens_at, closes_at, is_open FROM workspace_availability_exceptions WHERE workspace_id = ? ORDER BY date ASC';

const numberOr = (value: number | null, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The workspace's hours and policy, or `null` when it cannot be booked: no
 * timezone, or no open weekday (`isBookable` in utils is the one definition).
 */
export async function loadBookingPolicy(
  db: D1Database,
  workspaceId: string,
): Promise<BookingPolicy | null> {
  const policy = await db
    .prepare(SELECT_POLICY)
    .bind(workspaceId)
    .first<PolicyRow>();
  if (!policy) return null;

  const [weekRows, exceptionRows] = await Promise.all([
    db.prepare(SELECT_WEEK).bind(workspaceId).all<WeekRow>(),
    db.prepare(SELECT_EXCEPTIONS).bind(workspaceId).all<ExceptionRow>(),
  ]);
  const week: WeekdayHours[] = weekRows.results.map((r) => ({
    weekday: r.weekday,
    isOpen: r.is_open === 1,
    opensAt: r.opens_at ?? undefined,
    closesAt: r.closes_at ?? undefined,
  }));
  const exceptions: DatedHours[] = exceptionRows.results.map((r) => ({
    date: r.date,
    isOpen: r.is_open === 1,
    opensAt: r.opens_at ?? undefined,
    closesAt: r.closes_at ?? undefined,
  }));

  const source = { timezone: policy.timezone, week, exceptions };
  if (!isBookable(source) || !policy.timezone) return null;

  return {
    timezone: policy.timezone,
    leadHours: numberOr(policy.booking_lead_hours, 24),
    horizonDays: numberOr(policy.booking_horizon_days, 30),
    travelBufferMinutes: numberOr(policy.travel_buffer_minutes, 30),
    concurrency: Math.max(1, Math.floor(numberOr(policy.concurrent_jobs, 1))),
    week,
    exceptions,
  };
}

/**
 * Work already on the calendar: every scheduled or in-progress job that has
 * not ended more than a day before `now`. Cancelled and finished jobs hold
 * no time.
 */
export async function loadBookedIntervals(
  db: D1Database,
  workspaceId: string,
  now: Date,
  /** A job being moved holds no time against itself (GP-105). */
  excludeJobId?: string,
): Promise<BookedInterval[]> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const rows = await db
    .prepare(
      `SELECT scheduled_start, scheduled_end FROM jobs
       WHERE workspace_id = ? AND status IN ('scheduled', 'in_progress') AND scheduled_end >= ?
         AND id <> ?`,
    )
    .bind(workspaceId, since, excludeJobId ?? '')
    .all<{ scheduled_start: string; scheduled_end: string }>();
  return rows.results.map((r) => ({
    startUtc: r.scheduled_start,
    endUtc: r.scheduled_end,
  }));
}

/** Did this outcome put a price on the job? Only a priced quote books. */
export function isBookableOutcome(result: EvaluationResult): boolean {
  return qualifies(result) && result.low !== null && result.high !== null;
}

/** What a homeowner can pick from, sized by their own quote. */
export interface SlotOffer {
  readonly timezone: string;
  readonly durationMinutes: number;
  readonly horizonDays: number;
  readonly slots: readonly Slot[];
}

/**
 * The slots this session's workspace can offer for this session's quote —
 * or `null` when there is nothing to offer: the outcome is not priced, or
 * the workspace is not bookable. An empty `slots` with a non-null offer is
 * a real state (fully booked to the horizon) and is rendered as such.
 */
export interface OfferOptions {
  /** The job being rescheduled: its own half-hours are offered as free. */
  excludeJobId?: string;
  /** The length already on the calendar, when moving a job; the quote's otherwise. */
  durationMinutes?: number;
}

export async function offerSlots(
  db: D1Database,
  workspaceId: string,
  result: EvaluationResult,
  now: Date,
  options: OfferOptions = {},
): Promise<SlotOffer | null> {
  if (!isBookableOutcome(result)) return null;
  const policy = await loadBookingPolicy(db, workspaceId);
  if (!policy) return null;

  const durationMinutes =
    options.durationMinutes && options.durationMinutes > 0
      ? options.durationMinutes
      : estimatedDurationMinutes(result);
  const jobs = await loadBookedIntervals(
    db,
    workspaceId,
    now,
    options.excludeJobId,
  );
  const slots = generateSlots({
    availability: policy.week,
    exceptions: policy.exceptions,
    jobs,
    durationMinutes,
    timezone: policy.timezone,
    leadHours: policy.leadHours,
    horizonDays: policy.horizonDays,
    travelBufferMinutes: policy.travelBufferMinutes,
    concurrency: policy.concurrency,
    now,
  });
  return {
    timezone: policy.timezone,
    durationMinutes,
    horizonDays: policy.horizonDays,
    slots,
  };
}

/** The job a session booked, as the confirmation page shows it. */
export interface BookedJob {
  readonly id: string;
  readonly jobNumber: string;
  readonly title: string;
  readonly status: string;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
}

interface BookedJobRow {
  id: string;
  job_number: string;
  title: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
}

/**
 * The job booked off this session, if any. The link is the pipeline's own:
 * the session names its lead, the opportunity names the lead, the job names
 * the opportunity. A cancelled job is not a booking — GP-105 frees the slot
 * and the picker comes back.
 */
export async function findBookedJob(
  db: D1Database,
  session: Pick<QuoteSessionRow, 'workspace_id' | 'lead_id'>,
): Promise<BookedJob | null> {
  if (!session.lead_id) return null;
  const row = await db
    .prepare(
      `SELECT j.id, j.job_number, j.title, j.status, j.scheduled_start, j.scheduled_end
       FROM jobs j JOIN opportunities o ON o.id = j.opportunity_id
       WHERE j.workspace_id = ? AND o.lead_id = ? AND j.status <> 'cancelled'
       ORDER BY j.created_at DESC LIMIT 1`,
    )
    .bind(session.workspace_id, session.lead_id)
    .first<BookedJobRow>();
  return row ? toBookedJob(row) : null;
}

/**
 * The booking this session cancelled, if the most recent one was (GP-105):
 * what `/quote/s/:id` shows as the "cancelled" state, with the offer to book
 * again. A newer scheduled job wins — that is `findBookedJob`'s answer.
 */
export async function findCancelledBooking(
  db: D1Database,
  session: Pick<QuoteSessionRow, 'workspace_id' | 'lead_id'>,
): Promise<BookedJob | null> {
  if (!session.lead_id) return null;
  const row = await db
    .prepare(
      `SELECT j.id, j.job_number, j.title, j.status, j.scheduled_start, j.scheduled_end
       FROM jobs j JOIN opportunities o ON o.id = j.opportunity_id
       WHERE j.workspace_id = ? AND o.lead_id = ?
       ORDER BY j.created_at DESC LIMIT 1`,
    )
    .bind(session.workspace_id, session.lead_id)
    .first<BookedJobRow>();
  return row && row.status === 'cancelled' ? toBookedJob(row) : null;
}

const toBookedJob = (row: BookedJobRow): BookedJob => ({
  id: row.id,
  jobNumber: row.job_number,
  title: row.title,
  status: row.status,
  scheduledStart: row.scheduled_start,
  scheduledEnd: row.scheduled_end,
});

/** Minutes between a job's start and end; 0 when it holds none. */
export function jobDurationMinutes(
  job: Pick<BookedJob, 'scheduledStart' | 'scheduledEnd'>,
): number {
  const minutes = Math.round(
    (Date.parse(job.scheduledEnd) - Date.parse(job.scheduledStart)) / MINUTE_MS,
  );
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

export interface BookQuotedJobInput {
  db: D1Database;
  session: Pick<QuoteSessionRow, 'id' | 'workspace_id' | 'lead_id'>;
  /** The machine the quote came from: its name titles the job, its vertical types it. */
  flow: Pick<LoadedFlow, 'fsm'>;
  result: EvaluationResult;
  /** The chosen slot's start — MUST be one of the slots currently offered. */
  startUtc: string;
  durationMinutes: number;
  /** Injected so the caller owns id generation (and tests stay deterministic). */
  newId: () => string;
  now?: Date;
}

export type BookQuotedJobOutcome =
  | {
      kind: 'booked';
      jobId: string;
      scheduledStart: string;
      scheduledEnd: string;
    }
  /** Every lane for that half-hour is taken; nothing was written. */
  | { kind: 'taken' }
  /** The session never produced a lead, so there is nobody to book for. */
  | { kind: 'no_lead' }
  /**
   * The flow's service has no per-lead rate in the shared rate card, so
   * the booking cannot bill its fee. Nothing was written: an unmapped
   * service is an operator error to fix in the rate card, never a free
   * booking (the API's 422 UNMAPPED_SERVICE, on this side).
   */
  | { kind: 'unbillable'; service: string }
  /**
   * The workspace may not receive a booked lead (the API's lead-billing
   * gate, D1 half): no card on file (`CARD_REQUIRED`), or an earlier lead
   * fee or top-up failed to collect (`DELIVERY_PAUSED`). Nothing was
   * written.
   */
  | { kind: 'cannot_receive'; code: ReceiveBlockCode };

interface LeadRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_contact: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string;
  estimated_value: number | null;
}

const str = (answers: Record<string, unknown>, key: string): string => {
  const v = answers[key];
  return typeof v === 'string' ? v.trim() : '';
};

/**
 * Create the job for a quoted session at the chosen slot.
 *
 * ONE batch, through `bookInFreeLane`: the customer, the opportunity, the
 * job, its `job_slots` rows, the lead's conversion, the lead-fee meter row
 * and the audit rows land together or not at all. There is no check before the write — the PRIMARY
 * KEY on `job_slots` is the check, and a collision answers `taken` with
 * nothing half-written.
 *
 * The pipeline's own shape is kept (lead → opportunity → job → customer),
 * exactly as `POST /api/opportunities/:id/convert` writes it, so the
 * platform sees a booked job where it expects one and the confirmation page
 * finds it again by the same links. Amounts are cents (§5.0.1): the quote's
 * band is dollars, so the midpoint is converted on the way in.
 *
 * The booking is the billable event (WS-1, canonical model v14). The fee
 * is priced from the shared rate card by the flow's slug (every FSM slug
 * is a key there; a quote lead's `service_type` is the bare vertical,
 * which mostly is not), with the workspace's override or grandfathered
 * rate applied, and written by `LEAD_METER_INSERT_SQL` — the statement
 * the API's `recordLeadMeter` runs — as a `pending` row tied to this job.
 * `ON CONFLICT(lead_id, workspace_id) DO NOTHING` means a rebook after a
 * cancellation keeps the one standing row instead of billing twice. A
 * service with no rate answers `unbillable` before anything is written.
 *
 * Before anything is written, the workspace must be able to receive a
 * booked lead, by the same rows the API's lead-billing gate reads
 * (`OUTSTANDING_LEAD_FEES_SQL`, `WORKSPACE_STRIPE_CUSTOMER_SQL`): a fee
 * that failed to collect answers `DELIVERY_PAUSED`, and a workspace with
 * no Stripe customer has no card on file and answers `CARD_REQUIRED`.
 * The API also confirms the card with Stripe; this Worker cannot, so a
 * customer whose card was removed passes here and its fee fails at
 * collection — which then pauses the next booking.
 *
 * The public demo shop (`isDemoWorkspaceSlug`) is never billed: it skips
 * both gates and records no fee, so nothing can later be charged.
 *
 * This Worker holds no Stripe key, so it records the fee and does not
 * charge it: the row is collected by the API's `chargePendingLeadFees`
 * (`POST /api/billing/lead-fees/collect`, or the Stripe card-update
 * webhooks), as any other pending fee is.
 */
export async function bookQuotedJob(
  input: BookQuotedJobInput,
): Promise<BookQuotedJobOutcome> {
  const { db, session, flow, result, startUtc, newId } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const workspaceId = session.workspace_id;

  if (!session.lead_id) return { kind: 'no_lead' };
  const lead = await db
    .prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
    .bind(session.lead_id, workspaceId)
    .first<LeadRow>();
  if (!lead) return { kind: 'no_lead' };

  // jobs.created_by, opportunities.created_by and customers.created_by are
  // NOT NULL → users(id), and a homeowner is not a user: the workspace owner
  // carries the attribution, as for the lead itself.
  const attributedTo = await attributionUserId(
    db as unknown as D1Like,
    workspaceId,
  );
  if (!attributedTo) return { kind: 'no_lead' };

  const feeWorkspace = await db
    .prepare(WORKSPACE_LEAD_FEE_SQL)
    .bind(workspaceId)
    .first<WorkspaceLeadFeeRow>();
  // The demo shop is never billed: no gate, no fee row.
  const billable = !isDemoWorkspaceSlug(feeWorkspace?.slug);

  if (billable) {
    const outstanding = await db
      .prepare(OUTSTANDING_LEAD_FEES_SQL)
      .bind(workspaceId, workspaceId)
      .first<{ n: number }>();
    if (Number(outstanding?.n ?? 0) > 0) {
      return { kind: 'cannot_receive', code: 'DELIVERY_PAUSED' };
    }
    const billing = await db
      .prepare(WORKSPACE_STRIPE_CUSTOMER_SQL)
      .bind(workspaceId)
      .first<{ stripe_customer_id: string | null }>();
    if (!billing?.stripe_customer_id) {
      return { kind: 'cannot_receive', code: 'CARD_REQUIRED' };
    }
  }

  const rate =
    resolveLeadRate(flow.fsm.slug) ?? resolveLeadRate(flow.fsm.vertical);
  if (!rate) return { kind: 'unbillable', service: flow.fsm.slug };
  const feeUsd = priceUsdForWorkspaceRow(rate, feeWorkspace);

  const scheduledStart = new Date(startUtc).toISOString();
  const scheduledEnd = new Date(
    Date.parse(scheduledStart) + input.durationMinutes * MINUTE_MS,
  ).toISOString();

  // The same numbering as POST /api/jobs, so a booked job sits in the
  // contractor's sequence rather than in one of its own.
  const lastJob = await db
    .prepare(
      'SELECT job_number FROM jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .bind(workspaceId)
    .first<{ job_number: string }>();
  const lastNum = lastJob
    ? parseInt(lastJob.job_number.replace('#', ''), 10)
    : 1000;
  const jobNumber = `#${(Number.isFinite(lastNum) ? lastNum : 1000) + 1}`;

  const answers = result.answers ?? {};
  const zip = lead.zip || str(answers, 'service_zip');
  const low = result.low ?? 0;
  const high = result.high ?? 0;
  // The same number `createLeadFromQuote` put on the lead (GP-111).
  const valueCents = estimatedValueCents(result) ?? 0;
  const title = flow.fsm.name;
  // One exact number once the quote is exact (H1), the range before that.
  const notes = `Booked by the homeowner from their online quote: ${
    formatQuotePrice(result) ?? '$0'
  } (${result.terminal}).`;

  // Booking again after a cancellation (GP-105) is the same person and the
  // same enquiry: the customer and the opportunity a first booking wrote are
  // kept and re-pointed at the new job, rather than a second Dana Ortiz
  // appearing in the contractor's customer list.
  const prior = await db
    .prepare(
      `SELECT id, customer_id FROM opportunities
       WHERE workspace_id = ? AND lead_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(workspaceId, lead.id)
    .first<{ id: string; customer_id: string | null }>();
  const customerId = prior?.customer_id ?? newId();
  const opportunityId = prior?.id ?? newId();
  const jobId = newId();
  const slotStarts = slotStartsFor(scheduledStart, scheduledEnd);
  const meta = JSON.stringify({
    source: 'pricing_quote',
    quoteSessionId: session.id,
    leadId: lead.id,
    flow: flow.fsm.slug,
    terminal: result.terminal,
    low,
    high,
    stage: result.stage ?? 'range',
    exact: result.exact ?? null,
    scheduledStart,
    scheduledEnd,
  });

  const customerStatements = prior?.customer_id
    ? []
    : [
        db
          .prepare(
            `INSERT INTO customers (
           id, workspace_id, first_name, last_name, email, phone, preferred_contact,
           street, city, state, zip, notes, total_job_value, job_count,
           created_at, updated_at, created_by
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            customerId,
            workspaceId,
            lead.first_name,
            lead.last_name,
            lead.email ?? '',
            lead.phone ?? '',
            lead.preferred_contact ?? 'phone',
            lead.street ?? '',
            lead.city ?? '',
            lead.state ?? '',
            zip,
            '',
            0,
            0,
            nowIso,
            nowIso,
            attributedTo,
          ),
        db
          .prepare(
            `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
         VALUES (?,?,?,'customer',?,'created',?,?)`,
          )
          .bind(
            newId(),
            workspaceId,
            attributedTo,
            customerId,
            JSON.stringify({ leadId: lead.id, quoteSessionId: session.id }),
            nowIso,
          ),
      ];
  const opportunityStatement = prior
    ? db
        .prepare(
          `UPDATE opportunities
           SET customer_id = ?, status = 'won', value = ?, closed_at = ?,
               converted_to_job_id = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .bind(
          customerId,
          valueCents,
          nowIso,
          jobId,
          nowIso,
          opportunityId,
          workspaceId,
        )
    : db
        .prepare(
          `INSERT INTO opportunities (
           id, workspace_id, lead_id, customer_id, title, status, value, service_type,
           notes, closed_at, converted_to_job_id, created_at, updated_at, created_by
         ) VALUES (?,?,?,?,?,'won',?,?,?,?,?,?,?,?)`,
        )
        .bind(
          opportunityId,
          workspaceId,
          lead.id,
          customerId,
          title,
          valueCents,
          flow.fsm.vertical,
          notes,
          nowIso,
          jobId,
          nowIso,
          nowIso,
          attributedTo,
        );

  const lane = await bookInFreeLane(db, workspaceId, (lane) => [
    ...customerStatements,
    opportunityStatement,
    db
      .prepare(
        `INSERT INTO jobs (
           id, workspace_id, opportunity_id, customer_id, job_number, title, status,
           street, city, state, zip, scheduled_start, scheduled_end,
           total, notes, created_at, updated_at, created_by
         ) VALUES (?,?,?,?,?,?,'scheduled',?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        jobId,
        workspaceId,
        opportunityId,
        customerId,
        jobNumber,
        title,
        lead.street ?? '',
        lead.city ?? '',
        lead.state ?? '',
        zip,
        scheduledStart,
        scheduledEnd,
        valueCents,
        notes,
        nowIso,
        nowIso,
        attributedTo,
      ),
    ...slotInsertStatements(db, {
      workspaceId,
      jobId,
      lane,
      slotStarts,
    }),
    // The lead now has its opportunity, as the platform's own convert
    // would leave it. `qualified_at` is untouched.
    db
      .prepare(
        `UPDATE leads SET status = 'converted', converted_to_opportunity_id = ?, updated_at = ?
         WHERE id = ? AND status <> 'converted'`,
      )
      .bind(opportunityId, nowIso, lead.id),
    // The fee for this booking (WS-1): one pending row per lead per shop,
    // the API's own insert. Not a priority (rescue) booking, no delivery.
    // None for the demo shop, which is never billed.
    ...(billable
      ? [
          db
            .prepare(LEAD_METER_INSERT_SQL)
            .bind(
              newId(),
              workspaceId,
              lead.id,
              rate.vertical,
              flow.fsm.slug,
              feeUsd,
              jobId,
              null,
              0,
            ),
        ]
      : []),
    db
      .prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
         VALUES (?,?,?,'opportunity',?,'converted',?,?)`,
      )
      .bind(
        newId(),
        workspaceId,
        attributedTo,
        opportunityId,
        JSON.stringify({ jobId, customerId, quoteSessionId: session.id }),
        nowIso,
      ),
    db
      .prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
         VALUES (?,?,?,'job',?,'created',?,?)`,
      )
      .bind(newId(), workspaceId, attributedTo, jobId, meta, nowIso),
  ]);

  if (lane === null) return { kind: 'taken' };
  return { kind: 'booked', jobId, scheduledStart, scheduledEnd };
}

// ── Change or cancel (GP-105) ─────────────────────────────────

export interface CancelQuotedJobInput {
  db: D1Database;
  session: Pick<QuoteSessionRow, 'id' | 'workspace_id' | 'lead_id'>;
  /** The booking as `findBookedJob` found it. */
  job: Pick<BookedJob, 'id' | 'scheduledStart' | 'scheduledEnd'>;
  reason: LeadWithdrawnReason;
  newId: () => string;
  now?: Date;
}

export interface CancelQuotedJobOutcome {
  /** What happened to the contractor's fee; `withdrawLead`'s answer. */
  meterEventAdjustment: MeterEventAdjustment;
}

/**
 * Cancel the booked job and withdraw its lead, in ONE batch.
 *
 * The job's `status` goes to `cancelled` and its `job_slots` rows go — the
 * same two statements `PATCH /api/jobs/:id` uses, so the slot is free for
 * the next caller the moment the batch commits. The lead's withdrawal rides
 * in the same transaction through `withdrawLead`, which is where the money
 * is decided: the fee this booking metered stands — a cancellation is not
 * a refund case (FR-1.4), so the `pending` row is left unchanged, never
 * waived or deleted. The reason is recorded, not adjudicated.
 *
 * `workspace_id` is the session row's. The homeowner supplies a session id
 * and a reason, nothing else.
 */
export async function cancelQuotedJob(
  input: CancelQuotedJobInput,
): Promise<CancelQuotedJobOutcome> {
  const { db, session, job, reason, newId } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const workspaceId = session.workspace_id;
  const attributedTo = await attributionUserId(
    db as unknown as D1Like,
    workspaceId,
  );

  const cancel = [
    db
      .prepare(
        `UPDATE jobs SET status = 'cancelled', updated_at = ?
         WHERE id = ? AND workspace_id = ? AND status <> 'cancelled'`,
      )
      .bind(nowIso, job.id, workspaceId),
    slotDeleteStatement(db, job.id),
    db
      .prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
         VALUES (?,?,?,'job',?,'cancelled',?,?)`,
      )
      .bind(
        newId(),
        workspaceId,
        attributedTo,
        job.id,
        JSON.stringify({
          source: 'pricing_quote',
          quoteSessionId: session.id,
          reason,
          scheduledStart: job.scheduledStart,
          scheduledEnd: job.scheduledEnd,
        }),
        nowIso,
      ),
  ];

  if (session.lead_id) {
    const outcome = await withdrawLead(db, {
      workspaceId,
      leadId: session.lead_id,
      reason,
      now: nowIso,
      actorUserId: attributedTo,
      newId,
      alongside: cancel,
    });
    if (outcome.kind !== 'not_found') {
      return { meterEventAdjustment: outcome.meterEventAdjustment };
    }
  }
  // No lead to withdraw (deleted since, or never written): the job is still
  // the homeowner's to cancel.
  await db.batch(cancel);
  return { meterEventAdjustment: 'none' };
}

export interface RescheduleQuotedJobInput {
  db: D1Database;
  session: Pick<QuoteSessionRow, 'id' | 'workspace_id'>;
  job: Pick<BookedJob, 'id' | 'scheduledStart' | 'scheduledEnd'>;
  /** The new start — MUST be one of the slots currently offered for this job. */
  startUtc: string;
  durationMinutes: number;
  newId: () => string;
  now?: Date;
}

export type RescheduleQuotedJobOutcome =
  | { kind: 'moved'; scheduledStart: string; scheduledEnd: string }
  /** Every lane for the new time is taken; the original booking is untouched. */
  | { kind: 'taken' };

/**
 * Move the booked job to a new time, in ONE batch through `bookInFreeLane`:
 * the job's schedule, the release of its old half-hours and the claim on
 * the new ones land together or not at all — exactly as the calendar drag
 * in `PATCH /api/jobs/:id` does it. A taken slot rolls the whole thing back
 * and the homeowner still has the time they had; there is never a moment
 * with no slot. One job row throughout: the job number, the customer and
 * the opportunity are the same booking, just at a different time.
 */
export async function rescheduleQuotedJob(
  input: RescheduleQuotedJobInput,
): Promise<RescheduleQuotedJobOutcome> {
  const { db, session, job, newId } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const workspaceId = session.workspace_id;
  const scheduledStart = new Date(input.startUtc).toISOString();
  const scheduledEnd = new Date(
    Date.parse(scheduledStart) + input.durationMinutes * MINUTE_MS,
  ).toISOString();
  const slotStarts = slotStartsFor(scheduledStart, scheduledEnd);
  const attributedTo = await attributionUserId(
    db as unknown as D1Like,
    workspaceId,
  );

  const lane = await bookInFreeLane(db, workspaceId, (lane) => [
    db
      .prepare(
        `UPDATE jobs SET scheduled_start = ?, scheduled_end = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      )
      .bind(scheduledStart, scheduledEnd, nowIso, job.id, workspaceId),
    slotDeleteStatement(db, job.id),
    ...slotInsertStatements(db, {
      workspaceId,
      jobId: job.id,
      lane,
      slotStarts,
    }),
    db
      .prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
         VALUES (?,?,?,'job',?,'rescheduled',?,?)`,
      )
      .bind(
        newId(),
        workspaceId,
        attributedTo,
        job.id,
        JSON.stringify({
          source: 'pricing_quote',
          quoteSessionId: session.id,
          from: { start: job.scheduledStart, end: job.scheduledEnd },
          to: { start: scheduledStart, end: scheduledEnd },
        }),
        nowIso,
      ),
  ]);

  if (lane === null) return { kind: 'taken' };
  return { kind: 'moved', scheduledStart, scheduledEnd };
}
