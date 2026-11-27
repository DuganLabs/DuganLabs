// ─────────────────────────────────────────────────────────────
// Greenput Domain Types
// Single source of truth for the entire platform.
// ─────────────────────────────────────────────────────────────

export type { ErrorSeverity, ErrorCategory, ErrorEvent } from './errors';

// Closed value sets (LeadStatus, JobStatus, …) are declared once in ./enums as
// runtime arrays with the union type derived from the array, so wire.ts can
// validate an API response against the set and wire.spec.ts can check the set
// against schema.sql's CHECK constraint. Re-exported here because this file is
// the import surface every consumer already uses.
export * from './enums';

// …and imported here, because the interfaces below refer to them.
import type {
  ApiKeyScope,
  AssetCondition,
  AssetStatus,
  AssignmentAction,
  CampaignChannel,
  CampaignStatus,
  ChangeOrderEventAction,
  ChangeOrderStatus,
  ConsentMethod,
  CustomDomainStatus,
  CustomDomainVerificationMethod,
  EstimateLineItemType,
  EstimateStatus,
  InventoryTransactionType,
  JobStatus,
  LeadSource,
  LeadStatus,
  MaintenanceType,
  NotificationChannel,
  NotificationEventType,
  OpportunityStatus,
  PluginCategory,
  PreferredContact,
  ReviewPlatform,
  ReviewRequestChannel,
  ReviewRequestStatus,
  SubscriptionPlan,
  SubscriptionStatus,
  UserRole,
  VehicleStatus,
  LeadWithdrawnReason,
} from './enums';

// How a D1 row becomes one of the models below — the single mapping every list
// and detail endpoint goes through. Read the header of ./wire for why it
// exists and for the money-unit decision it records.
export * from './wire';
// The per-booked-lead rate card and meter insert (WS-1), shared by the
// API and the tenant site's booking commits.
export * from './lead-rate-card';
// The D1 half of the lead-receive gate (CARD_REQUIRED / DELIVERY_PAUSED).
export * from './lead-receive-gate';
// The demo shop is never billed.
export * from './demo-workspace';
export {
  readEstimateLineItem,
  readEstimateLineItems,
} from './estimate-line-item';

export type ID = string; // UUID v4

export type Timestamp = string; // ISO 8601

// ── Shared ───────────────────────────────────────────────────

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface ContactInfo {
  email: string;
  phone: string;
  preferredContact: PreferredContact;
}

export interface AuditFields {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: ID;
}

// ── Lead ─────────────────────────────────────────────────────

export interface Lead extends AuditFields {
  id: ID;
  firstName: string;
  lastName: string;
  contact: ContactInfo;
  address?: Address;
  status: LeadStatus;
  source: LeadSource;
  campaignId?: ID;
  notes: string;
  /** Integer cents. */
  estimatedValue?: number;
  serviceType: string;
  convertedToOpportunityId?: ID;
  /** Set once the receiving workspace confirms this is a real, in-scope request. */
  qualifiedAt?: Timestamp;
  /**
   * Set when the receiving workspace commits to the lead. A state change,
   * not a charge: the lead fee is metered at booking commit (WS-1).
   */
  acceptedAt?: Timestamp;
  /** Set if the consumer withdraws (e.g. balks at price) before or after acceptance. */
  withdrawnAt?: Timestamp;
  /** Why they withdrew, when they said (GP-105). Recorded, not adjudicated. */
  withdrawnReason?: LeadWithdrawnReason;
}

// ── Opportunity ───────────────────────────────────────────────

export interface Opportunity extends AuditFields {
  id: ID;
  leadId: ID;
  customerId?: ID;
  title: string;
  status: OpportunityStatus;
  /** Integer cents. */
  value: number;
  serviceType: string;
  notes: string;
  proposalSentAt?: Timestamp;
  closedAt?: Timestamp;
  convertedToJobId?: ID;
}

// ── Job ──────────────────────────────────────────────────────

