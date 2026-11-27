import type { Env } from '../env';
import { newId } from './response';
import {
  isDemoWorkspaceSlug,
  WORKSPACE_SLUG_SQL,
} from '@greenput/shared/models';
import {
  LEAD_METER_INSERT_SQL,
  leadFeeOverrideUsd,
  PER_LEAD_USD,
  priceUsdForWorkspaceRow,
  resolveLeadRate,
  UnmappedLeadServiceError,
  WORKSPACE_LEAD_FEE_SQL,
  type LeadRate,
  type Vertical,
  type WorkspaceLeadFeeRow,
} from './lead-rate-card';

export { PER_LEAD_USD, UnmappedLeadServiceError };
export type { Vertical };

/**
 * Per-lead pricing — the core revenue model. A meter event is billed to
 * the workspace a lead BOOKS with, at booking commit (WS-1, canonical
 * model v14). There are two booking commits and both write the row with
 * LEAD_METER_INSERT_SQL from the shared rate card: schedule-aware
 * delivery, which writes the job, its slots and the
 * lead_deliveries('booked') row atomically and then meters here; and
 * homeowner self-booking (apps/tenant-site/src/booking.ts,
 * bookQuotedJob), which writes the row in the same batch as the job.
 * The tenant site holds no Stripe key, so a self-booked row stays
 * pending until chargePendingLeadFees collects it. A staff
 * accept click (POST /api/leads/:id/accept) and a pool accept are lead
 * state transitions, NOT bookings — they never meter. Neither does lead
 * creation, a range display, or a quote completion. The Stripe charge
 * is chargeBookedLeadFee, called only when this insert actually wrote
 * a row.
 *
 * Rates and classification live in the shared lead-rate-card.ts
 * (libs/shared/models, re-exported by ./lead-rate-card.ts), the single
 * rate-card file: an explicit service→vertical map with placeholder
 * rates pending the Sheen pilot. Classification used to be a substring
 * guess over free text with a silent $0 fallback for anything unknown;
 * an unmapped service now throws UnmappedLeadServiceError, and the
 * booking path checks the mapping BEFORE writing the booking, so a lead
 * whose service has no rate fails loudly instead of being booked and
 * billed $0 (or misbilled as whatever vertical a substring hit).
 */

export interface RecordLeadMeterParams {
  readonly workspaceId: string;
  readonly leadId: string;
  readonly serviceType: string;
  /** The job the booking commit created — the row's booking linkage. */
  readonly jobId?: string | null;
  /** The lead_deliveries row the booking commit created. */
  readonly deliveryId?: string | null;
  /**
   * Priority (rescue) booking — a job re-offered after another shop's
   * failure. Bills at 50% of the resolved price and is marked on the
   * row (FR-1.3). The rescue flow itself is WS-3; this is the meter
   * layer's capability.
   */
  readonly priority?: boolean;
}

export interface LeadMeterEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly leadId: string;
  readonly vertical: Vertical;
  readonly priceUsd: number;
  readonly status: 'pending' | 'invoiced' | 'refunded' | 'waived';
  readonly jobId: string | null;
  readonly deliveryId: string | null;
  readonly priority: boolean;
  /**
   * False if a meter event for this (lead, workspace) already existed and
   * this call was a no-op (the UNIQUE(lead_id, workspace_id) backstop
   * below fired). The other fields still describe what a fresh event
   * would look like, not necessarily the row that's actually persisted —
   * callers that need the real persisted row should SELECT it, keyed on
   * (lead_id, workspace_id). Also false for the public demo workspace
   * (slug `demo`), which is never billed: nothing is written for it.
   */
  readonly inserted: boolean;
}

/**
 * Insert a single 'pending' meter event for a booking — the billable
 * event, fired at booking commit (schedule-aware delivery). Not at
 * lead creation, not at accept, not at pool accept.
 *
 * Idempotent via a real DB constraint, not just an application-level check:
 * `lead_meter_events` has `UNIQUE(lead_id, workspace_id)` (schema.sql),
 * and this INSERT uses `ON CONFLICT(lead_id, workspace_id) DO NOTHING`.
 * That's the authoritative guarantee — "at most one billing row per
 * lead per shop" holds even under concurrent booking requests: a rebook
 * at the same shop no-ops, while a booking at a different shop inserts
 * its own row and bills that shop (FR-1.2). The delivery path
 * additionally avoids calling this a second time in the common case (a
 * lead with accepted_at set cannot be delivered again), so this
 * constraint is normally a no-op backstop rather than the first line
 * of defense.
 *
 * Throws UnmappedLeadServiceError when the service is not in the rate
 * card's explicit map — an unmapped service is an operator error to fix
 * in lead-rate-card.ts, never a $0 event. The dollars are quoteLeadFee's:
 * the rate card, unless this workspace has a grandfathered override.
 * A priority booking halves the resolved price (FR-1.3); price_usd is
 * REAL, so an odd-dollar rate halves exactly ($35 → $17.50, charged as
 * 1750 cents by chargeBookedLeadFee's Math.round(price * 100)).
 */
export async function quoteLeadFee(
  env: Env,
  workspaceId: string,
  serviceType: string,
): Promise<LeadRate | null> {
  const rate = resolveLeadRate(serviceType);
  if (!rate) return null;
  const workspace = await env.DB.prepare(WORKSPACE_LEAD_FEE_SQL)
    .bind(workspaceId)
    .first<WorkspaceLeadFeeRow>();
  const priceUsd = priceUsdForWorkspaceRow(rate, workspace);
  return { vertical: rate.vertical, priceUsd };
}

