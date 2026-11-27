// ─────────────────────────────────────────────────────────────
// THE WIRE CONTRACT
//
// One machine-readable table saying, for every entity the API hands out, which
// D1 column each field of the declared model comes from and what type it has.
//
// WHY THIS FILE EXISTS
//
// apps/api used to answer `data: rows.results` — D1 rows verbatim: flat,
// snake_case, exactly the column names. apps/platform reads the models in
// ./index.ts: nested, camelCase. `Lead` declares `contact: ContactInfo` and
// the leads table has no `contact` column at all — it has `email` and `phone`.
// So /leads threw "Cannot read properties of undefined (reading 'email')" and
// rendered an empty board, /customers did the same, every Scheduled cell on
// /jobs read "Invalid Date", the calendar had no events and the dashboard run
// sheet read "--:--". The WRITE path had always mapped between the two shapes.
// The READ path never did.
//
// Sixteen e2e specs and a pile of route specs stayed green throughout, because
// every one of them was written against a hand-made fixture in the shape the
// reader wanted. A fixture written to match the reader is a copy of the
// reader's assumptions, not a test of the contract.
//
// So the mapping lives here, once, and three different things are driven off
// this same table:
//
//   1. apps/api serializes every list and detail response with `toWire`
//      (see apps/api/src/lib/serialize.ts) — no per-route mapping anywhere.
//   2. `checkWire` validates a real response body against the table, so a
//      contract test can assert the bytes the Worker actually produced.
//   3. wire.spec.ts checks the table itself against schema.sql: every column
//      named here must exist on the table named here, and every closed value
//      set must match that column's CHECK constraint.
//
// ADDING A FIELD TO A MODEL
//
// Add it to the interface in ./index.ts, add it to the entity below, and add
// it to that entity's sample in wire.spec.ts. All three are required: the
// sample is typed as the model (so TypeScript demands the new field) and is
// checked with `checkWire` (so an unmapped field fails as an unexpected key).
// There is no way to add a model field the API does not emit.
//
// ── MONEY: EVERY AMOUNT COLUMN IS INTEGER CENTS ──────────────
//
// Canonical unit: integer minor units (US cents). `kind: 'cents'` marks every
// field that carries one, `toWire` rounds it to an integer, and `checkWire`
// rejects a non-integer — so a dollars-valued row fails the contract test
// instead of quietly rendering 100x wrong.
//
// It was three ways ambiguous before: apps/platform divided by 100 (cents),
// libs/shared/documents/src/invoice.ts printed the number as-is (dollars), and
// scripts/preview/seed.sql wrote dollars — so the live demo tenant showed
// $26.52 for a $2,652 job and a real invoice would have rendered 100x wrong
// on a billing surface. Cents won because it is what the platform's write path
// already sent (`Math.round(f.value * 100)`), because integers do not
// accumulate float error across a subtotal, and because it is what Stripe
// takes. migrations/023-money-to-cents.sql converted the rows that predate
// this decision.
//
// Two amounts deliberately are NOT cents, and say so in their own names:
// `lead_meter_events.price_usd` (whole dollars, Greenput's per-lead fee — see
// apps/api/src/lib/lead-meter.ts) and `estimates.tax_rate`, which is a
// percentage, not an amount. The prepaid SMS balance is a third exception:
// `workspaces.usage_balance_micro_usd` and
// `workspace_usage_ledger.amount_micro_usd` are micro-USD (1 USD = 1_000_000),
// because a US SMS segment is $0.0083. The top-up and its threshold are
// cents (`usage_topup_cents`, `usage_topup_threshold_cents`). None of these
// is `kind: 'cents'`.
// ─────────────────────────────────────────────────────────────

import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
  CONSENT_METHODS,
  CUSTOM_DOMAIN_STATUSES,
  ESTIMATE_STATUSES,
  CHANGE_ORDER_STATUSES,
  CHANGE_ORDER_EVENT_ACTIONS,
  INVENTORY_TRANSACTION_TYPES,
  JOB_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_WITHDRAWN_REASONS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  OPPORTUNITY_STATUSES,
  PLUGIN_CATEGORIES,
  PREFERRED_CONTACTS,
  REVIEW_PLATFORMS,
  REVIEW_REQUEST_CHANNELS,
  REVIEW_REQUEST_STATUSES,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES,
  USER_ROLES,
  VEHICLE_STATUSES,
} from './enums';
import { readEstimateLineItems } from './estimate-line-item';

export type WireRow = Readonly<Record<string, unknown>>;

export type WireKind =
  | 'string'
  /** ISO 8601 string. Same wire type as `string`; named for what it holds. */
  | 'timestamp'
  | 'number'
  /** Integer minor units (US cents). See the MONEY note above. */
  | 'cents'
  | 'integer'
  /** SQLite has no boolean: stored as INTEGER 0/1, handed out as true/false. */
  | 'boolean'
  /** A TEXT column holding JSON, handed out parsed. */
  | 'json';

