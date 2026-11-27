// Driven over createSqliteD1 against the real schema.sql — not a mocked
// env.DB. The handler's correctness rests on UNIQUE(workspace_id, weekday),
// the CHECK on weekday, the FK to workspaces and the batch being one
// transaction, and a vi.fn() database can vouch for none of those.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  checkWire,
  describeWireProblems,
  WIRE_WORKSPACE_AVAILABILITY,
  type WorkspaceAvailability,
} from '@greenput/shared/models';
import { resolveAvailabilityForDate } from '@greenput/shared/utils';
import type { Env } from '../env';
import { availabilityRouter } from './availability';

const SCHEMA = resolve(__dirname, '../../../../schema.sql');
const WS1 = '00000000-0000-4000-8000-0000000000b1';
const WS2 = '00000000-0000-4000-8000-0000000000b2';
const USER1 = '00000000-0000-4000-8000-0000000000c1';
const USER2 = '00000000-0000-4000-8000-0000000000c2';

const SEED = `
INSERT INTO workspaces (id, name, slug, created_at) VALUES ('${WS1}', 'Rivertown Electric', 'rivertown', '2026-01-01T00:00:00.000Z');
INSERT INTO workspaces (id, name, slug, created_at) VALUES ('${WS2}', 'Other Plumbing', 'other', '2026-01-01T00:00:00.000Z');
INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${USER1}', '${WS1}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${USER2}', '${WS2}', 'Sam', 'Lee', 'sam@other.example', 'owner', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`;

const WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isOpen: weekday >= 1 && weekday <= 5,
  opensAt: '08:00',
  closesAt: '17:00',
}));

const FULL = {
  timezone: 'America/Chicago',
  bookingLeadHours: 48,
  bookingHorizonDays: 21,
  travelBufferMinutes: 45,
  concurrentJobs: 2,
  week: WEEK,
  exceptions: [] as Array<{
    date: string;
    isOpen: boolean;
    opensAt?: string;
    closesAt?: string;
    reason?: string;
  }>,
};

type Body = { data: WorkspaceAvailability } | { error: { code: string } };

