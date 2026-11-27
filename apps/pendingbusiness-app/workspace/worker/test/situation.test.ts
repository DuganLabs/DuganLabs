import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getSituation } from '../src/routes/situation.js';
import { FILING_LABELS, FILING_STATUSES, MODELLED_FILING_STATUSES } from '@pendingbusiness/core';
import type { Env } from '../src/env.js';

interface Row {
  id: number;
  user_id: number;
  label: string;
  type: string;
  gross_annual: number;
  employer: string | null;
  has_401k_match: number;
}

interface LiabRow {
  id: number;
  user_id: number;
  label: string;
  principal: number;
  rate_apr: number;
  min_payment_monthly: number;
  type: string;
  priority: number;
}

/**
 * A `users` row as `loadSituation` SELECTs it: identity plus the household
 * columns from 0006_household_profile.sql. Tests override the household
 * fields they are about; the rest default to the migration's defaults.
 */
function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    email: 'a@b.com',
    display_name: 'A',
    filing_status: 'mfj',
    state: 'CA',
    monthly_living_expenses: 0,
    liquidity_floor_monthly: 0,
    kids_count: 0,
    augusta_days: 0,
    augusta_daily_rate: 0,
    scorp_salary_split: 0.5,
    ...overrides,
  };
}

/**
 * Routes a sequence of D1 prepare/bind/first/all calls back to canned data
 * keyed by the first 30 chars of the SQL. Tests pass `tables` for the rows
 * each lookup should return; missing keys yield empty results. The session
 * lookup (adapter.currentUser) resolves any cookie to user id 1 — cross-user
 * isolation is covered separately in tenancy.test.ts.
 */
