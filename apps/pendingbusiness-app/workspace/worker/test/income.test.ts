/**
 * /api/income-sources over the real migrations (helpers/sqlite-d1.ts): the
 * CHECK on `type`, RETURNING, and the user_id scoping are all schema facts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  listIncomeSources,
  postIncomeSource,
  patchIncomeSource,
  deleteIncomeSource,
} from '../src/routes/income.js';
import { loadSituation } from '../src/routes/situation.js';
import type { Env } from '../src/env.js';
import { INCOME_TYPES } from '@pendingbusiness/core';
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
  return new Request('https://pb.com/api/income-sources', {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface Source {
  id: number;
  userId: number;
  label: string;
  type: string;
  grossAnnual: number;
  employer: string | null;
  has401kMatch: boolean;
}
interface Envelope {
  incomeSources?: Source[];
  incomeSource?: Source;
  error?: { code: string; message: string; field?: string };
}

const VALID = { label: 'Consulting', type: 'se', grossAnnual: 40_000 };

describe('/api/income-sources', () => {
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
    expect((await listIncomeSources(req('GET'), env)).status).toBe(401);
    expect((await postIncomeSource(req('POST', VALID), env)).status).toBe(401);
    expect((await patchIncomeSource(req('PATCH', VALID), env, ctx, { id: '1' })).status).toBe(401);
    expect((await deleteIncomeSource(req('DELETE'), env, ctx, { id: '1' })).status).toBe(401);
  });

  it('lists the seed rows for user 1 and nothing for a new user', async () => {
    const w = (await (
      await listIncomeSources(req('GET', undefined, warren), env)
    ).json()) as Envelope;
    expect(w.incomeSources?.map(s => s.label)).toEqual([
      'Primary job',
      'Household member',
      'Greenput',
    ]);
    const m = (await (
      await listIncomeSources(req('GET', undefined, mallory), env)
    ).json()) as Envelope;
    expect(m.incomeSources).toEqual([]);
  });

  it('POST creates a row scoped to the caller and returns it with its id', async () => {
    const res = await postIncomeSource(
      req('POST', { ...VALID, employer: 'Acme', has401kMatch: true }, mallory),
      env,
    );
    expect(res.status).toBe(201);
    const { incomeSource } = (await res.json()) as Envelope;
    expect(incomeSource).toMatchObject({
      ...VALID,
      userId: malloryId,
      employer: 'Acme',
      has401kMatch: true,
    });
    expect(incomeSource?.id).toBeGreaterThan(3);
    const situation = await loadSituation(env, malloryId);
    expect(situation?.incomeSources.map(s => s.label)).toEqual(['Consulting']);
  });

  it('POST defaults employer to null and has401kMatch to false', async () => {
    const { incomeSource } = (await (
      await postIncomeSource(req('POST', VALID, mallory), env)
    ).json()) as Envelope;
    expect(incomeSource?.employer).toBeNull();
    expect(incomeSource?.has401kMatch).toBe(false);
  });

  it('PATCH updates only the fields sent and reads back the whole row', async () => {
    const res = await patchIncomeSource(req('PATCH', { grossAnnual: 130_000 }, warren), env, ctx, {
      id: '1',
    });
    expect(res.status).toBe(200);
    const { incomeSource } = (await res.json()) as Envelope;
    expect(incomeSource).toMatchObject({
      id: 1,
      label: 'Primary job',
      grossAnnual: 130_000,
      has401kMatch: true,
    });
    expect((await loadSituation(env, 1))?.incomeSources[0]?.grossAnnual).toBe(130_000);
  });

  it('PATCH can clear the employer with null', async () => {
    const { incomeSource } = (await (
      await patchIncomeSource(req('PATCH', { employer: null }, warren), env, ctx, { id: '1' })
    ).json()) as Envelope;
    expect(incomeSource?.employer).toBeNull();
  });

  it('DELETE removes the row and the situation no longer counts it', async () => {
    const res = await deleteIncomeSource(req('DELETE', undefined, warren), env, ctx, { id: '1' });
    expect(res.status).toBe(200);
    expect((await loadSituation(env, 1))?.incomeSources.map(s => s.id)).toEqual([2, 3]);
  });

  it("another user's row is a 404 on PATCH and DELETE, and stays untouched", async () => {
    const p = await patchIncomeSource(req('PATCH', { label: 'mine now' }, mallory), env, ctx, {
      id: '1',
    });
    expect(p.status).toBe(404);
    const d = await deleteIncomeSource(req('DELETE', undefined, mallory), env, ctx, { id: '1' });
    expect(d.status).toBe(404);
    expect((await loadSituation(env, 1))?.incomeSources[0]?.label).toBe('Primary job');
  });

  it('a malformed id is a 400', async () => {
    expect(
      (await patchIncomeSource(req('PATCH', VALID, warren), env, ctx, { id: 'x' })).status,
    ).toBe(400);
    expect(
      (await deleteIncomeSource(req('DELETE', undefined, warren), env, ctx, { id: '0' })).status,
    ).toBe(400);
  });

  describe('validation', () => {
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ ...VALID, label: '' }, 'label'],
      [{ ...VALID, label: 'x'.repeat(121) }, 'label'],
      [{ ...VALID, type: 'wages' }, 'type'],
      [{ ...VALID, grossAnnual: -1 }, 'grossAnnual'],
      [{ ...VALID, grossAnnual: '40000' }, 'grossAnnual'],
      [{ ...VALID, grossAnnual: 10_000_001 }, 'grossAnnual'],
      [{ ...VALID, has401kMatch: 'yes' }, 'has401kMatch'],
      [{ ...VALID, employer: 42 }, 'employer'],
    ];
    for (const [body, field] of bad) {
      it(`POST rejects ${JSON.stringify(body).slice(0, 60)} naming ${field}`, async () => {
        const res = await postIncomeSource(req('POST', body, warren), env);
        expect(res.status).toBe(400);
        const { error } = (await res.json()) as Envelope;
        expect(error?.field).toBe(field);
        expect(error?.message).toMatch(/\.$/);
      });
    }

    it('POST requires label, type and grossAnnual', async () => {
      const res = await postIncomeSource(req('POST', { label: 'x' }, warren), env);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error?.field).toBe('type');
    });

    it('refuses unknown fields and empty PATCH bodies', async () => {
      const u = await postIncomeSource(req('POST', { ...VALID, notes: 'hi' }, warren), env);
      expect(((await u.json()) as Envelope).error?.code).toBe('UNKNOWN_FIELD');
      const e = await patchIncomeSource(req('PATCH', {}, warren), env, ctx, { id: '1' });
      expect(((await e.json()) as Envelope).error?.code).toBe('EMPTY_BODY');
    });

    it('offers the type vocabulary in the message, which is the CHECK’s vocabulary', async () => {
      const res = await postIncomeSource(req('POST', { ...VALID, type: 'nope' }, warren), env);
      const { error } = (await res.json()) as Envelope;
      for (const t of INCOME_TYPES) expect(error?.message).toContain(t);
    });
  });
});
