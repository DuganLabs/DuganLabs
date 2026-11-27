// ─────────────────────────────────────────────────────────────
// e2e response fixtures, built from D1 ROWS through the API's own serializer.
//
// Every spec in ../src intercepts `**/api/**` and serves a body written by
// hand. That is how the outage survived sixteen green e2e specs: the bodies
// were invented in whatever shape seemed right, so they agreed with neither
// the API (flat snake_case rows) nor the platform (nested camelCase models) —
// the customers fixture, for instance, had a top-level `email` while the page
// reads `customer.contact.email`, and nothing asserted on the rendered value,
// so it passed.
//
// Here a fixture starts as a snake_case ROW — exactly what D1 holds — and is
// turned into a response body by `toWire`, the same function apps/api answers
// with (apps/api/src/lib/serialize.ts). A fixture therefore cannot be in a
// shape the API does not produce, and when the contract changes these change
// with it.
//
// Amounts in rows are INTEGER CENTS, the canonical unit. See the MONEY note in
// libs/shared/models/src/wire.ts.
// ─────────────────────────────────────────────────────────────

import {
  toWireList,
  WIRE_CAMPAIGN,
  WIRE_CUSTOMER,
  WIRE_ESTIMATE,
  WIRE_INVENTORY_ITEM,
  WIRE_JOB,
  WIRE_SCHEDULE_BLOCK,
  WIRE_JOB_LINE_ITEM,
  WIRE_LEAD,
  WIRE_OPPORTUNITY,
  WIRE_REVIEW,
  WIRE_VEHICLE,
  type WireEntity,
  type WireRow,
} from '@greenput/shared/models';

export interface ListResponse {
  data: unknown[];
  meta: { total: number; page: number; perPage: number };
}

const WORKSPACE = 'test-workspace-1';
const USER = 'test-user-1';
const AUDIT = {
  workspace_id: WORKSPACE,
  created_at: '2026-04-01T10:00:00.000Z',
  updated_at: '2026-04-01T10:00:00.000Z',
  created_by: USER,
};

function list(
  entity: WireEntity,
  rows: readonly WireRow[],
  extras: (row: WireRow) => Record<string, unknown> = () => ({}),
): ListResponse {
  const data = toWireList<Record<string, unknown>>(entity, rows).map(
    (item, index) => ({ ...item, ...extras(rows[index] as WireRow) }),
  );
  return { data, meta: { total: data.length, page: 1, perPage: 25 } };
}

export const emptyList: ListResponse = {
  data: [],
  meta: { total: 0, page: 1, perPage: 25 },
};

// ── Rows ─────────────────────────────────────────────────────

export function leadRow(overrides: WireRow = {}): WireRow {
  return {
    ...AUDIT,
    id: 'lead-1',
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    phone: '5551234567',
    preferred_contact: 'email',
    street: '1 Oak St',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    status: 'new',
    source: 'website',
    campaign_id: null,
    service_type: 'Roofing',
    estimated_value: 265213,
    notes: '',
    converted_to_opportunity_id: null,
    qualified_at: null,
    accepted_at: null,
    withdrawn_at: null,
    ...overrides,
  };
}

export function customerRow(overrides: WireRow = {}): WireRow {
  return {
    ...AUDIT,
    id: 'cust-1',
    first_name: 'Alice',
    last_name: 'Smith',
    company: 'Smith LLC',
    email: 'alice@example.com',
    phone: '5559876543',
    preferred_contact: 'phone',
    street: '456 Oak Ave',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    notes: '',
    consent_given_at: null,
    consent_method: null,
    total_job_value: 500000,
    job_count: 2,
    ...overrides,
  };
}

export function jobRow(overrides: WireRow = {}): WireRow {
  return {
    ...AUDIT,
    id: 'job-1',
    opportunity_id: 'opp-1',
    customer_id: 'cust-1',
    job_number: '#1001',
    title: 'HVAC Installation',
    status: 'scheduled',
    street: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    scheduled_start: '2026-04-10T09:00:00.000Z',
    scheduled_end: '2026-04-10T17:00:00.000Z',
    actual_start: null,
    actual_end: null,
    total: 250000,
    notes: '',
    invoiced_at: null,
    paid_at: null,
    ...overrides,
  };
}

export function opportunityRow(overrides: WireRow = {}): WireRow {
  return {
    ...AUDIT,
    id: 'opp-1',
    lead_id: 'lead-1',
    customer_id: 'cust-1',
    title: 'HVAC Installation',
    status: 'open',
    value: 250000,
    service_type: 'HVAC',
    notes: '',
    proposal_sent_at: null,
    closed_at: null,
    converted_to_job_id: null,
    ...overrides,
  };
}

export function campaignRow(overrides: WireRow = {}): WireRow {
  return {
    ...AUDIT,
    id: 'camp-1',
    name: 'Spring Promo',
    status: 'active',
    channel: 'email',
    target_area: '62701',
    budget: 150000,
    spent: 68000,
    leads_generated: 12,
    // The alias every campaign read SELECTs; `leadCount` derives from it.
    lead_count: 12,
    start_date: '2026-03-01T00:00:00.000Z',
    end_date: null,
    notes: '',
    ...overrides,
  };
}

