import type { DashboardStats, ActivityEntry } from '@greenput/shared/models';

export function createActivityEntry(
  overrides: Partial<ActivityEntry> = {},
): ActivityEntry {
  return {
    id: 'act-1',
    entity_type: 'lead',
    entity_id: 'lead-1',
    action: 'created',
    meta: null,
    created_at: '2025-01-15T10:00:00Z',
    first_name: 'John',
    last_name: 'Doe',
    ...overrides,
  };
}

export function createDashboardStats(
  overrides: Partial<DashboardStats> = {},
): DashboardStats {
  return {
    leads: { thisMonth: 42, growth: 12.5 },
    jobs: { active: 8, dueThisWeek: 3 },
    revenue: { thisMonth: 125000, growth: 8.3 },
    conversion: { rate: 0.35 },
    activity: [
      createActivityEntry(),
      createActivityEntry({
        id: 'act-2',
        action: 'updated',
        entity_type: 'job',
      }),
    ],
    ...overrides,
  };
}

export function createEmptyDashboardStats(): DashboardStats {
  return {
    leads: { thisMonth: 0, growth: null },
    jobs: { active: 0, dueThisWeek: 0 },
    revenue: { thisMonth: 0, growth: null },
    conversion: { rate: 0 },
    activity: [],
  };
}
