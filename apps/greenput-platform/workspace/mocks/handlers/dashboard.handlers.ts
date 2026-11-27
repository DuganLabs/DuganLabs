import { http, HttpResponse, delay } from 'msw';
import {
  createDashboardStats,
  createEmptyDashboardStats,
} from '../data/dashboard.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getDashboardStatsSuccess = http.get(
  '*/api/dashboard/stats',
  async () => {
    return HttpResponse.json({ data: createDashboardStats() });
  },
);

// ── Empty handlers ──────────────────────────────────────────

export const getDashboardStatsEmpty = http.get(
  '*/api/dashboard/stats',
  async () => {
    return HttpResponse.json({ data: createEmptyDashboardStats() });
  },
);

// ── Server Error handlers ───────────────────────────────────

export const getDashboardStatsError500 = http.get(
  '*/api/dashboard/stats',
  async () => {
    return HttpResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  },
);

// ── Slow handlers ───────────────────────────────────────────

export const getDashboardStatsSlow = http.get(
  '*/api/dashboard/stats',
  async () => {
    await delay(2000);
    return HttpResponse.json({ data: createDashboardStats() });
  },
);

// ── Network Error handlers ──────────────────────────────────

export const getDashboardStatsNetworkError = http.get(
  '*/api/dashboard/stats',
  async () => {
    return HttpResponse.error();
  },
);

// ── Default export ──────────────────────────────────────────

export const dashboardHandlers = [getDashboardStatsSuccess];
