import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { leadsRouter } from './leads';
import { scheduleRouter } from './schedule';

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000d1';
const OWNER = '00000000-0000-4000-8000-0000000000d2';
const LEAD = '00000000-0000-4000-8000-0000000000d3';

let sqlite: SqliteD1;

function seed(): string {
  const windows = Array.from({ length: 7 }, (_, day) => day)
    .map(
      (day) =>
        `INSERT INTO availability_windows (id, workspace_id, user_id, day_of_week, start_minute, end_minute, active)
         VALUES ('win-${day}', '${WS}', '${OWNER}', ${day}, 360, 1320, 1);`,
    )
    .join('\n');
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, timezone, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'rivertown-sd', 'electrical', '5125550142',
        'hello@rivertown.example', '100 Example Way', 'Rivertown', 'TX', '78701', 'America/Los_Angeles', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${OWNER}', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO user_workspaces (id, user_id, workspace_id, role)
VALUES ('uw-1', '${OWNER}', '${WS}', 'owner');

INSERT INTO schedule_settings (workspace_id, timezone, travel_buffer_minutes, min_notice_hours, max_lead_time_days)
VALUES ('${WS}', 'America/Los_Angeles', 0, 0, NULL);

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, status, source, service_type, qualified_at, created_at, updated_at, created_by)
VALUES ('${LEAD}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '+19495550100', 'qualified', 'website', 'ev-charger-install',
        '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '${OWNER}');

${windows}
`;
}

function as(req: Request): Request {
  const mutable = req as unknown as Record<string, unknown>;
  mutable['user'] = {
    id: OWNER,
    workspaceId: WS,
    firstName: 'Dana',
    lastName: 'Ortiz',
    email: 'dana@rivertown.example',
    role: 'owner',
  };
  mutable['workspaceId'] = WS;
  return req;
}

function call(
  router: typeof leadsRouter | typeof scheduleRouter,
  path: string,
  body?: unknown,
): Promise<Response> {
  return router.fetch(
    as(
      new Request(`https://api.greenput.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    ),
    { DB: sqlite.db } as never,
  );
}

async function enroll(serviceType: string): Promise<void> {
  const res = await call(scheduleRouter, '/api/schedule/enrollments', {
    userId: OWNER,
    serviceType,
  });
  expect(res.status).toBe(201);
}

async function deliver(): Promise<{ status: number; body: any }> {
  const res = await call(leadsRouter, `/api/leads/${LEAD}/deliver`, {
    durationMinutes: 60,
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [resolve(ROOT, 'schema.sql')],
    sql: [seed()],
  });
});

afterEach(() => {
  sqlite.close();
});

