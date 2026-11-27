import { http, HttpResponse, delay } from 'msw';
import {
  createCustomer,
  createCustomerResponse,
  createEmptyCustomerResponse,
} from '../data/customers.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getCustomersSuccess = http.get('*/api/customers', async () => {
  return HttpResponse.json(createCustomerResponse());
});

export const getCustomerByIdSuccess = http.get(
  '*/api/customers/:id',
  async ({ params }) => {
    const id = params['id'] as string;
    return HttpResponse.json({ data: createCustomer({ id }) });
  },
);

// ── Empty handlers ──────────────────────────────────────────

export const getCustomersEmpty = http.get('*/api/customers', async () => {
  return HttpResponse.json(createEmptyCustomerResponse());
});

// ── Not Found handlers ──────────────────────────────────────

export const getCustomerNotFound = http.get('*/api/customers/:id', async () => {
  return HttpResponse.json({ message: 'Not found' }, { status: 404 });
});

// ── Server Error handlers ───────────────────────────────────

export const getCustomersError500 = http.get('*/api/customers', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const getCustomersSlow = http.get('*/api/customers', async () => {
  await delay(2000);
  return HttpResponse.json(createCustomerResponse());
});

// ── Network Error handlers ──────────────────────────────────

export const getCustomersNetworkError = http.get(
  '*/api/customers',
  async () => {
    return HttpResponse.error();
  },
);

// ── Default export ──────────────────────────────────────────

export const customerHandlers = [getCustomersSuccess, getCustomerByIdSuccess];
