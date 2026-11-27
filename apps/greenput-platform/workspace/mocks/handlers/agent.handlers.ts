import { http, HttpResponse, delay } from 'msw';
import { createAgentList } from '../data/agents.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getAgentsSuccess = http.get('*/api/agents', async () => {
  return HttpResponse.json({ data: createAgentList(3) });
});

// ── Empty handlers ──────────────────────────────────────────

export const getAgentsEmpty = http.get('*/api/agents', async () => {
  return HttpResponse.json({ data: [] });
});

// ── Server Error handlers ───────────────────────────────────

export const getAgentsError500 = http.get('*/api/agents', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const getAgentsSlow = http.get('*/api/agents', async () => {
  await delay(2000);
  return HttpResponse.json({ data: createAgentList(3) });
});

// ── Network Error handlers ──────────────────────────────────

export const getAgentsNetworkError = http.get('*/api/agents', async () => {
  return HttpResponse.error();
});

// ── Default export ──────────────────────────────────────────

export const agentHandlers = [getAgentsSuccess];
