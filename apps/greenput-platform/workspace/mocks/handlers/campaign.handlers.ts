import { http, HttpResponse, delay } from 'msw';
import {
  createCampaignResponse,
  createEmptyCampaignResponse,
} from '../data/campaigns.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getCampaignsSuccess = http.get('*/api/campaigns', async () => {
  return HttpResponse.json(createCampaignResponse());
});

// ── Empty handlers ──────────────────────────────────────────

export const getCampaignsEmpty = http.get('*/api/campaigns', async () => {
  return HttpResponse.json(createEmptyCampaignResponse());
});

// ── Server Error handlers ───────────────────────────────────

export const getCampaignsError500 = http.get('*/api/campaigns', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const getCampaignsSlow = http.get('*/api/campaigns', async () => {
  await delay(2000);
  return HttpResponse.json(createCampaignResponse());
});

// ── Network Error handlers ──────────────────────────────────

export const getCampaignsNetworkError = http.get(
  '*/api/campaigns',
  async () => {
    return HttpResponse.error();
  },
);

// ── Default export ──────────────────────────────────────────

export const campaignHandlers = [getCampaignsSuccess];
