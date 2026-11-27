import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { EvaluationResult, PricedLine } from '@greenput/shared/pricing';
import {
  bookQuotedJob,
  cancelQuotedJob,
  findBookedJob,
  findCancelledBooking,
  isBookableOutcome,
  jobDurationMinutes,
  loadBookedIntervals,
  loadBookingPolicy,
  offerSlots,
  rescheduleQuotedJob,
} from './booking';

const SCHEMA = join(resolve(__dirname, '..', '..', '..'), 'schema.sql');

// A Tuesday morning in Chicago, daylight time (UTC-5).
const NOW = new Date('2027-06-01T12:00:00.000Z');
const CHICAGO = 'America/Chicago';

const labour = (hours: number): PricedLine => ({
  id: 'labour',
  label: 'Labour',
  kind: 'labour',
  qty: hours,
  cost: hours * 110,
  detail: `${hours} hr x $110/hr`,
  side: 'both',
});

const quote = (over: Partial<EvaluationResult> = {}): EvaluationResult => ({
  terminal: 'T_standard_install',
  kind: 'quote',
  path: [],
  notices: [],
  answers: { service_zip: '60614' },
  low: 1000,
  high: 1275,
  lines: [labour(2)],
  ...over,
});

const flow = {
  fsm: {
    id: 'fsm',
    workspace_id: null,
    slug: 'ev-charger-install',
    vertical: 'ev_charger',
    name: 'Level 2 EV charger install',
    description: '',
    current_version_id: 'fsmv',
  },
};

const session = { id: 'sess-1', workspace_id: 'ws1', lead_id: 'lead-1' };

let sqlite: SqliteD1;
let ids: number;
const newId = () => `id-${++ids}`;

