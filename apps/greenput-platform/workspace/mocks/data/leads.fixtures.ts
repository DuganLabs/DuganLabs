import type {
  Lead,
  LeadStatus,
  LeadSource,
  ApiResponse,
} from '@greenput/shared/models';

let counter = 0;

export function createLead(overrides: Partial<Lead> = {}): Lead {
  counter++;
  return {
    id: `lead-${counter}`,
    firstName: `First${counter}`,
    lastName: `Last${counter}`,
    contact: {
      email: `lead${counter}@example.com`,
      phone: '555-0100',
      preferredContact: 'email',
    },
    status: 'new' as LeadStatus,
    source: 'website' as LeadSource,
    notes: '',
    serviceType: 'Roofing',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

export function createLeadList(
  n: number,
  overrides: Partial<Lead> = {},
): Lead[] {
  return Array.from({ length: n }, () => createLead(overrides));
}

export function createLeadResponse(
  leads: Lead[] = createLeadList(3),
): ApiResponse<Lead[]> {
  return {
    data: leads,
    meta: { total: leads.length, page: 1, perPage: 25 },
  };
}

export function createEmptyLeadResponse(): ApiResponse<Lead[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  };
}

export function createLeadValidationError(): {
  code: string;
  message: string;
  field: string;
} {
  return {
    code: 'VALIDATION_ERROR',
    message: 'firstName is required',
    field: 'firstName',
  };
}

export function resetLeadCounter(): void {
  counter = 0;
}