describe('schedule-aware delivery', () => {
  it('books the job, accepts the lead, and meters the delivery fee', async () => {
    await enroll('ev-charger-install');
    const { status, body } = await deliver();
    expect(status).toBe(200);
    expect(body.delivered).toBe(true);
    expect(body.userId).toBe(OWNER);

    const job = await sqlite.db
      .prepare(`SELECT assigned_to, status FROM jobs WHERE id = ?`)
      .bind(body.jobId)
      .first<{ assigned_to: string; status: string }>();
    expect(job).toMatchObject({ assigned_to: OWNER, status: 'scheduled' });

    const slots = await sqlite.db
      .prepare(`SELECT COUNT(*) AS n FROM job_slots WHERE job_id = ?`)
      .bind(body.jobId)
      .first<{ n: number }>();
    expect(slots!.n).toBeGreaterThan(0);

    const lead = await sqlite.db
      .prepare(`SELECT accepted_at, status FROM leads WHERE id = ?`)
      .bind(LEAD)
      .first<{ accepted_at: string | null; status: string }>();
    expect(lead!.accepted_at).not.toBeNull();
    expect(lead!.status).toBe('accepted');

    const meter = await sqlite.db
      .prepare(
        `SELECT price_usd, status, job_id, delivery_id, priority FROM lead_meter_events WHERE lead_id = ?`,
      )
      .bind(LEAD)
      .first<{
        price_usd: number;
        status: string;
        job_id: string;
        delivery_id: string;
        priority: number;
      }>();
    // The fee fires at this booking commit, linked to the job and the
    // delivery that committed it (WS-1).
    expect(meter).toEqual({
      price_usd: 60,
      status: 'pending',
      job_id: body.jobId,
      delivery_id: body.deliveryId,
      priority: 0,
    });

    const delivery = await sqlite.db
      .prepare(`SELECT status FROM lead_deliveries WHERE lead_id = ?`)
      .bind(LEAD)
      .first<{ status: string }>();
    expect(delivery!.status).toBe('booked');
  });

  // WS-0 acceptance (PRD v1.5): a delivered test booking produces
  // ZERO deposit records and ZERO deposit references in any outbound
  // message. The booking-deposit model was revoked on 2026-10-20.
  // The homeowner SMS body itself is a literal in schedule-delivery.ts
  // ("You're booked with … They'll confirm any final details…") and is
  // not persisted, so this pins every surface the delivery writes or
  // returns: the deposits table, the route response, the activity log
  // and the notification log. The copy-level guarantee is pinned by
  // the share-links spec (no deposit builder exists) and the
  // tenant-site deposit spec (the page is a plain not-found).
  it('WS-0: delivery creates no deposit and references none anywhere', async () => {
    await enroll('ev-charger-install');
    const { status, body } = await deliver();
    expect(status).toBe(200);
    expect(body.delivered).toBe(true);

    const deposits = await sqlite.db
      .prepare(`SELECT COUNT(*) AS n FROM deposits WHERE workspace_id = ?`)
      .bind(WS)
      .first<{ n: number }>();
    expect(deposits!.n).toBe(0);

    expect(JSON.stringify(body).toLowerCase()).not.toContain('deposit');

    const activity = await sqlite.db
      .prepare(`SELECT action, meta FROM activity_log WHERE workspace_id = ?`)
      .bind(WS)
      .all<{ action: string; meta: string }>();
    for (const row of activity.results) {
      expect(`${row.action} ${row.meta}`.toLowerCase()).not.toContain(
        'deposit',
      );
    }

    const notifications = await sqlite.db
      .prepare(
        `SELECT channel, event_type, recipient, status FROM notification_log WHERE workspace_id = ?`,
      )
      .bind(WS)
      .all<Record<string, string>>();
    for (const row of notifications.results) {
      expect(JSON.stringify(row).toLowerCase()).not.toContain('deposit');
    }
  });

  it('undo cancels the job, frees the slots, and the fee STANDS (WS-1)', async () => {
    await enroll('ev-charger-install');
    const { body } = await deliver();
    const res = await call(leadsRouter, `/api/leads/${LEAD}/delivery/undo`, {});
    expect(res.status).toBe(200);

    const job = await sqlite.db
      .prepare(`SELECT status FROM jobs WHERE id = ?`)
      .bind(body.jobId)
      .first<{ status: string }>();
    expect(job!.status).toBe('cancelled');
    const slots = await sqlite.db
      .prepare(`SELECT COUNT(*) AS n FROM job_slots WHERE job_id = ?`)
      .bind(body.jobId)
      .first<{ n: number }>();
    expect(slots!.n).toBe(0);
    // A booked job was delivered and billed; undo is not a waiver —
    // refunds exist only for proven fraud and platform fault (FR-1.4).
    const meter = await sqlite.db
      .prepare(`SELECT status FROM lead_meter_events WHERE lead_id = ?`)
      .bind(LEAD)
      .first<{ status: string }>();
    expect(meter!.status).toBe('pending');
    const delivery = await sqlite.db
      .prepare(`SELECT status FROM lead_deliveries WHERE lead_id = ?`)
      .bind(LEAD)
      .first<{ status: string }>();
    expect(delivery!.status).toBe('undone');
  });

  it('out of scope is a typed miss, not an error — nothing is written', async () => {
    const { status, body } = await deliver();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      delivered: false,
      reason: 'not_enrolled',
      fallback: 'request_flow',
    });
    const jobs = await sqlite.db
      .prepare(`SELECT COUNT(*) AS n FROM jobs`)
      .first<{ n: number }>();
    expect(jobs!.n).toBe(0);
    const meters = await sqlite.db
      .prepare(`SELECT COUNT(*) AS n FROM lead_meter_events WHERE lead_id = ?`)
      .bind(LEAD)
      .first<{ n: number }>();
    expect(meters!.n).toBe(0);
  });

  it('the SERVICE axis gates: enrolled for another service does not auto-book this one', async () => {
    await enroll('panel-upgrade');
    const { body } = await deliver();
    expect(body.delivered).toBe(false);
    expect(body.reason).toBe('not_enrolled');
  });

  it('refuses to auto-book when Stripe is on and there is no card', async () => {
    await enroll('ev-charger-install');
    const res = await leadsRouter.fetch(
      as(
        new Request(`https://api.greenput.com/api/leads/${LEAD}/deliver`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ durationMinutes: 60 }),
        }),
      ),
      { DB: sqlite.db, STRIPE_SECRET_KEY: 'sk_test_gate' } as never,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CARD_REQUIRED');
    const jobs = await sqlite.db
      .prepare('SELECT COUNT(*) AS n FROM jobs')
      .first<{ n: number }>();
    expect(jobs!.n).toBe(0);
    const meters = await sqlite.db
      .prepare('SELECT COUNT(*) AS n FROM lead_meter_events')
      .first<{ n: number }>();
    expect(meters!.n).toBe(0);
  });

  it('pauses auto-book while a lead-fee charge is outstanding', async () => {
    sqlite.raw.exec(`
INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, status, source, service_type, created_at, updated_at, created_by)
VALUES ('lead-owed', '${WS}', 'Old', 'Fee', 'old@example.com', '+19495550199', 'accepted', 'manual', 'electrical',
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '${OWNER}');
INSERT INTO lead_meter_events (id, workspace_id, lead_id, vertical, service_type, price_usd, status, payment_status, created_at)
VALUES ('meter-owed', '${WS}', 'lead-owed', 'electrical', 'electrical', 35, 'pending', 'failed', '2026-10-01T00:00:00.000Z');
`);
    await enroll('ev-charger-install');
    const { status, body } = await deliver();
    expect(status).toBe(409);
    expect(body.error.code).toBe('DELIVERY_PAUSED');
    const jobs = await sqlite.db
      .prepare('SELECT COUNT(*) AS n FROM jobs')
      .first<{ n: number }>();
    expect(jobs!.n).toBe(0);
  });

  it('a second delivery of the same lead conflicts', async () => {
    await enroll('ev-charger-install');
    await deliver();
    const { status } = await deliver();
    expect(status).toBe(409);
  });
});
