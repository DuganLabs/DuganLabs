import { http, HttpResponse, delay } from 'msw';
import {
  createAuditResponse,
  createEmptyAuditResponse,
} from '../data/activity.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getAuditSuccess = http.get('*/api/audit', async () => {
  return HttpResponse.json(createAuditResponse());
});

// ── Empty handlers ──────────────────────────────────────────

export const getAuditEmpty = http.get('*/api/audit', async () => {
  return HttpResponse.json(createEmptyAuditResponse());
});

// ── Error handlers ──────────────────────────────────────────

export const getAuditError500 = http.get('*/api/audit', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const getAuditSlow = http.get('*/api/audit', async () => {
  await delay(2000);
  return HttpResponse.json(createAuditResponse());
});

// ── Default export ──────────────────────────────────────────

export const activityHandlers = [getAuditSuccess];
