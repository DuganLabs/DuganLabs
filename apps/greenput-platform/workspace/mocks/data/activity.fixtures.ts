import type { AuditEntry, ApiResponse } from '@greenput/shared/models';

let counter = 0;

const entityTypes = [
  'lead',
  'job',
  'customer',
  'estimate',
  'opportunity',
  'campaign',
];
const actions = ['created', 'updated', 'deleted', 'converted', 'sent'];

export function createAuditEntry(
  overrides: Partial<AuditEntry> = {},
): AuditEntry {
  counter++;
  const entityType = entityTypes[(counter - 1) % entityTypes.length]!;
  const action = actions[(counter - 1) % actions.length]!;
  return {
    id: `audit-${counter}`,
    workspace_id: 'ws-1',
    user_id: 'user-1',
    entity_type: entityType,
    entity_id: `${entityType}-${counter}`,
    action,
    meta: null,
    created_at: new Date(Date.now() - counter * 60_000).toISOString(),
    first_name: 'Jane',
    last_name: 'Doe',
    ...overrides,
  };
}

export function createAuditEntryList(
  n: number,
  overrides: Partial<AuditEntry> = {},
): AuditEntry[] {
  return Array.from({ length: n }, () => createAuditEntry(overrides));
}

export function createAuditResponse(
  entries: AuditEntry[] = createAuditEntryList(10),
): ApiResponse<AuditEntry[]> {
  return {
    data: entries,
    meta: { total: entries.length, page: 1, perPage: 50 },
  };
}

export function createEmptyAuditResponse(): ApiResponse<AuditEntry[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 50 },
  };
}

export function resetAuditCounter(): void {
  counter = 0;
}
