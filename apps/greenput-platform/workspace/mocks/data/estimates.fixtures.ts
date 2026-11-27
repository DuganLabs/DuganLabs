import type {
  Estimate,
  EstimateStatus,
  ApiResponse,
} from '@greenput/shared/models';

let counter = 0;

export function createEstimate(overrides: Partial<Estimate> = {}): Estimate {
  counter++;
  return {
    id: `est-${counter}`,
    opportunityId: `opp-1`,
    estimateNumber: `E-${1000 + counter}`,
    title: `Estimate ${counter}`,
    status: 'draft' as EstimateStatus,
    lineItems: [
      {
        id: `li-${counter}-1`,
        description: 'Labor',
        quantity: 4,
        unitPrice: 7500, // $75.00 in cents
        total: 30000,
      },
      {
        id: `li-${counter}-2`,
        description: 'Materials',
        quantity: 1,
        unitPrice: 20000, // $200.00 in cents
        total: 20000,
      },
    ],
    subtotal: 50000, // $500.00 in cents
    taxRate: 8,
    taxAmount: 4000, // 8% of 50000 cents
    total: 54000,
    notes: '',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

export function createEstimateList(
  n: number,
  overrides: Partial<Estimate> = {},
): Estimate[] {
  return Array.from({ length: n }, () => createEstimate(overrides));
}

export function createEstimateResponse(
  estimates: Estimate[] = createEstimateList(3),
): ApiResponse<Estimate[]> {
  return {
    data: estimates,
    meta: { total: estimates.length, page: 1, perPage: 25 },
  };
}

export function createEmptyEstimateResponse(): ApiResponse<Estimate[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  };
}

export function resetEstimateCounter(): void {
  counter = 0;
}
