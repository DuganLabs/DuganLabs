export interface WorkspaceFixture {
  id: string;
  name: string;
  trade: string;
  phone: string;
  email: string;
  address: { street: string; city: string; state: string; zip: string };
  licenseNumber?: string;
  logoUrl?: string;
  createdAt: string;
}

export interface WorkspaceUserFixture {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: 'owner' | 'admin' | 'tech' | 'office';
  avatarInitials: string;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

let userCounter = 0;

export function createWorkspace(
  overrides: Partial<WorkspaceFixture> = {},
): WorkspaceFixture {
  return {
    id: 'ws-1',
    name: 'Test Electric',
    trade: 'electrical',
    phone: '555-555-1234',
    email: 'test@greenput.com',
    address: {
      street: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    },
    licenseNumber: 'EL-12345',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

export function createWorkspaceUser(
  overrides: Partial<WorkspaceUserFixture> = {},
): WorkspaceUserFixture {
  userCounter++;
  return {
    id: `usr-${userCounter}`,
    firstName: `User${userCounter}`,
    lastName: 'Test',
    email: `user${userCounter}@greenput.com`,
    role: 'tech',
    avatarInitials: `U${userCounter}`,
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    createdBy: 'usr-1',
    ...overrides,
  };
}

export function createWorkspaceUserList(n: number): WorkspaceUserFixture[] {
  return Array.from({ length: n }, () => createWorkspaceUser());
}

export function resetWorkspaceUserCounter(): void {
  userCounter = 0;
}
