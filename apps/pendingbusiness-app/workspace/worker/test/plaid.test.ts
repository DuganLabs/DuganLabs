import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  postPlaidCredentials,
  postLinkToken,
  postSync,
  getPlaidCredentials,
} from '../src/routes/plaid.js';
import {
  encryptField,
  decryptField,
  CredentialDecryptionError,
} from '../src/crypto/plaidCredentials.js';
import type { Env } from '../src/env.js';

/**
 * These tests stub D1 + global fetch so we can exercise the Plaid routes
 * end-to-end without touching the real Plaid API. The bug being guarded
 * against here is the one that prompted this fix: bad credentials silently
 * landing in D1, then producing INVALID_INPUT later when the user tries to
 * connect a bank.
 *
 * client_id/secret are encrypted at rest (see ../src/crypto/plaidCredentials.ts).
 * Fixtures below store already-encrypted values by default (the steady-state
 * shape of a real row) via encryptForTest(); the "migrates a legacy-plaintext
 * row" tests deliberately seed unprefixed plaintext instead.
 */

const TEST_KEK_ENV = {
  PLAID_CREDENTIALS_KEKS: JSON.stringify({
    '1': Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
  }),
  PLAID_CREDENTIALS_KEK_CURRENT: '1',
};

function encryptForTest(plaintext: string): Promise<string> {
  return encryptField(TEST_KEK_ENV, plaintext);
}

interface DbCall {
  sql: string;
  binds: unknown[];
}

interface FakeDb {
  calls: DbCall[];
  rows: Map<string, unknown>;
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
  };
}

function makeDb(
  initial: {
    credentials?: { client_id: string; secret: string; env: string; updated_at?: string };
    items?: Array<{ id: number; access_token: string }>;
  } = {},
): FakeDb {
  const db: FakeDb = {
    calls: [],
    rows: new Map(),
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const calls = db.calls;
      let lastBinds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          lastBinds = args;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          calls.push({ sql: normalized, binds: lastBinds });
          // adapter.currentUser — any cookie resolves to user 7 (not 1, so a
          // route that silently fell back to the old owner constant would fail).
          if (normalized.startsWith('SELECT u.id AS id, u.handle AS handle')) {
            return { id: 7, handle: 'warren', role: 'admin', expiresAt: 9999999999 } as T;
          }
          if (
            normalized.startsWith(
              'SELECT client_id, secret, env, updated_at FROM plaid_credentials',
            )
          ) {
            if (!initial.credentials) return null;
            return {
              client_id: initial.credentials.client_id,
              secret: initial.credentials.secret,
              env: initial.credentials.env,
              updated_at: initial.credentials.updated_at ?? '2026-04-27T00:00:00',
            } as T;
          }
          if (normalized.startsWith('INSERT INTO plaid_items')) {
            return { id: 99 } as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          calls.push({ sql: normalized, binds: lastBinds });
          if (normalized.startsWith('SELECT id, access_token FROM plaid_items')) {
            return { results: (initial.items ?? []) as T[] };
          }
          return { results: [] };
        },
        async run() {
          calls.push({ sql: normalized, binds: lastBinds });
          if (normalized.startsWith('UPDATE plaid_credentials SET client_id = ?, secret = ?')) {
            const [clientId, secret] = lastBinds as [string, string];
            if (initial.credentials) {
              initial.credentials.client_id = clientId;
              initial.credentials.secret = secret;
            }
          }
          return {};
        },
      };
      return stmt;
    },
  };
  return db;
}

