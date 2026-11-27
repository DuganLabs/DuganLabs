import type { Customer, ApiResponse } from '@greenput/shared/models';

let counter = 0;

export function createCustomer(overrides: Partial<Customer> = {}): Customer {
  counter++;
  return {
    id: `cust-${counter}`,
    firstName: `Customer${counter}`,
    lastName: `Jones${counter}`,
    contact: {
      email: `customer${counter}@example.com`,
      phone: '555-0200',
      preferredContact: 'email',
    },
    address: {
      street: '456 Oak Ave',
      city: 'Springfield',
      state: 'IL',
      zip: '62702',
    },
    notes: '',
    totalJobValue: 5000,
    jobCount: 2,
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

export function createCustomerList(
  n: number,
  overrides: Partial<Customer> = {},
): Customer[] {
  return Array.from({ length: n }, () => createCustomer(overrides));
}

export function createCustomerResponse(
  customers: Customer[] = createCustomerList(3),
): ApiResponse<Customer[]> {
  return {
    data: customers,
    meta: { total: customers.length, page: 1, perPage: 25 },
  };
}

export function createEmptyCustomerResponse(): ApiResponse<Customer[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  };
}

export function resetCustomerCounter(): void {
  counter = 0;
}
