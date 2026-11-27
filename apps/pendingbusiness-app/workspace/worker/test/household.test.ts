/**
 * GET / PATCH /api/household over the real migrations (helpers/sqlite-d1.ts).
 *
 * The literals this route replaces (`+ 5_000`, `200`, `3`, `14`, `350`,
 * `0.5` in routes/situation.ts) had no column, so a fake D1 would have been
 * the wrong instrument here: the property under test is that the columns
 * exist, default to 0, hold what PATCH writes, and reject what the CHECKs
 * reject — all schema facts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getHousehold, patchHousehold, HOUSEHOLD_FIELDS } from '../src/routes/household.js';
import { loadSituation } from '../src/routes/situation.js';
import type { Env } from '../src/env.js';
import { createSqliteD1, signIn, type SqliteD1 } from './helpers/sqlite-d1.js';

function envFor(d1: SqliteD1): Env {
  return {
    DB: d1.db,
    ASSETS: {} as Fetcher,
    OWNER_EMAIL: 'owner@example.com',
    RP_NAME: 'PendingBusiness',
    RP_ID: 'localhost',
    RP_ORIGIN: 'http://localhost:8787',
  };
}

function get(cookie?: string): Request {
  return new Request('https://pb.com/api/household', cookie ? { headers: { Cookie: cookie } } : {});
}
function patch(body: unknown, cookie?: string, rawBody?: string): Request {
  return new Request('https://pb.com/api/household', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: rawBody ?? JSON.stringify(body),
  });
}

interface Envelope {
  household?: Record<string, number>;
  error?: { code: string; message: string; field?: string };
}

describe('/api/household', () => {
  let d1: SqliteD1;
  let env: Env;
  let warren: string;
  let mallory: string;
  let malloryId: number;

  beforeEach(() => {
    d1 = createSqliteD1();
    env = envFor(d1);
    warren = signIn(d1.raw, { id: 1, handle: 'warren' }).cookie;
    const m = signIn(d1.raw, { handle: 'mallory' });
    mallory = m.cookie;
    malloryId = m.id;
  });

  it('is 401 without a session, for both verbs', async () => {
    expect((await getHousehold(get(), env)).status).toBe(401);
    expect((await patchHousehold(patch({ kidsCount: 1 }), env)).status).toBe(401);
  });

  it('GET returns the seeded profile for user 1 — the figures the dashboard showed before 0006', async () => {
    const res = await getHousehold(get(warren), env);
    expect(res.status).toBe(200);
    const { household } = (await res.json()) as Envelope;
    expect(household).toEqual({
      monthlyLivingExpenses: 5000,
      liquidityFloorMonthly: 200,
      kidsCount: 3,
      augustaDays: 14,
      augustaDailyRate: 350,
      scorpSalarySplit: 0.5,
    });
  });

  it('GET for a new user is zeros, not a plausible stranger’s numbers (only the salary split has a conventional default)', async () => {
    const { household } = (await (await getHousehold(get(mallory), env)).json()) as Envelope;
    expect(household).toEqual({
      monthlyLivingExpenses: 0,
      liquidityFloorMonthly: 0,
      kidsCount: 0,
      augustaDays: 0,
      augustaDailyRate: 0,
      scorpSalarySplit: 0.5,
    });
  });

  it('PATCH writes every field and GET reads it back', async () => {
    const body = {
      monthlyLivingExpenses: 1200,
      liquidityFloorMonthly: 500,
      kidsCount: 1,
      augustaDays: 10,
      augustaDailyRate: 425.5,
      scorpSalarySplit: 0.6,
    };
    const res = await patchHousehold(patch(body, mallory), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Envelope).household).toEqual(body);
    const again = (await (await getHousehold(get(mallory), env)).json()) as Envelope;
    expect(again.household).toEqual(body);
  });

  it('PATCH with a subset leaves the other columns alone', async () => {
    await patchHousehold(patch({ kidsCount: 2 }, warren), env);
    const { household } = (await (await getHousehold(get(warren), env)).json()) as Envelope;
    expect(household?.kidsCount).toBe(2);
    expect(household?.monthlyLivingExpenses).toBe(5000);
    expect(household?.augustaDays).toBe(14);
  });

  it('PATCH only ever touches the caller’s row', async () => {
    await patchHousehold(patch({ monthlyLivingExpenses: 999 }, mallory), env);
    const rows = d1.raw
      .prepare('SELECT id, monthly_living_expenses AS mle FROM users ORDER BY id')
      .all() as Array<{ id: number; mle: number }>;
    expect(rows).toEqual([
      { id: 1, mle: 5000 },
      { id: malloryId, mle: 999 },
    ]);
  });

  it('the situation is computed from the profile after a PATCH', async () => {
    await patchHousehold(
      patch({ monthlyLivingExpenses: 1200, liquidityFloorMonthly: 500, kidsCount: 1 }, warren),
      env,
    );
    const situation = await loadSituation(env, 1);
    const minPayments = situation!.liabilities.reduce((s, l) => s + l.minPaymentMonthly, 0);
    expect(minPayments).toBe(650); // the seed loan in 0002
    expect(situation!.fixedObligationsMonthly).toBe(1200 + minPayments);
    expect(situation!.liquidityFloorMonthly).toBe(500);
    expect(situation!.kidsCount).toBe(1);
    expect(situation!.augustaDays).toBe(14);
    expect(situation!.scorpSalarySplit).toBe(0.5);
  });

  describe('validation — a 400 naming the field, with a sentence the settings page can show verbatim', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ monthlyLivingExpenses: -1 }, 'monthlyLivingExpenses'],
      [{ monthlyLivingExpenses: 'lots' }, 'monthlyLivingExpenses'],
      [{ monthlyLivingExpenses: Number.NaN }, 'monthlyLivingExpenses'],
      [{ monthlyLivingExpenses: 1_000_001 }, 'monthlyLivingExpenses'],
      [{ liquidityFloorMonthly: -5 }, 'liquidityFloorMonthly'],
      [{ kidsCount: 1.5 }, 'kidsCount'],
      [{ kidsCount: 21 }, 'kidsCount'],
      [{ augustaDays: 15 }, 'augustaDays'],
      [{ augustaDays: -1 }, 'augustaDays'],
      [{ augustaDailyRate: -1 }, 'augustaDailyRate'],
      [{ scorpSalarySplit: 1.5 }, 'scorpSalarySplit'],
      [{ scorpSalarySplit: 50 }, 'scorpSalarySplit'],
    ];
    for (const [body, field] of cases) {
      it(`rejects ${JSON.stringify(body)}`, async () => {
        const res = await patchHousehold(patch(body, warren), env);
        expect(res.status).toBe(400);
        const { error } = (await res.json()) as Envelope;
        expect(error?.code).toBe('INVALID_INPUT');
        expect(error?.field).toBe(field);
        expect(error?.message).toMatch(/^[A-Za-z].*\.$/);
        expect(error?.message).toContain(field);
      });
    }

    it('refuses an unknown field instead of silently saving nothing', async () => {
      const res = await patchHousehold(patch({ kids: 3 }, warren), env);
      expect(res.status).toBe(400);
      const { error } = (await res.json()) as Envelope;
      expect(error?.code).toBe('UNKNOWN_FIELD');
      expect(error?.field).toBe('kids');
      for (const f of HOUSEHOLD_FIELDS) expect(error?.message).toContain(f);
    });

    it('refuses an empty object', async () => {
      const res = await patchHousehold(patch({}, warren), env);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error?.code).toBe('EMPTY_BODY');
    });

    it('refuses a non-object and non-JSON body', async () => {
      expect((await patchHousehold(patch([1], warren), env)).status).toBe(400);
      expect((await patchHousehold(patch(null, warren, '{nope'), env)).status).toBe(400);
    });

    it('a rejected PATCH writes nothing', async () => {
      await patchHousehold(patch({ kidsCount: 2, augustaDays: 99 }, warren), env);
      const { household } = (await (await getHousehold(get(warren), env)).json()) as Envelope;
      expect(household?.kidsCount).toBe(3);
      expect(household?.augustaDays).toBe(14);
    });
  });

  it('every bound the route enforces is also a CHECK the column enforces', () => {
    // The route validates first, so this exercises the migration directly:
    // a value the route would refuse must be one D1 refuses too, or the
    // route's bounds are the only thing between a bad value and the row.
    const attempts: Array<[string, number]> = [
      ['monthly_living_expenses', -1],
      ['liquidity_floor_monthly', -1],
      ['kids_count', -1],
      ['augusta_days', 15],
      ['augusta_daily_rate', -1],
      ['scorp_salary_split', 1.5],
    ];
    for (const [column, value] of attempts) {
      expect(
        () => d1.raw.prepare(`UPDATE users SET ${column} = ? WHERE id = 1`).run(value),
        `${column} = ${value}`,
      ).toThrow(/CHECK constraint failed/);
    }
  });
});
