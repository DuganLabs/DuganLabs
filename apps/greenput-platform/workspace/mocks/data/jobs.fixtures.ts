import type { Job, JobStatus, ApiResponse } from '@greenput/shared/models';

let counter = 0;

export function createJob(overrides: Partial<Job> = {}): Job {
  counter++;
  return {
    id: `job-${counter}`,
    opportunityId: `opp-${counter}`,
    customerId: `cust-${counter}`,
    jobNumber: `JOB-${String(counter).padStart(4, '0')}`,
    title: `Job ${counter}`,
    status: 'scheduled' as JobStatus,
    address: {
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
    },
    scheduledStart: '2025-02-01T09:00:00Z',
    scheduledEnd: '2025-02-01T17:00:00Z',
    lineItems: [
      {
        id: `li-${counter}`,
        description: 'Labor',
        quantity: 8,
        unitPrice: 7500, // $75.00 in cents
        total: 60000,
      },
    ],
    total: 60000, // $600.00 in cents
    notes: '',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

export function createJobList(n: number, overrides: Partial<Job> = {}): Job[] {
  return Array.from({ length: n }, () => createJob(overrides));
}

export function createJobResponse(
  jobs: Job[] = createJobList(3),
): ApiResponse<Job[]> {
  return {
    data: jobs,
    meta: { total: jobs.length, page: 1, perPage: 25 },
  };
}

export function createEmptyJobResponse(): ApiResponse<Job[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  };
}

export function resetJobCounter(): void {
  counter = 0;
}
