import type {
  Campaign,
  CampaignStatus,
  CampaignChannel,
  ApiResponse,
} from '@greenput/shared/models';

let counter = 0;

export function createCampaign(overrides: Partial<Campaign> = {}): Campaign {
  counter++;
  return {
    id: `camp-${counter}`,
    name: `Campaign ${counter}`,
    status: 'active' as CampaignStatus,
    channel: 'email' as CampaignChannel,
    leadsGenerated: 10,
    startDate: '2025-01-01T00:00:00Z',
    notes: '',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

export function createCampaignList(
  n: number,
  overrides: Partial<Campaign> = {},
): Campaign[] {
  return Array.from({ length: n }, () => createCampaign(overrides));
}

export function createCampaignResponse(
  campaigns: Campaign[] = createCampaignList(3),
): ApiResponse<Campaign[]> {
  return {
    data: campaigns,
    meta: { total: campaigns.length, page: 1, perPage: 25 },
  };
}

export function createEmptyCampaignResponse(): ApiResponse<Campaign[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  };
}

export function resetCampaignCounter(): void {
  counter = 0;
}
