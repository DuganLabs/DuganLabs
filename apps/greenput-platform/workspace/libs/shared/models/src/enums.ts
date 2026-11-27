// ─────────────────────────────────────────────────────────────
// Closed value sets, declared once as runtime arrays.
//
// Every one of these mirrors a `CHECK(col IN (...))` in schema.sql. Declaring
// them as `as const` arrays (with the union type DERIVED from the array, not
// written twice) makes two things possible that a bare `type X = 'a' | 'b'`
// cannot:
//
//   1. wire.ts can validate an API response value against the set at runtime;
//   2. wire.spec.ts can compare each set against the CHECK constraint in
//      schema.sql and fail when they drift apart.
//
// So the union a caller imports and the set the database enforces are the
// same list, checked, rather than two copies that agree by inspection.
// ─────────────────────────────────────────────────────────────

/**
 * 'accepted' and 'withdrawn' are the billing-lifecycle terminal states (see
 * schema.sql's `leads` table comment and apps/api/src/routes/leads.ts's
 * qualify/accept/withdraw endpoints). Not yet writable on every database —
 * those endpoints track the lifecycle via qualified_at/accepted_at/
 * withdrawn_at instead of this column for that reason.
 */
export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'converted',
  'accepted',
  'withdrawn',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Why a homeowner backed out of a booked job (GP-105). Recorded, never
 * adjudicated: the contractor's fee is waived whichever one they pick, so
 * this exists only to show which contractors lose booked work and why.
 * Mirrors the CHECK on `leads.withdrawn_reason` in schema.sql; on a migrated
 * database the column carries no CHECK (ALTER TABLE cannot add one), so the
 * validators and the tenant site enforce this set in code.
 */
export const LEAD_WITHDRAWN_REASONS = [
  'schedule_no_longer_works',
  'chose_another_provider',
  'no_longer_needed',
  'other',
] as const;
export type LeadWithdrawnReason = (typeof LEAD_WITHDRAWN_REASONS)[number];

