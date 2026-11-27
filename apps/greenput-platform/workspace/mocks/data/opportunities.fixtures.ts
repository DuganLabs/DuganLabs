import type {
  Opportunity,
  OpportunityStatus,
  ApiResponse,
} from '@greenput/shared/models';

let counter = 0;

export function createOpportunity(
  overrides: Partial<Opportunity> = {},
): Opportunity {
  counter++;
  return {
    id: `opp-${counter}`,
    leadId: `lead-${counter}`,
    title: `Opportunity ${counter}`,
    status: 'open' as OpportunityStatus,
    value: 1500000, // $15,000.00 in cents
    serviceType: 'Roofing',
    notes: '',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

export function createOpportunityList(
  n: number,
  overrides: Partial<Opportunity> = {},
): Opportunity[] {
  return Array.from({ length: n }, () => createOpportunity(overrides));
}

export function createOpportunityResponse(
  opps: Opportunity[] = createOpportunityList(3),
): ApiResponse<Opportunity[]> {
  return {
    data: opps,
    meta: { total: opps.length, page: 1, perPage: 25 },
  };
}

export function createEmptyOpportunityResponse(): ApiResponse<Opportunity[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  };
}

export function resetOpportunityCounter(): void {
  counter = 0;
}
