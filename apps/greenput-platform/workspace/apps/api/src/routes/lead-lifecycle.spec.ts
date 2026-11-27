import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  completeSession,
  createLeadFromQuote,
  createSession,
  evaluate,
  loadFlow,
  type D1Like,
} from '@greenput/shared/pricing';
// By relative path, not the alias: the seed loader reads `seeds/pricing/`
// with `node:fs` and is kept out of the barrel.
import {
  loadFlattenedSeed,
  readFixture,
} from '../../../../libs/shared/pricing/src/seed-loader';
// The consumer path IS the tenant Worker's handler (GP-105): the homeowner
// cancels from the tenant site, holding only the session capability, and
// the fee is decided by the same `withdrawLead` the staff route calls.
import { bookQuotedJob, offerSlots } from '../../../tenant-site/src/booking';
import { handleQuoteRequest } from '../../../tenant-site/src/intake-routes';
import type { Env as TenantEnv } from '../../../tenant-site/src/env';
import type { WorkspaceData } from '../../../tenant-site/src/render';
import type { Env } from '../env';
import { leadsRouter } from './leads';
import { publicRouter } from './public';

// Exercises the qualify -> accept -> (optional) withdraw lifecycle against
// the REAL schema.sql (via node:sqlite), rather than hand-rolled mocks, so
// CHECK/FK/UNIQUE constraints and D1's `meta.changes` semantics are actually
// enforced — precisely the things that matter for the idempotency and
// billing-timing guarantees this suite is checking. See
// apps/api/src/lib/lead-meter.spec.ts for lower-level recordLeadMeter tests
// and apps/api/src/routes/leads.spec.ts / public.spec.ts for per-route unit
// tests of the other status codes.

const ROOT = resolve(__dirname, '../../../..');
const DEMO_WORKSPACE = '00000000-0000-4000-8000-000000000001';
const DEMO_OWNER = '00000000-0000-4000-8000-000000000002';

// The response body's shape, which is the declared `Lead` model (camelCase,
// and a NULL timestamp omitted rather than sent as null) — not the row shape.
// Rows are asserted on separately, via sqlite.rows().
interface LeadBody {
  id: string;
  status: string;
  qualifiedAt?: string;
  acceptedAt?: string;
  withdrawnAt?: string;
  withdrawnReason?: string;
}

interface MeterEventRow {
  id: string;
  lead_id: string;
  status: string;
  price_usd: number;
  notes: string;
}

interface AcceptBody {
  data: {
    lead: LeadBody;
    meterEvent: { priceUsd: number; vertical: string } | null;
    alreadyAccepted: boolean;
  };
}

interface WithdrawBody {
  data: {
    lead: LeadBody;
    meterEventAdjustment: 'none' | 'waived' | 'left_unchanged';
  };
}

