import type { Env } from '../env';
import { unauthorized } from '../lib/response';
import type { SessionUser } from './auth';

/** Prefix added to all generated API keys */
const API_KEY_PREFIX = 'gp_';
/** Number of characters after `gp_` used as the lookup prefix */
const PREFIX_LENGTH = 8;

export interface ApiKeyInfo {
  id: string;
  name: string;
  scopes: string[];
}

declare module 'itty-router' {
  interface IRequest {
    apiKey?: ApiKeyInfo;
  }
}

/**
 * Hash a raw API key using SHA-256 (Web Crypto).
 * Returns a hex string.
 */
export async function hashApiKey(rawKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract the lookup prefix from a raw API key.
 * Given `gp_abcdefgh12345...`, returns `abcdefgh`.
 */
export function extractPrefix(rawKey: string): string {
  return rawKey.slice(
    API_KEY_PREFIX.length,
    API_KEY_PREFIX.length + PREFIX_LENGTH,
  );
}

/**
 * Middleware that authenticates via API key OR falls through to session auth.
 *
 * Checks for `Authorization: Bearer gp_...` header. If present, validates
 * the key and attaches workspace/apiKey info to the request. If no Bearer
 * token is present, falls through so the next middleware (session auth) can
 * handle authentication.
 */
export async function apiKeyAuth(
  request: Request & {
    user?: SessionUser;
    workspaceId?: string;
    apiKey?: ApiKeyInfo;
  },
  env: Env,
): Promise<Response | void> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return; // no header — fall through to session auth

  const match = authHeader.match(/^Bearer\s+(gp_.+)$/);
  if (!match) return; // not a gp_ token — fall through to session auth

  const rawKey = match[1];

  if (rawKey.length < API_KEY_PREFIX.length + PREFIX_LENGTH) {
    return unauthorized();
  }

  const prefix = extractPrefix(rawKey);

  // Look up by prefix
  const row = await env.DB.prepare(
    'SELECT id, workspace_id, name, key_hash, scopes, expires_at FROM api_keys WHERE key_prefix = ?',
  )
    .bind(prefix)
    .first<{
      id: string;
      workspace_id: string;
      name: string;
      key_hash: string;
      scopes: string;
      expires_at: string | null;
    }>();

  if (!row) {
    return unauthorized();
  }

  // Check expiration
  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at);
    if (expiresAt <= new Date()) {
      return unauthorized();
    }
  }

  // Verify full key hash
  const computedHash = await hashApiKey(rawKey);
  if (computedHash !== row.key_hash) {
    return unauthorized();
  }

  // Parse scopes
  let scopes: string[];
  try {
    scopes = JSON.parse(row.scopes) as string[];
  } catch {
    scopes = ['read'];
  }

  // Attach info to request
  const typedRequest = request as unknown as Record<string, unknown>;
  typedRequest['workspaceId'] = row.workspace_id;
  typedRequest['apiKey'] = {
    id: row.id,
    name: row.name,
    scopes,
  } satisfies ApiKeyInfo;
  // Set a minimal user so downstream handlers that check req.user still work
  typedRequest['user'] = {
    id: `apikey:${row.id}`,
    workspaceId: row.workspace_id,
    email: '',
    role: 'admin',
    firstName: 'API',
    lastName: 'Key',
  } satisfies SessionUser;

  // Update last_used_at (fire and forget)
  env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), row.id)
    .run()
    .catch(() => {
      /* best effort */
    });
}