export interface JobLineItem {
  id: ID;
  description: string;
  quantity: number;
  /** Integer cents. */
  unitPrice: number;
  /** Integer cents. */
  total: number;
}

export interface Job extends AuditFields {
  id: ID;
  opportunityId: ID;
  customerId: ID;
  jobNumber: string;
  title: string;
  status: JobStatus;
  address: Address;
  scheduledStart: Timestamp;
  scheduledEnd: Timestamp;
  actualStart?: Timestamp;
  actualEnd?: Timestamp;
  lineItems: JobLineItem[];
  /** Integer cents. */
  total: number;
  notes: string;
  invoicedAt?: Timestamp;
  paidAt?: Timestamp;
  /**
   * The technician doing the work (GP-034) — a workspace user with role
   * owner, admin or tech. Distinct from `createdBy`, who typed the job in.
   * Absent on jobs that predate the column or were never assigned.
   */
  assignedTo?: ID;
  /**
   * The capability behind the public invoice page,
   * `https://<slug>.greenput.com/invoice/<token>` (GP-008). Minted by
   * `POST /api/jobs/:id/invoice`; absent until then, and absent forever on
   * jobs invoiced before the column existed.
   */
  invoiceToken?: string;
}

// ── Customer ─────────────────────────────────────────────────

export interface Customer extends AuditFields {
  id: ID;
  firstName: string;
  lastName: string;
  company?: string;
  contact: ContactInfo;
  address: Address;
  notes: string;
  consentGivenAt?: Timestamp;
  consentMethod?: ConsentMethod;
  /** Integer cents. */
  totalJobValue: number;
  jobCount: number;
  /**
   * Job history. Returned by `GET /api/customers/:id` only — never by the
   * list endpoint, which is why it is optional.
   */
  jobs?: Job[];
}

// ── Campaign ─────────────────────────────────────────────────

export interface Campaign extends AuditFields {
  id: ID;
  name: string;
  status: CampaignStatus;
  channel: CampaignChannel;
  targetArea?: string;
  /** Integer cents. */
  budget?: number;
  /** Integer cents. */
  spent?: number;
  /**
   * What the contractor typed. Off-platform channels (a mailer, a van wrap)
   * have no lead rows, so this is the only count they can report.
   */
  leadsGenerated: number;
  /**
   * Derived — not a column. `COUNT(DISTINCT leads.id)` over the leads carrying
   * this `campaign_id`, the same join `/api/reports/campaigns` uses, so the
   * two screens agree (GP-034).
   */
  leadCount: number;
  startDate: Timestamp;
  endDate?: Timestamp;
  notes: string;
}

// ── User / Auth ───────────────────────────────────────────────

