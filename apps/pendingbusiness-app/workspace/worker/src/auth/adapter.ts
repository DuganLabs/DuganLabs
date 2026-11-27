/**
 * Per-request WebAuthn adapter factory.
 *
 * Builds a `webauthnAdapter` (from @basenative/auth-webauthn) bound to PB's
 * D1 stores and RP_* env vars. The adapter is the single object the rest of
 * the worker talks to for `currentUser`, `destroySession`, etc.
 */
import { webauthnAdapter } from '@basenative/auth-webauthn';
import type { Env } from '../env.js';
import { pbWebAuthnStores } from './stores.js';

export function getAdapter(env: Env) {
  const ttlDays = Number(env.SESSION_TTL_DAYS) || 30;
  return webauthnAdapter({
    rp: {
      rpName: env.RP_NAME || 'PendingBusiness',
      rpID: env.RP_ID || 'localhost',
      origin: env.RP_ORIGIN || 'http://localhost:8787',
    },
    stores: pbWebAuthnStores(env.DB),
    ttl: { sessionSeconds: ttlDays * 86400 },
    cookieName: 'pb_auth',
    secureCookie: env.RP_ORIGIN?.startsWith('https://') !== false,
  });
}

export type Adapter = ReturnType<typeof getAdapter>;
