import { http, HttpResponse, delay } from 'msw';
import {
  createJobResponse,
  createEmptyJobResponse,
} from '../data/jobs.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getJobsSuccess = http.get('*/api/jobs', async () => {
  return HttpResponse.json(createJobResponse());
});

// ── Empty handlers ──────────────────────────────────────────

export const getJobsEmpty = http.get('*/api/jobs', async () => {
  return HttpResponse.json(createEmptyJobResponse());
});

// ── Server Error handlers ───────────────────────────────────

export const getJobsError500 = http.get('*/api/jobs', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const getJobsSlow = http.get('*/api/jobs', async () => {
  await delay(2000);
  return HttpResponse.json(createJobResponse());
});

// ── Network Error handlers ──────────────────────────────────

export const getJobsNetworkError = http.get('*/api/jobs', async () => {
  return HttpResponse.error();
});

// ── Default export ──────────────────────────────────────────

export const jobHandlers = [getJobsSuccess];