/** The override Settings shows, or null when this workspace pays the card. */
export async function readLeadFeeOverrideUsd(
  env: Env,
  workspaceId: string,
): Promise<number | null> {
  const workspace = await env.DB.prepare(
    'SELECT slug, lead_fee_override_usd FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<{ slug: string | null; lead_fee_override_usd: number | null }>();
  if (!workspace) return null;
  return leadFeeOverrideUsd({
    slug: workspace.slug,
    leadFeeOverrideUsd:
      workspace.lead_fee_override_usd === null ||
      workspace.lead_fee_override_usd === undefined
        ? null
        : Number(workspace.lead_fee_override_usd),
  });
}

export async function recordLeadMeter(
  env: Env,
  params: RecordLeadMeterParams,
): Promise<LeadMeterEvent> {
  const rate = await quoteLeadFee(env, params.workspaceId, params.serviceType);
  if (!rate) throw new UnmappedLeadServiceError(params.serviceType);
  const { vertical } = rate;
  const priority = params.priority ?? false;
  const priceUsd = priority ? rate.priceUsd / 2 : rate.priceUsd;
  const jobId = params.jobId ?? null;
  const deliveryId = params.deliveryId ?? null;
  const id = newId();
  const workspace = await env.DB.prepare(WORKSPACE_SLUG_SQL)
    .bind(params.workspaceId)
    .first<{ slug: string | null }>();
  if (isDemoWorkspaceSlug(workspace?.slug)) {
    // The public demo shop is never billed: no fee is recorded.
    return {
      id,
      workspaceId: params.workspaceId,
      leadId: params.leadId,
      vertical,
      priceUsd,
      status: 'pending',
      jobId,
      deliveryId,
      priority,
      inserted: false,
    };
  }
  const result = await env.DB.prepare(LEAD_METER_INSERT_SQL)
    .bind(
      id,
      params.workspaceId,
      params.leadId,
      vertical,
      params.serviceType,
      priceUsd,
      jobId,
      deliveryId,
      priority ? 1 : 0,
    )
    .run();
  return {
    id,
    workspaceId: params.workspaceId,
    leadId: params.leadId,
    vertical,
    priceUsd,
    status: 'pending',
    jobId,
    deliveryId,
    priority,
    inserted: (result.meta?.changes ?? 0) > 0,
  };
}

export interface MeterSummary {
  readonly pendingCount: number;
  readonly pendingUsd: number;
  readonly invoicedCount: number;
  readonly invoicedUsd: number;
  readonly perVertical: Record<Vertical, { count: number; pendingUsd: number }>;
}

/**
 * Read-only summary of a workspace's meter ledger. Used by GET /api/billing/meter.
 */
export async function summarizeWorkspaceMeter(
  env: Env,
  workspaceId: string,
): Promise<MeterSummary> {
  const rows = (
    await env.DB.prepare(
      `SELECT vertical, status, COUNT(*) AS cnt, COALESCE(SUM(price_usd), 0) AS total_usd
     FROM lead_meter_events
     WHERE workspace_id = ?
     GROUP BY vertical, status`,
    )
      .bind(workspaceId)
      .all<{
        vertical: string;
        status: string;
        cnt: number;
        total_usd: number;
      }>()
  ).results;

  const summary: MeterSummary = {
    pendingCount: 0,
    pendingUsd: 0,
    invoicedCount: 0,
    invoicedUsd: 0,
    perVertical: Object.fromEntries(
      Object.keys(PER_LEAD_USD).map((v) => [v, { count: 0, pendingUsd: 0 }]),
    ) as Record<Vertical, { count: number; pendingUsd: number }>,
  };

  for (const row of rows) {
    const v = row.vertical as Vertical;
    const cnt = Number(row.cnt);
    const total = Number(row.total_usd);
    if (row.status === 'pending') {
      (summary as { pendingCount: number }).pendingCount += cnt;
      (summary as { pendingUsd: number }).pendingUsd += total;
      const bucket = summary.perVertical[v];
      if (bucket !== undefined) {
        bucket.count += cnt;
        bucket.pendingUsd += total;
      }
    } else if (row.status === 'invoiced') {
      (summary as { invoicedCount: number }).invoicedCount += cnt;
      (summary as { invoicedUsd: number }).invoicedUsd += total;
    }
  }
  return summary;
}

export interface LeadCharge {
  readonly id: string;
  readonly leadId: string;
  readonly vertical: string;
  readonly serviceType: string;
  readonly priceUsd: number;
  readonly status: string;
  readonly paymentStatus: string | null;
  readonly invoicedAt: string | null;
  readonly createdAt: string;
}

/** Recent meter rows for Settings → Billing. Newest first, capped. */
export async function listLeadCharges(
  env: Env,
  workspaceId: string,
  limit = 50,
): Promise<LeadCharge[]> {
  const rows = (
    await env.DB.prepare(
      `SELECT id, lead_id, vertical, service_type, price_usd, status,
              payment_status, invoiced_at, created_at
         FROM lead_meter_events
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
      .bind(workspaceId, limit)
      .all<{
        id: string;
        lead_id: string;
        vertical: string;
        service_type: string;
        price_usd: number;
        status: string;
        payment_status: string | null;
        invoiced_at: string | null;
        created_at: string;
      }>()
  ).results;
  return (rows ?? []).map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    vertical: row.vertical,
    serviceType: row.service_type,
    priceUsd: Number(row.price_usd),
    status: row.status,
    paymentStatus: row.payment_status,
    invoicedAt: row.invoiced_at,
    createdAt: row.created_at,
  }));
}
