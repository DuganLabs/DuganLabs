/**
 * THE per-booked-lead rate card — the single source of truth for what
 * booking a lead bills (WS-1: the fee fires at booking commit, never at
 * a staff accept click or a pool accept). Every surface that quotes or
 * charges the per-lead fee (both booking commits — schedule-aware
 * delivery in apps/api and homeowner self-booking in apps/tenant-site —
 * plus GET /api/leads/:id/fee and GET /api/billing/meter) reads rates
 * from this file and nowhere else. It lives in the shared models library
 * so both Workers bill from the same card; apps/api/src/lib/
 * lead-rate-card.ts re-exports it. Priority (rescue) bookings bill at 50% of the
 * resolved rate — applied in recordLeadMeter, not here.
 *
 * ⚠ PLACEHOLDER RATES. The dollar figures below are placeholders sourced
 * from competitor public pricing (Angi, HomeAdvisor, Modernize,
 * Thumbtack), positioned at the lower-middle of exclusive-lead pricing.
 * They are not a price GreenPut has quoted a customer, except where a
 * workspace override says otherwise.
 *
 * Hi Power Electric (workspace slug `hi-power`, the design partner) is
 * grandfathered at $1 per lead via GRANDFATHERED_LEAD_FEE_USD. That map
 * does not change these placeholders. A row in
 * workspaces.lead_fee_override_usd wins over both the map and the card,
 * so the pilot rate can move without editing this file.
 *
 * This file is NOT the FSM quote rate card (seeds/pricing/
 * rate-card.default.json). That card prices the homeowner's job (labour,
 * materials, markups) inside the pricing engines. This card prices the
 * LEAD GreenPut delivers to the contractor. Two different surfaces, two
 * different files — do not merge them.
 *
 * Classification is an EXPLICIT map, exact match only (after trim +
 * case-folding). The previous implementation substring-matched free text
 * (`inferVertical`): 'ev' matched "evaluation" and "level" and priced
 * them as EV-charger leads, and anything unrecognised fell back to a
 * silent $0 "tracked but not billed" event. Both failure modes are gone:
 *
 * - A service string that is not a key in SERVICE_TO_VERTICAL below does
 *   not classify. `resolveLeadRate` returns null and the booking/fee
 *   paths fail LOUDLY (422 UNMAPPED_SERVICE) — an operator adds the new
 *   service here, in review, instead of the meter quietly misbilling or
 *   billing $0.
 * - Adding a service = adding one exact key (plus its FSM slug form when
 *   it has one). Never add substring/prefix matching back.
 */

export type Vertical =
  | 'ev_charger'
  | 'electrical'
  | 'plumbing'
  | 'hvac'
  | 'solar'
  | 'roofing'
  | 'fence'
  | 'drain_cleaning';

/**
 * Flat per-lead price in whole US dollars, by workspace slug.
 * Grandfathered: changing PER_LEAD_USD does not change these.
 * Slug `hi-power` is Hi Power Electric, the pilot design partner.
 */
export const GRANDFATHERED_LEAD_FEE_USD: Readonly<Record<string, number>> =
  Object.freeze({
    'hi-power': 1,
  });

/**
 * The override a workspace is actually billed, or null when it pays the
 * rate card. A stored lead_fee_override_usd wins over the slug map, so
 * the pilot rate can be changed on the row without a deploy. A negative
 * or non-finite stored value is ignored (the card applies).
 */
export function leadFeeOverrideUsd(workspace: {
  readonly slug: string | null;
  readonly leadFeeOverrideUsd: number | null;
}): number | null {
  const stored = workspace.leadFeeOverrideUsd;
  if (stored !== null && Number.isFinite(stored) && stored >= 0) {
    return Math.round(stored);
  }
  if (workspace.slug) {
    const grandfathered = GRANDFATHERED_LEAD_FEE_USD[workspace.slug];
    if (grandfathered !== undefined) return grandfathered;
  }
  return null;
}

/** Placeholder per-delivered-lead price in whole US dollars, by vertical. */
export const PER_LEAD_USD: Readonly<Record<Vertical, number>> = Object.freeze({
  ev_charger: 60,
  electrical: 35,
  plumbing: 45,
  hvac: 60,
  solar: 110,
  roofing: 95,
  fence: 25,
  drain_cleaning: 15,
});

/**
 * The four electrical quote services (the FSM `vertical` field in
 * seeds/pricing/*.fsm.json). They still bill in the `electrical`
 * vertical bucket; only the dollar figure is per service.
 */
export type ElectricalService =
  'panel_service' | 'circuits' | 'troubleshooting' | 'surge_protection';