// NOT `extends AuditFields`: the `users` table has no `created_by` column, so
// a WorkspaceUser cannot carry `createdBy`. It used to inherit it anyway,
// which is the kind of claim that only ever fails at the wire.
export interface WorkspaceUser {
  id: ID;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  /** Derived from firstName/lastName — not a column. */
  avatarInitials: string;
  lastSeenAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Workspace ─────────────────────────────────────────────────

export interface Workspace {
  id: ID;
  name: string;
  slug?: string;
  trade: string;
  phone: string;
  email: string;
  address: Address;
  licenseNumber?: string;
  logoUrl?: string;
  /**
   * Every service the contractor offers, as picked on onboarding's "pick all
   * that apply" grid (GP-039). `trade` is its first entry, kept for the
   * readers that still want one string (apps/tenant-site, the brand card).
   * `[]` on a workspace that has never said.
   */
  serviceTypes: string[];
  /** The city or region the contractor works from. Absent until they say. */
  serviceArea?: string;
  /** How far from `serviceArea` they will travel, in whole miles. */
  serviceRadiusMiles?: number;
  createdAt: Timestamp;
  // Custom domain (Cloudflare for SaaS) — see libs/shared/models CustomDomain
  // for the fuller shape returned by GET /api/custom-domain. These mirror a
  // subset onto Workspace so list/detail views that already fetch a
  // workspace can show domain state without a second round trip.
  customHostname?: string;
  customDomainStatus?: CustomDomainStatus;
  customDomainSetupFeePaidAt?: Timestamp;
}

// ── Subscription (Stripe Billing) ────────────────────────────
//
// What GET /api/billing/subscription hands out: the workspace's newest
// `subscriptions` row, serialized through WIRE_SUBSCRIPTION. The Stripe ids
// (`stripe_subscription_id`, `stripe_customer_id`) stay in the database on
// purpose — the wire contract exists partly so they never ride along in a
// response. `null` (no row) is the honest "billing is not set up" answer; the
// platform must not synthesize one from `workspaces.stripe_customer_id`.

export interface Subscription {
  id: ID;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart: Timestamp;
  currentPeriodEnd: Timestamp;
  cancelAtPeriodEnd: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Full custom-domain state for a workspace, as returned by the
 * `/api/custom-domain` endpoints in apps/api. `cnameTarget` is the
 * Cloudflare for SaaS fallback origin every contractor CNAMEs their domain
 * to — it is the same value for every workspace, not stored per-row. */
export interface CustomDomain {
  hostname: string | null;
  status: CustomDomainStatus;
  verificationMethod: CustomDomainVerificationMethod | null;
  /** The value the contractor's DNS provider must serve — either the TXT
   * record content or, for the 'cname' method, `cnameTarget` again. */
  verificationValue: string | null;
  cnameTarget: string;
  failureReason: string | null;
  requestedAt: Timestamp | null;
  verifiedAt: Timestamp | null;
  lastCheckedAt: Timestamp | null;
  setupFeePaidAt: Timestamp | null;
}

// ── Plugin ───────────────────────────────────────────────────

export interface Plugin {
  id: ID;
  name: string;
  slug: string;
  description: string;
  version: string;
  author: string;
  iconUrl?: string;
  category: PluginCategory;
  events: string[];
  configSchema: Record<string, unknown>;
  active: boolean;
  createdAt: Timestamp;
}

export interface PluginInstallation {
  id: ID;
  workspaceId: ID;
  pluginId: ID;
  config: Record<string, unknown>;
  enabled: boolean;
  installedAt: Timestamp;
  installedBy: ID;
}

// ── Branding (White-Label) ────────────────────────────────────

/**
 * The primary colour a workspace has until it picks one — the same green
 * `branding.primary_color` defaults to in schema.sql. The onboarding wizard's
 * swatch, the value `/api/auth/register` stores when the swatch is left
 * alone, and the defaults `GET /api/branding` answers for a workspace with no
 * row all read this, so they cannot drift into two different greens again
 * (GP-039: the wizard showed #3d8b5e and Settings then showed #10b981).
 */
export const DEFAULT_BRAND_PRIMARY_COLOR = '#10b981';

export interface Branding {
  id: ID;
  workspaceId: ID;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  customDomain?: string;
  emailFooter: string;
  updatedAt: Timestamp;
}

// ── Reviews / Reputation ─────────────────────────────────────

export interface Review {
  id: ID;
  workspaceId: ID;
  customerId?: ID;
  jobId?: ID;
  platform: ReviewPlatform;
  rating: number;
  content: string;
  authorName: string;
  reviewUrl?: string;
  responded: boolean;
  responseText?: string;
  fetchedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface ReviewRequest {
  id: ID;
  workspaceId: ID;
  customerId: ID;
  jobId: ID;
  channel: ReviewRequestChannel;
  status: ReviewRequestStatus;
  sentAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface ReviewStats {
  averageRating: number | null;
  totalReviews: number;
  byPlatform: Array<{ platform: string; count: number }>;
  ratingDistribution: Array<{ rating: number; count: number }>;
}

// ── Estimate ──────────────────────────────────────────────────

/**
 * Stored inside `estimates.line_items` as a JSON array rather than in its own
 * table, so `id` is whatever the writer put there — the API has never assigned
 * one, which is why it is optional here.
 */
export interface EstimateLineItem {
  id?: ID;
  /**
   * Labor or materials. Rows written before this field existed carry it as a
   * `[labor] ` / `[material] ` prefix on `description` instead —
   * `readEstimateLineItem` moves that prefix here on read.
   */
  type: EstimateLineItemType;
  description: string;
  quantity: number;
  /** Integer cents. */
  unitPrice: number;
  /** Integer cents. */
  total: number;
}

export interface Estimate extends AuditFields {
  id: ID;
  opportunityId: ID;
  customerId?: ID;
  estimateNumber: string;
  title: string;
  status: EstimateStatus;
  lineItems: EstimateLineItem[];
  /** Integer cents. */
  subtotal: number;
  /** A percentage — 8.25 means 8.25%. NOT an amount, NOT a fraction. */
  taxRate: number;
  /** Integer cents. */
  taxAmount: number;
  /** Integer cents. */
  total: number;
  notes: string;
  validUntil?: Timestamp;
  sentAt?: Timestamp;
  acceptedAt?: Timestamp;
  rejectedAt?: Timestamp;
  /** The homeowner quote this estimate was drafted from; null when written by hand. */
  quoteSessionId?: ID | null;
}

// ── Change order ──────────────────────────────────────────────

/**
 * One entry in a change order's append-only trail
 * (`GET /api/change-orders/:id` → `events`).
 */
export interface ChangeOrderEvent {
  id: ID;
  changeOrderId: ID;
  action: ChangeOrderEventAction;
  actorUserId?: ID;
  note: string;
  /** Integer cents: the parent's total after an approval applied. */
  totalAfter?: number;
  createdAt: Timestamp;
}

/**
 * The only way a job's (or a sent estimate's) price moves once it exists.
 * Exactly one of `jobId` / `estimateId` is set. Amounts are integer cents;
 * a negative line is a credit.
 */
export interface ChangeOrder extends AuditFields {
  id: ID;
  jobId?: ID;
  estimateId?: ID;
  /** `CO-1001`, numbered per workspace. */
  number: string;
  title: string;
  reason: string;
  status: ChangeOrderStatus;
  lineItems: EstimateLineItem[];
  /** Integer cents, signed: the sum of the lines. */
  priceDelta: number;
  /** Integer cents: the parent's total when the change was proposed. */
  totalBefore: number;
  decidedBy?: ID;
  decidedAt?: Timestamp;
  decisionNote: string;
  /** Attached by `GET /api/change-orders/:id` and the decision routes. */
  events?: ChangeOrderEvent[];
}

// ── Webhook ───────────────────────────────────────────────────

/** One delivery attempt, as returned inside `GET /api/webhooks/:id`. */
export interface WebhookDelivery {
  id: ID;
  webhookId: ID;
  eventType: string;
  statusCode?: number;
  attempts: number;
  deliveredAt?: Timestamp;
  createdAt: Timestamp;
}

export interface Webhook {
  id: ID;
  workspaceId: ID;
  url: string;
  events: string[];
  /**
   * The signing secret. Returned by create and by `GET /api/webhooks/:id`,
   * and deliberately absent from the list response — hence optional.
   */
  secret?: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Recent delivery attempts. `GET /api/webhooks/:id` only. */
  deliveries?: WebhookDelivery[];
}

// ── Audit / Activity Log ──────────────────────────────────────

export interface AuditEntry {
  id: string;
  workspace_id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  meta: string | null;
  created_at: Timestamp;
  first_name: string | null;
  last_name: string | null;
}

// ── API Response envelope ─────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    perPage: number;
  };
}

/**
 * A link the contractor sends THEMSELVES (GP-008). Nothing in this product
 * sends mail or SMS yet, so "Mark invoiced", "Mark sent" and "Invite
 * teammate" each answer with the public URL and a message ready to paste
 * into whatever the contractor already uses. No status anywhere may imply the
 * message went out — the copy is "link ready to share", never "sent".
 */
export interface ShareLink {
  url: string;
  /** A short message with the URL in it, for the contractor to paste. */
  message: string;
  /** Set when the link stops working on its own (invitations). */
  expiresAt?: Timestamp;
}

/**
 * `{ data, share }` — the envelope of the three actions that produce a link.
 * `share` is absent when the workspace has no public site address (a NULL
 * `workspaces.slug`), because there is then no URL to hand over.
 */
export interface ShareableResponse<T> extends ApiResponse<T> {
  share?: ShareLink;
}

/**
 * What `GET /api/auth/invite/:token` tells the accept screen before the
 * holder commits: who the invitation is for and where. No user id, no
 * email — the token is the only thing the holder has, and this must not
 * turn it into a directory.
 */
export interface InvitationPreview {
  firstName: string;
  lastName: string;
  workspaceName: string;
  expiresAt: Timestamp;
}

export interface ApiError {
  code: string;
  message: string;
  field?: string;
}

// ── Schedule ─────────────────────────────────────────────────

export interface ScheduleBlock {
  id: ID;
  title: string;
  jobNumber: string;
  status: JobStatus;
  start: Timestamp;
  end: Timestamp;
  customerId: ID;
  customerName: string;
  location: string;
  /** The assigned technician (GP-034), when there is one. */
  assignedTo?: ID;
  /** Their name, so the calendar can print it under the block. */
  assigneeName?: string;
}

// ── Dashboard ─────────────────────────────────────────────────

export interface ActivityEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  meta: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
}

export interface DashboardStats {
  leads: { thisMonth: number; growth: number | null };
  jobs: { active: number; dueThisWeek: number };
  revenue: { thisMonth: number; growth: number | null };
  conversion: { rate: number };
  activity: ActivityEntry[];
}

// ── Inventory ─────────────────────────────────────────────────

export interface InventoryItem {
  id: ID;
  workspaceId: ID;
  name: string;
  sku?: string;
  description: string;
  category: string;
  quantity: number;
  minQuantity: number;
  /** Integer cents. */
  unitCost: number;
  /** Integer cents. */
  unitPrice: number;
  supplier: string;
  location: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /**
   * Transaction history. Returned by `GET /api/inventory/:id` only — never by
   * the list endpoint, which is why it is optional.
   */
  transactions?: InventoryTransaction[];
}

// No `unitCost`: `inventory_transactions` has no such column and never had
// one, so the field could only ever have been undefined on the wire.
export interface InventoryTransaction {
  id: ID;
  workspaceId: ID;
  itemId: ID;
  jobId?: ID;
  type: InventoryTransactionType;
  quantity: number;
  notes: string;
  createdAt: Timestamp;
  createdBy: ID;
}

// ── Vehicle ───────────────────────────────────────────────────

export interface Vehicle {
  id: ID;
  workspaceId: ID;
  name: string;
  make: string;
  model: string;
  /** Nullable in the database — a vehicle can be recorded without a year. */
  year?: number;
  /** Nullable in the database. */
  licensePlate?: string;
  vin?: string;
  status: VehicleStatus;
  mileage: number;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Chat ─────────────────────────────────────────────────────

/**
 * A conversation (GP-055). `entityType` / `entityId` name what it is about —
 * a customer or a job — and the API hands back the existing room for that
 * entity rather than minting a second one. Shape of `chat_rooms`: there is
 * no `updated_at` column, and `workspace_id` stays server-side like every
 * other entity's.
 */
export interface ChatRoom {
  id: ID;
  name: string;
  entityType?: string;
  entityId?: ID;
  createdBy: ID;
  createdAt: Timestamp;
}

/** One line of a room's history, as `GET /api/chat/rooms/:id/messages` and the room-state frame both send it. */
export interface ChatMessage {
  id: ID;
  userId: ID;
  userName: string;
  content: string;
  createdAt: Timestamp;
}

/** `GET /api/chat/unread` — one row per room with messages the caller has not read. */
export interface ChatUnread {
  roomId: ID;
  name: string;
  unreadCount: number;
}

// ── Physical Assets ──────────────────────────────────────────

export interface Asset {
  id: ID;
  workspaceId: ID;
  name: string;
  category: string;
  serialNumber?: string;
  qrCode?: string;
  status: AssetStatus;
  assignedTo?: ID;
  vehicleId?: ID;
  purchaseDate?: Timestamp;
  purchaseCost?: number;
  condition: AssetCondition;
  location: string;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MaintenanceLog {
  id: ID;
  workspaceId: ID;
  assetId: ID;
  type: MaintenanceType;
  description: string;
  cost?: number;
  performedBy?: ID;
  performedAt: Timestamp;
  nextDue?: Timestamp;
  createdAt: Timestamp;
}

export interface AssetAssignment {
  id: ID;
  workspaceId: ID;
  assetId: ID;
  userId: ID;
  jobId?: ID;
  action: AssignmentAction;
  notes: string;
  createdAt: Timestamp;
}

// ── ApiKey ───────────────────────────────────────────────────

export interface ApiKey {
  id: ID;
  workspaceId: ID;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt?: Timestamp;
  expiresAt?: Timestamp;
  createdAt: Timestamp;
  createdBy: ID;
}

/**
 * `POST /api/api-keys` — the created key plus the secret itself, returned
 * once and never retrievable again.
 */
export interface ApiKeyCreated extends ApiKey {
  key: string;
}

// ── NotificationPreference ───────────────────────────────────

export interface NotificationPreference {
  id: ID;
  userId: ID;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
}

// ── Workspace availability (GP-101) ──────────────────────────

/**
 * One weekday of the recurring week. `weekday` is 0 = Sunday … 6 = Saturday,
 * as `Date.prototype.getDay()`. Times are local wall-clock `HH:MM` in the
 * workspace's `timezone`, and are absent when the day is closed.
 */
export interface AvailabilityDay {
  id: ID;
  weekday: number;
  isOpen: boolean;
  opensAt?: string;
  closesAt?: string;
}

/**
 * A dated override of the recurring week — a public holiday, a day off, or a
 * normally-closed day the contractor is opening. For its `date` (local
 * `YYYY-MM-DD`) it wins over the weekday row in both directions.
 */
export interface AvailabilityException {
  id: ID;
  date: string;
  isOpen: boolean;
  opensAt?: string;
  closesAt?: string;
  reason?: string;
}

/**
 * What `GET /api/availability` answers: the workspace's booking policy, the
 * recurring week and the dated exceptions, and whether all of that adds up to
 * something a booking screen may offer. `bookable` is computed by the route,
 * never stored: it is true only when a timezone is set AND at least one
 * weekday is open. A workspace that has never said when it works is not
 * bookable — an absent answer must not publish a claim.
 */
export interface WorkspaceAvailability {
  /** IANA zone the hours are written in. Absent until the contractor sets it. */
  timezone?: string;
  /** How far ahead the first offered slot is. */
  bookingLeadHours: number;
  /** How far ahead the last offered slot is. */
  bookingHorizonDays: number;
  /** Travel gap put between two consecutive jobs. */
  travelBufferMinutes: number;
  /** How many jobs may overlap — a two-van shop books two. */
  concurrentJobs: number;
  bookable: boolean;
  week: AvailabilityDay[];
  exceptions: AvailabilityException[];
}

// ── Installed plugin (a JOIN, not a table) ───────────────────

/**
 * What `GET /api/plugins/installed` returns: the installation plus the
 * catalogue fields of the plugin it points at. Lives here rather than in
 * apps/platform because it is a response shape, and response shapes are the
 * contract — see WIRE_INSTALLED_PLUGIN in ./wire for the column mapping.
 */
export interface InstalledPlugin extends PluginInstallation {
  name: string;
  slug: string;
  description: string;
  version: string;
  author: string;
  iconUrl?: string;
  category: PluginCategory;
  events: string[];
}
