import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { withdrawLead } from './lead-withdraw.ts';

// Over the real schema.sql: the money rules here rest on the
// `withdrawn_at IS NULL` guard and on D1's `meta.changes`, which a mock
// cannot exercise (CLAUDE.md §10.0).

const SCHEMA = join(resolve(__dirname, '..', '..', '..', '..'), 'schema.sql');
const NOW = '2026-09-13T15:00:00.000Z';

let sqlite: SqliteD1;
let ids: number;
const newId = () => `id-${++ids}`;

interface LeadRow {
  id: string;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  updated_at: string;
}
interface MeterRow {
  lead_id: string;
  status: string;
  notes: string;
}
interface LogRow {
  entity_id: string;
  action: string;
  user_id: string | null;
  meta: string;
}

function build(): void {
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Rivertown Electric', 'rivertown');`,
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws2', 'Someone Else', 'other');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u1', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO leads (id, workspace_id, first_name, last_name, email, status, source, service_type, qualified_at, created_by, updated_at)
         VALUES ('l1', 'ws1', 'Dana', 'Ortiz', 'dana@example.com', 'qualified', 'website', 'ev_charger', '2026-09-12T00:00:00.000Z', 'u1', '2026-09-12T00:00:00.000Z');`,
    ],
  });
  ids = 0;
}

function accept(status: 'pending' | 'invoiced' = 'pending'): void {
  sqlite.raw.exec(
    `UPDATE leads SET accepted_at = '2026-09-12T12:00:00.000Z' WHERE id = 'l1';
     INSERT INTO lead_meter_events (id, workspace_id, lead_id, vertical, service_type, price_usd, status, notes, created_at)
       VALUES ('m1', 'ws1', 'l1', 'ev_charger', 'ev_charger', 60, '${status}', '', '2026-09-12T12:00:00.000Z');`,
  );
}

const lead = (): LeadRow => {
  const row = sqlite.rows<LeadRow>('leads')[0];
  if (!row) throw new Error('the lead is gone');
  return row;
};
const meter = () => sqlite.rows<MeterRow>('lead_meter_events');
const log = () =>
  sqlite.rows<LogRow>('activity_log').filter((r) => r.action === 'withdrawn');

beforeEach(build);
afterEach(() => sqlite.close());

describe('withdrawLead', () => {
  it('before acceptance: stamps the lead and its reason, bills nothing', async () => {
    const outcome = await withdrawLead(sqlite.db, {
      workspaceId: 'ws1',
      leadId: 'l1',
      reason: 'schedule_no_longer_works',
      now: NOW,
      actorUserId: 'u1',
      newId,
    });
    expect(outcome.kind).toBe('withdrawn');
    expect(outcome.meterEventAdjustment).toBe('none');
    expect(outcome.lead?.['withdrawn_at']).toBe(NOW);

    expect(lead().withdrawn_at).toBe(NOW);
    expect(lead().withdrawn_reason).toBe('schedule_no_longer_works');
    expect(lead().updated_at).toBe(NOW);
    expect(meter()).toHaveLength(0);

    expect(log()).toHaveLength(1);
    expect(log()[0]?.user_id).toBe('u1');
    expect(JSON.parse(String(log()[0]?.meta))).toEqual({
      meterEventAdjustment: 'none',
      reason: 'schedule_no_longer_works',
    });
  });

  it('after acceptance: the pending fee stands — the row stays pending and collectible', async () => {
    accept();
    const outcome = await withdrawLead(sqlite.db, {
      workspaceId: 'ws1',
      leadId: 'l1',
      reason: 'chose_another_provider',
      now: NOW,
      actorUserId: null,
      newId,
    });
    expect(outcome.kind).toBe('withdrawn');
    expect(outcome.meterEventAdjustment).toBe('left_unchanged');

    expect(meter()).toHaveLength(1);
    expect(meter()[0]?.status).toBe('pending');
    expect(meter()[0]?.notes).toBe('');
    // Unattributed is allowed: a homeowner is not a user.
    expect(log()[0]?.user_id).toBeNull();
    expect(JSON.parse(String(log()[0]?.meta)).meterEventAdjustment).toBe(
      'left_unchanged',
    );
  });

  it('after invoicing: the event is left alone, no refund invented', async () => {
    accept('invoiced');
    const outcome = await withdrawLead(sqlite.db, {
      workspaceId: 'ws1',
      leadId: 'l1',
      now: NOW,
      actorUserId: 'u1',
      newId,
    });
    expect(outcome.meterEventAdjustment).toBe('left_unchanged');
    expect(meter()[0]?.status).toBe('invoiced');
    expect(JSON.parse(String(log()[0]?.meta))).toEqual({
      meterEventAdjustment: 'left_unchanged',
      reason: null,
    });
  });

  it('is idempotent: a second withdrawal changes nothing and revisits no fee', async () => {
    accept();
    await withdrawLead(sqlite.db, {
      workspaceId: 'ws1',
      leadId: 'l1',
      reason: 'other',
      now: NOW,
      actorUserId: 'u1',
      newId,
    });
    const again = await withdrawLead(sqlite.db, {
      workspaceId: 'ws1',
      leadId: 'l1',
      reason: 'no_longer_needed',
      now: '2026-09-14T09:00:00.000Z',
      actorUserId: 'u1',
      newId,
    });
    expect(again.kind).toBe('already_withdrawn');
    expect(again.meterEventAdjustment).toBe('none');
    expect(lead().withdrawn_at).toBe(NOW);
    expect(lead().withdrawn_reason).toBe('other');
    expect(meter()).toHaveLength(1);
    expect(meter()[0]?.status).toBe('pending');
    expect(log()).toHaveLength(1);
  });

  it("another workspace's id finds nothing and touches nothing — alongside statements included", async () => {
    accept();
    const outcome = await withdrawLead(sqlite.db, {
      workspaceId: 'ws2',
      leadId: 'l1',
      reason: 'other',
      now: NOW,
      actorUserId: null,
      newId,
      alongside: [
        sqlite.db
          .prepare(`UPDATE leads SET notes = 'touched' WHERE id = ?`)
          .bind('l1'),
      ],
    });
    expect(outcome).toEqual({
      kind: 'not_found',
      lead: null,
      meterEventAdjustment: 'none',
    });
    expect(lead().withdrawn_at).toBeNull();
    expect(meter()[0]?.status).toBe('pending');
    expect(sqlite.rows<{ notes: string }>('leads')[0]?.notes).toBe('');
    expect(log()).toHaveLength(0);
  });

  it('commits the alongside statements in the same transaction — and rolls everything back together', async () => {
    accept();
    sqlite.raw.exec(
      `INSERT INTO customers (id, workspace_id, first_name, last_name, created_by) VALUES ('c1', 'ws1', 'D', 'O', 'u1');
       INSERT INTO opportunities (id, workspace_id, lead_id, title, created_by) VALUES ('o1', 'ws1', 'l1', 'EV', 'u1');
       INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, created_by)
         VALUES ('j1', 'ws1', 'o1', 'c1', '#1001', 'EV', 'scheduled', '2026-10-01T14:00:00.000Z', '2026-10-01T16:00:00.000Z', 'u1');`,
    );
    const cancel = sqlite.db
      .prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = ?`)
      .bind('j1');

    // A statement the database rejects: nothing else in the batch lands.
    await expect(
      withdrawLead(sqlite.db, {
        workspaceId: 'ws1',
        leadId: 'l1',
        now: NOW,
        actorUserId: 'u1',
        newId,
        alongside: [
          cancel,
          sqlite.db
            .prepare(`UPDATE jobs SET status = 'not_a_status' WHERE id = ?`)
            .bind('j1'),
        ],
      }),
    ).rejects.toThrow(/CHECK constraint/);
    expect(sqlite.rows<{ status: string }>('jobs')[0]?.status).toBe(
      'scheduled',
    );
    expect(lead().withdrawn_at).toBeNull();
    expect(meter()[0]?.status).toBe('pending');

    const outcome = await withdrawLead(sqlite.db, {
      workspaceId: 'ws1',
      leadId: 'l1',
      reason: 'schedule_no_longer_works',
      now: NOW,
      actorUserId: 'u1',
      newId,
      alongside: [cancel],
    });
    expect(outcome.meterEventAdjustment).toBe('left_unchanged');
    expect(sqlite.rows<{ status: string }>('jobs')[0]?.status).toBe(
      'cancelled',
    );
    expect(lead().withdrawn_at).toBe(NOW);
  });

  it('runs the alongside statements even when the lead is already withdrawn', async () => {
    await withdrawLead(sqlite.db, {
      workspaceId: 'ws1',
      leadId: 'l1',
      now: NOW,
      actorUserId: 'u1',
      newId,
    });
    const again = await withdrawLead(sqlite.db, {
      workspaceId: 'ws1',
      leadId: 'l1',
      now: '2026-09-14T09:00:00.000Z',
      actorUserId: 'u1',
      newId,
      alongside: [
        sqlite.db
          .prepare(`UPDATE leads SET notes = 'cancelled again' WHERE id = ?`)
          .bind('l1'),
      ],
    });
    expect(again.kind).toBe('already_withdrawn');
    expect(sqlite.rows<{ notes: string }>('leads')[0]?.notes).toBe(
      'cancelled again',
    );
  });
});