export interface WireField {
  readonly kind: WireKind;
  /** The D1 column this field is read from. */
  readonly column: string;
  /**
   * The model declares this field optional (`field?: T`). A NULL column, or a
   * column the endpoint did not SELECT, omits the key entirely rather than
   * inventing a value.
   */
  readonly optional?: boolean;
  /** Closed value set, mirroring the column's CHECK constraint. */
  readonly values?: readonly string[];
  /** For `json`: the shape to fall back to when the column is absent/unparseable. */
  readonly empty?: 'array' | 'object';
  /**
   * Not a column read. Used for the handful of fields the model declares that
   * are computed from other columns (`WorkspaceUser.avatarInitials`). `column`
   * still names a real column so the schema check has something to anchor on.
   */
  readonly derive?: (row: WireRow) => unknown;
  /**
   * Supplied by the route, not by the row — the freshly minted API key, which
   * exists for one response and is never stored in readable form. `toWire`
   * leaves it alone; `checkWire` still type-checks it; the schema check skips
   * it because it has no column.
   */
  readonly fromRoute?: boolean;
}

/** A nested object in the model built from flat columns (`contact`, `address`). */
export interface WireGroup {
  readonly group: Readonly<Record<string, WireField>>;
}

export type WireShape = Readonly<Record<string, WireField | WireGroup>>;

export interface WireEntity {
  /** For error messages. */
  readonly name: string;
  /** The D1 table every `column` below must exist on. */
  readonly table: string;
  /**
   * Further tables a column may come from, for the handful of endpoints that
   * hand out a JOIN (`GET /api/plugins/installed`). wire.spec.ts resolves each
   * column against `table` and these.
   */
  readonly joinedTables?: readonly string[];
  readonly fields: WireShape;
  /**
   * Keys a route attaches from a second query (`job.lineItems`,
   * `customer.jobs`). `toWire` never fills these — the route does, with
   * `toWireList` — but `checkWire` validates them and does not report them as
   * unexpected.
   */
  readonly children?: Readonly<Record<string, WireEntity>>;
}

function isGroup(field: WireField | WireGroup): field is WireGroup {
  return 'group' in field;
}

// ── Field constructors ───────────────────────────────────────
// Terse on purpose: the table below is the contract and wants to be read, not
// waded through. Every one of them names its column explicitly — the whole
// defect was an implicit assumption about what a field was called.

const str = (column: string): WireField => ({ kind: 'string', column });
const strOpt = (column: string): WireField => ({
  kind: 'string',
  column,
  optional: true,
});
const ts = (column: string): WireField => ({ kind: 'timestamp', column });
const tsOpt = (column: string): WireField => ({
  kind: 'timestamp',
  column,
  optional: true,
});
const num = (column: string): WireField => ({ kind: 'number', column });
const int = (column: string): WireField => ({ kind: 'integer', column });
const intOpt = (column: string): WireField => ({
  kind: 'integer',
  column,
  optional: true,
});
const cents = (column: string): WireField => ({ kind: 'cents', column });
const centsOpt = (column: string): WireField => ({
  kind: 'cents',
  column,
  optional: true,
});
const bool = (column: string): WireField => ({ kind: 'boolean', column });
const jsonArray = (column: string): WireField => ({
  kind: 'json',
  column,
  empty: 'array',
});
const jsonObject = (column: string): WireField => ({
  kind: 'json',
  column,
  empty: 'object',
});
const oneOf = (column: string, values: readonly string[]): WireField => ({
  kind: 'string',
  column,
  values,
});
const oneOfOpt = (column: string, values: readonly string[]): WireField => ({
  kind: 'string',
  column,
  values,
  optional: true,
});

/** `contact: ContactInfo` — the group whose absence broke /leads and /customers. */
const CONTACT: WireGroup = {
  group: {
    email: str('email'),
    phone: str('phone'),
    preferredContact: oneOf('preferred_contact', PREFERRED_CONTACTS),
  },
};

/** `address: Address` — four flat columns, one nested object. */
const ADDRESS: WireGroup = {
  group: {
    street: str('street'),
    city: str('city'),
    state: str('state'),
    zip: str('zip'),
  },
};

const AUDIT = {
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
  createdBy: str('created_by'),
} as const;

// ── The entities ─────────────────────────────────────────────

export const WIRE_LEAD: WireEntity = {
  name: 'Lead',
  table: 'leads',
  fields: {
    id: str('id'),
    firstName: str('first_name'),
    lastName: str('last_name'),
    contact: CONTACT,
    address: ADDRESS,
    status: oneOf('status', LEAD_STATUSES),
    source: oneOf('source', LEAD_SOURCES),
    campaignId: strOpt('campaign_id'),
    notes: str('notes'),
    estimatedValue: centsOpt('estimated_value'),
    serviceType: str('service_type'),
    convertedToOpportunityId: strOpt('converted_to_opportunity_id'),
    qualifiedAt: tsOpt('qualified_at'),
    acceptedAt: tsOpt('accepted_at'),
    withdrawnAt: tsOpt('withdrawn_at'),
    withdrawnReason: oneOfOpt('withdrawn_reason', LEAD_WITHDRAWN_REASONS),
    ...AUDIT,
  },
};

