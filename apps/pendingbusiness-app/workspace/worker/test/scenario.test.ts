import { describe, it, expect } from 'vitest';
import { postScenario, deleteScenario } from '../src/routes/scenario.js';
import type { Env } from '../src/env.js';

/**
 * POST /api/scenario and DELETE /api/scenarios/:id against a D1 fake that
 * dispatches on SQL substrings and records every statement it is asked to
 * prepare. That makes "no INSERT was prepared" a trustworthy assertion (it
 * observes the call). It makes a *successful* DELETE untrustworthy — the
 * fake reports whatever `changes` it is told to — so the per-user isolation
 * of the delete lives in tenancy.test.ts, where rows are modelled.
 *
 * (test/scenario.test.js beside this file is a node:test script that vitest's
 * `test/**\/*.test.ts` include never runs; it is not the harness the pipeline
 * executes.)
 */

interface Fake {
  env: Env;
  prepared: string[];
}

function fake(opts: { session?: boolean; deleteChanges?: number } = {}): Fake {
  const prepared: string[] = [];
  const session = opts.session ?? true;
  let nextSql = '';
  const stmt = {
    bind() {
      return stmt;
    },
    first: async () => {
      if (nextSql.includes('FROM user_sessions')) {
        return session ? { id: 1, handle: 'warren', role: 'admin', expiresAt: 9999999999 } : null;
      }
      if (nextSql.includes('FROM users')) {
        return {
          id: 1,
          email: 'owner@example.com',
          display_name: 'Warren',
          filing_status: 'mfj',
          state: 'CA',
          // The household profile (0006_household_profile.sql), on the row
          // rather than in the worker; the shortfall fixture below adds up
          // from these.
          monthly_living_expenses: 5_000,
          liquidity_floor_monthly: 200,
          kids_count: 3,
          augusta_days: 14,
          augusta_daily_rate: 350,
          scorp_salary_split: 0.5,
        };
      }
      return null;
    },
    all: async () => {
      if (nextSql.includes('FROM income_sources')) {
        return {
          results: [
            {
              id: 1,
              user_id: 1,
              label: 'W-2',
              type: 'w2',
              gross_annual: 240_000,
              employer: 'Greenput',
              has_401k_match: 1,
            },
          ],
        };
      }
      if (nextSql.includes('FROM liabilities')) {
        return {
          results: [
            {
              id: 10,
              user_id: 1,
              label: 'Personal loan',
              principal: 80_000,
              rate_apr: 0.12,
              min_payment_monthly: 650,
              type: 'personal_loan',
              priority: 1,
            },
          ],
        };
      }
      return { results: [] };
    },
    run: async () => ({
      success: true,
      meta: { changes: nextSql.startsWith('DELETE') ? (opts.deleteChanges ?? 1) : 1 },
    }),
  };
  const DB = {
    prepare(sql: string) {
      nextSql = sql.replace(/\s+/g, ' ').trim();
      prepared.push(nextSql);
      return stmt;
    },
  } as unknown as D1Database;
  return {
    prepared,
    env: {
      DB,
      ASSETS: {} as Fetcher,
      OWNER_EMAIL: 'owner@example.com',
      RP_NAME: 'PendingBusiness',
      RP_ID: 'localhost',
      RP_ORIGIN: 'http://localhost:8787',
    },
  };
}

const COOKIE = { Cookie: 'pb_auth=session-token' };
const ctx = {} as ExecutionContext;

function post(body: unknown): Request {
  return new Request('https://pendingbusiness.com/api/scenario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...COOKIE },
    body: JSON.stringify(body),
  });
}

function del(id: string, withSession = true): Request {
  return new Request(`https://pendingbusiness.com/api/scenarios/${id}`, {
    method: 'DELETE',
    headers: withSession ? COOKIE : {},
  });
}

const inserts = (f: Fake): string[] =>
  f.prepared.filter(s => s.startsWith('INSERT INTO scenarios'));

