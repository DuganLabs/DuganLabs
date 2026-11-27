import type { Env } from '../env.js';
import { sessionUserId, authRequired } from '../auth/session.js';
import {
  loadCredentials,
  readCredentialsRow,
  plaidPost,
  verifyCredentials,
  PlaidError,
  type PlaidCredentials,
  type LinkTokenCreateResponse,
  type ItemExchangeResponse,
  type AccountsGetResponse,
  type InstitutionsGetByIdResponse,
} from '../plaid.js';
import { encryptField } from '../crypto/plaidCredentials.js';

/*
 * plaid_credentials is the operator's Plaid API key pair — app-level
 * configuration, not per-user data. The schema pins it to a single row
 * (`CHECK (id = 1)`), so the `id = 1` below is that singleton's key, not a
 * user id. Reads/writes still require a session (requireAuth), and every
 * table that holds bank data (plaid_items, accounts) is scoped by user_id.
 */
export async function getPlaidCredentials(_request: Request, env: Env): Promise<Response> {
  const row = await readCredentialsRow(env);
  if (!row) return Response.json({ configured: false });
  return Response.json({
    configured: true,
    clientIdMasked: row.clientId.slice(0, 4) + '…' + row.clientId.slice(-4),
    env: row.env,
    updatedAt: row.updatedAt,
  });
}

export async function postPlaidCredentials(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, 'INVALID_JSON', 'Body must be JSON.');
  }
  if (typeof body !== 'object' || body === null) {
    return errorJson(400, 'INVALID_BODY', 'Expected { clientId, secret, env }.');
  }
  const {
    clientId,
    secret,
    env: plaidEnv,
  } = body as {
    clientId?: unknown;
    secret?: unknown;
    env?: unknown;
  };
  if (typeof clientId !== 'string' || clientId.trim().length === 0) {
    return errorJson(400, 'INVALID_INPUT', 'clientId is required.', 'clientId');
  }
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    return errorJson(400, 'INVALID_INPUT', 'secret is required.', 'secret');
  }
  if (plaidEnv !== 'sandbox' && plaidEnv !== 'production') {
    return errorJson(400, 'INVALID_INPUT', "env must be 'sandbox' or 'production'.", 'env');
  }

  // Validate the credentials against Plaid before persisting. This catches
  // typos, paste errors, and password-manager autofill — all of which would
  // otherwise sit in D1 and fail later when the user tries to connect a bank.
  const trimmedCreds: PlaidCredentials = {
    clientId: clientId.trim(),
    secret: secret.trim(),
    env: plaidEnv,
  };
  try {
    await verifyCredentials(trimmedCreds);
  } catch (err) {
    return plaidErrorToResponse(err, 'INVALID_CREDENTIALS');
  }

  const [encClientId, encSecret] = await Promise.all([
    encryptField(env, trimmedCreds.clientId),
    encryptField(env, trimmedCreds.secret),
  ]);

  await env.DB.prepare(
    `INSERT INTO plaid_credentials (id, client_id, secret, env, updated_at)
     VALUES (1, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, secret = excluded.secret, env = excluded.env, updated_at = excluded.updated_at`,
  )
    .bind(encClientId, encSecret, trimmedCreds.env)
    .run();

  return Response.json({ ok: true });
}

export async function postLinkToken(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const creds = await loadCredentials(env);
  if (!creds) return errorJson(400, 'NOT_CONFIGURED', 'Set Plaid credentials in /settings first.');
  try {
    const data = await plaidPost<LinkTokenCreateResponse>(creds, '/link/token/create', {
      user: { client_user_id: String(userId) },
      client_name: 'PendingBusiness',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    return Response.json({ linkToken: data.link_token, expiration: data.expiration });
  } catch (err) {
    return plaidErrorToResponse(err);
  }
}

export async function postExchange(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, 'INVALID_JSON', 'Body must be JSON.');
  }
  if (typeof body !== 'object' || body === null) {
    return errorJson(400, 'INVALID_BODY', 'Expected { publicToken }.');
  }
  const { publicToken } = body as { publicToken?: unknown };
  if (typeof publicToken !== 'string' || publicToken.length === 0) {
    return errorJson(400, 'INVALID_INPUT', 'publicToken is required.', 'publicToken');
  }

  const creds = await loadCredentials(env);
  if (!creds) return errorJson(400, 'NOT_CONFIGURED', 'Plaid not configured.');

  try {
    const exchange = await plaidPost<ItemExchangeResponse>(creds, '/item/public_token/exchange', {
      public_token: publicToken,
    });

    const accounts = await plaidPost<AccountsGetResponse>(creds, '/accounts/get', {
      access_token: exchange.access_token,
    });

    let institutionName: string | null = null;
    if (accounts.item.institution_id) {
      try {
        const inst = await plaidPost<InstitutionsGetByIdResponse>(
          creds,
          '/institutions/get_by_id',
          {
            institution_id: accounts.item.institution_id,
            country_codes: ['US'],
          },
        );
        institutionName = inst.institution.name;
      } catch {
        /* institution lookup is best-effort */
      }
    }

    const itemInsert = await env.DB.prepare(
      "INSERT INTO plaid_items (user_id, item_id, access_token, institution_id, institution_name, last_synced_at) VALUES (?, ?, ?, ?, ?, datetime('now')) RETURNING id",
    )
      .bind(
        userId,
        exchange.item_id,
        exchange.access_token,
        accounts.item.institution_id,
        institutionName,
      )
      .first<{ id: number }>();

    if (!itemInsert) return errorJson(500, 'DB_ERROR', 'Failed to persist Plaid item.');

    const stmts = accounts.accounts.map(a =>
      env.DB.prepare(
        `INSERT INTO accounts (user_id, plaid_item_id, plaid_account_id, name, official_name, type, subtype, mask, current_balance, available_balance, iso_currency, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(plaid_item_id, plaid_account_id) DO UPDATE SET current_balance = excluded.current_balance, available_balance = excluded.available_balance, last_synced_at = excluded.last_synced_at`,
      ).bind(
        userId,
        itemInsert.id,
        a.account_id,
        a.name,
        a.official_name,
        a.type,
        a.subtype,
        a.mask,
        a.balances.current,
        a.balances.available,
        a.balances.iso_currency_code ?? 'USD',
      ),
    );
    if (stmts.length > 0) await env.DB.batch(stmts);

    return Response.json({
      ok: true,
      itemId: exchange.item_id,
      institutionName,
      accountsAdded: accounts.accounts.length,
    });
  } catch (err) {
    return plaidErrorToResponse(err);
  }
}

