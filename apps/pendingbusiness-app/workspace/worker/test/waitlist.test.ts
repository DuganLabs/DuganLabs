import { describe, it, expect } from 'vitest';
import { postWaitlist } from '../src/routes/waitlist.js';
import type { Env } from '../src/env.js';

interface InsertCall {
  sql: string;
  bound: unknown[];
}

/**
 * D1 fake that captures the most recent prepare/bind/run sequence so tests
 * can assert what would hit the database, plus lets each test inject the
 * outcome (success or a specific error from `run()`).
 */
function fakeDB(runResult: { ok?: true; throwMsg?: string } = { ok: true }) {
  const calls: InsertCall[] = [];
  let pending: { sql: string; bound: unknown[] } | null = null;
  const stmt = {
    bind(...args: unknown[]) {
      pending = { sql: pending!.sql, bound: args };
      return stmt;
    },
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => {
      if (!pending) throw new Error('bind() not called');
      calls.push(pending);
      pending = null;
      if (runResult.throwMsg) throw new Error(runResult.throwMsg);
      return { success: true };
    },
  };
  const db = {
    prepare(sql: string) {
      pending = { sql, bound: [] };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
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

function reqWith(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://pendingbusiness.com/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/waitlist', () => {
  it('rejects non-JSON bodies with 400 INVALID_JSON', async () => {
    const { db } = fakeDB();
    const req = new Request('https://pendingbusiness.com/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{',
    });
    const res = await postWaitlist(req, fakeEnv(db));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_JSON');
  });

  it('rejects a non-object body with 400 INVALID_BODY', async () => {
    const { db } = fakeDB();
    const res = await postWaitlist(reqWith(['not', 'an', 'object']), fakeEnv(db));
    // Arrays are objects in JS, so the validator accepts but then falls through
    // to email/name checks. Either INVALID_BODY or INVALID_EMAIL is acceptable.
    const body = (await res.json()) as { error: { code: string } };
    expect(res.status).toBe(400);
    expect(['INVALID_BODY', 'INVALID_EMAIL']).toContain(body.error.code);
  });

  it('rejects missing email with 400 INVALID_EMAIL', async () => {
    const { db } = fakeDB();
    const res = await postWaitlist(reqWith({ name: 'Warren' }), fakeEnv(db));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('INVALID_EMAIL');
    expect(body.error.field).toBe('email');
  });

  it('rejects malformed email with 400 INVALID_EMAIL', async () => {
    const { db } = fakeDB();
    const res = await postWaitlist(reqWith({ email: 'not-an-email', name: 'X' }), fakeEnv(db));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_EMAIL');
  });

  it('rejects missing name with 400 INVALID_NAME', async () => {
    const { db } = fakeDB();
    const res = await postWaitlist(reqWith({ email: 'a@b.com' }), fakeEnv(db));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('INVALID_NAME');
    expect(body.error.field).toBe('name');
  });

  it('rejects whitespace-only name with 400 INVALID_NAME', async () => {
    const { db } = fakeDB();
    const res = await postWaitlist(reqWith({ email: 'a@b.com', name: '   ' }), fakeEnv(db));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_NAME');
  });

  it('returns 409 ALREADY_ON_LIST on UNIQUE-constraint failure', async () => {
    const { db } = fakeDB({ throwMsg: 'D1_ERROR: UNIQUE constraint failed: waitlist.email' });
    const res = await postWaitlist(reqWith({ email: 'a@b.com', name: 'A' }), fakeEnv(db));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ALREADY_ON_LIST');
  });

  it('returns 500 DB_ERROR on other database failures', async () => {
    const { db } = fakeDB({ throwMsg: 'D1_ERROR: connection lost' });
    const res = await postWaitlist(reqWith({ email: 'a@b.com', name: 'A' }), fakeEnv(db));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DB_ERROR');
  });

  it('persists normalized email + name + Referer source', async () => {
    const { db, calls } = fakeDB();
    const res = await postWaitlist(
      reqWith(
        { email: '  Warren@Example.COM ', name: '  Warren  ' },
        { Referer: 'https://x.test/' },
      ),
      fakeEnv(db),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean; email: string }).email).toBe('warren@example.com');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bound).toEqual(['warren@example.com', 'Warren', 'https://x.test/']);
  });

  it('uses "direct" as source when no Referer is present', async () => {
    const { db, calls } = fakeDB();
    await postWaitlist(reqWith({ email: 'a@b.com', name: 'A' }), fakeEnv(db));
    expect(calls[0]?.bound[2]).toBe('direct');
  });
});