function fakeDB(tables: {
  user?: Record<string, unknown> | null;
  income?: Row[];
  liabilities?: LiabRow[];
}) {
  let nextSql = '';
  const stmt = {
    bind() {
      return stmt;
    },
    first: async () => {
      if (nextSql.includes('FROM user_sessions')) {
        return { id: 1, handle: 'warren', role: 'admin', expiresAt: 9999999999 };
      }
      if (nextSql.includes('FROM users')) return tables.user ?? null;
      return null;
    },
    all: async () => {
      if (nextSql.includes('FROM income_sources')) return { results: tables.income ?? [] };
      if (nextSql.includes('FROM liabilities')) return { results: tables.liabilities ?? [] };
      return { results: [] };
    },
    run: async () => ({ success: true }),
  };
  const db = {
    prepare(sql: string) {
      nextSql = sql;
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

function fakeEnv(db: D1Database): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
  };
}

const req = new Request('https://pendingbusiness.com/api/situation', {
  headers: { Cookie: 'pb_auth=session-token' },
});

describe('GET /api/situation', () => {
  it('returns 401 without a session', async () => {
    const anon = new Request('https://pendingbusiness.com/api/situation');
    const res = await getSituation(anon, fakeEnv(fakeDB({ user: null })));
    expect(res.status).toBe(401);
  });

  it('returns 404 NOT_FOUND when the caller has no profile row', async () => {
    const res = await getSituation(req, fakeEnv(fakeDB({ user: null })));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns the projection shape when owner exists', async () => {
    const env = fakeEnv(
      fakeDB({
        user: userRow({ email: 'warren@example.com', display_name: 'Warren' }),
        income: [
          {
            id: 1,
            user_id: 1,
            label: 'W-2 day job',
            type: 'w2',
            gross_annual: 240_000,
            employer: 'Greenput',
            has_401k_match: 1,
          },
        ],
        liabilities: [],
      }),
    );
    const res = await getSituation(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      situation: { incomeSources: unknown[]; kidsCount: number };
      projectedMagi: number;
      stackedMarginal: number;
      nextThreshold: { name: string };
      scorpLadder: unknown[];
      augusta: { taxBenefit: number };
      ctc: { baseCredit: number; kids: number; currentAnnual: number };
      salt: { cap2026Base: number; currentAnnual: number };
    };
    expect(body.situation.incomeSources).toHaveLength(1);
    expect(body.projectedMagi).toBe(240_000);
    expect(body.scorpLadder.length).toBeGreaterThan(0);
    expect(body.ctc.baseCredit).toBe(2_200);
    expect(body.salt.cap2026Base).toBe(40_400);
    expect(typeof body.stackedMarginal).toBe('number');
  });

  it('sums only W-2 income into projected MAGI (ignores SE/k1/other)', async () => {
    const env = fakeEnv(
      fakeDB({
        user: userRow(),
        income: [
          {
            id: 1,
            user_id: 1,
            label: 'W-2',
            type: 'w2',
            gross_annual: 100_000,
            employer: null,
            has_401k_match: 0,
          },
          {
            id: 2,
            user_id: 1,
            label: 'SE',
            type: 'se',
            gross_annual: 50_000,
            employer: null,
            has_401k_match: 0,
          },
          {
            id: 3,
            user_id: 1,
            label: 'K-1',
            type: 'k1',
            gross_annual: 25_000,
            employer: null,
            has_401k_match: 0,
          },
        ],
        liabilities: [],
      }),
    );
    const body = (await (await getSituation(req, env)).json()) as { projectedMagi: number };
    expect(body.projectedMagi).toBe(100_000);
  });

  it('includes a four-rung S-Corp ladder for transition modeling', async () => {
    const env = fakeEnv(
      fakeDB({
        user: userRow(),
        income: [],
        liabilities: [],
      }),
    );
    const body = (await (await getSituation(req, env)).json()) as {
      scorpLadder: { netProfit: number; ficaSavings: number }[];
    };
    expect(body.scorpLadder.map(r => r.netProfit)).toEqual([80_000, 100_000, 145_000, 200_000]);
    for (const rung of body.scorpLadder) {
      expect(typeof rung.ficaSavings).toBe('number');
    }
  });

  /*
   * These three used to be literals in loadSituation (`+ 5_000`, `200`, `3`)
   * returned identically for every user. On that code the assertions below
   * read 5_650, 200 and 3 and fail; they pass only when the row is the source.
   */
  it('computes fixed obligations, the liquidity floor and kids from the user’s own row', async () => {
    const env = fakeEnv(
      fakeDB({
        user: userRow({
          monthly_living_expenses: 1_200,
          liquidity_floor_monthly: 500,
          kids_count: 1,
        }),
        income: [],
        liabilities: [
          {
            id: 1,
            user_id: 1,
            label: 'Loan',
            principal: 25_000,
            rate_apr: 0.09,
            min_payment_monthly: 650,
            type: 'personal_loan',
            priority: 1,
          },
          {
            id: 2,
            user_id: 1,
            label: 'Card',
            principal: 4_000,
            rate_apr: 0.24,
            min_payment_monthly: 120,
            type: 'cc',
            priority: 100,
          },
        ],
      }),
    );
    const body = (await (await getSituation(req, env)).json()) as {
      situation: {
        fixedObligationsMonthly: number;
        liquidityFloorMonthly: number;
        kidsCount: number;
      };
      ctc: { kids: number };
    };
    expect(body.situation.fixedObligationsMonthly).toBe(1_200 + 650 + 120);
    expect(body.situation.liquidityFloorMonthly).toBe(500);
    expect(body.situation.kidsCount).toBe(1);
    expect(body.ctc.kids).toBe(1);
  });

  it('a user who has entered nothing gets zeros, not a plausible stranger’s figures', async () => {
    const env = fakeEnv(fakeDB({ user: userRow(), income: [], liabilities: [] }));
    const body = (await (await getSituation(req, env)).json()) as {
      situation: {
        fixedObligationsMonthly: number;
        liquidityFloorMonthly: number;
        kidsCount: number;
      };
      augusta: { rentalDays: number; dailyRate: number; taxFreeIncome: number };
    };
    expect(body.situation.fixedObligationsMonthly).toBe(0);
    expect(body.situation.liquidityFloorMonthly).toBe(0);
    expect(body.situation.kidsCount).toBe(0);
    expect(body.augusta).toMatchObject({ rentalDays: 0, dailyRate: 0, taxFreeIncome: 0 });
  });

  it('computes the Augusta benefit from the user’s days and rate, not 14 × $350', async () => {
    const env = fakeEnv(
      fakeDB({
        user: userRow({ augusta_days: 10, augusta_daily_rate: 500 }),
        income: [
          {
            id: 1,
            user_id: 1,
            label: 'W-2',
            type: 'w2',
            gross_annual: 240_000,
            employer: null,
            has_401k_match: 0,
          },
        ],
        liabilities: [],
      }),
    );
    const body = (await (await getSituation(req, env)).json()) as {
      augusta: { rentalDays: number; dailyRate: number; taxFreeIncome: number; taxBenefit: number };
    };
    expect(body.augusta.rentalDays).toBe(10);
    expect(body.augusta.dailyRate).toBe(500);
    expect(body.augusta.taxFreeIncome).toBe(5_000);
    expect(body.augusta.taxBenefit).toBeGreaterThan(0);
  });

  it('splits the S-Corp ladder at the user’s salary share, not 50/50', async () => {
    const env = fakeEnv(
      fakeDB({ user: userRow({ scorp_salary_split: 0.6 }), income: [], liabilities: [] }),
    );
    const body = (await (await getSituation(req, env)).json()) as {
      scorpLadder: {
        netProfit: number;
        scorp: { w2Portion: number; distributionPortion: number };
      }[];
    };
    expect(body.scorpLadder[0]).toMatchObject({
      netProfit: 80_000,
      scorp: { w2Portion: 48_000, distributionPortion: 32_000 },
    });
  });
});

/**
 * The literals cannot come back. `loadSituation` used to carry `+ 5_000`,
 * `liquidityFloorMonthly: 200` and `kidsCount: 3`, and `getSituation` carried
 * `augustaBenefit(14, 350, …)` and `compareSoleVsScorp(net, 0.5)` — one set
 * of numbers for every user. Same shape as schema-drift.test.ts: read the
 * source off disk and assert on it, so the guard cannot be satisfied by a
 * mock that happens to return the same numbers.
 */
describe('routes/situation.ts carries no household literals', () => {
  const source = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/routes/situation.ts'),
    'utf8',
  );
  const loader = source.slice(source.indexOf('export async function loadSituation'));

  it('loadSituation has no invented living expenses, floor or kids', () => {
    expect(loader).not.toMatch(/5[_,]?000/);
    expect(loader).not.toMatch(/liquidityFloorMonthly:\s*\d/);
    expect(loader).not.toMatch(/kidsCount:\s*\d/);
    expect(loader).not.toMatch(/: 200,/);
    expect(loader).not.toMatch(/: 3,/);
  });

  it('getSituation takes the Augusta days/rate and the salary split from the situation', () => {
    expect(source).not.toMatch(/augustaBenefit\(\s*\d/);
    expect(source).not.toMatch(/compareSoleVsScorp\([^)]*0\.5\)/);
    expect(source).toMatch(/augustaBenefit\(situation\.augustaDays, situation\.augustaDailyRate/);
    expect(source).toMatch(/compareSoleVsScorp\(net, situation\.scorpSalarySplit\)/);
  });

  it('leaves the published 2026 tax constants alone (constitution #4)', () => {
    expect(source).toContain('const ctcBase = 2_200');
    expect(source).toContain('saltAfterPhaseout(40_400');
  });
});

/**
 * The route used to call `stackedMarginal(w2, FEDERAL_MFJ_2026, CA_MFJ_2026)`
 * with the tables hardcoded, never reading `filing_status` for the math — so a
 * single filer got married-filing-jointly brackets, an MFJ SALT cap and MFJ
 * NIIT/CTC thresholds, under a heading that said MFJ. Wrong tax numbers are
 * worse than no tax numbers (constitution item 4).
 *
 * These iterate the vocabulary rather than naming statuses, so they keep
 * meaning the same thing after another status's brackets are published: the
 * modelled ones must compute, the rest must refuse.
 */
describe('GET /api/situation respects the caller’s filing status', () => {
  function envFor(filing_status: string): Env {
    return fakeEnv(
      fakeDB({
        user: userRow({ filing_status }),
        income: [
          {
            id: 1,
            user_id: 1,
            label: 'W-2',
            type: 'w2',
            gross_annual: 240_000,
            employer: null,
            has_401k_match: 0,
          },
        ],
        liabilities: [],
      }),
    );
  }

  for (const status of MODELLED_FILING_STATUSES) {
    it(`computes a projection for ${status}, which has brackets`, async () => {
      const res = await getSituation(req, envFor(status));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        stackedMarginal: number;
        situation: { filingStatus: string };
      };
      expect(body.situation.filingStatus).toBe(status);
      expect(body.stackedMarginal).toBeGreaterThan(0);
    });
  }

  const unmodelled = FILING_STATUSES.filter(s => !MODELLED_FILING_STATUSES.includes(s));

  for (const status of unmodelled) {
    it(`refuses to invent a projection for ${status}, which has none`, async () => {
      const res = await getSituation(req, envFor(status));
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('FILING_STATUS_NOT_MODELLED');
      // The message has to name what IS supported, or the user is stuck.
      expect(body.error.message).toContain(FILING_LABELS[MODELLED_FILING_STATUSES[0]!]);
    });

    it(`leaks no computed tax figure alongside the ${status} refusal`, async () => {
      const res = await getSituation(req, envFor(status));
      const body = (await res.json()) as Record<string, unknown>;
      for (const key of ['stackedMarginal', 'nextThreshold', 'salt', 'ctc', 'scorpLadder']) {
        expect(body[key], `${key} must not be present`).toBeUndefined();
      }
    });
  }

  it('covers every status the DB can hold — none falls through unhandled', () => {
    expect(MODELLED_FILING_STATUSES.length + unmodelled.length).toBe(FILING_STATUSES.length);
  });
});