function makeEnv(db: FakeDb): Env {
  return {
    DB: {
      prepare: db.prepare.bind(db),
      batch: async () => [],
    } as unknown as D1Database,
    ASSETS: {} as Fetcher,
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
    ...TEST_KEK_ENV,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request('https://pendingbusiness.com/api/plaid/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SESSION = { Cookie: 'pb_auth=session-token' };

describe('postPlaidCredentials — verifies with Plaid before storing', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects malformed JSON', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const req = new Request('https://pendingbusiness.com/api/plaid/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await postPlaidCredentials(req as never, env);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe('INVALID_JSON');
    // Should never have called Plaid, never written to DB.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.calls.find(c => c.sql.startsWith('INSERT'))).toBeUndefined();
  });

  it('rejects missing fields without calling Plaid', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const res = await postPlaidCredentials(
      jsonRequest({ clientId: '   ', secret: 'foo', env: 'sandbox' }) as never,
      env,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string; field?: string } };
    expect(data.error.code).toBe('INVALID_INPUT');
    expect(data.error.field).toBe('clientId');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unknown env value', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const res = await postPlaidCredentials(
      jsonRequest({ clientId: 'cid', secret: 'sec', env: 'staging' }) as never,
      env,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Plaid /institutions/get to verify creds before saving', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ institutions: [] }), { status: 200 }),
    );
    const res = await postPlaidCredentials(
      jsonRequest({ clientId: 'good_client', secret: 'good_secret', env: 'sandbox' }) as never,
      env,
    );
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://sandbox.plaid.com/institutions/get');
    const sentBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(sentBody.client_id).toBe('good_client');
    expect(sentBody.secret).toBe('good_secret');
    expect(sentBody.count).toBe(1);
    expect(sentBody.country_codes).toEqual(['US']);

    // Only after Plaid 200 do we INSERT — and the stored values are
    // encrypted, never the plaintext client_id/secret.
    const insert = db.calls.find(c => c.sql.startsWith('INSERT INTO plaid_credentials'));
    expect(insert).toBeDefined();
    const [storedClientId, storedSecret, storedEnv] = insert!.binds as [string, string, string];
    expect(storedClientId).not.toBe('good_client');
    expect(storedSecret).not.toBe('good_secret');
    expect(storedClientId.startsWith('pbenc:v1:')).toBe(true);
    expect(storedSecret.startsWith('pbenc:v1:')).toBe(true);
    expect(await decryptField(TEST_KEK_ENV, storedClientId)).toBe('good_client');
    expect(await decryptField(TEST_KEK_ENV, storedSecret)).toBe('good_secret');
    expect(storedEnv).toBe('sandbox');
  });

  it('does NOT save when Plaid rejects with INVALID_INPUT', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const plaidErr = {
      error_type: 'INVALID_INPUT',
      error_code: 'INVALID_API_KEYS',
      error_message: 'invalid client_id or secret provided',
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(plaidErr), { status: 400 }));

    const res = await postPlaidCredentials(
      jsonRequest({ clientId: 'wrong', secret: 'wrong', env: 'sandbox' }) as never,
      env,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as {
      error: { code: string; message: string; errorType?: string; errorCode?: string };
    };
    expect(data.error.code).toBe('INVALID_CREDENTIALS');
    expect(data.error.message).toContain('invalid client_id or secret');
    expect(data.error.errorType).toBe('INVALID_INPUT');
    expect(data.error.errorCode).toBe('INVALID_API_KEYS');

    // Importantly: the bad creds were NOT inserted.
    const insert = db.calls.find(c => c.sql.startsWith('INSERT INTO plaid_credentials'));
    expect(insert).toBeUndefined();
  });

  it('trims whitespace before sending to Plaid and storing', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ institutions: [] }), { status: 200 }),
    );

    await postPlaidCredentials(
      jsonRequest({ clientId: '  cid  ', secret: '\tsec\n', env: 'sandbox' }) as never,
      env,
    );

    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(sentBody.client_id).toBe('cid');
    expect(sentBody.secret).toBe('sec');

    const insert = db.calls.find(c => c.sql.startsWith('INSERT INTO plaid_credentials'));
    const [storedClientId, storedSecret] = insert!.binds as [string, string];
    expect(await decryptField(TEST_KEK_ENV, storedClientId)).toBe('cid');
    expect(await decryptField(TEST_KEK_ENV, storedSecret)).toBe('sec');
  });

  it('uses the production base URL when env=production', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ institutions: [] }), { status: 200 }),
    );
    await postPlaidCredentials(
      jsonRequest({ clientId: 'cid', secret: 'sec', env: 'production' }) as never,
      env,
    );
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe('https://production.plaid.com/institutions/get');
  });
});

