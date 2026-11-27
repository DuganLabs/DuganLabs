export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OWNER_EMAIL: string;
  // WebAuthn / passkey config (see worker/wrangler.toml [vars]).
  RP_NAME: string;
  RP_ID: string;
  RP_ORIGIN: string;
  ADMIN_HANDLES?: string;
  SESSION_TTL_DAYS?: string;
  // Envelope-encryption keys for plaid_credentials.client_id/secret at rest
  // (see worker/src/crypto/plaidCredentials.ts). Worker secrets — never set
  // these in wrangler.toml [vars] or commit a real value.
  PLAID_CREDENTIALS_KEKS?: string;
  PLAID_CREDENTIALS_KEK_CURRENT?: string;
}
