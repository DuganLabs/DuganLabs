import type { ApiClient } from '@basenative/fetch';
import type {
  Address,
  ApiResponse,
  ContactInfo,
  Lead,
  LeadWithdrawnReason,
} from '@greenput/shared/models';

export type LeadListParams = {
  page?: number;
  perPage?: number;
  q?: string;
  status?: string;
  source?: string;
};

/**
 * The row `recordLeadMeter()` writes when a lead BOOKS (WS-1) — the
 * shape schedule-aware delivery creates at booking commit
 * (apps/api/src/lib/lead-meter.ts `LeadMeterEvent`). Accept no longer
 * returns one: its `meterEvent` is always null.
 */
export interface LeadMeterEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly leadId: string;
  readonly vertical: string;
  /** Whole US dollars — NOT cents (CLAUDE.md §5.0.1). */
  readonly priceUsd: number;
  readonly status: 'pending' | 'invoiced' | 'refunded' | 'waived';
  readonly inserted: boolean;
}

/**
 * `POST /api/leads/:id/accept` — idempotent state transition. Since
 * WS-1 the fee bills at booking, never at accept, so `meterEvent` and
 * `charge` are always null; the fields stay for shape compatibility.
 */
export interface AcceptLeadResult {
  readonly lead: Lead | null;
  /** Always `null` — accept creates no meter event (WS-1). */
  readonly meterEvent: LeadMeterEvent | null;
  readonly alreadyAccepted: boolean;
  /** Always `null` — accept charges nothing (WS-1). */
  readonly charge?: {
    readonly outcome: string;
    readonly paymentStatus: string | null;
  } | null;
}

/**
 * `POST /api/leads/:id/withdraw` — optional `{ reason }` from the closed set
 * on `leads.withdrawn_reason` (GP-105); no body records none.
 * `meterEventAdjustment` says what happened to the fee: `none` (nothing was
 * owed yet, or already withdrawn), `left_unchanged` (a booking fee exists
 * and stands — pending stays collectible, invoiced untouched; a refund is
 * a manual FR-1.4 decision, not made here). `waived` stays in the union
 * for historical rows only: since WS-1 a withdrawal never produces it.
 * The fee outcome never depends on the reason.
 */
export interface WithdrawLeadResult {
  readonly lead: Lead | null;
  readonly meterEventAdjustment: 'none' | 'waived' | 'left_unchanged';
}

/** `GET /api/leads/:id/fee` — the figure a booking will bill, quoted first. */
export interface LeadFee {
  readonly leadId: string;
  readonly vertical: string;
  /** Whole US dollars — NOT cents (CLAUDE.md §5.0.1). */
  readonly priceUsd: number;
  /**
   * Whether this workspace may accept right now. Absent on an older
   * response; the dialog then still enables Confirm once the price is shown.
   */
  readonly receive?: {
    readonly ok: boolean;
    readonly code?: 'CARD_REQUIRED' | 'DELIVERY_PAUSED';
    readonly message?: string;
  };
}

/**
 * What `PATCH /api/leads/:id` accepts: any subset of the lead, and inside
 * `contact` / `address` any subset of their fields — `UpdateLeadSchema`
 * folds the nested keys it was sent onto the columns and leaves the rest
 * alone. The detail route (GP-003) sends only what changed.
 */
export type LeadPatch = Omit<Partial<Lead>, 'contact' | 'address'> & {
  readonly contact?: Partial<ContactInfo>;
  readonly address?: Partial<Address>;
};

export interface LeadsApi {
  list(params?: LeadListParams): Promise<ApiResponse<Lead[]>>;
  get(id: string): Promise<{ data: Lead }>;
  create(payload: Partial<Lead>): Promise<{ data: Lead }>;
  update(id: string, patch: LeadPatch): Promise<{ data: Lead }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
  convert(
    id: string,
    payload?: { title?: string; value?: number },
  ): Promise<{ data: { opportunityId: string } }>;
  /** Stamp `qualifiedAt`; idempotent. */
  qualify(id: string): Promise<{ data: Lead }>;
  /** The per-lead fee a booking will record — read it before offering the click. */
  fee(id: string): Promise<{ data: LeadFee }>;
  /** A state transition, not a billing event (WS-1). Idempotent: see `AcceptLeadResult.alreadyAccepted`. */
  accept(id: string): Promise<{ data: AcceptLeadResult }>;
  /** The reason is recorded for the owner, not adjudicated; omit it when none was given. */
  withdraw(
    id: string,
    reason?: LeadWithdrawnReason,
  ): Promise<{ data: WithdrawLeadResult }>;
}

export function createLeadsApi(api: ApiClient): LeadsApi {
  return {
    list: (params = {}) => api.get('/api/leads', params),
    get: (id) => api.get(`/api/leads/${id}`),
    create: (payload) => api.post('/api/leads', payload),
    update: (id, patch) => api.patch(`/api/leads/${id}`, patch),
    delete: (id) => api.delete(`/api/leads/${id}`),
    convert: (id, payload = {}) =>
      api.post(`/api/leads/${id}/convert`, payload),
    qualify: (id) => api.post(`/api/leads/${id}/qualify`),
    fee: (id) => api.get(`/api/leads/${id}/fee`),
    accept: (id) => api.post(`/api/leads/${id}/accept`),
    withdraw: (id, reason) =>
      api.post(`/api/leads/${id}/withdraw`, reason ? { reason } : undefined),
  };
}