/**
 * ⚠ PLACEHOLDER per-booked-lead prices, in whole US dollars, for the four
 * electrical quote services. These are estimates, not prices GreenPut
 * has quoted a customer. They are config: change the number here (one
 * reviewed line) or set workspaces.lead_fee_override_usd on a shop's row,
 * which wins over this map (see priceUsdForWorkspace).
 *
 * Anchored to the vertical card above (PER_LEAD_USD) by job size, using
 * the seeds/pricing/fixtures quote ranges:
 * - panel_service $90: a $5,275–$6,600 service upgrade, ~5x an EV install;
 *   priced with the large-ticket trades (roofing $95, solar $110), above
 *   ev_charger $60.
 * - circuits $40: $285–$1,425 jobs, around one EV install at the top end;
 *   between electrical $35 and ev_charger $60, nearer the general rate.
 * - troubleshooting $25: a $285–$650 diagnostic call-out, a service-call
 *   lead like drain_cleaning $15; below electrical $35.
 * - surge_protection $20: a $375–$475 add-on; the smallest ticket,
 *   between drain_cleaning $15 and fence $25.
 */
export const PER_SERVICE_LEAD_USD: Readonly<Record<ElectricalService, number>> =
  Object.freeze({
    panel_service: 90,
    circuits: 40,
    troubleshooting: 25,
    surge_protection: 20,
  });

/**
 * Exact service keys that price at a PER_SERVICE_LEAD_USD rate instead of
 * the flat `electrical` rate. Same matching rules as SERVICE_TO_VERTICAL
 * (trim + lower-case, exact keys only); every key here is also an
 * `electrical` key there. Plain "electrical" stays at PER_LEAD_USD.
 */
export const SERVICE_TO_ELECTRICAL_SERVICE: Readonly<
  Record<string, ElectricalService>
> = Object.freeze({
  // FSM slugs
  'panel-service-upgrade': 'panel_service',
  'circuit-outlet-addition': 'circuits',
  'troubleshooting-callout': 'troubleshooting',
  'whole-home-surge-protection': 'surge_protection',
  // Bare FSM verticals (a quote lead's leads.service_type)
  panel_service: 'panel_service',
  circuits: 'circuits',
  troubleshooting: 'troubleshooting',
  surge_protection: 'surge_protection',
  // FSM display names
  'panel replacement and service upgrade': 'panel_service',
  'adding an outlet or a circuit': 'circuits',
  "something's not working": 'troubleshooting',
  'whole-home surge protection': 'surge_protection',
  // Trade phrases
  'electrical panel upgrade': 'panel_service',
  'panel upgrade': 'panel_service',
  'electrical troubleshooting': 'troubleshooting',
  'surge protection': 'surge_protection',
});

/**
 * Explicit service → vertical map. Keys are matched EXACTLY after
 * trimming and lower-casing the lead's service_type. Three key families:
 *
 * 1. FSM slugs — the canonical service keys the pricing engines and the
 *    intake flows use (seeds/pricing/*.fsm.json).
 * 2. FSM display names — what those services are called to a homeowner.
 * 3. Plain trade phrases the capture paths and operators actually type
 *    (manual lead entry, the public form's free-text field).
 *
 * Panel/circuit/troubleshooting/surge services bill as the `electrical`
 * vertical: the meter's verticals are trade-level billing buckets, while
 * the FSM verticals (panel_service, circuits, …) are quote-level detail.
 */
export const SERVICE_TO_VERTICAL: Readonly<Record<string, Vertical>> =
  Object.freeze({
    // 1. FSM slugs (seeds/pricing/*.fsm.json)
    'ev-charger-install': 'ev_charger',
    'panel-service-upgrade': 'electrical',
    'circuit-outlet-addition': 'electrical',
    'troubleshooting-callout': 'electrical',
    'whole-home-surge-protection': 'electrical',

    // 2. FSM display names
    'level 2 ev charger install': 'ev_charger',
    'panel replacement and service upgrade': 'electrical',
    'adding an outlet or a circuit': 'electrical',
    "something's not working": 'electrical',
    'whole-home surge protection': 'electrical',

    // 3. Trade phrases (exact, complete strings only)
    'ev charger install': 'ev_charger',
    'ev charger installation': 'ev_charger',
    'ev charger': 'ev_charger',
    'tesla wall connector install': 'ev_charger',
    'electrical panel upgrade': 'electrical',
    'panel upgrade': 'electrical',
    'electrical troubleshooting': 'electrical',
    'surge protection': 'electrical',
    electrical: 'electrical',
    plumbing: 'plumbing',
    'plumbing repair': 'plumbing',
    'drain cleaning': 'drain_cleaning',
    drain_cleaning: 'drain_cleaning',
    hvac: 'hvac',
    'hvac tune-up': 'hvac',
    'air conditioning install': 'hvac',
    'furnace replacement': 'hvac',
    solar: 'solar',
    'solar panel install': 'solar',
    roofing: 'roofing',
    'roofing repair': 'roofing',
    fence: 'fence',
    'fence install': 'fence',

    // The bare FSM verticals a quote lead stores as service_type.
    panel_service: 'electrical',
    circuits: 'electrical',
    troubleshooting: 'electrical',
    surge_protection: 'electrical',

    // The vertical names themselves, for callers that already classified.
    ev_charger: 'ev_charger',
  });

