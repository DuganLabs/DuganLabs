import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSituation } from '../src/routes/situation.js';
import { listScenarios, postScenario, deleteScenario } from '../src/routes/scenario.js';
import { listAccounts, postLinkToken } from '../src/routes/plaid.js';
import { postRegisterOptions } from '../src/routes/auth.js';
import { pbWebAuthnStores } from '../src/auth/stores.js';
import { MODELLED_FILING_STATUSES } from '@pendingbusiness/core';
import type { Env } from '../src/env.js';

/**
 * Per-user scoping + closed enrolment.
 *
 * Two users share one fake D1. Every assertion is of the form "the second
 * user can neither read nor write the first user's rows" — the P0 finding
 * was that every data route was hard-wired to user id 1 regardless of who
 * held the session, and that /api/auth/register-options created a users
 * row for any unused handle.
 */

interface UserRow {
  id: number;
  handle: string;
  role: string;
  email: string;
  display_name: string;
  filing_status: string;
  state: string;
}
interface IncomeRow {
  id: number;
  user_id: number;
  label: string;
  type: string;
  gross_annual: number;
  employer: string | null;
  has_401k_match: number;
}
interface LiabilityRow {
  id: number;
  user_id: number;
  label: string;
  principal: number;
  rate_apr: number;
  min_payment_monthly: number;
  type: string;
  priority: number;
}
interface ScenarioRow {
  id: number;
  user_id: number;
  label: string;
  inputs_json: string;
  computed_json: string;
  created_at: string;
}
interface AccountRow {
  id: number;
  user_id: number;
  name: string;
  type: string;
  current_balance: number;
}
interface Store {
  users: UserRow[];
  sessions: Array<{ id: string; user_id: number; expires_at: number }>;
  income: IncomeRow[];
  liabilities: LiabilityRow[];
  scenarios: ScenarioRow[];
  accounts: AccountRow[];
  challenges: Array<{ challenge: string; user_id: number | null; purpose: string }>;
  calls: Array<{ sql: string; binds: unknown[] }>;
}

function makeDB(store: Store): D1Database {
  function prepare(sql: string) {
    const s = sql.replace(/\s+/g, ' ').trim();
    let binds: unknown[] = [];
    /** Rows a write statement actually touched — what D1 reports as `meta.changes`. */
    let changes = 1;
    const record = () => store.calls.push({ sql: s, binds });
    function rows(): unknown[] {
      if (
        s.startsWith(
          'SELECT u.id AS id, u.handle AS handle, u.role AS role, s.expires_at AS expiresAt',
        )
      ) {
        const sess = store.sessions.find(x => x.id === binds[0]);
        const u = sess && store.users.find(x => x.id === sess.user_id);
        return u ? [{ id: u.id, handle: u.handle, role: u.role, expiresAt: sess!.expires_at }] : [];
      }
      if (s.startsWith('SELECT id, email, display_name, filing_status, state, ')) {
        return store.users
          .filter(u => u.id === binds[0])
          .map(u => ({
            ...u,
            monthly_living_expenses: 0,
            liquidity_floor_monthly: 0,
            kids_count: 0,
            augusta_days: 0,
            augusta_daily_rate: 0,
            scorp_salary_split: 0.5,
          }));
      }
      if (
        s.startsWith(
          'SELECT id, handle, role, email, display_name, filing_status, state FROM users WHERE handle = ?',
        )
      ) {
        return store.users.filter(u => u.handle === String(binds[0]).toLowerCase());
      }
      if (s.startsWith('SELECT COUNT(*) AS n FROM users')) return [{ n: store.users.length }];
      if (s.startsWith('SELECT id, user_id, label, type, gross_annual')) {
        return store.income.filter(r => r.user_id === binds[0]);
      }
      if (s.startsWith('SELECT id, user_id, label, principal, rate_apr')) {
        return store.liabilities.filter(r => r.user_id === binds[0]);
      }
      if (s.startsWith('SELECT id, label, inputs_json, computed_json, created_at FROM scenarios')) {
        return store.scenarios.filter(r => r.user_id === binds[0]);
      }
      if (s.startsWith('SELECT a.id, a.name')) {
        return store.accounts
          .filter(a => a.user_id === binds[0])
          .map(a => ({
            id: a.id,
            name: a.name,
            official_name: null,
            type: a.type,
            subtype: null,
            mask: null,
            current_balance: a.current_balance,
            available_balance: a.current_balance,
            iso_currency: 'USD',
            last_synced_at: null,
            institution_name: null,
          }));
      }
      if (s.startsWith('SELECT client_id, secret, env, updated_at FROM plaid_credentials')) {
        return [
          { client_id: 'cid', secret: 'sec', env: 'sandbox', updated_at: '2026-09-10 00:00:00' },
        ];
      }
      if (s.startsWith('SELECT id, user_id AS userId, public_key AS publicKey')) return [];
      if (s.startsWith('INSERT INTO users')) {
        const [email, display, handle] = binds as [string, string, string];
        const id = store.users.length + 1;
        store.users.push({
          id,
          handle,
          role: 'user',
          email,
          display_name: display,
          filing_status: 'single',
          state: 'CA',
        });
        return [{ id }];
      }
      if (s.startsWith('INSERT INTO scenarios')) {
        const [user_id, label, inputs_json, computed_json] = binds as [
          number,
          string,
          string,
          string,
        ];
        store.scenarios.push({
          id: 100 + store.scenarios.length,
          user_id,
          label,
          inputs_json,
          computed_json,
          created_at: '2026-09-10 00:00:00',
        });
        return [];
      }
      if (s.startsWith('DELETE FROM scenarios WHERE id = ? AND user_id = ?')) {
        const [id, user_id] = binds as [number, number];
        const before = store.scenarios.length;
        store.scenarios = store.scenarios.filter(r => !(r.id === id && r.user_id === user_id));
        changes = before - store.scenarios.length;
        return [];
      }
      if (s.startsWith('INSERT INTO challenges')) {
        const [challenge, user_id, purpose] = binds as [string, number | null, string];
        store.challenges.push({ challenge, user_id, purpose });
        return [];
      }
      return [];
    }
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      first: async <T = unknown>(): Promise<T | null> => {
        record();
        return (rows()[0] as T | undefined) ?? null;
      },
      all: async <T = unknown>(): Promise<{ results: T[] }> => {
        record();
        return { results: rows() as T[] };
      },
      run: async () => {
        record();
        rows();
        return { success: true, meta: { changes } };
      },
    };
    return stmt;
  }
  return { prepare, batch: async () => [] } as unknown as D1Database;
}