describe('POST /api/scenario — persist flag', () => {
  it('computes without writing a row when persist is omitted (the live preview)', async () => {
    const f = fake();
    const res = await postScenario(post({ greenputMonthlyNet: 5000 }), f.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { waterfall: { grossIn: number } };
    expect(body.waterfall.grossIn).toBe(5000);
    expect(inserts(f)).toEqual([]);
  });

  it('computes without writing a row when persist is false', async () => {
    const f = fake();
    const res = await postScenario(post({ greenputMonthlyNet: 5000, persist: false }), f.env);
    expect(res.status).toBe(200);
    expect(inserts(f)).toEqual([]);
  });

  it('writes exactly one row when persist is true (Save scenario)', async () => {
    const f = fake();
    const res = await postScenario(post({ greenputMonthlyNet: 5000, persist: true }), f.env);
    expect(res.status).toBe(200);
    expect(inserts(f)).toHaveLength(1);
  });

  it('refuses a non-boolean persist without computing or writing', async () => {
    const f = fake();
    const res = await postScenario(post({ greenputMonthlyNet: 5000, persist: 'yes' }), f.env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.field).toBe('persist');
    expect(inserts(f)).toEqual([]);
  });
});

describe('POST /api/scenario — a month that does not cover itself', () => {
  /*
   * The core's WARREN_SPARSE fixture is shaped by hand; this is the check
   * that the field survives the real loadSituation → routeCash → JSON path.
   * Fixture: 650 min payment + the row's 5_000 living expenses = 5_650
   * obligations, 200 liquidity floor, 33% tax reserve on 1_000 in.
   */
  it('reports the shortfall instead of clamping it away', async () => {
    const f = fake();
    const res = await postScenario(post({ greenputMonthlyNet: 1000 }), f.env);
    expect(res.status).toBe(200);
    const { waterfall } = (await res.json()) as {
      waterfall: {
        grossIn: number;
        taxReserve: number;
        fixedObligations: number;
        liquidityReserve: number;
        debtAvalanche: { amount: number };
        discretionary: number;
        shortfall: number;
      };
    };
    // 1_000 - 330 - 5_650 - 200 = -5_180
    expect(waterfall.shortfall).toBe(5_180);
    expect(waterfall.debtAvalanche.amount).toBe(0);
    expect(waterfall.discretionary).toBe(0);
    expect(
      waterfall.taxReserve +
        waterfall.fixedObligations +
        waterfall.liquidityReserve +
        waterfall.debtAvalanche.amount +
        waterfall.discretionary -
        waterfall.shortfall,
    ).toBeCloseTo(waterfall.grossIn, 2);
  });
});

describe('DELETE /api/scenarios/:id', () => {
  it('is 401 without a session and prepares no DELETE', async () => {
    const f = fake({ session: false });
    const res = await deleteScenario(del('20', false), f.env, ctx, { id: '20' });
    expect(res.status).toBe(401);
    expect(f.prepared.some(s => s.startsWith('DELETE'))).toBe(false);
  });

  it('is 400 for an id that is not a positive integer', async () => {
    const f = fake();
    for (const id of ['abc', '0', '-3', '1.5', '']) {
      const res = await deleteScenario(del(id), f.env, ctx, { id });
      expect(res.status, id).toBe(400);
    }
    expect(f.prepared.some(s => s.startsWith('DELETE'))).toBe(false);
  });

  it('binds both id and the session user into the DELETE, and 404s when nothing changed', async () => {
    const f = fake({ deleteChanges: 0 });
    const res = await deleteScenario(del('20'), f.env, ctx, { id: '20' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(f.prepared).toContain('DELETE FROM scenarios WHERE id = ? AND user_id = ?');
  });

  it('answers { ok, id } when a row was removed', async () => {
    const f = fake({ deleteChanges: 1 });
    const res = await deleteScenario(del('20'), f.env, ctx, { id: '20' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 20 });
  });
});
