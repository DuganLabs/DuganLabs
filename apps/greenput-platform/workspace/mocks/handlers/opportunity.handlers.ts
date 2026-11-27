import { http, HttpResponse, delay } from 'msw';
import {
  createOpportunity,
  createOpportunityResponse,
  createEmptyOpportunityResponse,
} from '../data/opportunities.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getOpportunitiesSuccess = http.get(
  '*/api/opportunities',
  async () => {
    return HttpResponse.json(createOpportunityResponse());
  },
);

export const createOpportunitySuccess = http.post(
  '*/api/opportunities',
  async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      { data: createOpportunity(body) },
      { status: 201 },
    );
  },
);

export const updateOpportunitySuccess = http.patch(
  '*/api/opportunities/:id',
  async ({ params, request }) => {
    const id = params['id'] as string;
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ data: createOpportunity({ id, ...body }) });
  },
);

// ── Empty handlers ──────────────────────────────────────────

export const getOpportunitiesEmpty = http.get(
  '*/api/opportunities',
  async () => {
    return HttpResponse.json(createEmptyOpportunityResponse());
  },
);

// ── Validation error handlers ───────────────────────────────

export const createOpportunityValidation422 = http.post(
  '*/api/opportunities',
  async () => {
    return HttpResponse.json(
      {
        errors: [
          {
            code: 'VALIDATION_ERROR',
            message: 'title is required',
            field: 'title',
          },
        ],
      },
      { status: 422 },
    );
  },
);

// ── Not Found handlers ──────────────────────────────────────

export const updateOpportunityNotFound = http.patch(
  '*/api/opportunities/:id',
  async () => {
    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  },
);

// ── Server Error handlers ───────────────────────────────────

export const getOpportunitiesError500 = http.get(
  '*/api/opportunities',
  async () => {
    return HttpResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  },
);

// ── Slow handlers ───────────────────────────────────────────

export const getOpportunitiesSlow = http.get(
  '*/api/opportunities',
  async () => {
    await delay(2000);
    return HttpResponse.json(createOpportunityResponse());
  },
);

// ── Network Error handlers ──────────────────────────────────

export const getOpportunitiesNetworkError = http.get(
  '*/api/opportunities',
  async () => {
    return HttpResponse.error();
  },
);

// ── Default export ──────────────────────────────────────────

export const opportunityHandlers = [
  getOpportunitiesSuccess,
  createOpportunitySuccess,
  updateOpportunitySuccess,
];