function build(options: { availability?: boolean; timezone?: boolean } = {}) {
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      // A card on file (a Stripe customer) — self-booking requires one.
      `INSERT INTO workspaces (id, name, slug, stripe_customer_id${options.timezone === false ? '' : ', timezone'}) VALUES ('ws1', 'Rivertown Electric', 'rivertown', 'cus_rivertown'${
        options.timezone === false ? '' : `, '${CHICAGO}'`
      });`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u1', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact, status, source, service_type, qualified_at, created_by)
         VALUES ('lead-1', 'ws1', 'Dana', 'Ortiz', 'dana@example.com', '512-555-0134', 'text', 'qualified', 'website', 'ev_charger', '2027-05-31T00:00:00.000Z', 'u1');`,
      ...(options.availability === false
        ? []
        : [0, 1, 2, 3, 4, 5, 6].map(
            (weekday) =>
              `INSERT INTO workspace_availability (id, workspace_id, weekday, opens_at, closes_at, is_open)
                 VALUES ('wa-${weekday}', 'ws1', ${weekday}, '08:00', '17:00', ${weekday === 0 ? 0 : 1});`,
          )),
    ],
  });
  ids = 0;
}

beforeEach(() => build());
afterEach(() => sqlite.close());

describe('isBookableOutcome', () => {
  it('books a priced quote and nothing else', () => {
    expect(isBookableOutcome(quote())).toBe(true);
    expect(isBookableOutcome(quote({ kind: 'span' }))).toBe(false);
    expect(
      isBookableOutcome(quote({ kind: 'no_quote', low: null, high: null })),
    ).toBe(false);
    expect(
      isBookableOutcome(quote({ kind: 'urgent', low: null, high: null })),
    ).toBe(false);
    expect(
      isBookableOutcome(quote({ kind: 'referral', low: null, high: null })),
    ).toBe(false);
    // A "quote" with no number on it is not a price either.
    expect(isBookableOutcome(quote({ low: null, high: null }))).toBe(false);
  });
});

describe('loadBookingPolicy', () => {
  it('reads the week, the exceptions and the policy defaults', async () => {
    sqlite.raw.exec(
      `INSERT INTO workspace_availability_exceptions (id, workspace_id, date, opens_at, closes_at, is_open, reason)
       VALUES ('ex-1', 'ws1', '2027-06-03', NULL, NULL, 0, 'Off');`,
    );
    const policy = await loadBookingPolicy(sqlite.db, 'ws1');
    expect(policy).not.toBeNull();
    expect(policy?.timezone).toBe(CHICAGO);
    expect(policy?.leadHours).toBe(24);
    expect(policy?.horizonDays).toBe(30);
    expect(policy?.travelBufferMinutes).toBe(30);
    expect(policy?.concurrency).toBe(1);
    expect(policy?.week).toHaveLength(7);
    expect(policy?.week[0]).toEqual({
      weekday: 0,
      isOpen: false,
      opensAt: '08:00',
      closesAt: '17:00',
    });
    expect(policy?.exceptions).toEqual([
      {
        date: '2027-06-03',
        isOpen: false,
        opensAt: undefined,
        closesAt: undefined,
      },
    ]);
  });

  it('is null when the workspace has no hours — never "always open"', async () => {
    build({ availability: false });
    expect(await loadBookingPolicy(sqlite.db, 'ws1')).toBeNull();
  });

  it('is null when there is no timezone — never UTC', async () => {
    build({ timezone: false });
    expect(await loadBookingPolicy(sqlite.db, 'ws1')).toBeNull();
  });

  it('is null for a workspace that does not exist', async () => {
    expect(await loadBookingPolicy(sqlite.db, 'nope')).toBeNull();
  });
});

describe('offerSlots', () => {
  it('offers nothing for an outcome that is not priced, whatever the hours', async () => {
    expect(
      await offerSlots(sqlite.db, 'ws1', quote({ kind: 'span' }), NOW),
    ).toBeNull();
  });

  it('offers nothing when the workspace is not bookable', async () => {
    build({ availability: false });
    expect(await offerSlots(sqlite.db, 'ws1', quote(), NOW)).toBeNull();
  });

  it('sizes the slots by the quote and leaves booked time out', async () => {
    // Wednesday 2 June, 09:00–11:00 Chicago is 14:00–16:00Z.
    sqlite.raw.exec(`
      INSERT INTO customers (id, workspace_id, first_name, last_name, created_by) VALUES ('c1', 'ws1', 'A', 'B', 'u1');
      INSERT INTO opportunities (id, workspace_id, lead_id, title, created_by) VALUES ('o1', 'ws1', 'lead-1', 'Other', 'u1');
      INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, created_by)
        VALUES ('j1', 'ws1', 'o1', 'c1', '#1001', 'Other', 'scheduled', '2027-06-02T14:00:00.000Z', '2027-06-02T16:00:00.000Z', 'u1');
    `);
    const offer = await offerSlots(sqlite.db, 'ws1', quote(), NOW);
    expect(offer).not.toBeNull();
    expect(offer?.timezone).toBe(CHICAGO);
    expect(offer?.durationMinutes).toBe(120);
    const starts = offer?.slots.map((s) => s.startUtc) ?? [];
    // 24-hour lead: nothing on the 1st.
    expect(starts.some((s) => s.startsWith('2027-06-01'))).toBe(false);
    // On the 2nd the booked job plus its travel buffer blocks 09:00–11:30
    // local; the first free start is 11:30 (16:30Z), and 08:00 would run
    // into the job so it is out too.
    const day2 = starts.filter((s) => s.startsWith('2027-06-02'));
    expect(day2[0]).toBe('2027-06-02T16:30:00.000Z');
    expect(day2).not.toContain('2027-06-02T14:00:00.000Z');
    expect(day2).not.toContain('2027-06-02T13:00:00.000Z');
    // Sunday is closed.
    expect(starts.some((s) => s.startsWith('2027-06-06'))).toBe(false);
    // Every slot is two hours of work.
    for (const slot of offer?.slots ?? []) {
      expect(Date.parse(slot.endUtc) - Date.parse(slot.startUtc)).toBe(
        2 * 60 * 60_000,
      );
    }
  });
});

describe('loadBookedIntervals', () => {
  it('reads scheduled and in-progress jobs, not cancelled or finished ones', async () => {
    sqlite.raw.exec(`
      INSERT INTO customers (id, workspace_id, first_name, last_name, created_by) VALUES ('c1', 'ws1', 'A', 'B', 'u1');
      INSERT INTO opportunities (id, workspace_id, lead_id, title, created_by) VALUES ('o1', 'ws1', 'lead-1', 'Other', 'u1');
      INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, created_by) VALUES
        ('j1', 'ws1', 'o1', 'c1', '#1', 'a', 'scheduled', '2027-06-02T14:00:00.000Z', '2027-06-02T16:00:00.000Z', 'u1'),
        ('j2', 'ws1', 'o1', 'c1', '#2', 'b', 'in_progress', '2027-06-01T13:00:00.000Z', '2027-06-01T14:00:00.000Z', 'u1'),
        ('j3', 'ws1', 'o1', 'c1', '#3', 'c', 'cancelled', '2027-06-03T14:00:00.000Z', '2027-06-03T16:00:00.000Z', 'u1'),
        ('j4', 'ws1', 'o1', 'c1', '#4', 'd', 'completed', '2027-06-04T14:00:00.000Z', '2027-06-04T16:00:00.000Z', 'u1'),
        ('j5', 'ws1', 'o1', 'c1', '#5', 'e', 'scheduled', '2027-05-01T14:00:00.000Z', '2027-05-01T16:00:00.000Z', 'u1');
    `);
    const jobs = await loadBookedIntervals(sqlite.db, 'ws1', NOW);
    expect(jobs.map((j) => j.startUtc).sort()).toEqual([
      '2027-06-01T13:00:00.000Z',
      '2027-06-02T14:00:00.000Z',
    ]);
  });
});

describe('bookQuotedJob', () => {
  const START = '2027-06-02T14:00:00.000Z';

  it('writes the customer, the opportunity, the job and its slots in one go', async () => {
    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: START,
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    expect(outcome.kind).toBe('booked');
    if (outcome.kind !== 'booked') return;
    expect(outcome.scheduledStart).toBe(START);
    expect(outcome.scheduledEnd).toBe('2027-06-02T16:00:00.000Z');

    const job = sqlite.rows<Record<string, unknown>>('jobs')[0];
    expect(job['id']).toBe(outcome.jobId);
    expect(job['status']).toBe('scheduled');
    expect(job['scheduled_start']).toBe(START);
    expect(job['scheduled_end']).toBe('2027-06-02T16:00:00.000Z');
    expect(job['title']).toBe('Level 2 EV charger install');
    expect(job['job_number']).toBe('#1001');
    expect(job['zip']).toBe('60614');
    // Cents (§5.0.1): the midpoint of $1,000–$1,275.
    expect(job['total']).toBe(113750);
    expect(job['created_by']).toBe('u1');

    const opp = sqlite.rows<Record<string, unknown>>('opportunities')[0];
    expect(opp['id']).toBe(job['opportunity_id']);
    expect(opp['lead_id']).toBe('lead-1');
    expect(opp['status']).toBe('won');
    expect(opp['converted_to_job_id']).toBe(job['id']);
    expect(opp['service_type']).toBe('ev_charger');

    const customer = sqlite.rows<Record<string, unknown>>('customers')[0];
    expect(customer['id']).toBe(job['customer_id']);
    expect(customer['first_name']).toBe('Dana');
    expect(customer['phone']).toBe('512-555-0134');
    expect(customer['preferred_contact']).toBe('text');

    // Four half-hours for a two-hour job.
    expect(
      sqlite
        .rows<Record<string, unknown>>('job_slots')
        .map((r) => r['slot_start']),
    ).toEqual([
      '2027-06-02T14:00:00.000Z',
      '2027-06-02T14:30:00.000Z',
      '2027-06-02T15:00:00.000Z',
      '2027-06-02T15:30:00.000Z',
    ]);

    // The lead is converted and stays qualified. The booking itself is the
    // billable event (WS-1); its meter row is covered below.
    const lead = sqlite.rows<Record<string, unknown>>('leads')[0];
    expect(lead['status']).toBe('converted');
    expect(lead['converted_to_opportunity_id']).toBe(opp['id']);
    expect(lead['qualified_at']).toBe('2027-05-31T00:00:00.000Z');

    const log = sqlite.rows<Record<string, unknown>>('activity_log');
    const jobEntry = log.find((e) => e['entity_type'] === 'job');
    expect(jobEntry?.['action']).toBe('created');
    expect(jobEntry?.['entity_id']).toBe(job['id']);
    expect(JSON.parse(String(jobEntry?.['meta']))).toMatchObject({
      source: 'pricing_quote',
      quoteSessionId: 'sess-1',
      leadId: 'lead-1',
      scheduledStart: START,
    });
    expect(log.map((e) => e['entity_type']).sort()).toEqual([
      'customer',
      'job',
      'opportunity',
    ]);
  });

  it('numbers the job after the last one, like POST /api/jobs', async () => {
    sqlite.raw.exec(`
      INSERT INTO customers (id, workspace_id, first_name, last_name, created_by) VALUES ('c1', 'ws1', 'A', 'B', 'u1');
      INSERT INTO opportunities (id, workspace_id, lead_id, title, created_by) VALUES ('o1', 'ws1', 'lead-1', 'Other', 'u1');
      INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, created_at, created_by)
        VALUES ('j1', 'ws1', 'o1', 'c1', '#1042', 'Other', 'completed', '2027-05-02T14:00:00.000Z', '2027-05-02T16:00:00.000Z', '2027-05-01T00:00:00.000Z', 'u1');
    `);
    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: START,
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    expect(outcome.kind).toBe('booked');
    const numbers = sqlite
      .rows<Record<string, unknown>>('jobs')
      .map((j) => j['job_number'])
      .sort();
    expect(numbers).toEqual(['#1042', '#1043']);
  });

  it('answers taken — and writes NOTHING — when the half-hour is held', async () => {
    sqlite.raw.exec(`
      INSERT INTO customers (id, workspace_id, first_name, last_name, created_by) VALUES ('c1', 'ws1', 'A', 'B', 'u1');
      INSERT INTO opportunities (id, workspace_id, lead_id, title, created_by) VALUES ('o1', 'ws1', 'lead-1', 'Other', 'u1');
      INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, created_by)
        VALUES ('j1', 'ws1', 'o1', 'c1', '#1001', 'Other', 'scheduled', '2027-06-02T15:00:00.000Z', '2027-06-02T15:30:00.000Z', 'u1');
      INSERT INTO job_slots (workspace_id, slot_start, lane, job_id) VALUES ('ws1', '2027-06-02T15:00:00.000Z', 0, 'j1');
    `);
    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: START,
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    expect(outcome).toEqual({ kind: 'taken' });
    // The batch rolled back: no second customer, no opportunity, no job.
    expect(sqlite.rows('customers')).toHaveLength(1);
    expect(sqlite.rows('opportunities')).toHaveLength(1);
    expect(sqlite.rows('jobs')).toHaveLength(1);
    expect(sqlite.rows('job_slots')).toHaveLength(1);
    expect(sqlite.rows<Record<string, unknown>>('leads')[0]['status']).toBe(
      'qualified',
    );
  });

  it('takes the next lane when the workspace runs two crews', async () => {
    sqlite.raw.exec(`
      UPDATE workspaces SET concurrent_jobs = 2 WHERE id = 'ws1';
      INSERT INTO customers (id, workspace_id, first_name, last_name, created_by) VALUES ('c1', 'ws1', 'A', 'B', 'u1');
      INSERT INTO opportunities (id, workspace_id, lead_id, title, created_by) VALUES ('o1', 'ws1', 'lead-1', 'Other', 'u1');
      INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, created_by)
        VALUES ('j1', 'ws1', 'o1', 'c1', '#1001', 'Other', 'scheduled', '2027-06-02T14:00:00.000Z', '2027-06-02T14:30:00.000Z', 'u1');
      INSERT INTO job_slots (workspace_id, slot_start, lane, job_id) VALUES ('ws1', '2027-06-02T14:00:00.000Z', 0, 'j1');
    `);
    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: START,
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    expect(outcome.kind).toBe('booked');
    const lanes = sqlite
      .rows<Record<string, unknown>>('job_slots')
      .filter((r) => r['slot_start'] === START)
      .map((r) => r['lane'])
      .sort();
    expect(lanes).toEqual([0, 1]);
  });

  it('books nobody when the session has no lead', async () => {
    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session: { ...session, lead_id: null },
      flow,
      result: quote(),
      startUtc: START,
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    expect(outcome).toEqual({ kind: 'no_lead' });
    expect(sqlite.rows('jobs')).toHaveLength(0);
  });
});

describe('findBookedJob', () => {
  it('finds the job through the lead and its opportunity, skipping cancelled ones', async () => {
    expect(await findBookedJob(sqlite.db, session)).toBeNull();
    expect(
      await findBookedJob(sqlite.db, { ...session, lead_id: null }),
    ).toBeNull();

    sqlite.raw.exec(`
      INSERT INTO customers (id, workspace_id, first_name, last_name, created_by) VALUES ('c1', 'ws1', 'A', 'B', 'u1');
      INSERT INTO opportunities (id, workspace_id, lead_id, title, created_by) VALUES ('o1', 'ws1', 'lead-1', 'Other', 'u1');
      INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, created_by)
        VALUES ('j1', 'ws1', 'o1', 'c1', '#1001', 'Was cancelled', 'cancelled', '2027-06-02T14:00:00.000Z', '2027-06-02T16:00:00.000Z', 'u1');
    `);
    expect(await findBookedJob(sqlite.db, session)).toBeNull();

    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: '2027-06-03T14:00:00.000Z',
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    expect(outcome.kind).toBe('booked');
    const found = await findBookedJob(sqlite.db, session);
    expect(found?.scheduledStart).toBe('2027-06-03T14:00:00.000Z');
    expect(found?.scheduledEnd).toBe('2027-06-03T16:00:00.000Z');
    expect(found?.status).toBe('scheduled');
    expect(found?.jobNumber).toBe('#1002');
  });
});

// ── Change or cancel (GP-105) ─────────────────────────────────

describe('cancelQuotedJob', () => {
  const START = '2027-06-02T14:00:00.000Z';

  async function bookAndAccept(): Promise<string> {
    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: START,
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    if (outcome.kind !== 'booked') throw new Error(outcome.kind);
    // The booking is the billable event (WS-1): bookQuotedJob itself wrote
    // the pending fee, tied to the booked job — a withdrawal must leave it
    // standing.
    sqlite.raw.exec(
      `UPDATE leads SET accepted_at = '2027-06-01T13:00:00.000Z' WHERE id = 'lead-1'`,
    );
    return outcome.jobId;
  }

  it('frees the slot and leaves the booking fee standing in one go, and keeps the pending row', async () => {
    const jobId = await bookAndAccept();
    expect(sqlite.rows('job_slots')).toHaveLength(4);
    const booked = await findBookedJob(sqlite.db, session);
    if (!booked) throw new Error('not booked');

    const outcome = await cancelQuotedJob({
      db: sqlite.db,
      session,
      job: booked,
      reason: 'chose_another_provider',
      newId,
      now: new Date('2027-06-01T15:00:00.000Z'),
    });
    expect(outcome.meterEventAdjustment).toBe('left_unchanged');

    const job = sqlite.rows<Record<string, unknown>>('jobs')[0];
    expect(job?.['id']).toBe(jobId);
    expect(job?.['status']).toBe('cancelled');
    expect(job?.['updated_at']).toBe('2027-06-01T15:00:00.000Z');
    expect(sqlite.rows('job_slots')).toHaveLength(0);

    const event = sqlite.rows<Record<string, unknown>>('lead_meter_events');
    expect(event).toHaveLength(1);
    expect(event[0]?.['status']).toBe('pending');
    expect(event[0]?.['job_id']).toBe(jobId);

    const lead = sqlite.rows<Record<string, unknown>>('leads')[0];
    expect(lead?.['withdrawn_at']).toBe('2027-06-01T15:00:00.000Z');
    expect(lead?.['withdrawn_reason']).toBe('chose_another_provider');

    const log = sqlite.rows<Record<string, unknown>>('activity_log');
    const cancelled = log.find((e) => e['action'] === 'cancelled');
    expect(cancelled?.['entity_id']).toBe(jobId);
    expect(cancelled?.['user_id']).toBe('u1');
    expect(JSON.parse(String(cancelled?.['meta']))).toMatchObject({
      quoteSessionId: 'sess-1',
      reason: 'chose_another_provider',
      scheduledStart: START,
    });
    expect(log.some((e) => e['action'] === 'withdrawn')).toBe(true);

    // The time is on offer again.
    const offer = await offerSlots(sqlite.db, 'ws1', quote(), NOW);
    expect(offer?.slots.map((s) => s.startUtc)).toContain(START);
    expect(await findBookedJob(sqlite.db, session)).toBeNull();
    expect((await findCancelledBooking(sqlite.db, session))?.id).toBe(jobId);
  });

  it('still cancels the job when the session names a lead that is not there', async () => {
    await bookAndAccept();
    const booked = await findBookedJob(sqlite.db, session);
    if (!booked) throw new Error('not booked');

    const outcome = await cancelQuotedJob({
      db: sqlite.db,
      session: { ...session, lead_id: 'ghost' },
      job: booked,
      reason: 'other',
      newId,
      now: NOW,
    });
    expect(outcome.meterEventAdjustment).toBe('none');
    // The real lead's fee is not this session's to touch.
    expect(
      sqlite.rows<Record<string, unknown>>('lead_meter_events')[0]?.['status'],
    ).toBe('pending');
    expect(sqlite.rows<Record<string, unknown>>('jobs')[0]?.['status']).toBe(
      'cancelled',
    );
    expect(sqlite.rows('job_slots')).toHaveLength(0);
  });
});

describe('rescheduleQuotedJob', () => {
  const START = '2027-06-02T14:00:00.000Z';

  async function book(): Promise<string> {
    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: START,
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    if (outcome.kind !== 'booked') throw new Error(outcome.kind);
    return outcome.jobId;
  }

  it('moves the job onto time that overlaps its own — one batch, one job row', async () => {
    const jobId = await book();
    const booked = await findBookedJob(sqlite.db, session);
    if (!booked) throw new Error('not booked');

    const moved = await rescheduleQuotedJob({
      db: sqlite.db,
      session,
      job: booked,
      startUtc: '2027-06-02T15:00:00.000Z',
      durationMinutes: 120,
      newId,
      now: new Date('2027-06-01T15:00:00.000Z'),
    });
    expect(moved).toEqual({
      kind: 'moved',
      scheduledStart: '2027-06-02T15:00:00.000Z',
      scheduledEnd: '2027-06-02T17:00:00.000Z',
    });
    const jobs = sqlite.rows<Record<string, unknown>>('jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.['id']).toBe(jobId);
    expect(jobs[0]?.['scheduled_start']).toBe('2027-06-02T15:00:00.000Z');
    expect(jobs[0]?.['scheduled_end']).toBe('2027-06-02T17:00:00.000Z');
    expect(
      sqlite
        .rows<Record<string, unknown>>('job_slots')
        .map((s) => s['slot_start'])
        .sort(),
    ).toEqual([
      '2027-06-02T15:00:00.000Z',
      '2027-06-02T15:30:00.000Z',
      '2027-06-02T16:00:00.000Z',
      '2027-06-02T16:30:00.000Z',
    ]);
    const entry = sqlite
      .rows<Record<string, unknown>>('activity_log')
      .find((e) => e['action'] === 'rescheduled');
    expect(entry?.['entity_id']).toBe(jobId);
    expect(JSON.parse(String(entry?.['meta']))).toEqual({
      source: 'pricing_quote',
      quoteSessionId: 'sess-1',
      from: { start: START, end: '2027-06-02T16:00:00.000Z' },
      to: {
        start: '2027-06-02T15:00:00.000Z',
        end: '2027-06-02T17:00:00.000Z',
      },
    });
  });

  it('answers taken — and changes NOTHING — when the new time is held', async () => {
    await book();
    const booked = await findBookedJob(sqlite.db, session);
    if (!booked) throw new Error('not booked');
    sqlite.raw.exec(`
      INSERT INTO customers (id, workspace_id, first_name, last_name, created_by) VALUES ('c9', 'ws1', 'X', 'Y', 'u1');
      INSERT INTO opportunities (id, workspace_id, lead_id, title, created_by) VALUES ('o9', 'ws1', 'lead-1', 'Other', 'u1');
      INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, scheduled_start, scheduled_end, created_by)
        VALUES ('j9', 'ws1', 'o9', 'c9', '#1002', 'Holds 4pm', 'scheduled', '2027-06-03T16:00:00.000Z', '2027-06-03T17:00:00.000Z', 'u1');
      INSERT INTO job_slots (workspace_id, slot_start, lane, job_id) VALUES ('ws1', '2027-06-03T16:00:00.000Z', 0, 'j9');
      INSERT INTO job_slots (workspace_id, slot_start, lane, job_id) VALUES ('ws1', '2027-06-03T16:30:00.000Z', 0, 'j9');
    `);
    const before = sqlite.rows('job_slots');

    const moved = await rescheduleQuotedJob({
      db: sqlite.db,
      session,
      job: booked,
      startUtc: '2027-06-03T15:00:00.000Z',
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    expect(moved).toEqual({ kind: 'taken' });
    expect((await findBookedJob(sqlite.db, session))?.scheduledStart).toBe(
      START,
    );
    expect(sqlite.rows('job_slots')).toEqual(before);
    expect(
      sqlite
        .rows<Record<string, unknown>>('activity_log')
        .some((e) => e['action'] === 'rescheduled'),
    ).toBe(false);
  });
});

describe('offerSlots for a move', () => {
  it("offers the job's own time as free, and sizes by the job's length", async () => {
    const outcome = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: '2027-06-02T14:00:00.000Z',
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    if (outcome.kind !== 'booked') throw new Error(outcome.kind);

    const plain = await offerSlots(sqlite.db, 'ws1', quote(), NOW);
    expect(plain?.slots.map((s) => s.startUtc)).not.toContain(
      '2027-06-02T14:00:00.000Z',
    );
    const moving = await offerSlots(sqlite.db, 'ws1', quote(), NOW, {
      excludeJobId: outcome.jobId,
      durationMinutes: 180,
    });
    expect(moving?.slots.map((s) => s.startUtc)).toContain(
      '2027-06-02T14:00:00.000Z',
    );
    expect(moving?.durationMinutes).toBe(180);
    expect(
      (await offerSlots(sqlite.db, 'ws1', quote(), NOW, { durationMinutes: 0 }))
        ?.durationMinutes,
    ).toBe(plain?.durationMinutes);
  });

  it('reads a duration off the job, and 0 off one that holds no time', () => {
    expect(
      jobDurationMinutes({
        scheduledStart: '2027-06-02T14:00:00.000Z',
        scheduledEnd: '2027-06-02T16:30:00.000Z',
      }),
    ).toBe(150);
    expect(
      jobDurationMinutes({
        scheduledStart: '2027-06-02T14:00:00.000Z',
        scheduledEnd: '2027-06-02T14:00:00.000Z',
      }),
    ).toBe(0);
    expect(jobDurationMinutes({ scheduledStart: 'x', scheduledEnd: 'y' })).toBe(
      0,
    );
  });
});

describe('findCancelledBooking', () => {
  it('is the most recent job only while that job is cancelled', async () => {
    expect(await findCancelledBooking(sqlite.db, session)).toBeNull();
    const first = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: '2027-06-02T14:00:00.000Z',
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    if (first.kind !== 'booked') throw new Error(first.kind);
    expect(await findCancelledBooking(sqlite.db, session)).toBeNull();

    const booked = await findBookedJob(sqlite.db, session);
    if (!booked) throw new Error('not booked');
    await cancelQuotedJob({
      db: sqlite.db,
      session,
      job: booked,
      reason: 'no_longer_needed',
      newId,
      now: NOW,
    });
    expect((await findCancelledBooking(sqlite.db, session))?.id).toBe(
      first.jobId,
    );

    // Booked again, later: the same customer and opportunity, a new job.
    const again = await bookQuotedJob({
      db: sqlite.db,
      session,
      flow,
      result: quote(),
      startUtc: '2027-06-03T14:00:00.000Z',
      durationMinutes: 120,
      newId,
      now: new Date('2027-06-01T13:00:00.000Z'),
    });
    expect(again.kind).toBe('booked');
    expect(await findCancelledBooking(sqlite.db, session)).toBeNull();
    expect(sqlite.rows('customers')).toHaveLength(1);
    expect(sqlite.rows('opportunities')).toHaveLength(1);
    expect(sqlite.rows('jobs')).toHaveLength(2);
    expect(
      sqlite.rows<Record<string, unknown>>('opportunities')[0]?.[
        'converted_to_job_id'
      ],
    ).toBe(again.kind === 'booked' ? again.jobId : null);
  });
});

// ── The booking is the billable event (WS-1) ─────────────────

describe('bookQuotedJob meters the lead fee at booking commit', () => {
  const START = '2027-06-02T14:00:00.000Z';
  const book = (
    over: { flow?: typeof flow; startUtc?: string; now?: Date } = {},
  ) =>
    bookQuotedJob({
      db: sqlite.db,
      session,
      flow: over.flow ?? flow,
      result: quote(),
      startUtc: over.startUtc ?? START,
      durationMinutes: 120,
      newId,
      now: over.now ?? NOW,
    });
  const meter = () => sqlite.rows<Record<string, unknown>>('lead_meter_events');

  it('writes one pending meter row tied to the booked job, at the rate-card price', async () => {
    const outcome = await book();
    if (outcome.kind !== 'booked') throw new Error(outcome.kind);
    const rows = meter();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: 'ws1',
      lead_id: 'lead-1',
      vertical: 'ev_charger',
      service_type: 'ev-charger-install',
      price_usd: 60,
      status: 'pending',
      job_id: outcome.jobId,
      delivery_id: null,
      priority: 0,
      payment_status: null,
    });
  });

  it('classifies by the flow slug, so a panel quote bills as electrical at the panel price', async () => {
    sqlite.raw.exec(
      `UPDATE leads SET service_type = 'panel_service' WHERE id = 'lead-1'`,
    );
    const outcome = await book({
      flow: {
        fsm: {
          ...flow.fsm,
          slug: 'panel-service-upgrade',
          vertical: 'panel_service',
          name: 'Panel replacement and service upgrade',
        },
      },
    });
    expect(outcome.kind).toBe('booked');
    expect(meter()[0]).toMatchObject({
      vertical: 'electrical',
      service_type: 'panel-service-upgrade',
      price_usd: 90, // PLACEHOLDER panel_service price
    });
  });

  it("applies the workspace's lead-fee override", async () => {
    sqlite.raw.exec(
      `UPDATE workspaces SET lead_fee_override_usd = 12 WHERE id = 'ws1'`,
    );
    await book();
    expect(meter()[0]?.['price_usd']).toBe(12);
  });

  it('refuses a shop with no card on file, writing nothing (CARD_REQUIRED)', async () => {
    sqlite.raw.exec(
      `UPDATE workspaces SET stripe_customer_id = NULL WHERE id = 'ws1'`,
    );
    const leadsBefore = sqlite.rows('leads');
    const outcome = await book();
    expect(outcome).toEqual({ kind: 'cannot_receive', code: 'CARD_REQUIRED' });
    for (const table of [
      'jobs',
      'job_slots',
      'opportunities',
      'customers',
      'activity_log',
      'lead_meter_events',
    ]) {
      expect(sqlite.rows(table), table).toHaveLength(0);
    }
    expect(sqlite.rows('leads')).toEqual(leadsBefore);
  });

  it('books the demo workspace with no card on file and records no lead fee', async () => {
    // The public demo shop (slug 'demo') has no Stripe customer and even
    // an earlier fee that failed to collect: neither gate applies, the
    // job books, and no fee is recorded — so nothing can be charged.
    sqlite.raw.exec(`
      UPDATE workspaces SET slug = 'demo', stripe_customer_id = NULL WHERE id = 'ws1';
      INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact, status, source, service_type, created_by)
        VALUES ('lead-0', 'ws1', 'Earlier', 'Lead', 'e@example.com', '512-555-0100', 'phone', 'converted', 'website', 'ev_charger', 'u1');
      INSERT INTO lead_meter_events (id, workspace_id, lead_id, vertical, service_type, price_usd, status, payment_status)
        VALUES ('m0', 'ws1', 'lead-0', 'ev_charger', 'ev-charger-install', 60, 'pending', 'failed');
    `);
    const outcome = await book();
    expect(outcome.kind).toBe('booked');
    expect(sqlite.rows('jobs')).toHaveLength(1);
    expect(meter().map((r) => r['id'])).toEqual(['m0']);
  });

  it('still refuses a non-demo shop with no card on file (CARD_REQUIRED)', async () => {
    sqlite.raw.exec(
      `UPDATE workspaces SET slug = 'demo-electric', stripe_customer_id = NULL WHERE id = 'ws1'`,
    );
    expect(await book()).toEqual({
      kind: 'cannot_receive',
      code: 'CARD_REQUIRED',
    });
    expect(sqlite.rows('jobs')).toHaveLength(0);
    expect(meter()).toHaveLength(0);
  });

  it('refuses a shop whose earlier lead fee failed to collect (DELIVERY_PAUSED)', async () => {
    sqlite.raw.exec(`
      INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact, status, source, service_type, created_by)
        VALUES ('lead-0', 'ws1', 'Earlier', 'Lead', 'e@example.com', '512-555-0100', 'phone', 'converted', 'website', 'ev_charger', 'u1');
      INSERT INTO lead_meter_events (id, workspace_id, lead_id, vertical, service_type, price_usd, status, payment_status)
        VALUES ('m0', 'ws1', 'lead-0', 'ev_charger', 'ev-charger-install', 60, 'pending', 'failed');
    `);
    const outcome = await book();
    expect(outcome).toEqual({
      kind: 'cannot_receive',
      code: 'DELIVERY_PAUSED',
    });
    expect(sqlite.rows('jobs')).toHaveLength(0);
    expect(meter()).toHaveLength(1);
  });

  it('writes nothing when the slot is taken', async () => {
    await book();
    const before = meter().length;
    const second = await bookQuotedJob({
      db: sqlite.db,
      session: { ...session, id: 'sess-2' },
      flow,
      result: quote(),
      startUtc: START,
      durationMinutes: 120,
      newId,
      now: NOW,
    });
    expect(second.kind).toBe('taken');
    expect(meter()).toHaveLength(before);
  });

  it('bills a lead once per shop: rebooking after a cancel keeps the one standing row', async () => {
    const first = await book();
    if (first.kind !== 'booked') throw new Error(first.kind);
    const booked = await findBookedJob(sqlite.db, session);
    if (!booked) throw new Error('not booked');
    const cancelled = await cancelQuotedJob({
      db: sqlite.db,
      session,
      job: booked,
      reason: 'schedule_no_longer_works',
      newId,
      now: NOW,
    });
    expect(cancelled.meterEventAdjustment).toBe('left_unchanged');
    const again = await book({ startUtc: '2027-06-03T14:00:00.000Z' });
    expect(again.kind).toBe('booked');
    const rows = meter();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['status']).toBe('pending');
    expect(rows[0]?.['job_id']).toBe(first.jobId);
  });

  it('refuses to book, writing nothing, when the service has no lead rate', async () => {
    sqlite.raw.exec(
      `UPDATE leads SET service_type = 'gutter_cleaning' WHERE id = 'lead-1'`,
    );
    const outcome = await book({
      flow: {
        fsm: {
          ...flow.fsm,
          slug: 'gutter-cleaning',
          vertical: 'gutter_cleaning',
          name: 'Gutter cleaning',
        },
      },
    });
    expect(outcome.kind).toBe('unbillable');
    expect(sqlite.rows('jobs')).toHaveLength(0);
    expect(sqlite.rows('job_slots')).toHaveLength(0);
    expect(meter()).toHaveLength(0);
  });
});
