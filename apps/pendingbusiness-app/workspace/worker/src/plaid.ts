import type { Env } from './env.js';
import { decryptField, encryptField, isEncryptedField } from './crypto/plaidCredentials.js';

export interface PlaidCredentials {
  clientId: string;
  secret: string;
  env: 'sandbox' | 'production';
}

export interface PlaidCredentialsMeta extends PlaidCredentials {
  updatedAt: string;
}

const BASE_URLS: Record<PlaidCredentials['env'], string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

/**
 * Reads the singleton plaid_credentials row and transparently decrypts
 * client_id/secret. If either column predates encryption (no `pbenc:v1:`
 * envelope prefix), this migrates the row in place — encrypting it and
 * writing the result back — before returning. Decryption failure on an
 * already-encrypted value (tampering, an unknown/retired key version)
 * throws CredentialDecryptionError; it is never treated as, or replaced
 * by, plaintext.
 *
 * Both getPlaidCredentials (routes/plaid.ts) and loadCredentials below go
 * through this single function so there is exactly one place that knows
 * how to read+migrate the row.
 */
export async function readCredentialsRow(env: Env): Promise<PlaidCredentialsMeta | null> {
  const row = await env.DB.prepare(
    'SELECT client_id, secret, env, updated_at FROM plaid_credentials WHERE id = 1',
  ).first<{
    client_id: string;
    secret: string;
    env: 'sandbox' | 'production';
    updated_at: string;
  }>();
  if (!row) return null;

  const [clientId, secret] = await Promise.all([
    decryptField(env, row.client_id),
    decryptField(env, row.secret),
  ]);

  const clientIdMigrated = !isEncryptedField(row.client_id);
  const secretMigrated = !isEncryptedField(row.secret);
  if (clientIdMigrated || secretMigrated) {
    const [encClientId, encSecret] = await Promise.all([
      clientIdMigrated ? encryptField(env, clientId) : Promise.resolve(row.client_id),
      secretMigrated ? encryptField(env, secret) : Promise.resolve(row.secret),
    ]);
    await env.DB.prepare(
      `UPDATE plaid_credentials SET client_id = ?, secret = ?, updated_at = datetime('now') WHERE id = 1`,
    )
      .bind(encClientId, encSecret)
      .run();
  }

  return { clientId, secret, env: row.env, updatedAt: row.updated_at };
}

export async function loadCredentials(env: Env): Promise<PlaidCredentials | null> {
  const row = await readCredentialsRow(env);
  if (!row) return null;
  return { clientId: row.clientId, secret: row.secret, env: row.env };
}

export async function plaidPost<T>(
  creds: PlaidCredentials,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE_URLS[creds.env]}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      secret: creds.secret,
      ...body,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw PlaidError.fromBody(res.status, text);
  }
  return (await res.json()) as T;
}

interface PlaidErrorBody {
  error_type?: string;
  error_code?: string;
  error_message?: string;
  display_message?: string;
}

export class PlaidError extends Error {
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly displayMessage: string | null;

  constructor(
    public readonly status: number,
    public readonly body: string,
    parsed: PlaidErrorBody | null = null,
  ) {
    const cleanMessage =
      parsed?.error_message ?? parsed?.display_message ?? `Plaid ${status}: ${body}`;
    super(cleanMessage);
    this.name = 'PlaidError';
    this.errorType = parsed?.error_type ?? null;
    this.errorCode = parsed?.error_code ?? null;
    this.displayMessage = parsed?.display_message ?? null;
  }

  static fromBody(status: number, body: string): PlaidError {
    let parsed: PlaidErrorBody | null = null;
    try {
      const json = JSON.parse(body) as PlaidErrorBody;
      if (json && typeof json === 'object') parsed = json;
    } catch {
      /* non-JSON body — fall back to raw text */
    }
    return new PlaidError(status, body, parsed);
  }
}

/**
 * Verify that a set of credentials is accepted by Plaid. Uses
 * /institutions/get with count=1 — the lightest endpoint that requires
 * client_id + secret and returns 400 INVALID_INPUT for bad credentials.
 *
 * Throws PlaidError on rejection. Returns void on success.
 */
export async function verifyCredentials(creds: PlaidCredentials): Promise<void> {
  await plaidPost<{ institutions: unknown[] }>(creds, '/institutions/get', {
    count: 1,
    offset: 0,
    country_codes: ['US'],
  });
}

export interface LinkTokenCreateResponse {
  link_token: string;
  expiration: string;
}

export interface ItemExchangeResponse {
  access_token: string;
  item_id: string;
}

export interface AccountsGetResponse {
  accounts: Array<{
    account_id: string;
    name: string;
    official_name: string | null;
    type: string;
    subtype: string | null;
    mask: string | null;
    balances: {
      current: number | null;
      available: number | null;
      iso_currency_code: string | null;
    };
  }>;
  item: {
    institution_id: string | null;
  };
}

export interface InstitutionsGetByIdResponse {
  institution: {
    institution_id: string;
    name: string;
  };
}