describe('postLinkToken — surfaces Plaid errors cleanly', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 NOT_CONFIGURED when no creds row exists', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const res = await postLinkToken(
      new Request('http://localhost/api/plaid/link-token', { method: 'POST', headers: SESSION }),
      env,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe('NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards stored creds to Plaid /link/token/create', async () => {
    const db = makeDb({
      credentials: {
        client_id: await encryptForTest('stored_cid'),
        secret: await encryptForTest('stored_sec'),
        env: 'sandbox',
      },
    });
    const env = makeEnv(db);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ link_token: 'link-sandbox-xyz', expiration: '2026-04-28T00:00:00Z' }),
        { status: 200 },
      ),
    );
    const res = await postLinkToken(
      new Request('http://localhost/api/plaid/link-token', { method: 'POST', headers: SESSION }),
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { linkToken: string };
    expect(data.linkToken).toBe('link-sandbox-xyz');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://sandbox.plaid.com/link/token/create');
    const sent = JSON.parse((init as RequestInit).body as string) as {
      client_id: string;
      secret: string;
      user: { client_user_id: string };
    };
    expect(sent.client_id).toBe('stored_cid');
    expect(sent.secret).toBe('stored_sec');
    // The session user, never a hard-coded owner id.
    expect(sent.user.client_user_id).toBe('7');
  });

  it('returns 401 without a session and never calls Plaid', async () => {
    const db = makeDb({
      credentials: {
        client_id: await encryptForTest('stored_cid'),
        secret: await encryptForTest('stored_sec'),
        env: 'sandbox',
      },
    });
    const res = await postLinkToken(
      new Request('http://localhost/api/plaid/link-token', { method: 'POST' }),
      makeEnv(db),
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns parsed Plaid error message (not raw JSON) when creds are rejected', async () => {
    const db = makeDb({
      credentials: {
        client_id: await encryptForTest('bad'),
        secret: await encryptForTest('bad'),
        env: 'sandbox',
      },
    });
    const env = makeEnv(db);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error_type: 'INVALID_INPUT',
          error_code: 'INVALID_API_KEYS',
          error_message: 'invalid client_id or secret provided',
        }),
        { status: 400 },
      ),
    );
    const res = await postLinkToken(
      new Request('http://localhost/api/plaid/link-token', { method: 'POST', headers: SESSION }),
      env,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as {
      error: { code: string; message: string; errorCode: string; errorType: string };
    };
    expect(data.error.message).toBe('invalid client_id or secret provided');
    expect(data.error.errorCode).toBe('INVALID_API_KEYS');
    expect(data.error.errorType).toBe('INVALID_INPUT');
  });
});