function fakeEnv(store: Store): Env {
  return {
    DB: makeDB(store),
    ASSETS: {} as Fetcher,
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
    PLAID_CREDENTIALS_KEKS: JSON.stringify({
      '1': Buffer.from(new Uint8Array(32).fill(4)).toString('base64'),
    }),
    PLAID_CREDENTIALS_KEK_CURRENT: '1',
  };
}

const WARREN = 'pb_auth=tok-warren';
const MALLORY = 'pb_auth=tok-mallory';

function get(path: string, cookie?: string): Request {
  return new Request(`https://pb.com${path}`, cookie ? { headers: { Cookie: cookie } } : {});
}
function del(path: string, cookie?: string): Request {
  return new Request(`https://pb.com${path}`, {
    method: 'DELETE',
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
  });
}
function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://pb.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function seed(): Store {
  return {
    users: [
      {
        id: 1,
        handle: 'warren',
        role: 'admin',
        email: 'owner@example.com',
        display_name: 'Warren',
        filing_status: 'mfj',
        state: 'CA',
      },
      {
        id: 2,
        handle: 'mallory',
        role: 'user',
        email: 'mallory@example.com',
        display_name: 'Mallory',
        // A status the tax engine models, so these stay tests of per-user
        // scoping. /api/situation now refuses a status it has no brackets for
        // (situation.test.ts covers that), and a hardcoded 'single' here would
        // turn every tenancy assertion below into a 409 instead.
        filing_status: MODELLED_FILING_STATUSES[0]!,
        state: 'NY',
      },
    ],
    sessions: [
      { id: 'tok-warren', user_id: 1, expires_at: 9999999999 },
      { id: 'tok-mallory', user_id: 2, expires_at: 9999999999 },
    ],
    income: [
      {
        id: 1,
        user_id: 1,
        label: 'Example Employer',
        type: 'w2',
        gross_annual: 210_000,
        employer: 'Example Employer',
        has_401k_match: 0,
      },
      {
        id: 2,
        user_id: 1,
        label: 'Example School District',
        type: 'w2',
        gross_annual: 92_000,
        employer: null,
        has_401k_match: 0,
      },
      {
        id: 3,
        user_id: 2,
        label: 'Mallory W-2',
        type: 'w2',
        gross_annual: 50_000,
        employer: null,
        has_401k_match: 0,
      },
    ],
    liabilities: [
      {
        id: 1,
        user_id: 1,
        label: 'Personal loan',
        principal: 80_000,
        rate_apr: 0.12,
        min_payment_monthly: 1800,
        type: 'personal_loan',
        priority: 1,
      },
    ],
    scenarios: [
      {
        id: 20,
        user_id: 1,
        label: 'w-1',
        inputs_json: '{"greenputMonthlyNet":8000}',
        computed_json: '{}',
        created_at: '2026-01-01',
      },
      {
        id: 21,
        user_id: 1,
        label: 'w-2',
        inputs_json: '{"greenputMonthlyNet":9000}',
        computed_json: '{}',
        created_at: '2026-01-02',
      },
      {
        id: 30,
        user_id: 2,
        label: 'm-1',
        inputs_json: '{"greenputMonthlyNet":100}',
        computed_json: '{}',
        created_at: '2026-01-03',
      },
    ],
    accounts: [
      { id: 1, user_id: 1, name: 'Warren Checking', type: 'depository', current_balance: 12_000 },
      { id: 2, user_id: 2, name: 'Mallory Savings', type: 'depository', current_balance: 300 },
    ],
    challenges: [],
    calls: [],
  };
}