function leadsReq(path: string, init: RequestInit = {}): Request {
  const req = new Request(`https://api.greenput.com/api/leads${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = DEMO_WORKSPACE;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: DEMO_OWNER,
    role: 'owner',
  };
  return req;
}

describe('lead billing lifecycle', () => {
  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db } as unknown as Env;
  });

  afterEach(() => {
    sqlite.close();
  });

  async function createInternalLead(serviceType: string): Promise<string> {
    const res = await leadsRouter.fetch(
      leadsReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Doe',
          email: `jane-${crypto.randomUUID()}@example.com`,
          serviceType,
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    return body.data.id;
  }

  async function createPublicLead(serviceType: string): Promise<string> {
    const email = `public-${crypto.randomUUID()}@example.com`;
    const res = await publicRouter.fetch(
      new Request('https://api.greenput.com/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'demo',
          firstName: 'Public',
          lastName: 'Lead',
          email,
          serviceType,
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const row = sqlite.raw
      .prepare('SELECT id FROM leads WHERE email = ?')
      .get(email) as { id: string };
    return row.id;
  }

  it('public capture bills nothing at creation', async () => {
    await createPublicLead('HVAC tune-up');
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });

  it('internal capture bills nothing at creation', async () => {
    await createInternalLead('HVAC tune-up');
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });

  it('accept is a state transition and bills nothing (WS-1, internal entry point)', async () => {
    const leadId = await createInternalLead('HVAC tune-up');
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );

    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AcceptBody;
    expect(body.data.alreadyAccepted).toBe(false);
    // The shape is unchanged; the fee is not in it — accept creates no
    // meter event and no charge. The fee fires at booking commit only.
    expect(body.data.meterEvent).toBeNull();
    expect(body.data.lead.acceptedAt).toBeTruthy();

    expect(sqlite.rows<MeterEventRow>('lead_meter_events')).toHaveLength(0);
  });

  it('the public entry point reaches accepted and bills nothing (WS-1)', async () => {
    const leadId = await createPublicLead('Drain cleaning');
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );
    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    expect(sqlite.rows<MeterEventRow>('lead_meter_events')).toHaveLength(0);
  });

  it('GET /:id/fee quotes the exact figure a booking then bills (GP-106)', async () => {
    const leadId = await createInternalLead('HVAC tune-up');
    const quote = await leadsRouter.fetch(leadsReq(`/${leadId}/fee`), env);
    expect(quote.status).toBe(200);
    const quoted = (await quote.json()) as {
      data: { leadId: string; vertical: string; priceUsd: number };
    };
    expect(quoted.data).toEqual({
      leadId,
      vertical: 'hvac',
      priceUsd: 60,
      receive: { ok: true },
    });
    // Quoting bills nothing.
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);

    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );
    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    const body = (await res.json()) as AcceptBody;
    // The quoted figure is what a BOOKING of this lead bills (the
    // quote→book amount match is pinned in lead-fee-booking.spec.ts,
    // the FR-1.6 suite). Accept itself bills nothing.
    expect(body.data.meterEvent).toBeNull();
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });

  it('GET /:id/fee is 404 for a lead outside the workspace', async () => {
    const res = await leadsRouter.fetch(leadsReq('/no-such-lead/fee'), env);
    expect(res.status).toBe(404);
  });

  it('an unmapped service fails loudly: fee 422, accept 422, nothing billed', async () => {
    // 'Service evaluation' is the old substring trap — 'ev' inside
    // "evaluation" priced it as an EV-charger lead. It is not a rate-card
    // key, so both paths now refuse instead of guessing.
    const leadId = await createInternalLead('Service evaluation');

    const quote = await leadsRouter.fetch(leadsReq(`/${leadId}/fee`), env);
    expect(quote.status).toBe(422);
    const quoteBody = (await quote.json()) as { error?: { code?: string } };
    expect(quoteBody.error?.code).toBe('UNMAPPED_SERVICE');

    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );
    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNMAPPED_SERVICE');

    // No mutation, no meter event: the lead was never accepted.
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
    const row = sqlite.raw
      .prepare('SELECT accepted_at FROM leads WHERE id = ?')
      .get(leadId) as { accepted_at: string | null };
    expect(row.accepted_at).toBeNull();
  });

  it('double-accept bills nothing, ever (WS-1)', async () => {
    const leadId = await createInternalLead('Plumbing repair');
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );

    const first = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    const second = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as AcceptBody;
    expect(secondBody.data.alreadyAccepted).toBe(true);
    expect(secondBody.data.meterEvent).toBeNull();

    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });

  it('cannot accept before qualifying, and nothing is billed', async () => {
    const leadId = await createInternalLead('Electrical panel upgrade');
    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });

  it('withdraw before acceptance bills nothing and blocks a later accept', async () => {
    const leadId = await createInternalLead('Fence install');
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );

    const withdrawRes = await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, { method: 'POST' }),
      env,
    );
    expect(withdrawRes.status).toBe(200);
    const withdrawBody = (await withdrawRes.json()) as WithdrawBody;
    expect(withdrawBody.data.meterEventAdjustment).toBe('none');
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);

    const acceptRes = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    expect(acceptRes.status).toBe(409);
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });

  it('withdraw after acceptance adjusts nothing — accept created no fee (WS-1)', async () => {
    const leadId = await createInternalLead('Roofing repair');
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );

    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WithdrawBody;
    // withdrawLead's vocabulary: an accepted lead with no meter row at
    // all reads 'none'. The WS-1 point is the row count:
    // no fee was ever created, so nothing was billed or forgiven.
    expect(body.data.meterEventAdjustment).toBe('none');
    expect(sqlite.rows<MeterEventRow>('lead_meter_events')).toHaveLength(0);
  });

  it('withdraw leaves an already-invoiced booking fee untouched (no refund invented)', async () => {
    const leadId = await createInternalLead('Solar panel install');
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );

    await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );

    // A booking fee that has already been collected (WS-1: the row is
    // written at booking commit and charged immediately).
    sqlite.raw
      .prepare(
        `INSERT INTO lead_meter_events
           (id, workspace_id, lead_id, vertical, service_type, price_usd, status, created_at)
         VALUES (?, ?, ?, 'solar', 'Solar panel install', 110, 'invoiced', ?)`,
      )
      .run(
        crypto.randomUUID(),
        DEMO_WORKSPACE,
        leadId,
        new Date().toISOString(),
      );

    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WithdrawBody;
    expect(body.data.meterEventAdjustment).toBe('left_unchanged');

    const events = sqlite.rows<MeterEventRow>('lead_meter_events');
    expect(events[0]?.status).toBe('invoiced'); // untouched, not waived/refunded
  });

  it('withdraw records the reason the staff give, and refuses one outside the set', async () => {
    const leadId = await createInternalLead('HVAC tune-up');
    const refused = await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'changed_mind' }),
      }),
      env,
    );
    expect(refused.status).toBe(400);
    const leadRow = () =>
      sqlite
        .rows<{
          id: string;
          withdrawn_at: string | null;
          withdrawn_reason: string | null;
        }>('leads')
        .find((l) => l.id === leadId);
    expect(leadRow()?.withdrawn_at).toBeNull();

    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'no_longer_needed' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WithdrawBody;
    expect(body.data.lead.withdrawnReason).toBe('no_longer_needed');
    expect(body.data.lead.withdrawnAt).toBeTruthy();
    expect(leadRow()?.withdrawn_reason).toBe('no_longer_needed');
  });

  it('withdraw without a body records no reason', async () => {
    const leadId = await createInternalLead('HVAC tune-up');
    const res = await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WithdrawBody;
    expect(body.data.lead.withdrawnAt).toBeTruthy();
    expect(body.data.lead.withdrawnReason).toBeUndefined();
    const entry = sqlite
      .rows<{ action: string; meta: string }>('activity_log')
      .find((e) => e.action === 'withdrawn');
    expect(JSON.parse(entry?.meta ?? '{}')).toEqual({
      meterEventAdjustment: 'none',
      reason: null,
    });
  });

  it('withdraw is idempotent', async () => {
    const leadId = await createInternalLead('HVAC tune-up');
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/qualify`, { method: 'POST' }),
      env,
    );
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, { method: 'POST' }),
      env,
    );
    const second = await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, { method: 'POST' }),
      env,
    );
    expect(second.status).toBe(200);
    // No meter event was ever created (accept does not bill, WS-1),
    // and the second withdrawal re-processes nothing.
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });
});

