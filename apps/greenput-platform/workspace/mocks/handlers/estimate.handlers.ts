import { http, HttpResponse, delay } from 'msw';
import {
  createEstimateResponse,
  createEmptyEstimateResponse,
  createEstimate,
} from '../data/estimates.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getEstimatesSuccess = http.get('*/api/estimates', async () => {
  return HttpResponse.json(createEstimateResponse());
});

export const createEstimateSuccess = http.post('*/api/estimates', async () => {
  return HttpResponse.json({ data: createEstimate() }, { status: 201 });
});

export const sendEstimateSuccess = http.post(
  '*/api/estimates/:id/send',
  async ({ params }) => {
    return HttpResponse.json({
      data: createEstimate({ id: params['id'] as string, status: 'sent' }),
    });
  },
);

export const acceptEstimateSuccess = http.post(
  '*/api/estimates/:id/accept',
  async ({ params }) => {
    return HttpResponse.json({
      data: createEstimate({ id: params['id'] as string, status: 'accepted' }),
    });
  },
);

// ── Empty handlers ──────────────────────────────────────────

export const getEstimatesEmpty = http.get('*/api/estimates', async () => {
  return HttpResponse.json(createEmptyEstimateResponse());
});

// ── Server Error handlers ───────────────────────────────────

export const getEstimatesError500 = http.get('*/api/estimates', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const getEstimatesSlow = http.get('*/api/estimates', async () => {
  await delay(2000);
  return HttpResponse.json(createEstimateResponse());
});

// ── Network Error handlers ──────────────────────────────────

export const getEstimatesNetworkError = http.get(
  '*/api/estimates',
  async () => {
    return HttpResponse.error();
  },
);

// ── Default export ──────────────────────────────────────────

export const estimateHandlers = [
  getEstimatesSuccess,
  createEstimateSuccess,
  sendEstimateSuccess,
  acceptEstimateSuccess,
];
