import type { Branding } from '@greenput/shared/models';

export function createBranding(overrides: Partial<Branding> = {}): Branding {
  return {
    id: 'br-1',
    workspaceId: 'ws-1',
    primaryColor: '#10b981',
    secondaryColor: '#1f2937',
    accentColor: '#3b82f6',
    fontFamily: 'system-ui',
    emailFooter: 'Powered by Greenput',
    updatedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}