export interface LeadRate {
  readonly vertical: Vertical;
  /** Placeholder per-delivered-lead price in whole US dollars. */
  readonly priceUsd: number;
}

/**
 * Resolve a lead's service_type to its billing rate, or null when the
 * service is not in the explicit map. The price is the service's
 * PER_SERVICE_LEAD_USD entry when it has one, else its vertical's
 * PER_LEAD_USD entry (a workspace override is applied later, by
 * priceUsdForWorkspace). Null is a loud failure at every
 * call site — never a $0 fallback.
 */
export function resolveLeadRate(serviceType: string): LeadRate | null {
  const key = serviceType.trim().toLowerCase();
  if (!key) return null;
  const vertical = SERVICE_TO_VERTICAL[key];
  if (vertical === undefined) return null;
  const service = SERVICE_TO_ELECTRICAL_SERVICE[key];
  const priceUsd =
    service === undefined
      ? PER_LEAD_USD[vertical]
      : PER_SERVICE_LEAD_USD[service];
  return { vertical, priceUsd };
}

/**
 * The price a booking will write, after a per-workspace override. The
 * vertical still comes from the rate card — an override changes the
 * dollars, never which bucket the lead is in. Null override means the
 * card price, so every other workspace is unchanged.
 */
export function priceUsdForWorkspace(
  rate: LeadRate,
  workspace: {
    readonly slug: string | null;
    readonly leadFeeOverrideUsd: number | null;
  },
): number {
  return leadFeeOverrideUsd(workspace) ?? rate.priceUsd;
}

/** The two `workspaces` columns a lead fee depends on, as D1 returns them. */
export interface WorkspaceLeadFeeRow {
  readonly slug: string | null;
  readonly lead_fee_override_usd: number | null;
}

/** The SELECT that reads a WorkspaceLeadFeeRow, bound with the workspace id. */
export const WORKSPACE_LEAD_FEE_SQL =
  'SELECT slug, lead_fee_override_usd FROM workspaces WHERE id = ?';

/**
 * The fee a booking at this workspace bills for `rate`, from the row
 * WORKSPACE_LEAD_FEE_SQL read (null when the workspace is gone, which
 * pays the card). Every booking commit prices through this.
 */
export function priceUsdForWorkspaceRow(
  rate: LeadRate,
  row: WorkspaceLeadFeeRow | null | undefined,
): number {
  const stored = row?.lead_fee_override_usd;
  return priceUsdForWorkspace(rate, {
    slug: row?.slug ?? null,
    leadFeeOverrideUsd:
      stored === null || stored === undefined ? null : Number(stored),
  });
}

/** Thrown when a lead's service has no explicit rate-card entry. */
export class UnmappedLeadServiceError extends Error {
  readonly serviceType: string;
  constructor(serviceType: string) {
    super(
      `No per-lead rate for service "${serviceType}": it is not in the explicit ` +
        `service→vertical map (libs/shared/models/src/lead-rate-card.ts). Add the service ` +
        `there — unmapped services are never billed silently at $0.`,
    );
    this.name = 'UnmappedLeadServiceError';
    this.serviceType = serviceType;
  }
}

/**
 * The one meter insert, shared by every booking commit so the row shape
 * cannot drift between Workers. One `pending` row per (lead, workspace):
 * `ON CONFLICT(lead_id, workspace_id) DO NOTHING` makes a rebook at the
 * same shop a no-op, so a lead is never billed twice by one shop. Binds,
 * in order: id, workspace_id, lead_id, vertical, service_type, price_usd,
 * job_id, delivery_id, priority (0/1).
 */
export const LEAD_METER_INSERT_SQL = `INSERT INTO lead_meter_events
       (id, workspace_id, lead_id, vertical, service_type, price_usd, status, created_at,
        job_id, delivery_id, priority)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), ?, ?, ?)
     ON CONFLICT(lead_id, workspace_id) DO NOTHING`;
