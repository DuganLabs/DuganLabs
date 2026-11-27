/**
 * Per-credential management endpoints powering the /account.html passkey
 * manager.
 *
 *   GET    /api/auth/credentials         → list current user's passkeys
 *   PATCH  /api/auth/credentials/:id     → rename (set nickname)
 *   DELETE /api/auth/credentials/:id     → revoke (delete row); refuses to
 *                                          delete the last one unless ?force=1
 *
 * All endpoints require an authenticated session (gated upstream by
 * requireAuth) AND scope every operation to the calling user — credential
 * IDs are unguessable, but checking ownership keeps a buggy frontend or a
 * compromised session from leaking into someone else's account.
 */
import type { Env } from '../env.js';
import { sessionUserId, authRequired } from '../auth/session.js';

const NICKNAME_MAX = 64;

interface CredentialRow {
  id: string;
  nickname: string | null;
  transports: string | null;
  counter: number;
  created_at: number;
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function listCredentials(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();

  const r = await env.DB.prepare(
    'SELECT id, nickname, transports, counter, created_at FROM credentials WHERE user_id = ? ORDER BY created_at ASC',
  )
    .bind(userId)
    .all<CredentialRow>();

  const rows = (r.results || []).map(c => {
    const transports = c.transports ? (JSON.parse(c.transports) as string[]) : [];
    return {
      id: c.id,
      nickname: c.nickname,
      transports,
      counter: c.counter,
      createdAt: c.created_at,
      // Hint at the platform for the UI ("internal" → device-bound, "hybrid"
      // → cross-device QR, "usb"/"nfc"/"ble" → security key). Frontend can
      // present a friendlier label.
      platform: derivePlatform(transports),
    };
  });

  return Response.json({ credentials: rows });
}

function derivePlatform(transports: readonly string[]): string {
  if (transports.includes('internal')) return 'platform';
  if (transports.includes('hybrid')) return 'cross-device';
  if (transports.includes('usb') || transports.includes('nfc') || transports.includes('ble'))
    return 'security-key';
  return 'unknown';
}

export async function renameCredential(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();

  const id = params.id;
  if (!id) return jsonError(400, 'BAD_PARAM', 'Credential id required.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Body must be JSON.');
  }
  const raw = (body as { nickname?: unknown })?.nickname;
  let nickname: string | null;
  if (raw == null || raw === '') {
    nickname = null;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length > NICKNAME_MAX) {
      return jsonError(400, 'NICKNAME_TOO_LONG', `Nickname must be ≤ ${NICKNAME_MAX} chars.`);
    }
    nickname = trimmed.length === 0 ? null : trimmed;
  } else {
    return jsonError(400, 'INVALID_NICKNAME', 'Nickname must be a string or null.');
  }

  // Scope by user_id — the WHERE clause guarantees we never rename a row
  // that belongs to a different user, even if `id` is forged.
  const result = await env.DB.prepare(
    'UPDATE credentials SET nickname = ? WHERE id = ? AND user_id = ?',
  )
    .bind(nickname, id, userId)
    .run();

  // D1 reports `meta.changes` but typings vary; treat zero rows as 404.
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes === 0) return jsonError(404, 'NOT_FOUND', 'Credential not found.');

  return Response.json({ ok: true, id, nickname });
}

export async function revokeCredential(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();

  const id = params.id;
  if (!id) return jsonError(400, 'BAD_PARAM', 'Credential id required.');

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  // Lockout-prevention: if this is the user's only credential and force=1
  // wasn't supplied, refuse. Without this check a user can delete their
  // last passkey, log out, and have no way back in.
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  const total = countRow?.n ?? 0;
  if (total <= 1 && !force) {
    return jsonError(
      409,
      'LAST_CREDENTIAL',
      'This is your only passkey — revoking it would lock you out. Re-send with ?force=1 to override.',
    );
  }

  const result = await env.DB.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes === 0) return jsonError(404, 'NOT_FOUND', 'Credential not found.');

  return Response.json({ ok: true, id });
}
