import type { ApiClient } from '@basenative/fetch';
import type { AuthUser } from '@basenative/auth-webauthn';
import type { InvitationPreview } from '@greenput/shared/models';

/**
 * `/api/auth/invite/:token` — the public half of a teammate invitation
 * (GP-008). Neither call carries a session: the holder of the link has none
 * yet. `accept` is single-use on the server and answers with the session
 * cookie, after which passkey enrolment runs under it.
 */
export interface InvitationsApi {
  preview(token: string): Promise<{ data: InvitationPreview }>;
  accept(token: string): Promise<{ data: { user: AuthUser } }>;
}

export function createInvitationsApi(api: ApiClient): InvitationsApi {
  const path = (token: string) =>
    `/api/auth/invite/${encodeURIComponent(token)}`;
  return {
    preview: (token) => api.get(path(token)),
    accept: (token) => api.post(`${path(token)}/accept`, {}),
  };
}