export const WIRE_JOB_LINE_ITEM: WireEntity = {
  name: 'JobLineItem',
  table: 'job_line_items',
  fields: {
    id: str('id'),
    description: str('description'),
    quantity: num('quantity'),
    unitPrice: cents('unit_price'),
    total: cents('total'),
  },
};

export const WIRE_JOB: WireEntity = {
  name: 'Job',
  table: 'jobs',
  fields: {
    id: str('id'),
    opportunityId: str('opportunity_id'),
    customerId: str('customer_id'),
    jobNumber: str('job_number'),
    title: str('title'),
    status: oneOf('status', JOB_STATUSES),
    address: ADDRESS,
    scheduledStart: ts('scheduled_start'),
    scheduledEnd: ts('scheduled_end'),
    actualStart: tsOpt('actual_start'),
    actualEnd: tsOpt('actual_end'),
    total: cents('total'),
    notes: str('notes'),
    invoicedAt: tsOpt('invoiced_at'),
    paidAt: tsOpt('paid_at'),
    assignedTo: strOpt('assigned_to'),
    invoiceToken: strOpt('invoice_token'),
    ...AUDIT,
  },
  children: { lineItems: WIRE_JOB_LINE_ITEM },
};

/**
 * `GET /api/jobs/schedule` — the calendar's week: a narrowed read of `jobs`
 * ordered by start. `customerName` and `location` are the two strings the
 * calendar prints under a block; they are composed from the customer JOIN
 * and the address columns, so they are `derive`d here (anchored on a real
 * `jobs` column for the schema check) rather than mapped by the route.
 */
export const WIRE_SCHEDULE_BLOCK: WireEntity = {
  name: 'ScheduleBlock',
  table: 'jobs',
  fields: {
    id: str('id'),
    title: str('title'),
    jobNumber: str('job_number'),
    status: oneOf('status', JOB_STATUSES),
    start: ts('scheduled_start'),
    end: ts('scheduled_end'),
    customerId: str('customer_id'),
    customerName: {
      kind: 'string',
      column: 'customer_id',
      derive: (row) =>
        [row['customer_first_name'], row['customer_last_name']]
          .filter(Boolean)
          .join(' '),
    },
    location: {
      kind: 'string',
      column: 'street',
      derive: (row) => [row['street'], row['city']].filter(Boolean).join(', '),
    },
    assignedTo: strOpt('assigned_to'),
    // From the users JOIN on assigned_to (GP-034); absent when unassigned,
    // so the calendar prints nothing rather than an empty name.
    assigneeName: {
      kind: 'string',
      column: 'assigned_to',
      optional: true,
      derive: (row) => {
        if (!row['assigned_to']) return undefined;
        const name = [row['assignee_first_name'], row['assignee_last_name']]
          .filter(Boolean)
          .join(' ');
        return name || undefined;
      },
    },
  },
};

export const WIRE_CUSTOMER: WireEntity = {
  name: 'Customer',
  table: 'customers',
  fields: {
    id: str('id'),
    firstName: str('first_name'),
    lastName: str('last_name'),
    company: strOpt('company'),
    contact: CONTACT,
    address: ADDRESS,
    notes: str('notes'),
    consentGivenAt: tsOpt('consent_given_at'),
    consentMethod: oneOfOpt('consent_method', CONSENT_METHODS),
    totalJobValue: cents('total_job_value'),
    jobCount: int('job_count'),
    ...AUDIT,
  },
  children: { jobs: WIRE_JOB },
};

export const WIRE_OPPORTUNITY: WireEntity = {
  name: 'Opportunity',
  table: 'opportunities',
  fields: {
    id: str('id'),
    leadId: str('lead_id'),
    customerId: strOpt('customer_id'),
    title: str('title'),
    status: oneOf('status', OPPORTUNITY_STATUSES),
    value: cents('value'),
    serviceType: str('service_type'),
    notes: str('notes'),
    proposalSentAt: tsOpt('proposal_sent_at'),
    closedAt: tsOpt('closed_at'),
    convertedToJobId: strOpt('converted_to_job_id'),
    ...AUDIT,
  },
};

export const WIRE_CAMPAIGN: WireEntity = {
  name: 'Campaign',
  table: 'campaigns',
  fields: {
    id: str('id'),
    name: str('name'),
    status: oneOf('status', CAMPAIGN_STATUSES),
    channel: oneOf('channel', CAMPAIGN_CHANNELS),
    targetArea: strOpt('target_area'),
    budget: centsOpt('budget'),
    spent: centsOpt('spent'),
    leadsGenerated: int('leads_generated'),
    // Not a column: every campaign read SELECTs
    // `COUNT(DISTINCT l.id) AS lead_count` over the leads carrying this
    // campaign_id — the same join /api/reports/campaigns uses — so /campaigns
    // and /reports show one number under one name (GP-034). `column` anchors
    // on leads_generated only so the schema check has something to check.
    leadCount: {
      kind: 'integer',
      column: 'leads_generated',
      derive: (row) => Number(row['lead_count'] ?? 0),
    },
    startDate: ts('start_date'),
    endDate: tsOpt('end_date'),
    notes: str('notes'),
    ...AUDIT,
  },
};

