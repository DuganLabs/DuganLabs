/**
 * /api/liabilities over the real migrations (helpers/sqlite-d1.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  listLiabilities,
  postLiability,
  patchLiability,
  deleteLiability,
} from '../src/routes/liabilities.js';
import { loadSituation } from '../src/routes/situation.js';
import type { Env } from '../src/env.js';
import { LIABILITY_TYPES } from '@pendingbusiness/core';
import { createSqliteD1, signIn, type SqliteD1 } from './helpers/sqlite-d1.js';

const ctx: ExecutionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
};

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

function req(method: string, body?: unknown, cookie?: string): Request {
  return new Request('https://pb.com/api/liabilities', {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface Row {
  id: number;
  userId: number;
  label: string;
  principal: number;
  rateApr: number;
  minPaymentMonthly: number;
  type: string;
  priority: number;
}
interface Envelope {
  liabilities?: Row[];
  liability?: Row;
  error?: { code: string; message: string; field?: string };
}

const VALID = {
  label: 'Card',
  type: 'cc',
  principal: 4_000,
  rateApr: 0.24,
  minPaymentMonthly: 120,
};

describe('/api/liabilities', () => {
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

  it('is 401 without a session on every verb', async () => {
    expect((await listLiabilities(req('GET'), env)).status).toBe(401);
    expect((await postLiability(req('POST', VALID), env)).status).toBe(401);
    expect((await patchLiability(req('PATCH', VALID), env, ctx, { id: '1' })).status).toBe(401);
    expect((await deleteLiability(req('DELETE'), env, ctx, { id: '1' })).status).toBe(401);
  });

  it('lists the seed loan for user 1 and nothing for a new user', async () => {
    const w = (await (
      await listLiabilities(req('GET', undefined, warren), env)
    ).json()) as Envelope;
    expect(w.liabilities?.map(l => l.label)).toEqual(['Example personal loan']);
    const m = (await (
      await listLiabilities(req('GET', undefined, mallory), env)
    ).json()) as Envelope;
    expect(m.liabilities).toEqual([]);
  });

  it('POST creates a row for the caller with the default priority, and the waterfall sees it', async () => {
    const res = await postLiability(req('POST', VALID, mallory), env);
    expect(res.status).toBe(201);
    const { liability } = (await res.json()) as Envelope;
    expect(liability).toMatchObject({ ...VALID, userId: malloryId, priority: 100 });
    const situation = await loadSituation(env, malloryId);
    expect(situation?.liabilities.map(l => l.label)).toEqual(['Card']);
    expect(situation?.fixedObligationsMonthly).toBe(120); // + 0 living expenses for a new user
  });

  it('lists in avalanche order: priority first, then APR descending', async () => {
    await postLiability(req('POST', { ...VALID, label: 'Low APR', rateApr: 0.05 }, mallory), env);
    await postLiability(req('POST', { ...VALID, label: 'High APR', rateApr: 0.29 }, mallory), env);
    await postLiability(
      req('POST', { ...VALID, label: 'Pinned', rateApr: 0.01, priority: 1 }, mallory),
      env,
    );
    const { liabilities } = (await (
      await listLiabilities(req('GET', undefined, mallory), env)
    ).json()) as Envelope;
    expect(liabilities?.map(l => l.label)).toEqual(['Pinned', 'High APR', 'Low APR']);
  });

  it('PATCH updates only the fields sent', async () => {
    const res = await patchLiability(
      req('PATCH', { principal: 20_000, rateApr: 0.08 }, warren),
      env,
      ctx,
      { id: '1' },
    );
    expect(res.status).toBe(200);
    const { liability } = (await res.json()) as Envelope;
    expect(liability).toMatchObject({
      id: 1,
      label: 'Example personal loan',
      principal: 20_000,
      rateApr: 0.08,
      minPaymentMonthly: 650,
    });
  });

  it('DELETE removes the row and fixed obligations drop by its minimum payment', async () => {
    const before = (await loadSituation(env, 1))!.fixedObligationsMonthly;
    const res = await deleteLiability(req('DELETE', undefined, warren), env, ctx, { id: '1' });
    expect(res.status).toBe(200);
    const after = (await loadSituation(env, 1))!;
    expect(after.liabilities).toEqual([]);
    expect(after.fixedObligationsMonthly).toBe(before - 650);
  });

  it("another user's row is a 404 on PATCH and DELETE, and stays untouched", async () => {
    expect(
      (await patchLiability(req('PATCH', { label: 'x' }, mallory), env, ctx, { id: '1' })).status,
    ).toBe(404);
    expect(
      (await deleteLiability(req('DELETE', undefined, mallory), env, ctx, { id: '1' })).status,
    ).toBe(404);
    expect((await loadSituation(env, 1))?.liabilities[0]?.label).toBe('Example personal loan');
  });

  describe('validation', () => {
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ ...VALID, label: '' }, 'label'],
      [{ ...VALID, type: 'car' }, 'type'],
      [{ ...VALID, principal: -1 }, 'principal'],
      [{ ...VALID, rateApr: 24 }, 'rateApr'],
      [{ ...VALID, rateApr: -0.1 }, 'rateApr'],
      [{ ...VALID, minPaymentMonthly: 'lots' }, 'minPaymentMonthly'],
      [{ ...VALID, priority: 0 }, 'priority'],
      [{ ...VALID, priority: 1.5 }, 'priority'],
    ];
    for (const [body, field] of bad) {
      it(`POST rejects ${JSON.stringify(body).slice(0, 60)} naming ${field}`, async () => {
        const res = await postLiability(req('POST', body, warren), env);
        expect(res.status).toBe(400);
        const { error } = (await res.json()) as Envelope;
        expect(error?.field).toBe(field);
        expect(error?.message).toMatch(/\.$/);
      });
    }

    it('says what an APR fraction means, because 24 for 24% is the obvious mistake', async () => {
      const res = await postLiability(req('POST', { ...VALID, rateApr: 24 }, warren), env);
      expect(((await res.json()) as Envelope).error?.message).toContain('0.09 means 9% APR');
    });

    it('refuses unknown fields and empty PATCH bodies', async () => {
      const u = await postLiability(req('POST', { ...VALID, notes: 'hi' }, warren), env);
      expect(((await u.json()) as Envelope).error?.code).toBe('UNKNOWN_FIELD');
      const e = await patchLiability(req('PATCH', {}, warren), env, ctx, { id: '1' });
      expect(((await e.json()) as Envelope).error?.code).toBe('EMPTY_BODY');
    });

    it('offers the type vocabulary in the message, which is the CHECK’s vocabulary', async () => {
      const res = await postLiability(req('POST', { ...VALID, type: 'nope' }, warren), env);
      const { error } = (await res.json()) as Envelope;
      for (const t of LIABILITY_TYPES) expect(error?.message).toContain(t);
    });
  });
});