describe('/api/availability', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA], sql: [SEED] });
    env = { DB: sqlite.db } as unknown as Env;
  });
  afterEach(() => sqlite.close());

  function request(
    method: 'GET' | 'PUT',
    body?: unknown,
    {
      workspaceId = WS1,
      userId = USER1,
      role = 'owner',
    }: { workspaceId?: string; userId?: string; role?: string } = {},
  ): Request {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const req = new Request('https://api.greenput.com/api/availability', init);
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = workspaceId;
    mutable['user'] = { id: userId, role };
    return req;
  }

  async function call(
    method: 'GET' | 'PUT',
    body?: unknown,
    who?: { workspaceId?: string; userId?: string; role?: string },
  ): Promise<{ status: number; body: Body }> {
    const res = await availabilityRouter.fetch(request(method, body, who), env);
    return { status: res.status, body: (await res.json()) as Body };
  }

  function data(body: Body): WorkspaceAvailability {
    if (!('data' in body)) throw new Error(JSON.stringify(body));
    return body.data;
  }

  // ── The rule the ticket is about ─────────────────────────────

  it('a workspace with no rows is not bookable — never "always open"', async () => {
    const { status, body } = await call('GET');
    expect(status).toBe(200);
    const av = data(body);
    expect(av.bookable).toBe(false);
    expect(av.week).toEqual([]);
    expect(av.exceptions).toEqual([]);
    expect(av.timezone).toBeUndefined();
    // The schema defaults, not zeros, so the form opens on sensible numbers.
    expect(av.bookingLeadHours).toBe(24);
    expect(av.bookingHorizonDays).toBe(30);
    expect(av.travelBufferMinutes).toBe(30);
    expect(av.concurrentJobs).toBe(1);
    expect(
      describeWireProblems(checkWire(WIRE_WORKSPACE_AVAILABILITY, av)),
    ).toBe('');
  });

  it('PUT seven rows reads back seven, in weekday order, through the contract', async () => {
    const put = await call('PUT', FULL);
    expect(put.status).toBe(200);
    const written = data(put.body);
    expect(written.week).toHaveLength(7);
    expect(written.bookable).toBe(true);

    const { body } = await call('GET');
    const av = data(body);
    expect(
      describeWireProblems(checkWire(WIRE_WORKSPACE_AVAILABILITY, av)),
    ).toBe('');
    expect(av.week.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(av.week.map((d) => d.isOpen)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(av.week[1]).toMatchObject({ opensAt: '08:00', closesAt: '17:00' });
    expect(av.timezone).toBe('America/Chicago');
    expect(av.bookingLeadHours).toBe(48);
    expect(av.bookingHorizonDays).toBe(21);
    expect(av.travelBufferMinutes).toBe(45);
    expect(av.concurrentJobs).toBe(2);
    expect(av.bookable).toBe(true);
  });

  it('a second PUT replaces the week rather than adding to it', async () => {
    await call('PUT', FULL);
    const flipped = {
      ...FULL,
      week: WEEK.map((d) => ({ ...d, isOpen: !d.isOpen })),
    };
    await call('PUT', flipped);
    expect(sqlite.rows('workspace_availability')).toHaveLength(7);
    const av = data((await call('GET')).body);
    expect(av.week.map((d) => d.isOpen)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('an exception closing a normally-open day wins', async () => {
    await call('PUT', {
      ...FULL,
      exceptions: [{ date: '2026-12-25', isOpen: false, reason: 'Christmas' }],
    });
    const av = data((await call('GET')).body);
    expect(av.exceptions).toHaveLength(1);
    expect(av.exceptions[0]).toMatchObject({
      date: '2026-12-25',
      isOpen: false,
      reason: 'Christmas',
    });
    // 2026-12-25 is a Friday, which the week says is open 08:00–17:00.
    const friday = av.week.find((d) => d.weekday === 5);
    expect(friday?.isOpen).toBe(true);
    const resolved = resolveAvailabilityForDate(av, '2026-12-25');
    expect(resolved.source).toBe('exception');
    expect(resolved.isOpen).toBe(false);
    expect(resolved.opensAt).toBeUndefined();
  });

  it('an exception opening a normally-closed day wins the other way', async () => {
    await call('PUT', {
      ...FULL,
      exceptions: [
        {
          date: '2026-09-13', // a Sunday
          isOpen: true,
          opensAt: '10:00',
          closesAt: '14:00',
        },
      ],
    });
    const av = data((await call('GET')).body);
    expect(resolveAvailabilityForDate(av, '2026-09-13')).toMatchObject({
      source: 'exception',
      isOpen: true,
      opensAt: '10:00',
      closesAt: '14:00',
    });
  });

  it("another workspace's rows are never visible", async () => {
    await call('PUT', FULL, { workspaceId: WS2, userId: USER2 });
    await call(
      'PUT',
      {
        ...FULL,
        timezone: 'America/Denver',
        exceptions: [{ date: '2026-07-04', isOpen: false }],
      },
      { workspaceId: WS2, userId: USER2 },
    );

    const mine = data((await call('GET')).body);
    expect(mine.week).toEqual([]);
    expect(mine.exceptions).toEqual([]);
    expect(mine.timezone).toBeUndefined();
    expect(mine.bookable).toBe(false);

    // And writing mine does not touch theirs.
    await call('PUT', FULL);
    const theirs = data(
      (await call('GET', undefined, { workspaceId: WS2, userId: USER2 })).body,
    );
    expect(theirs.timezone).toBe('America/Denver');
    expect(theirs.exceptions).toHaveLength(1);
    expect(sqlite.rows('workspace_availability')).toHaveLength(14);
  });

  // ── Guards ──────────────────────────────────────────────────

  it.each(['tech', 'office'])(
    'a %s role gets 403 on GET and PUT',
    async (role) => {
      const get = await call('GET', undefined, { role });
      expect(get.status).toBe(403);
      const put = await call('PUT', FULL, { role });
      expect(put.status).toBe(403);
      expect(sqlite.rows('workspace_availability')).toHaveLength(0);
    },
  );

  it('an admin may read and write, not only the owner', async () => {
    expect((await call('PUT', FULL, { role: 'admin' })).status).toBe(200);
    expect((await call('GET', undefined, { role: 'admin' })).status).toBe(200);
  });

  it('refuses a partial week — six days is not a state', async () => {
    const { status, body } = await call('PUT', {
      ...FULL,
      week: WEEK.slice(0, 6),
    });
    expect(status).toBe(400);
    expect('error' in body && body.error.code).toBe('VALIDATION_ERROR');
    expect(sqlite.rows('workspace_availability')).toHaveLength(0);
  });

  it('refuses an open day with no hours, and a timezone the runtime cannot resolve', async () => {
    const noHours = await call('PUT', {
      ...FULL,
      week: WEEK.map((d) =>
        d.weekday === 1 ? { weekday: 1, isOpen: true } : d,
      ),
    });
    expect(noHours.status).toBe(400);
    const badZone = await call('PUT', { ...FULL, timezone: 'Central Time' });
    expect(badZone.status).toBe(400);
  });

  it('a null timezone is stored and leaves the workspace not bookable', async () => {
    const { status, body } = await call('PUT', { ...FULL, timezone: null });
    expect(status).toBe(200);
    const av = data(body);
    expect(av.timezone).toBeUndefined();
    expect(av.week).toHaveLength(7);
    expect(av.bookable).toBe(false);
  });

  it('closed days store no hours, whatever the form sent', async () => {
    await call('PUT', FULL);
    const sunday = sqlite
      .rows<{ weekday: number; opens_at: string | null; is_open: number }>(
        'workspace_availability',
      )
      .find((r) => r.weekday === 0);
    // The validator lets a closed day carry hours so the form can restore
    // them; they are still stored (the row is the form's memory), but is_open
    // is what the resolver reads.
    expect(sunday?.is_open).toBe(0);
    expect(sunday?.opens_at).toBe('08:00');
  });

  // ── Atomicity and the audit trail ───────────────────────────

  it('a rejected batch leaves the previous week intact', async () => {
    await call('PUT', FULL);
    // The validator rejects duplicates, so reach the database directly with a
    // statement UNIQUE(workspace_id, weekday) will refuse, inside a batch that
    // first deleted the week. D1 runs a batch as one transaction; so does the
    // test double, with a real BEGIN/ROLLBACK.
    const stmts = [
      env.DB.prepare(
        'DELETE FROM workspace_availability WHERE workspace_id = ?',
      ).bind(WS1),
      env.DB.prepare(
        'INSERT INTO workspace_availability (id, workspace_id, weekday, is_open) VALUES (?, ?, 1, 1)',
      ).bind('dup-a', WS1),
      env.DB.prepare(
        'INSERT INTO workspace_availability (id, workspace_id, weekday, is_open) VALUES (?, ?, 1, 1)',
      ).bind('dup-b', WS1),
    ];
    await expect(env.DB.batch(stmts)).rejects.toThrow(/UNIQUE/);
    expect(sqlite.rows('workspace_availability')).toHaveLength(7);
  });

  it('logs the replacement to activity_log', async () => {
    await call('PUT', {
      ...FULL,
      exceptions: [{ date: '2026-12-25', isOpen: false }],
    });
    const log = sqlite.rows<{
      entity_type: string;
      entity_id: string;
      action: string;
      user_id: string;
      meta: string;
    }>('activity_log');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      entity_type: 'workspace',
      entity_id: WS1,
      action: 'availability_updated',
      user_id: USER1,
    });
    expect(JSON.parse(log[0]?.meta ?? '{}')).toEqual({
      timezone: 'America/Chicago',
      openDays: 5,
      exceptions: 1,
    });
  });

  it('stamps workspaces.updated_at', async () => {
    await call('PUT', FULL);
    const ws = sqlite
      .rows<{ id: string; updated_at: string | null }>('workspaces')
      .find((r) => r.id === WS1);
    expect(ws?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('404s when the session workspace no longer exists', async () => {
    const gone = '00000000-0000-4000-8000-0000000000ff';
    expect((await call('GET', undefined, { workspaceId: gone })).status).toBe(
      404,
    );
    expect((await call('PUT', FULL, { workspaceId: gone })).status).toBe(404);
  });
});