export const WIRE_ESTIMATE: WireEntity = {
  name: 'Estimate',
  table: 'estimates',
  fields: {
    id: str('id'),
    opportunityId: str('opportunity_id'),
    customerId: strOpt('customer_id'),
    estimateNumber: str('estimate_number'),
    title: str('title'),
    status: oneOf('status', ESTIMATE_STATUSES),
    // Stored as a JSON array in `estimates.line_items` rather than in its own
    // table (unlike job line items), so it is handed out parsed. Each entry is
    // an `EstimateLineItem` — {id?, type, description, quantity, unitPrice,
    // total} — and amounts inside it are cents, like every other amount.
    // Read through `readEstimateLineItems` rather than parsed bare, because
    // rows written before `type` existed carry it as a `[labor] ` prefix on
    // the description (GP-038) and are deliberately not migrated.
    lineItems: {
      kind: 'json',
      column: 'line_items',
      empty: 'array',
      derive: (row) => readEstimateLineItems(row['line_items']),
    },
    subtotal: cents('subtotal'),
    /** A percentage (8.25 means 8.25%), NOT an amount. */
    taxRate: num('tax_rate'),
    taxAmount: cents('tax_amount'),
    total: cents('total'),
    notes: str('notes'),
    validUntil: tsOpt('valid_until'),
    sentAt: tsOpt('sent_at'),
    acceptedAt: tsOpt('accepted_at'),
    rejectedAt: tsOpt('rejected_at'),
    /** The homeowner quote this was drafted from; null when written by hand. */
    quoteSessionId: strOpt('quote_session_id'),
    ...AUDIT,
  },
};

export const WIRE_CHANGE_ORDER_EVENT: WireEntity = {
  name: 'ChangeOrderEvent',
  table: 'change_order_events',
  fields: {
    id: str('id'),
    changeOrderId: str('change_order_id'),
    action: oneOf('action', CHANGE_ORDER_EVENT_ACTIONS),
    actorUserId: strOpt('actor_user_id'),
    note: str('note'),
    totalAfter: centsOpt('total_after'),
    createdAt: ts('created_at'),
  },
};

export const WIRE_CHANGE_ORDER: WireEntity = {
  name: 'ChangeOrder',
  table: 'change_orders',
  fields: {
    id: str('id'),
    jobId: strOpt('job_id'),
    estimateId: strOpt('estimate_id'),
    number: str('number'),
    title: str('title'),
    reason: str('reason'),
    status: oneOf('status', CHANGE_ORDER_STATUSES),
    // Same JSON line shape as `estimates.line_items`, amounts in cents.
    lineItems: {
      kind: 'json',
      column: 'line_items',
      empty: 'array',
      derive: (row) => readEstimateLineItems(row['line_items']),
    },
    priceDelta: cents('price_delta'),
    totalBefore: cents('total_before'),
    decidedBy: strOpt('decided_by'),
    decidedAt: tsOpt('decided_at'),
    decisionNote: str('decision_note'),
    ...AUDIT,
  },
  children: { events: WIRE_CHANGE_ORDER_EVENT },
};

export const WIRE_INVENTORY_TRANSACTION: WireEntity = {
  name: 'InventoryTransaction',
  table: 'inventory_transactions',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    itemId: str('item_id'),
    jobId: strOpt('job_id'),
    type: oneOf('type', INVENTORY_TRANSACTION_TYPES),
    quantity: int('quantity'),
    notes: str('notes'),
    createdAt: ts('created_at'),
    createdBy: str('created_by'),
  },
};

export const WIRE_INVENTORY_ITEM: WireEntity = {
  name: 'InventoryItem',
  table: 'inventory_items',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    name: str('name'),
    sku: strOpt('sku'),
    description: str('description'),
    category: str('category'),
    quantity: int('quantity'),
    minQuantity: int('min_quantity'),
    unitCost: cents('unit_cost'),
    unitPrice: cents('unit_price'),
    supplier: str('supplier'),
    location: str('location'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  children: { transactions: WIRE_INVENTORY_TRANSACTION },
};

export const WIRE_VEHICLE: WireEntity = {
  name: 'Vehicle',
  table: 'vehicles',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    name: str('name'),
    make: str('make'),
    model: str('model'),
    year: intOpt('year'),
    licensePlate: strOpt('license_plate'),
    vin: strOpt('vin'),
    status: oneOf('status', VEHICLE_STATUSES),
    mileage: int('mileage'),
    notes: str('notes'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
};

export const WIRE_REVIEW: WireEntity = {
  name: 'Review',
  table: 'reviews',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    customerId: strOpt('customer_id'),
    jobId: strOpt('job_id'),
    platform: oneOf('platform', REVIEW_PLATFORMS),
    rating: int('rating'),
    content: str('content'),
    authorName: str('author_name'),
    reviewUrl: strOpt('review_url'),
    responded: bool('responded'),
    responseText: strOpt('response_text'),
    fetchedAt: tsOpt('fetched_at'),
    createdAt: ts('created_at'),
  },
};

export const WIRE_REVIEW_REQUEST: WireEntity = {
  name: 'ReviewRequest',
  table: 'review_requests',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    customerId: str('customer_id'),
    jobId: str('job_id'),
    channel: oneOf('channel', REVIEW_REQUEST_CHANNELS),
    status: oneOf('status', REVIEW_REQUEST_STATUSES),
    sentAt: tsOpt('sent_at'),
    completedAt: tsOpt('completed_at'),
    createdAt: ts('created_at'),
  },
};