/** Every bound user_id for statements that filter on user_id. */
function userIdBinds(store: Store): unknown[] {
  return store.calls
    .filter(c => /user_id = \?|WHERE a\.user_id = \?/.test(c.sql))
    .map(c => c.binds[0]);
}

describe("per-user scoping — a second user never touches the first user's rows", () => {
  let store: Store;
  beforeEach(() => {
    store = seed();
  });

  it("GET /api/situation returns only the caller's rows", async () => {
    const res = await getSituation(get('/api/situation', MALLORY), fakeEnv(store));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      situation: {
        userId: number;
        incomeSources: Array<{ label: string }>;
        liabilities: unknown[];
      };
      projectedMagi: number;
    };
    expect(body.situation.userId).toBe(2);
    expect(body.projectedMagi).toBe(50_000);
    expect(body.situation.incomeSources.map(s => s.label)).toEqual(['Mallory W-2']);
    expect(body.situation.liabilities).toEqual([]);
    expect(userIdBinds(store)).not.toContain(1);
    expect(userIdBinds(store).every(b => b === 2)).toBe(true);
  });

  it('GET /api/situation still serves the first user their own rows', async () => {
    const res = await getSituation(get('/api/situation', WARREN), fakeEnv(store));
    const body = (await res.json()) as { projectedMagi: number; situation: { userId: number } };
    expect(body.situation.userId).toBe(1);
    expect(body.projectedMagi).toBe(302_000);
  });

  it('GET /api/situation is 401 without a session', async () => {
    const res = await getSituation(get('/api/situation'), fakeEnv(store));
    expect(res.status).toBe(401);
    expect(store.calls.some(c => c.sql.includes('FROM income_sources'))).toBe(false);
  });

  it("GET /api/scenarios lists only the caller's scenarios", async () => {
    const res = await listScenarios(get('/api/scenarios', MALLORY), fakeEnv(store));
    const body = (await res.json()) as { scenarios: Array<{ id: number }> };
    expect(body.scenarios.map(s => s.id)).toEqual([30]);
    expect(userIdBinds(store)).toEqual([2]);
  });

  it('GET /api/scenarios is 401 without a session', async () => {
    expect((await listScenarios(get('/api/scenarios'), fakeEnv(store))).status).toBe(401);
  });

  it("POST /api/scenario writes into the caller's rows, not user 1", async () => {
    const res = await postScenario(
      post('/api/scenario', { greenputMonthlyNet: 4000, persist: true }, MALLORY),
      fakeEnv(store),
    );
    expect(res.status).toBe(200);
    const inserted = store.scenarios.filter(s => s.label.startsWith('scenario-'));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.user_id).toBe(2);
    expect(store.scenarios.filter(s => s.user_id === 1)).toHaveLength(2);
    const insert = store.calls.find(c => c.sql.startsWith('INSERT INTO scenarios'));
    expect(insert?.binds[0]).toBe(2);
  });

  it('POST /api/scenario is 401 without a session and writes nothing', async () => {
    const res = await postScenario(
      post('/api/scenario', { greenputMonthlyNet: 4000 }),
      fakeEnv(store),
    );
    expect(res.status).toBe(401);
    expect(store.scenarios).toHaveLength(3);
  });

  it('POST /api/scenario without persist computes and leaves every row alone', async () => {
    const res = await postScenario(
      post('/api/scenario', { greenputMonthlyNet: 4000 }, MALLORY),
      fakeEnv(store),
    );
    expect(res.status).toBe(200);
    expect(store.scenarios).toHaveLength(3);
  });

  /*
   * The delete is scoped by user_id as well as id. Scoping by id alone would
   * let any session delete any user's row, and the caller could not tell a
   * wrong id from someone else's: both are the same 404, and neither moves
   * a row.
   */
  it("DELETE /api/scenarios/:id for another user's row changes nothing and is 404", async () => {
    const res = await deleteScenario(
      del('/api/scenarios/20', MALLORY),
      fakeEnv(store),
      {} as ExecutionContext,
      { id: '20' },
    );
    expect(res.status).toBe(404);
    expect(store.scenarios.map(r => r.id)).toEqual([20, 21, 30]);
    const stmt = store.calls.find(c => c.sql.startsWith('DELETE FROM scenarios'));
    expect(stmt?.sql).toBe('DELETE FROM scenarios WHERE id = ? AND user_id = ?');
    expect(stmt?.binds).toEqual([20, 2]);
  });

  it("DELETE /api/scenarios/:id removes only the caller's own row", async () => {
    const res = await deleteScenario(
      del('/api/scenarios/20', WARREN),
      fakeEnv(store),
      {} as ExecutionContext,
      { id: '20' },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 20 });
    expect(store.scenarios.map(r => r.id)).toEqual([21, 30]);
  });

  it('DELETE /api/scenarios/:id is 401 without a session and touches nothing', async () => {
    const res = await deleteScenario(
      del('/api/scenarios/20'),
      fakeEnv(store),
      {} as ExecutionContext,
      { id: '20' },
    );
    expect(res.status).toBe(401);
    expect(store.scenarios).toHaveLength(3);
    expect(store.calls.some(c => c.sql.startsWith('DELETE'))).toBe(false);
  });

  it("GET /api/plaid/accounts lists only the caller's accounts", async () => {
    const res = await listAccounts(get('/api/plaid/accounts', MALLORY), fakeEnv(store));
    const body = (await res.json()) as {
      accounts: Array<{ name: string }>;
      totals: { cash: number };
    };
    expect(body.accounts.map(a => a.name)).toEqual(['Mallory Savings']);
    expect(body.totals.cash).toBe(300);
    expect(userIdBinds(store)).toEqual([2]);
  });

  it('GET /api/plaid/accounts is 401 without a session', async () => {
    expect((await listAccounts(get('/api/plaid/accounts'), fakeEnv(store))).status).toBe(401);
  });

  describe('POST /api/plaid/link-token', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ link_token: 'lt', expiration: 'x' }), { status: 200 }),
        );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => vi.restoreAllMocks());

    it('identifies the caller (not user 1) to Plaid', async () => {
      const res = await postLinkToken(post('/api/plaid/link-token', {}, MALLORY), fakeEnv(store));
      expect(res.status).toBe(200);
      const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
        user: { client_user_id: string };
      };
      expect(sent.user.client_user_id).toBe('2');
    });

    it('is 401 without a session and never calls Plaid', async () => {
      const res = await postLinkToken(post('/api/plaid/link-token', {}), fakeEnv(store));
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('closed enrolment — POST /api/auth/register-options', () => {
  let store: Store;
  beforeEach(() => {
    store = seed();
  });

  it('refuses an unknown handle while any user exists (no row created)', async () => {
    const res = await postRegisterOptions(
      post('/api/auth/register-options', { handle: 'qa-stranger' }),
      fakeEnv(store),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'enrollment-closed' });
    expect(store.users.map(u => u.handle)).toEqual(['warren', 'mallory']);
    expect(store.calls.some(c => c.sql.startsWith('INSERT INTO'))).toBe(false);
    expect(store.challenges).toHaveLength(0);
  });

  it('still issues options for a handle that already exists', async () => {
    const res = await postRegisterOptions(
      post('/api/auth/register-options', { handle: 'Warren' }),
      fakeEnv(store),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string; user: { name: string } };
    expect(typeof body.challenge).toBe('string');
    expect(body.user.name).toBe('warren');
    expect(store.users).toHaveLength(2);
    expect(store.challenges).toEqual([
      { challenge: body.challenge, user_id: 1, purpose: 'register' },
    ]);
  });

  it('bootstraps the first user when the users table is empty', async () => {
    store.users = [];
    store.sessions = [];
    const res = await postRegisterOptions(
      post('/api/auth/register-options', { handle: 'first-user' }),
      fakeEnv(store),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string; user: { name: string } };
    expect(body.user.name).toBe('first-user');
    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({
      handle: 'first-user',
      email: 'first-user@placeholder.invalid',
      role: 'user',
    });
    expect(store.challenges[0]).toMatchObject({ user_id: 1, purpose: 'register' });
  });

  it('delegates malformed handles to the package (400 bad-handle), without touching users', async () => {
    const res = await postRegisterOptions(
      post('/api/auth/register-options', { handle: 'X' }),
      fakeEnv(store),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-handle' });
    expect(store.users).toHaveLength(2);
  });

  it('pbUsers.create refuses once any user exists (belt and braces at the store)', async () => {
    const stores = pbWebAuthnStores(fakeEnv(store).DB);
    await expect(stores.users.create({ id: 'ignored', handle: 'someone' })).rejects.toThrow(
      'enrollment-closed',
    );
    expect(store.users).toHaveLength(2);
  });
});
