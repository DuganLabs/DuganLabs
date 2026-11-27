import type { WorkspaceUser, UserRole } from '@greenput/shared/models';

let counter = 0;

export function createAgent(
  overrides: Partial<WorkspaceUser> = {},
): WorkspaceUser {
  counter++;
  return {
    id: `agent-${counter}`,
    firstName: `Agent${counter}`,
    lastName: `Smith${counter}`,
    email: `agent${counter}@example.com`,
    role: 'admin' as UserRole,
    avatarInitials: `A${counter}`,
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

export function createAgentList(
  n: number,
  overrides: Partial<WorkspaceUser> = {},
): WorkspaceUser[] {
  return Array.from({ length: n }, () => createAgent(overrides));
}

export function resetAgentCounter(): void {
  counter = 0;
}