export const LEAD_SOURCES = [
  'website',
  'referral',
  'campaign',
  'manual',
  'google',
  'nextdoor',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const PREFERRED_CONTACTS = ['email', 'phone', 'text'] as const;
export type PreferredContact = (typeof PREFERRED_CONTACTS)[number];

export const CONSENT_METHODS = ['form', 'verbal', 'email'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const OPPORTUNITY_STATUSES = [
  'open',
  'proposal_sent',
  'negotiating',
  'won',
  'lost',
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const JOB_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'invoiced',
  'paid',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Every legal job-status move, one explicit row per status. Anything not
 * listed is refused (409 INVALID_TRANSITION), so money states never move
 * backwards: a paid job is terminal, an invoiced job can only be paid.
 * A same-status write is a no-op and always allowed. Reinstating a
 * cancelled job puts it back on the schedule, which re-claims its slots.
 */
export const JOB_STATUS_TRANSITIONS: Readonly<
  Record<JobStatus, readonly JobStatus[]>
> = {
  scheduled: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['scheduled', 'completed', 'cancelled'],
  completed: ['in_progress', 'invoiced'],
  invoiced: ['paid'],
  paid: [],
  cancelled: ['scheduled'],
};

/**
 * Statuses reached only through their own routes, never a generic PATCH:
 * POST /api/jobs/:id/invoice mints the invoice token and stamps
 * invoiced_at; POST /api/jobs/:id/paid stamps paid_at.
 */
export const ROUTE_ONLY_JOB_STATUSES: readonly JobStatus[] = [
  'invoiced',
  'paid',
];

const isJobStatus = (s: string): s is JobStatus =>
  (JOB_STATUSES as readonly string[]).includes(s);

export function canTransitionJobStatus(from: string, to: string): boolean {
  if (!isJobStatus(from) || !isJobStatus(to)) return false;
  return from === to || JOB_STATUS_TRANSITIONS[from].includes(to);
}

/** The subset of {@link canTransitionJobStatus} a PATCH may take. */
export function canPatchJobStatus(from: string, to: string): boolean {
  if (!canTransitionJobStatus(from, to)) return false;
  return from === to || !ROUTE_ONLY_JOB_STATUSES.includes(to as JobStatus);
}

export const CAMPAIGN_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_CHANNELS = [
  'email',
  'sms',
  'postcard',
  'social',
  'google',
] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const USER_ROLES = ['owner', 'admin', 'tech', 'office'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ESTIMATE_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

/**
 * Not a column: an estimate's line items are a JSON array in
 * `estimates.line_items`, so there is no CHECK for wire.spec.ts to compare
 * this against. Declared here anyway so the validator, the API and the two
 * renderers agree on the same two words.
 */
export const ESTIMATE_LINE_ITEM_TYPES = ['labor', 'material'] as const;
export type EstimateLineItemType = (typeof ESTIMATE_LINE_ITEM_TYPES)[number];

/**
 * `change_orders.status`. Proposed → approved | rejected, decided exactly
 * once. Approving applies the change's lines to its job or estimate.
 */
export const CHANGE_ORDER_STATUSES = [
  'proposed',
  'approved',
  'rejected',
] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

/** `change_order_events.action` — one row per transition, append-only. */
export const CHANGE_ORDER_EVENT_ACTIONS = [
  'proposed',
  'approved',
  'rejected',
] as const;
export type ChangeOrderEventAction =
  (typeof CHANGE_ORDER_EVENT_ACTIONS)[number];

export const REVIEW_PLATFORMS = [
  'internal',
  'google',
  'yelp',
  'nextdoor',
  'facebook',
] as const;
export type ReviewPlatform = (typeof REVIEW_PLATFORMS)[number];

export const REVIEW_REQUEST_STATUSES = [
  'pending',
  'sent',
  'completed',
  'declined',
] as const;
export type ReviewRequestStatus = (typeof REVIEW_REQUEST_STATUSES)[number];

export const REVIEW_REQUEST_CHANNELS = ['email', 'sms'] as const;
export type ReviewRequestChannel = (typeof REVIEW_REQUEST_CHANNELS)[number];

export const PLUGIN_CATEGORIES = [
  'general',
  'communication',
  'accounting',
  'scheduling',
  'marketing',
  'analytics',
] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export const INVENTORY_TRANSACTION_TYPES = [
  'purchase',
  'usage',
  'adjustment',
  'return',
] as const;
export type InventoryTransactionType =
  (typeof INVENTORY_TRANSACTION_TYPES)[number];

export const VEHICLE_STATUSES = ['active', 'inactive', 'maintenance'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['email', 'sms', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * `notification_preferences.event_type` carries no CHECK in schema.sql, so
 * this set is enforced by the Zod validator and by wire.ts, not by the
 * database. wire.spec.ts's CHECK-comparison test skips it for that reason.
 */
export const NOTIFICATION_EVENT_TYPES = [
  'new_lead',
  'job_status_change',
  'payment_received',
  'review_request',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const API_KEY_SCOPES = [
  'read',
  'write',
  'leads',
  'jobs',
  'customers',
  'campaigns',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const CUSTOM_DOMAIN_STATUSES = [
  'none',
  'pending',
  'verifying',
  'active',
  'failed',
] as const;
export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];

export const CUSTOM_DOMAIN_VERIFICATION_METHODS = [
  'cname',
  'txt',
  'http',
] as const;
export type CustomDomainVerificationMethod =
  (typeof CUSTOM_DOMAIN_VERIFICATION_METHODS)[number];

export const ASSET_STATUSES = [
  'available',
  'checked_out',
  'maintenance',
  'retired',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const MAINTENANCE_TYPES = [
  'repair',
  'inspection',
  'calibration',
  'cleaning',
  'replacement',
] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const ASSIGNMENT_ACTIONS = ['check_out', 'check_in'] as const;
export type AssignmentAction = (typeof ASSIGNMENT_ACTIONS)[number];

// subscriptions.plan / subscriptions.status — the CHECK constraints on the
// Stripe Billing table. `WIRE_SUBSCRIPTION` validates against these.
export const SUBSCRIPTION_PLANS = [
  'starter',
  'pro',
  'business',
  'enterprise',
] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = [
  'active',
  'past_due',
  'canceled',
  'trialing',
  'incomplete',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