describe('postSync — surfaces per-item errors instead of swallowing them', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:true with no errors on success', async () => {
    const db = makeDb({
      credentials: {
        client_id: await encryptForTest('cid'),
        secret: await encryptForTest('sec'),
        env: 'sandbox',
      },
      items: [{ id: 1, access_token: 'access-good' }],
    });
    // Patch batch to be a no-op resolved promise.
    (env => env)(makeEnv(db));
    const env = makeEnv(db);
    (env.DB as unknown as { batch: () => Promise<unknown[]> }).batch = async () => [];

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accounts: [
            {
              account_id: 'acc-1',
              name: 'Checking',
              official_name: null,
              type: 'depository',
              subtype: 'checking',
              mask: '0001',
              balances: { current: 100, available: 100, iso_currency_code: 'USD' },
            },
          ],
          item: { institution_id: null },
        }),
        { status: 200 },
      ),
    );

    const res = await postSync(
      new Request('http://localhost/api/plaid/sync', { method: 'POST', headers: SESSION }),
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      itemsSynced: number;
      errors: unknown[];
    };
    expect(data.ok).toBe(true);
    expect(data.itemsSynced).toBe(1);
    expect(data.errors).toEqual([]);
    // Items were looked up for the session user (7), not a fixed owner.
    const itemsQuery = db.calls.find(c =>
      c.sql.startsWith('SELECT id, access_token FROM plaid_items'),
    );
    expect(itemsQuery?.binds).toEqual([7]);
  });

  it('returns ok:false with the parsed Plaid error message when an item fails', async () => {
    const db = makeDb({
      credentials: {
        client_id: await encryptForTest('cid'),
        secret: await encryptForTest('sec'),
        env: 'sandbox',
      },
      items: [{ id: 7, access_token: 'access-bad' }],
    });
    const env = makeEnv(db);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error_type: 'INVALID_INPUT',
          error_code: 'INVALID_API_KEYS',
          error_message: 'invalid client_id or secret provided',
        }),
        { status: 400 },
      ),
    );

    const res = await postSync(
      new Request('http://localhost/api/plaid/sync', { method: 'POST', headers: SESSION }),
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      itemsSynced: number;
      errors: Array<{ itemId: number; message: string; code: string | null }>;
    };
    expect(data.ok).toBe(false);
    expect(data.itemsSynced).toBe(0);
    expect(data.errors).toHaveLength(1);
    expect(data.errors[0]!.itemId).toBe(7);
    expect(data.errors[0]!.message).toBe('invalid client_id or secret provided');
    expect(data.errors[0]!.code).toBe('INVALID_API_KEYS');
  });

  it('returns NOT_CONFIGURED when no credentials are stored', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const res = await postSync(
      new Request('http://localhost/api/plaid/sync', { method: 'POST', headers: SESSION }),
      env,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok:true with itemsSynced:0 when no items exist', async () => {
    const db = makeDb({
      credentials: {
        client_id: await encryptForTest('cid'),
        secret: await encryptForTest('sec'),
        env: 'sandbox',
      },
      items: [],
    });
    const env = makeEnv(db);
    const res = await postSync(
      new Request('http://localhost/api/plaid/sync', { method: 'POST', headers: SESSION }),
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; itemsSynced: number };
    expect(data.ok).toBe(true);
    expect(data.itemsSynced).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('plaid_credentials encryption at rest', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('migrates a legacy-plaintext row to encrypted on GET /api/plaid/credentials', async () => {
    const db = makeDb({
      credentials: { client_id: 'legacy_plain_cid', secret: 'legacy_plain_secret', env: 'sandbox' },
    });
    const env = makeEnv(db);

    const res = await getPlaidCredentials(
      new Request('http://localhost/api/plaid/credentials'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; clientIdMasked: string };
    // The transparent read still works correctly for the not-yet-migrated row.
    expect(body.configured).toBe(true);
    expect(body.clientIdMasked).toBe('lega…_cid');

    const update = db.calls.find(c =>
      c.sql.startsWith('UPDATE plaid_credentials SET client_id = ?, secret = ?'),
    );
    expect(update).toBeDefined();
    const [newClientId, newSecret] = update!.binds as [string, string];
    expect(newClientId.startsWith('pbenc:v1:')).toBe(true);
    expect(newSecret.startsWith('pbenc:v1:')).toBe(true);
    expect(await decryptField(TEST_KEK_ENV, newClientId)).toBe('legacy_plain_cid');
    expect(await decryptField(TEST_KEK_ENV, newSecret)).toBe('legacy_plain_secret');

    // A second read (FakeDb's UPDATE mutated `initial.credentials` in place,
    // same as a real re-SELECT would see) does not re-migrate.
    db.calls.length = 0;
    const res2 = await getPlaidCredentials(
      new Request('http://localhost/api/plaid/credentials'),
      env,
    );
    expect(((await res2.json()) as { clientIdMasked: string }).clientIdMasked).toBe('lega…_cid');
    expect(db.calls.find(c => c.sql.startsWith('UPDATE'))).toBeUndefined();
  });

  it('migrates a legacy-plaintext row on read via postLinkToken and still forwards the correct value to Plaid', async () => {
    const db = makeDb({
      credentials: { client_id: 'legacy_cid', secret: 'legacy_secret', env: 'sandbox' },
    });
    const env = makeEnv(db);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ link_token: 'lt', expiration: '2026-04-28T00:00:00Z' }), {
        status: 200,
      }),
    );

    const res = await postLinkToken(
      new Request('http://localhost/api/plaid/link-token', { method: 'POST', headers: SESSION }),
      env,
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      client_id: string;
      secret: string;
    };
    expect(sent.client_id).toBe('legacy_cid');
    expect(sent.secret).toBe('legacy_secret');

    const update = db.calls.find(c => c.sql.startsWith('UPDATE plaid_credentials'));
    expect(update).toBeDefined();
    expect((update!.binds[0] as string).startsWith('pbenc:v1:')).toBe(true);
  });

  it('fails closed — never falls back to plaintext — when a stored value cannot be decrypted', async () => {
    // Encrypted under key version "2", which this environment's
    // PLAID_CREDENTIALS_KEKS never had (e.g. a retired key removed too
    // early, or a row corrupted in place).
    const undecryptableClientId = await encryptField(
      {
        PLAID_CREDENTIALS_KEKS: JSON.stringify({
          '2': Buffer.from(new Uint8Array(32).fill(5)).toString('base64'),
        }),
        PLAID_CREDENTIALS_KEK_CURRENT: '2',
      },
      'whatever',
    );
    const db = makeDb({
      credentials: {
        client_id: undecryptableClientId,
        secret: await encryptForTest('fine'),
        env: 'sandbox',
      },
    });
    const env = makeEnv(db);

    // getPlaidCredentials must reject rather than return a masked garbage
    // string or silently treat the ciphertext as a usable client_id.
    await expect(
      getPlaidCredentials(new Request('http://localhost/api/plaid/credentials'), env),
    ).rejects.toThrow(CredentialDecryptionError);
    // And it must never have written anything back.
    expect(db.calls.find(c => c.sql.startsWith('UPDATE'))).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
