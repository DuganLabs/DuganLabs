import type { Env } from '../env';
import { unauthorized } from '../lib/response';

export interface AdminSession {
  isAdmin: true;
  adminId: string;
  email: string;
}

export async function requireAdmin(
  request: Request & { adminSession?: AdminSession },
  env: Env,
): Promise<Response | void> {
  const sessionToken = getCookieValue(
    request.headers.get('cookie') ?? '',
    'gp_admin_session',
  );

  if (!sessionToken) {
    return unauthorized();
  }

  const raw = await env.SESSIONS.get(`admin_session:${sessionToken}`);
  if (!raw) {
    return unauthorized();
  }

  try {
    const session: AdminSession = JSON.parse(raw);
    if (!session.isAdmin) return unauthorized();
    (request as Record<string, unknown>)['adminSession'] = session;
  } catch {
    return unauthorized();
  }
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