// ── The consumer path (GP-105) ────────────────────────────────
//
// A homeowner books from their quote, the contractor accepts the lead,
// and then the homeowner cancels from the tenant site with nothing but
// the session capability. WS-1: the tenant-site booking IS a booking
// commit, so it meters the lead fee in the same batch as the job (the
// shared rate card and insert the API's recordLeadMeter uses); the staff
// accept is a state transition and meters nothing. The cancel withdraws
// the lead, cancels the job and frees its half-hours for the next
// caller, and leaves the fee standing (FR-1.4: a cancel is not a refund
// case). A session from another workspace cannot reach any of it.

const SEED_DIR = join(ROOT, 'seeds', 'pricing');
const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const evMachine = machines.find((m) => m.slug === 'ev-charger-install');
if (!evMachine) throw new Error('the EV machine is missing from seeds/pricing');
const evFixture = readFixture(join(SEED_DIR, 'fixtures', '01-ev-typical.json'));
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

const demoSite: WorkspaceData = {
  id: DEMO_WORKSPACE,
  name: 'Demo Electric',
  // Not `demo`: the public demo shop is never billed, and these tests
  // are about the booking fee standing.
  slug: 'demo-electric',
  trade: 'electrical',
  phone: '512-555-0100',
  email: 'demo@example.com',
  logo_url: null,
  street: '',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
};