export function estimateRow(overrides: WireRow = {}): WireRow {
  return {
    ...AUDIT,
    id: 'est-1',
    opportunity_id: 'opp-1',
    customer_id: 'cust-1',
    estimate_number: 'EST-1001',
    title: 'HVAC Installation',
    status: 'draft',
    line_items: '[]',
    subtotal: 245000,
    tax_rate: 8.25,
    tax_amount: 20213,
    total: 265213,
    notes: '',
    valid_until: null,
    sent_at: null,
    accepted_at: null,
    rejected_at: null,
    ...overrides,
  };
}

export function inventoryRow(overrides: WireRow = {}): WireRow {
  return {
    id: 'item-1',
    workspace_id: WORKSPACE,
    name: '12/2 Romex',
    sku: 'ROMEX-12-2',
    description: '',
    category: 'wire',
    quantity: 40,
    min_quantity: 10,
    unit_cost: 12900,
    unit_price: 19900,
    supplier: 'Supply Co',
    location: 'Van 1',
    created_at: AUDIT.created_at,
    updated_at: AUDIT.updated_at,
    ...overrides,
  };
}

export function vehicleRow(overrides: WireRow = {}): WireRow {
  return {
    id: 'veh-1',
    workspace_id: WORKSPACE,
    name: 'Van 1',
    make: 'Ford',
    model: 'Transit',
    year: 2022,
    license_plate: 'IL-1234',
    vin: null,
    status: 'active',
    mileage: 42000,
    notes: '',
    created_at: AUDIT.created_at,
    updated_at: AUDIT.updated_at,
    ...overrides,
  };
}

export function reviewRow(overrides: WireRow = {}): WireRow {
  return {
    id: 'rev-1',
    workspace_id: WORKSPACE,
    customer_id: 'cust-1',
    job_id: 'job-1',
    platform: 'google',
    rating: 5,
    content: 'Great work',
    author_name: 'Alice S.',
    review_url: null,
    responded: 0,
    response_text: null,
    fetched_at: null,
    created_at: AUDIT.created_at,
    ...overrides,
  };
}

// ── Responses ────────────────────────────────────────────────

export const leadsResponse = (rows: readonly WireRow[] = [leadRow()]) =>
  list(WIRE_LEAD, rows);

export const customersResponse = (rows: readonly WireRow[] = [customerRow()]) =>
  list(WIRE_CUSTOMER, rows);

/** `Job.lineItems` comes from a second query, so the route attaches it. */
export const jobsResponse = (
  rows: readonly WireRow[] = [jobRow()],
  lineItemsByJob: Record<string, readonly WireRow[]> = {},
) =>
  list(WIRE_JOB, rows, (row) => ({
    lineItems: toWireList(
      WIRE_JOB_LINE_ITEM,
      lineItemsByJob[String(row['id'])] ?? [],
    ),
  }));

/** `GET /api/jobs/schedule`: the calendar's week, no pagination envelope. */
export const scheduleResponse = (rows: readonly WireRow[] = [jobRow()]) => ({
  data: toWireList(WIRE_SCHEDULE_BLOCK, rows),
});
export const opportunitiesResponse = (
  rows: readonly WireRow[] = [opportunityRow()],
) => list(WIRE_OPPORTUNITY, rows);

export const campaignsResponse = (rows: readonly WireRow[] = [campaignRow()]) =>
  list(WIRE_CAMPAIGN, rows);

export const estimatesResponse = (rows: readonly WireRow[] = [estimateRow()]) =>
  list(WIRE_ESTIMATE, rows);

export const inventoryResponse = (
  rows: readonly WireRow[] = [inventoryRow()],
) => list(WIRE_INVENTORY_ITEM, rows);

export const vehiclesResponse = (rows: readonly WireRow[] = [vehicleRow()]) =>
  list(WIRE_VEHICLE, rows);

export const reviewsResponse = (rows: readonly WireRow[] = [reviewRow()]) =>
  list(WIRE_REVIEW, rows);

/** `GET /api/auth/me`, which every page fetches before it renders anything. */
export const mockUser = {
  data: {
    user: {
      id: USER,
      email: 'test@greenput.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'owner',
      workspaceId: WORKSPACE,
    },
  },
};

// ── Interception ─────────────────────────────────────────────

/**
 * Serve a map of URL fragments to response bodies for every `/api/` call, with
 * `/api/auth/me` and a `{ data: null }` catch-all already in place. The first
 * fragment the request URL contains wins, so put more specific paths first
 * ('/api/jobs/schedule' before '/api/jobs').
 */
export async function mockApi(
  page: import('@playwright/test').Page,
  routes: ReadonlyArray<readonly [string, unknown]>,
): Promise<void> {
  await page.unrouteAll();
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const body = url.includes('/api/auth/me')
      ? mockUser
      : (routes.find(([fragment]) => url.includes(fragment))?.[1] ?? {
          data: null,
        });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}