export const WIRE_PLUGIN: WireEntity = {
  name: 'Plugin',
  table: 'plugins',
  fields: {
    id: str('id'),
    name: str('name'),
    slug: str('slug'),
    description: str('description'),
    version: str('version'),
    author: str('author'),
    iconUrl: strOpt('icon_url'),
    category: oneOf('category', PLUGIN_CATEGORIES),
    events: jsonArray('events'),
    configSchema: jsonObject('config_schema'),
    active: bool('active'),
    createdAt: ts('created_at'),
  },
};

export const WIRE_PLUGIN_INSTALLATION: WireEntity = {
  name: 'PluginInstallation',
  table: 'plugin_installations',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    pluginId: str('plugin_id'),
    config: jsonObject('config'),
    enabled: bool('enabled'),
    installedAt: ts('installed_at'),
    installedBy: str('installed_by'),
  },
};

/**
 * `GET /api/plugins/installed` — an installation JOINed onto its plugin's
 * catalogue fields, which is what the Installed tab renders from.
 */
export const WIRE_INSTALLED_PLUGIN: WireEntity = {
  name: 'InstalledPlugin',
  table: 'plugin_installations',
  joinedTables: ['plugins'],
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    pluginId: str('plugin_id'),
    config: jsonObject('config'),
    enabled: bool('enabled'),
    installedAt: ts('installed_at'),
    installedBy: str('installed_by'),
    name: str('name'),
    slug: str('slug'),
    description: str('description'),
    version: str('version'),
    author: str('author'),
    iconUrl: strOpt('icon_url'),
    category: oneOf('category', PLUGIN_CATEGORIES),
    events: jsonArray('events'),
  },
};

export const WIRE_WEBHOOK_DELIVERY: WireEntity = {
  name: 'WebhookDelivery',
  table: 'webhook_deliveries',
  fields: {
    id: str('id'),
    webhookId: str('webhook_id'),
    eventType: str('event_type'),
    statusCode: intOpt('status_code'),
    attempts: int('attempts'),
    deliveredAt: tsOpt('delivered_at'),
    createdAt: ts('created_at'),
  },
};

export const WIRE_WEBHOOK: WireEntity = {
  name: 'Webhook',
  table: 'webhooks',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    url: str('url'),
    events: jsonArray('events'),
    // Optional because the list endpoint deliberately does not SELECT it —
    // a signing secret is handed back once, by the detail and create
    // endpoints, and never in a list.
    secret: strOpt('secret'),
    active: bool('active'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  children: { deliveries: WIRE_WEBHOOK_DELIVERY },
};

export const WIRE_API_KEY: WireEntity = {
  name: 'ApiKey',
  table: 'api_keys',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    name: str('name'),
    keyPrefix: str('key_prefix'),
    scopes: { kind: 'json', column: 'scopes', empty: 'array' },
    lastUsedAt: tsOpt('last_used_at'),
    expiresAt: tsOpt('expires_at'),
    createdAt: ts('created_at'),
    createdBy: str('created_by'),
  },
};

/**
 * `POST /api/api-keys` — the row, plus the raw key, handed over exactly once.
 * Same fields as the list response, so the two cannot describe the key
 * differently (they used to: create invented an array of scopes and a
 * made-up `createdAt`, and called the secret `key` while apps/platform read
 * `rawKey` and rendered "undefined" to the contractor).
 */
export const WIRE_API_KEY_CREATED: WireEntity = {
  name: 'ApiKeyCreated',
  table: 'api_keys',
  fields: {
    ...WIRE_API_KEY.fields,
    key: { kind: 'string', column: 'key_hash', fromRoute: true },
  },
};

export const WIRE_BRANDING: WireEntity = {
  name: 'Branding',
  table: 'branding',
  fields: {
    id: str('id'),
    workspaceId: str('workspace_id'),
    logoUrl: strOpt('logo_url'),
    faviconUrl: strOpt('favicon_url'),
    primaryColor: str('primary_color'),
    secondaryColor: str('secondary_color'),
    accentColor: str('accent_color'),
    fontFamily: str('font_family'),
    customDomain: strOpt('custom_domain'),
    emailFooter: str('email_footer'),
    updatedAt: ts('updated_at'),
  },
};

export const WIRE_NOTIFICATION_PREFERENCE: WireEntity = {
  name: 'NotificationPreference',
  table: 'notification_preferences',
  fields: {
    id: str('id'),
    userId: str('user_id'),
    eventType: oneOf('event_type', NOTIFICATION_EVENT_TYPES),
    channel: oneOf('channel', NOTIFICATION_CHANNELS),
    enabled: bool('enabled'),
  },
};