export async function listAccounts(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const rows = await env.DB.prepare(
    `SELECT a.id, a.name, a.official_name, a.type, a.subtype, a.mask, a.current_balance, a.available_balance, a.iso_currency, a.last_synced_at, i.institution_name
     FROM accounts a
     LEFT JOIN plaid_items i ON i.id = a.plaid_item_id
     WHERE a.user_id = ?
     ORDER BY i.institution_name, a.name`,
  )
    .bind(userId)
    .all<{
      id: number;
      name: string;
      official_name: string | null;
      type: string;
      subtype: string | null;
      mask: string | null;
      current_balance: number | null;
      available_balance: number | null;
      iso_currency: string | null;
      last_synced_at: string | null;
      institution_name: string | null;
    }>();

  const accounts = rows.results.map(r => ({
    id: r.id,
    name: r.name,
    officialName: r.official_name,
    type: r.type,
    subtype: r.subtype,
    mask: r.mask,
    currentBalance: r.current_balance,
    availableBalance: r.available_balance,
    currency: r.iso_currency,
    lastSyncedAt: r.last_synced_at,
    institution: r.institution_name,
  }));
  const totals = accounts.reduce(
    (acc, a) => {
      const bal = a.currentBalance ?? 0;
      if (a.type === 'depository') acc.cash += bal;
      if (a.type === 'credit') acc.creditDebt += bal;
      if (a.type === 'loan') acc.loanDebt += bal;
      return acc;
    },
    { cash: 0, creditDebt: 0, loanDebt: 0 },
  );
  return Response.json({ accounts, totals });
}

export async function postSync(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (userId == null) return authRequired();
  const creds = await loadCredentials(env);
  if (!creds) return errorJson(400, 'NOT_CONFIGURED', 'Plaid not configured.');

  const items = await env.DB.prepare('SELECT id, access_token FROM plaid_items WHERE user_id = ?')
    .bind(userId)
    .all<{ id: number; access_token: string }>();

  if (items.results.length === 0) {
    return Response.json({ ok: true, itemsSynced: 0, accountsUpdated: 0 });
  }

  let accountsUpdated = 0;
  const itemErrors: Array<{ itemId: number; message: string; code: string | null }> = [];
  for (const item of items.results) {
    try {
      const data = await plaidPost<AccountsGetResponse>(creds, '/accounts/get', {
        access_token: item.access_token,
      });
      const stmts = data.accounts.map(a =>
        env.DB.prepare(
          `UPDATE accounts SET current_balance = ?, available_balance = ?, last_synced_at = datetime('now')
           WHERE plaid_item_id = ? AND plaid_account_id = ?`,
        ).bind(a.balances.current, a.balances.available, item.id, a.account_id),
      );
      if (stmts.length > 0) {
        await env.DB.batch(stmts);
        accountsUpdated += data.accounts.length;
      }
      await env.DB.prepare("UPDATE plaid_items SET last_synced_at = datetime('now') WHERE id = ?")
        .bind(item.id)
        .run();
    } catch (err) {
      // Per-item failure doesn't block others, but surface it so the user
      // can see why a bank stopped syncing (bad creds, expired token, etc.).
      const message =
        err instanceof PlaidError ? err.message : err instanceof Error ? err.message : String(err);
      const code = err instanceof PlaidError ? err.errorCode : null;
      itemErrors.push({ itemId: item.id, message, code });
    }
  }

  return Response.json({
    ok: itemErrors.length === 0,
    itemsSynced: items.results.length - itemErrors.length,
    accountsUpdated,
    errors: itemErrors,
  });
}

function errorJson(status: number, code: string, message: string, field?: string): Response {
  const body: Record<string, unknown> = { error: { code, message } };
  if (field) (body.error as Record<string, unknown>).field = field;
  return Response.json(body, { status });
}

function plaidErrorToResponse(err: unknown, codeOverride?: string): Response {
  if (err instanceof PlaidError) {
    // Surface 400-class errors (e.g. INVALID_INPUT for bad creds) as 400 to
    // the client — they're caller errors, not upstream failures. 500-class
    // Plaid responses become 502.
    const status = err.status >= 400 && err.status < 500 ? 400 : 502;
    const code = codeOverride ?? err.errorCode ?? 'PLAID_ERROR';
    return Response.json(
      {
        error: {
          code,
          message: err.message,
          plaidStatus: err.status,
          errorType: err.errorType,
          errorCode: err.errorCode,
        },
      },
      { status },
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return errorJson(500, 'UNKNOWN', msg);
}
