import { http, HttpResponse, delay } from 'msw';
import {
  createReviewResponse,
  createEmptyReviewResponse,
  createReviewStats,
  createReviewRequestResponse,
} from '../data/reviews.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getReviewsSuccess = http.get(
  '*/api/reviews',
  async ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/stats')) {
      return HttpResponse.json({ data: createReviewStats() });
    }
    if (url.pathname.endsWith('/requests')) {
      return HttpResponse.json(createReviewRequestResponse());
    }
    return HttpResponse.json(createReviewResponse());
  },
);

export const getReviewStatsSuccess = http.get(
  '*/api/reviews/stats',
  async () => {
    return HttpResponse.json({ data: createReviewStats() });
  },
);

export const getReviewRequestsSuccess = http.get(
  '*/api/reviews/requests',
  async () => {
    return HttpResponse.json(createReviewRequestResponse());
  },
);

// ── Empty handlers ──────────────────────────────────────────

export const getReviewsEmpty = http.get('*/api/reviews', async () => {
  return HttpResponse.json(createEmptyReviewResponse());
});

// ── Error handlers ──────────────────────────────────────────

export const getReviewsError500 = http.get('*/api/reviews', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const getReviewsSlow = http.get('*/api/reviews', async () => {
  await delay(2000);
  return HttpResponse.json(createReviewResponse());
});

// ── Default export ──────────────────────────────────────────

export const reviewHandlers = [
  getReviewStatsSuccess,
  getReviewRequestsSuccess,
  getReviewsSuccess,
];
