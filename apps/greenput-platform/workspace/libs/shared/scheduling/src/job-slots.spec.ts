import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  bookInFreeLane,
  isSlotConflict,
  slotInsertStatements,
  slotStartsFor,
} from './job-slots';

describe('slotStartsFor', () => {
  it('writes five rows for 09:00–11:30, the backlog example', () => {
    expect(
      slotStartsFor('2027-03-04T09:00:00.000Z', '2027-03-04T11:30:00.000Z'),
    ).toEqual([
      '2027-03-04T09:00:00.000Z',
      '2027-03-04T09:30:00.000Z',
      '2027-03-04T10:00:00.000Z',
      '2027-03-04T10:30:00.000Z',
      '2027-03-04T11:00:00.000Z',
    ]);
  });

  it('gives a zero-length job one slot, not none', () => {
    expect(
      slotStartsFor('2027-03-04T09:00:00.000Z', '2027-03-04T09:00:00.000Z'),
    ).toEqual(['2027-03-04T09:00:00.000Z']);
  });

  it('floors the start to the half-hour grid and still claims one slot for a ten-minute job', () => {
    expect(
      slotStartsFor('2027-03-04T09:10:00.000Z', '2027-03-04T09:20:00.000Z'),
    ).toEqual(['2027-03-04T09:00:00.000Z']);
  });

  it('claims both half-hours a job straddles', () => {
    expect(
      slotStartsFor('2027-03-04T09:50:00.000Z', '2027-03-04T10:10:00.000Z'),
    ).toEqual(['2027-03-04T09:30:00.000Z', '2027-03-04T10:00:00.000Z']);
  });

  it('does not claim the slot that begins exactly at the end', () => {
    expect(
      slotStartsFor('2027-03-04T09:00:00.000Z', '2027-03-04T10:00:00.000Z'),
    ).toEqual(['2027-03-04T09:00:00.000Z', '2027-03-04T09:30:00.000Z']);
  });

  it('normalises an offset timestamp onto the UTC grid', () => {
    expect(
      slotStartsFor('2027-03-04T09:00:00+02:00', '2027-03-04T09:30:00+02:00'),
    ).toEqual(['2027-03-04T07:00:00.000Z']);
  });

  it('refuses a schedule it cannot parse rather than booking nothing', () => {
    expect(() => slotStartsFor('nope', '2027-03-04T09:00:00.000Z')).toThrow(
      TypeError,
    );
  });
});

describe('isSlotConflict', () => {
  it('recognises the job_slots primary-key collision as D1 reports it', () => {
    expect(
      isSlotConflict(
        new Error(
          'D1_ERROR: UNIQUE constraint failed: job_slots.workspace_id, job_slots.slot_start, job_slots.lane: SQLITE_CONSTRAINT',
        ),
      ),
    ).toBe(true);
  });

  it('recognises it as node:sqlite reports it', () => {
    expect(
      isSlotConflict(
        new Error(
          'UNIQUE constraint failed: job_slots.workspace_id, job_slots.slot_start, job_slots.lane',
        ),
      ),
    ).toBe(true);
  });

  it('leaves every other constraint alone — those are real errors', () => {
    expect(isSlotConflict(new Error('FOREIGN KEY constraint failed'))).toBe(
      false,
    );
    expect(
      isSlotConflict(new Error('UNIQUE constraint failed: workspaces.slug')),
    ).toBe(false);
    expect(isSlotConflict('not even an error')).toBe(false);
  });
});

// The lane retry over the real table: the PRIMARY KEY does the arbitration
// and the batch does the rollback, so this has to run over the real schema.
describe('bookInFreeLane against schema.sql', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-000000000001';
  const OWNER = '00000000-0000-4000-8000-000000000002';
  const OPP = '00000000-0000-4000-8000-000000000201';
  const SLOT = '2027-03-04T09:00:00.000Z';

  let sqlite: SqliteD1;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
      sql: [
        `INSERT INTO customers (id, workspace_id, first_name, last_name, created_at, updated_at, created_by)
         VALUES ('cust-1', '${WS}', 'Jane', 'Smith', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '${OWNER}')`,
      ],
    });
  });

  afterEach(() => sqlite.close());

  function statementsFor(jobId: string) {
    return (lane: number) => [
      sqlite.db
        .prepare(
          `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title,
                             scheduled_start, scheduled_end, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(jobId, WS, OPP, 'cust-1', '#1', jobId, SLOT, SLOT, OWNER),
      ...slotInsertStatements(sqlite.db, {
        workspaceId: WS,
        jobId,
        lane,
        slotStarts: [SLOT],
      }),
    ];
  }

  function setLanes(n: number) {
    sqlite.raw
      .prepare('UPDATE workspaces SET concurrent_jobs = ? WHERE id = ?')
      .run(n, WS);
  }

  it('takes lane 0 when it is free', async () => {
    expect(await bookInFreeLane(sqlite.db, WS, statementsFor('a'))).toBe(0);
    expect(sqlite.rows('job_slots')).toEqual([
      { workspace_id: WS, slot_start: SLOT, lane: 0, job_id: 'a' },
    ]);
  });

  it('answers null and writes nothing when the only lane is taken', async () => {
    await bookInFreeLane(sqlite.db, WS, statementsFor('a'));
    expect(await bookInFreeLane(sqlite.db, WS, statementsFor('b'))).toBeNull();
    expect(sqlite.rows('jobs').map((r) => r['id'])).toEqual(['a']);
    expect(sqlite.rows('job_slots')).toHaveLength(1);
  });

  it('moves up to the next lane while concurrent_jobs allows, then stops', async () => {
    setLanes(2);
    expect(await bookInFreeLane(sqlite.db, WS, statementsFor('a'))).toBe(0);
    expect(await bookInFreeLane(sqlite.db, WS, statementsFor('b'))).toBe(1);
    expect(await bookInFreeLane(sqlite.db, WS, statementsFor('c'))).toBeNull();
    expect(sqlite.rows('jobs').map((r) => r['id'])).toEqual(['a', 'b']);
  });

  it('rethrows a constraint that is not a slot collision', async () => {
    const bad = (lane: number) => [
      sqlite.db
        .prepare(
          `INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title,
                             scheduled_start, scheduled_end, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          'x',
          WS,
          'no-such-opportunity',
          'cust-1',
          '#1',
          'x',
          SLOT,
          SLOT,
          OWNER,
        ),
      ...slotInsertStatements(sqlite.db, {
        workspaceId: WS,
        jobId: 'x',
        lane,
        slotStarts: [SLOT],
      }),
    ];
    await expect(bookInFreeLane(sqlite.db, WS, bad)).rejects.toThrow(
      /FOREIGN KEY/,
    );
    expect(sqlite.rows('jobs')).toHaveLength(0);
  });
});
