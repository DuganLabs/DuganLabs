import { http, HttpResponse, delay } from 'msw';
import {
  createLead,
  createLeadResponse,
  createEmptyLeadResponse,
  createLeadValidationError,
} from '../data/leads.fixtures';

const BASE = '*/api/leads*';

// ── Success handlers ────────────────────────────────────────

export const getLeadsSuccess = http.get('*/api/leads', async () => {
  return HttpResponse.json(createLeadResponse());
});

export const getLeadByIdSuccess = http.get(
  '*/api/leads/:id',
  async ({ params }) => {
    const id = params['id'] as string;
    return HttpResponse.json({ data: createLead({ id }) });
  },
);

export const createLeadSuccess = http.post(
  '*/api/leads',
  async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ data: createLead(body) }, { status: 201 });
  },
);

export const updateLeadSuccess = http.patch(
  '*/api/leads/:id',
  async ({ params, request }) => {
    const id = params['id'] as string;
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ data: createLead({ id, ...body }) });
  },
);

export const deleteLeadSuccess = http.delete('*/api/leads/:id', async () => {
  return HttpResponse.json({ data: { deleted: true } }, { status: 200 });
});

export const convertLeadSuccess = http.post(
  '*/api/leads/:id/convert',
  async () => {
    return HttpResponse.json({ data: { opportunityId: 'opp-new-1' } });
  },
);

// ── Empty handlers ──────────────────────────────────────────

export const getLeadsEmpty = http.get('*/api/leads', async () => {
  return HttpResponse.json(createEmptyLeadResponse());
});

// ── Validation error handlers ───────────────────────────────

export const createLeadValidation422 = http.post('*/api/leads', async () => {
  return HttpResponse.json(
    { errors: [createLeadValidationError()] },
    { status: 422 },
  );
});

// ── Not Found handlers ──────────────────────────────────────

export const getLeadNotFound = http.get('*/api/leads/:id', async () => {
  return HttpResponse.json({ message: 'Not found' }, { status: 404 });
});

export const updateLeadNotFound = http.patch('*/api/leads/:id', async () => {
  return HttpResponse.json({ message: 'Not found' }, { status: 404 });
});

export const deleteLeadNotFound = http.delete('*/api/leads/:id', async () => {
  return HttpResponse.json({ message: 'Not found' }, { status: 404 });
});

// ── Server Error handlers ───────────────────────────────────

export const getLeadsError500 = http.get('*/api/leads', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

export const getLeadError500 = http.get('*/api/leads/:id', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const getLeadsSlow = http.get('*/api/leads', async () => {
  await delay(2000);
  return HttpResponse.json(createLeadResponse());
});

// ── Network Error handlers ──────────────────────────────────

export const getLeadsNetworkError = http.get('*/api/leads', async () => {
  return HttpResponse.error();
});

// ── Default export (success scenarios) ──────────────────────

export const leadHandlers = [
  getLeadsSuccess,
  getLeadByIdSuccess,
  createLeadSuccess,
  updateLeadSuccess,
  deleteLeadSuccess,
  convertLeadSuccess,
];
