import type { ApiClient } from '@basenative/fetch';
import type {
  Address,
  ApiResponse,
  Job,
  ScheduleBlock,
  ShareableResponse,
} from '@greenput/shared/models';

export type JobListParams = {
  page?: number;
  perPage?: number;
  status?: string;
};

/**
 * What `PATCH /api/jobs/:id` accepts (`UpdateJobSchema`): any subset of the
 * job, `address` nested with any subset of its fields, and `assignedTo:
 * null` to unassign — absent leaves the technician alone (GP-034). A new
 * `scheduledStart` / `scheduledEnd` rebooks the job's `job_slots` in the
 * same batch and answers 409 `SLOT_TAKEN` when the time is gone (GP-104).
 * The detail route (GP-003) sends only what changed.
 */
export type JobPatch = Omit<Partial<Job>, 'address' | 'assignedTo'> & {
  readonly address?: Partial<Address>;
  readonly assignedTo?: string | null;
};

export interface JobsApi {
  list(params?: JobListParams): Promise<ApiResponse<Job[]>>;
  /** One job with its line items. */
  get(id: string): Promise<{ data: Job }>;
  schedule(
    start: string,
    end: string,
    techId?: string,
  ): Promise<{ data: ScheduleBlock[] }>;
  create(payload: Partial<Job>): Promise<{ data: Job }>;
  update(id: string, patch: JobPatch): Promise<{ data: Job }>;
  delete(id: string): Promise<{ data: { deleted: boolean } }>;
  /**
   * Mark invoiced. Answers `{ data, share }`: the public invoice link and a
   * message for the contractor to send THEMSELVES (GP-008) — nothing is
   * sent by the API, and `share` is absent when the workspace has no site.
   */
  invoice(id: string): Promise<ShareableResponse<Job>>;
  markPaid(id: string): Promise<{ data: Job }>;
}

export function createJobsApi(api: ApiClient): JobsApi {
  return {
    list: (params = {}) => api.get('/api/jobs', params),
    schedule: (start, end, techId) => {
      const query: Record<string, string | undefined> = { start, end };
      if (techId !== undefined) query['techId'] = techId;
      return api.get('/api/jobs/schedule', query);
    },
    get: (id) => api.get(`/api/jobs/${id}`),
    create: (payload) => api.post('/api/jobs', payload),
    update: (id, patch) => api.patch(`/api/jobs/${id}`, patch),
    delete: (id) => api.delete(`/api/jobs/${id}`),
    invoice: (id) => api.post(`/api/jobs/${id}/invoice`, {}),
    markPaid: (id) => api.post(`/api/jobs/${id}/paid`, {}),
  };
}
