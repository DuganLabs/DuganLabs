import type { ApiClient } from '@basenative/fetch';
import type {
  ShareableResponse,
  UserRole,
  Workspace,
  WorkspaceUser,
} from '@greenput/shared/models';

/**
 * What `PATCH /api/workspace` accepts (`UpdateWorkspaceSchema`). The model's
 * optional fields are absent when unset, but clearing one on the wire is an
 * explicit `null` — the same convention `licenseNumber`/`logoUrl` already
 * follow server-side — so the two that Settings → Workspace can clear
 * (GP-039) admit it here.
 */
export type WorkspacePatch = Partial<
  Omit<Workspace, 'serviceArea' | 'serviceRadiusMiles'>
> & {
  serviceArea?: string | null;
  serviceRadiusMiles?: number | null;
};

export interface WorkspaceApi {
  get(): Promise<{ data: Workspace }>;
  update(patch: WorkspacePatch): Promise<{ data: Workspace }>;
  listUsers(): Promise<{ data: WorkspaceUser[] }>;
  /**
   * Invite a teammate. Answers `{ data, share }` — the accept-invite link
   * the inviter passes on by hand (GP-008); nothing sends it. Inviting an
   * email that exists but has never enrolled a passkey re-issues the link.
   */
  invite(payload: {
    firstName: string;
    lastName: string;
    email: string;
    role: UserRole;
  }): Promise<ShareableResponse<WorkspaceUser>>;
  updateUserRole(id: string, role: UserRole): Promise<{ data: WorkspaceUser }>;
  removeUser(id: string): Promise<{ data: { deleted: boolean } }>;
}

export function createWorkspaceApi(api: ApiClient): WorkspaceApi {
  return {
    get: () => api.get('/api/workspace'),
    update: (patch) => api.patch('/api/workspace', patch),
    listUsers: () => api.get('/api/workspace/users'),
    invite: (payload) => api.post('/api/workspace/users', payload),
    updateUserRole: (id, role) =>
      api.patch(`/api/workspace/users/${id}`, { role }),
    removeUser: (id) => api.delete(`/api/workspace/users/${id}`),
  };
}