function initialsOf(row: WireRow): string {
  const first = String(row['first_name'] ?? '');
  const last = String(row['last_name'] ?? '');
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export const WIRE_WORKSPACE_USER: WireEntity = {
  name: 'WorkspaceUser',
  table: 'users',
  fields: {
    id: str('id'),
    firstName: str('first_name'),
    lastName: str('last_name'),
    email: str('email'),
    role: oneOf('role', USER_ROLES),
    avatarInitials: {
      kind: 'string',
      column: 'first_name',
      derive: initialsOf,
    },
    lastSeenAt: tsOpt('last_seen_at'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
};

export const WIRE_WORKSPACE: WireEntity = {
  name: 'Workspace',
  table: 'workspaces',
  fields: {
    id: str('id'),
    name: str('name'),
    slug: strOpt('slug'),
    trade: str('trade'),
    phone: str('phone'),
    email: str('email'),
    address: ADDRESS,
    // `license_num`, not `license_number`: the column and the model field are
    // spelled differently, which is exactly why this mapping is a table and
    // not a camelCase() call. apps/platform/src/routes/settings read
    // `license_number` and got nothing for it.
    licenseNumber: strOpt('license_num'),
    logoUrl: strOpt('logo_url'),
    // GP-039: the whole service list, the area and the radius. `service_types`
    // is a JSON array column and `trade` is its first entry; the other two
    // are NULL — and so absent here — on a workspace that never gave them.
    serviceTypes: jsonArray('service_types'),
    serviceArea: strOpt('service_area'),
    serviceRadiusMiles: intOpt('service_radius_miles'),
    createdAt: ts('created_at'),
    customHostname: strOpt('custom_hostname'),
    customDomainStatus: oneOfOpt(
      'custom_domain_status',
      CUSTOM_DOMAIN_STATUSES,
    ),
    customDomainSetupFeePaidAt: tsOpt('custom_domain_setup_fee_paid_at'),
  },
};

/**
 * GET /api/billing/subscription. Deliberately NOT mapped:
 * `stripe_subscription_id` and `stripe_customer_id` — the ids stay server-side.
 * This was the last raw-row response in apps/api; its snake_case
 * `current_period_end` is why Settings → Billing never showed a renewal date.
 */
export const WIRE_SUBSCRIPTION: WireEntity = {
  name: 'Subscription',
  table: 'subscriptions',
  fields: {
    id: str('id'),
    plan: oneOf('plan', SUBSCRIPTION_PLANS),
    status: oneOf('status', SUBSCRIPTION_STATUSES),
    currentPeriodStart: ts('current_period_start'),
    currentPeriodEnd: ts('current_period_end'),
    cancelAtPeriodEnd: bool('cancel_at_period_end'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
};

export const WIRE_AVAILABILITY_DAY: WireEntity = {
  name: 'AvailabilityDay',
  table: 'workspace_availability',
  fields: {
    id: str('id'),
    weekday: int('weekday'),
    isOpen: bool('is_open'),
    opensAt: strOpt('opens_at'),
    closesAt: strOpt('closes_at'),
  },
};

export const WIRE_AVAILABILITY_EXCEPTION: WireEntity = {
  name: 'AvailabilityException',
  table: 'workspace_availability_exceptions',
  fields: {
    id: str('id'),
    date: str('date'),
    isOpen: bool('is_open'),
    opensAt: strOpt('opens_at'),
    closesAt: strOpt('closes_at'),
    reason: strOpt('reason'),
  },
};

/**
 * `GET /api/availability`. The scalar fields are the booking-policy columns on
 * `workspaces`; `week` and `exceptions` are the two availability tables,
 * attached by the route with `toWireList`; `bookable` is computed by the route
 * from the other three (a timezone AND at least one open weekday) and is never
 * a column — `column` names `timezone` only so the schema check has something
 * to anchor on.
 */
export const WIRE_WORKSPACE_AVAILABILITY: WireEntity = {
  name: 'WorkspaceAvailability',
  table: 'workspaces',
  fields: {
    timezone: strOpt('timezone'),
    bookingLeadHours: int('booking_lead_hours'),
    bookingHorizonDays: int('booking_horizon_days'),
    travelBufferMinutes: int('travel_buffer_minutes'),
    concurrentJobs: int('concurrent_jobs'),
    bookable: { kind: 'boolean', column: 'timezone', fromRoute: true },
  },
  children: {
    week: WIRE_AVAILABILITY_DAY,
    exceptions: WIRE_AVAILABILITY_EXCEPTION,
  },
};

// ── Chat (GP-055) ────────────────────────────────────────────

export const WIRE_CHAT_ROOM: WireEntity = {
  name: 'ChatRoom',
  table: 'chat_rooms',
  fields: {
    id: str('id'),
    name: str('name'),
    entityType: strOpt('entity_type'),
    entityId: strOpt('entity_id'),
    createdBy: str('created_by'),
    createdAt: ts('created_at'),
  },
};

export const WIRE_CHAT_MESSAGE: WireEntity = {
  name: 'ChatMessage',
  table: 'chat_messages',
  fields: {
    id: str('id'),
    userId: str('user_id'),
    userName: str('user_name'),
    content: str('content'),
    createdAt: ts('created_at'),
  },
};

/** The per-user aggregate `GET /api/chat/unread` answers: a room plus a COUNT alias. */
export const WIRE_CHAT_UNREAD: WireEntity = {
  name: 'ChatUnread',
  table: 'chat_rooms',
  fields: {
    roomId: str('id'),
    name: str('name'),
    unreadCount: {
      kind: 'integer',
      column: 'id',
      derive: (row) => Number(row['unread_count'] ?? 0),
    },
  },
};

/** Every entity, for the schema/CHECK cross-checks in wire.spec.ts. */
export const WIRE_ENTITIES: readonly WireEntity[] = [
  WIRE_LEAD,
  WIRE_JOB,
  WIRE_JOB_LINE_ITEM,
  WIRE_SCHEDULE_BLOCK,
  WIRE_CUSTOMER,
  WIRE_OPPORTUNITY,
  WIRE_CAMPAIGN,
  WIRE_ESTIMATE,
  WIRE_CHANGE_ORDER_EVENT,
  WIRE_CHANGE_ORDER,
  WIRE_INVENTORY_TRANSACTION,
  WIRE_INVENTORY_ITEM,
  WIRE_VEHICLE,
  WIRE_REVIEW,
  WIRE_REVIEW_REQUEST,
  WIRE_PLUGIN,
  WIRE_PLUGIN_INSTALLATION,
  WIRE_INSTALLED_PLUGIN,
  WIRE_WEBHOOK_DELIVERY,
  WIRE_WEBHOOK,
  WIRE_API_KEY,
  WIRE_API_KEY_CREATED,
  WIRE_BRANDING,
  WIRE_NOTIFICATION_PREFERENCE,
  WIRE_WORKSPACE_USER,
  WIRE_WORKSPACE,
  WIRE_SUBSCRIPTION,
  WIRE_AVAILABILITY_DAY,
  WIRE_AVAILABILITY_EXCEPTION,
  WIRE_WORKSPACE_AVAILABILITY,
  WIRE_CHAT_ROOM,
  WIRE_CHAT_MESSAGE,
  WIRE_CHAT_UNREAD,
];

// ── Serialize: D1 row → the declared model ───────────────────

function zeroFor(field: WireField): unknown {
  switch (field.kind) {
    case 'string':
    case 'timestamp':
      return field.values ? field.values[0] : '';
    case 'number':
    case 'cents':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'json':
      return field.empty === 'object' ? {} : [];
  }
}

function coerce(field: WireField, value: unknown): unknown {
  switch (field.kind) {
    case 'string':
    case 'timestamp':
      return typeof value === 'string' ? value : String(value);
    case 'number':
      return Number(value);
    // Rounded, not truncated: a legacy REAL column can hold 2652.0000000001
    // and cents are whole by definition.
    case 'cents':
      return Math.round(Number(value));
    case 'integer':
      return Math.trunc(Number(value));
    case 'boolean':
      return value === true || value === 1 || value === '1';
    case 'json': {
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch {
        return zeroFor(field);
      }
    }
  }
}

function fieldValue(field: WireField, row: WireRow): unknown {
  if (field.derive) return field.derive(row);
  const raw = row[field.column];
  if (raw === null || raw === undefined) {
    // Optional in the model: omit the key rather than invent a value. A
    // column the endpoint did not SELECT lands here too, which is what makes
    // a narrow SELECT visible as an absent key instead of a plausible zero.
    return undefined;
  }
  return coerce(field, raw);
}

/**
 * Turn one D1 row into the model apps/platform reads. Columns the entity does
 * not name are dropped — the response body is exactly the declared model, so
 * `customers.stripe_customer_id` and `webhooks.secret` stop riding along in a
 * list, and a reader cannot come to depend on a column that was never part of
 * the contract.
 */
export function toWire<T>(entity: WireEntity, row: WireRow): T {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(entity.fields)) {
    if (isGroup(field)) {
      const nested: Record<string, unknown> = {};
      for (const [member, leaf] of Object.entries(field.group)) {
        const value = fieldValue(leaf, row);
        nested[member] = value === undefined ? zeroFor(leaf) : value;
      }
      out[name] = nested;
      continue;
    }
    if (field.fromRoute) continue;
    const value = fieldValue(field, row);
    if (value === undefined) {
      if (field.optional) continue;
      // Required by the model and NULL in the row. The live databases hold
      // NULLs in columns schema.sql declares NOT NULL (see
      // migrations/000-baseline-notnull.tsv), so this is reachable: hand out
      // the type's zero rather than a null the reader is not typed for.
      out[name] = zeroFor(field);
      continue;
    }
    out[name] = value;
  }
  return out as T;
}

export function toWireList<T>(
  entity: WireEntity,
  rows: readonly WireRow[] | undefined | null,
): T[] {
  return (rows ?? []).map((row) => toWire<T>(entity, row));
}

// ── Validate: a real response body → problems ────────────────

export interface WireProblem {
  readonly path: string;
  readonly problem: string;
}

function typeOfValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkLeaf(
  field: WireField,
  value: unknown,
  path: string,
  problems: WireProblem[],
): void {
  switch (field.kind) {
    case 'string':
    case 'timestamp':
      if (typeof value !== 'string') {
        problems.push({
          path,
          problem: `expected string, got ${typeOfValue(value)}`,
        });
        return;
      }
      if (field.values && !field.values.includes(value)) {
        problems.push({
          path,
          problem: `"${value}" is not one of ${field.values.join(', ')}`,
        });
      }
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        problems.push({
          path,
          problem: `expected a finite number, got ${JSON.stringify(value)}`,
        });
      }
      return;
    case 'cents':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        problems.push({
          path,
          problem: `expected a finite number of cents, got ${JSON.stringify(value)}`,
        });
        return;
      }
      if (!Number.isInteger(value)) {
        problems.push({
          path,
          problem: `money must be integer cents, got ${value} — a fractional amount means the value is in dollars`,
        });
      }
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        problems.push({
          path,
          problem: `expected an integer, got ${JSON.stringify(value)}`,
        });
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        problems.push({
          path,
          problem: `expected boolean, got ${typeOfValue(value)} (${JSON.stringify(value)}) — SQLite 0/1 must be converted`,
        });
      }
      return;
    case 'json': {
      const wanted = field.empty === 'object' ? 'object' : 'array';
      const actual = typeOfValue(value);
      if (wanted === 'array' ? actual !== 'array' : actual !== 'object') {
        problems.push({
          path,
          problem: `expected a parsed JSON ${wanted}, got ${actual} (${JSON.stringify(value)?.slice(0, 60)})`,
        });
      }
      return;
    }
  }
}

/**
 * Check a value the API actually produced against the contract. Reports every
 * problem rather than throwing on the first, and reports unexpected keys — so
 * a response is exactly the declared model, no more and no less.
 */
export function checkWire(
  entity: WireEntity,
  value: unknown,
  path = entity.name,
): WireProblem[] {
  const problems: WireProblem[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path, problem: `expected an object, got ${typeOfValue(value)}` }];
  }
  const record = value as Record<string, unknown>;

  for (const [name, field] of Object.entries(entity.fields)) {
    const at = `${path}.${name}`;
    const present = Object.prototype.hasOwnProperty.call(record, name);
    if (isGroup(field)) {
      if (!present) {
        problems.push({ path: at, problem: 'missing nested object' });
        continue;
      }
      const nested = record[name];
      if (
        typeof nested !== 'object' ||
        nested === null ||
        Array.isArray(nested)
      ) {
        problems.push({
          path: at,
          problem: `expected an object, got ${typeOfValue(nested)}`,
        });
        continue;
      }
      const nestedRecord = nested as Record<string, unknown>;
      for (const [member, leaf] of Object.entries(field.group)) {
        if (!Object.prototype.hasOwnProperty.call(nestedRecord, member)) {
          problems.push({ path: `${at}.${member}`, problem: 'missing' });
          continue;
        }
        checkLeaf(leaf, nestedRecord[member], `${at}.${member}`, problems);
      }
      for (const member of Object.keys(nestedRecord)) {
        if (!(member in field.group)) {
          problems.push({ path: `${at}.${member}`, problem: 'unexpected key' });
        }
      }
      continue;
    }
    if (!present) {
      if (!field.optional) problems.push({ path: at, problem: 'missing' });
      continue;
    }
    if (record[name] === undefined) {
      // JSON cannot carry undefined; a key present with undefined means the
      // object was built in memory and the field was never filled.
      problems.push({ path: at, problem: 'present but undefined' });
      continue;
    }
    checkLeaf(field, record[name], at, problems);
  }

  for (const key of Object.keys(record)) {
    if (key in entity.fields) continue;
    const child = entity.children?.[key];
    if (child) {
      const list = record[key];
      if (!Array.isArray(list)) {
        problems.push({
          path: `${path}.${key}`,
          problem: `expected an array of ${child.name}, got ${typeOfValue(list)}`,
        });
        continue;
      }
      list.forEach((item, index) => {
        problems.push(...checkWire(child, item, `${path}.${key}[${index}]`));
      });
      continue;
    }
    problems.push({
      path: `${path}.${key}`,
      problem: 'unexpected key — not part of the declared model',
    });
  }

  return problems;
}

/** `checkWire` over a list, with the index in each path. */
export function checkWireList(
  entity: WireEntity,
  values: unknown,
  path = entity.name,
): WireProblem[] {
  if (!Array.isArray(values)) {
    return [{ path, problem: `expected an array, got ${typeOfValue(values)}` }];
  }
  return values.flatMap((value, index) =>
    checkWire(entity, value, `${path}[${index}]`),
  );
}

/** One-line rendering of `checkWire` output, for test failure messages. */
export function describeWireProblems(problems: readonly WireProblem[]): string {
  return problems.map((p) => `${p.path}: ${p.problem}`).join('\n');
}