interface JobRow {
  id: string;
  status: string;
  scheduled_start: string;
}

describe('a homeowner cancelling from the tenant site', () => {
  let sqlite: SqliteD1;
  let env: Env;
  let tenantEnv: TenantEnv;
  let ids: number;
  const newId = () => `gp105-${++ids}`;
  const NOW = new Date('2027-06-01T12:00:00.000Z');

  beforeEach(() => {
    ids = 0;
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
      sql: [
        // The demo workspace says when it works, so it can be booked, and
        // has a card on file (a Stripe customer), which self-booking needs.
        // It is renamed off the `demo` slug, which is never billed.
        `UPDATE workspaces SET slug = 'demo-electric', timezone = 'America/Chicago', stripe_customer_id = 'cus_demo' WHERE id = '${DEMO_WORKSPACE}';`,
        ...[1, 2, 3, 4, 5].map(
          (weekday) =>
            `INSERT INTO workspace_availability (id, workspace_id, weekday, opens_at, closes_at, is_open)
               VALUES ('wa-${weekday}', '${DEMO_WORKSPACE}', ${weekday}, '08:00', '17:00', 1);`,
        ),
        // The EV machine and the default rate card, as the seeder publishes them.
        `INSERT INTO rate_cards (id, workspace_id, name) VALUES ('rc', NULL, 'Greenput default');`,
        `INSERT INTO rate_card_versions (id, rate_card_id, version_number, rates_json, status)
           VALUES ('rcv', 'rc', 1, ${q(JSON.stringify(rateCard))}, 'published');`,
        `INSERT INTO pricing_fsms (id, workspace_id, slug, vertical, name, description, current_version_id)
           VALUES ('fsm', NULL, 'ev-charger-install', 'ev_charger', ${q(evMachine.name)}, '', 'fsmv');`,
        `INSERT INTO pricing_fsm_versions (id, fsm_id, version_number, graph_json, status)
           VALUES ('fsmv', 'fsm', 1, ${q(JSON.stringify(evMachine))}, 'published');`,
      ],
    });
    env = { DB: sqlite.db } as unknown as Env;
    tenantEnv = { DB: sqlite.db, ENVIRONMENT: 'test' };
  });

  afterEach(() => {
    sqlite.close();
  });

  /** A priced EV quote, its lead, and the job booked off it. */
  async function bookFromQuote(): Promise<{
    sessionId: string;
    leadId: string;
    jobId: string;
    startUtc: string;
  }> {
    const db = sqlite.db as unknown as D1Like;
    const flow = await loadFlow(db, DEMO_WORKSPACE, 'ev-charger-install');
    if (!flow) throw new Error('flow not published');
    const session = await createSession(db, {
      id: crypto.randomUUID(),
      workspaceId: DEMO_WORKSPACE,
      flow,
      sourceUrl: null,
    });
    const result = evaluate(
      evMachine,
      rateCard,
      evFixture.answers,
      evFixture.env ?? {},
    );
    expect(result.kind).toBe('quote');
    const completed = await completeSession(db, session, result);
    const lead = await createLeadFromQuote({
      db,
      session: completed,
      machine: evMachine,
      answers: result.answers,
      result,
      newId,
    });
    if (!lead) throw new Error('no lead from the quote');

    const offer = await offerSlots(sqlite.db, DEMO_WORKSPACE, result, NOW);
    const startUtc = offer?.slots[0]?.startUtc;
    if (!offer || !startUtc) throw new Error('nothing on offer');
    const booked = await bookQuotedJob({
      db: sqlite.db,
      session: { ...completed, lead_id: lead.leadId },
      flow,
      result,
      startUtc,
      durationMinutes: offer.durationMinutes,
      newId,
      now: NOW,
    });
    if (booked.kind !== 'booked') throw new Error(booked.kind);
    return {
      sessionId: session.id,
      leadId: lead.leadId,
      jobId: booked.jobId,
      startUtc,
    };
  }

  async function cancelFromSite(
    sessionId: string,
    site: WorkspaceData,
    reason = 'schedule_no_longer_works',
  ) {
    const body = new FormData();
    body.set('reason', reason);
    return handleQuoteRequest(
      new Request(
        `https://${site.slug}.greenput.com/quote/s/${sessionId}/cancel`,
        {
          method: 'POST',
          body,
        },
      ),
      tenantEnv,
      site,
    );
  }

  it('cancels the job, frees the slot — and the booking fee stands (WS-1)', async () => {
    const { sessionId, leadId, jobId, startUtc } = await bookFromQuote();

    // The booking metered the fee: one pending row, tied to the job, at
    // the EV rate the API would have billed for the same booking.
    const fee = () => sqlite.rows<MeterEventRow>('lead_meter_events');
    expect(fee()).toHaveLength(1);
    expect(fee()[0]).toMatchObject({
      lead_id: leadId,
      job_id: jobId,
      vertical: 'ev_charger',
      price_usd: 60,
      status: 'pending',
    });

    // The quote qualified the lead. Accepting it is a state transition,
    // not a billing event: still the one row.
    const accepted = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    expect(accepted.status).toBe(200);
    expect(fee()).toHaveLength(1);
    expect(sqlite.rows('job_slots').length).toBeGreaterThan(0);

    const res = await cancelFromSite(sessionId, demoSite);
    expect(res).toEqual({
      kind: 'redirect',
      location: `/quote/s/${sessionId}`,
    });

    // The money: the booking fee stands, unchanged.
    expect(fee()).toHaveLength(1);
    expect(fee()[0]?.status).toBe('pending');

    // The job and its half-hours.
    const job = sqlite.rows<JobRow>('jobs').find((j) => j.id === jobId);
    expect(job?.status).toBe('cancelled');
    expect(sqlite.rows('job_slots')).toHaveLength(0);

    // The lead, as the platform will read it.
    const detail = await leadsRouter.fetch(leadsReq(`/${leadId}`), env);
    const body = (await detail.json()) as { data: LeadBody };
    expect(body.data.withdrawnAt).toBeTruthy();
    expect(body.data.withdrawnReason).toBe('schedule_no_longer_works');
    expect(body.data.acceptedAt).toBeTruthy();

    // The slot is offered to the next caller.
    const result = evaluate(
      evMachine,
      rateCard,
      evFixture.answers,
      evFixture.env ?? {},
    );
    const offer = await offerSlots(sqlite.db, DEMO_WORKSPACE, result, NOW);
    expect(offer?.slots.map((s) => s.startUtc)).toContain(startUtc);

    // Idempotent from either side: the staff withdrawing again changes nothing.
    const again = await leadsRouter.fetch(
      leadsReq(`/${leadId}/withdraw`, { method: 'POST' }),
      env,
    );
    expect(
      ((await again.json()) as WithdrawBody).data.meterEventAdjustment,
    ).toBe('none');
    expect(fee()).toHaveLength(1);
    expect(fee()[0]?.status).toBe('pending');
  });

  it("a cancel carrying another workspace's session touches nothing", async () => {
    const { sessionId, jobId } = await bookFromQuote();
    const elsewhere: WorkspaceData = {
      ...demoSite,
      id: '00000000-0000-4000-8000-00000000dead',
      slug: 'elsewhere',
    };
    const res = await cancelFromSite(sessionId, elsewhere);
    expect(res.kind).toBe('html');
    if (res.kind === 'html') expect(res.status).toBe(404);

    expect(
      sqlite.rows<JobRow>('jobs').find((j) => j.id === jobId)?.status,
    ).toBe('scheduled');
    expect(sqlite.rows('job_slots').length).toBeGreaterThan(0);
    expect(
      sqlite
        .rows<{ withdrawn_at: string | null }>('leads')
        .every((l) => l.withdrawn_at === null),
    ).toBe(true);
  });

  it('before acceptance the cancel leaves the booking fee standing and blocks a later accept', async () => {
    const { sessionId, leadId } = await bookFromQuote();
    await cancelFromSite(sessionId, demoSite, 'no_longer_needed');
    // The fee was earned at booking commit, not at accept (WS-1).
    expect(sqlite.rows('lead_meter_events')).toHaveLength(1);
    const accepted = await leadsRouter.fetch(
      leadsReq(`/${leadId}/accept`, { method: 'POST' }),
      env,
    );
    expect(accepted.status).toBe(409);
    expect(sqlite.rows('lead_meter_events')).toHaveLength(1);
  });
});
