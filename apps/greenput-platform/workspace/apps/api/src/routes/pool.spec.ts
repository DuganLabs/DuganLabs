import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { poolRouter } from './pool';

const ROOT = resolve(__dirname, '../../../..');
const WS_A = '00000000-0000-4000-8000-000000000aa1';
const WS_B = '00000000-0000-4000-8000-000000000aa2';
const OWNER_A = '00000000-0000-4000-8000-000000000aa3';
const OWNER_B = '00000000-0000-4000-8000-000000000aa4';
const LEAD = '00000000-0000-4000-8000-000000000aa5';
const PHONE = '+19495550100';

let sqlite: SqliteD1;

function seed(reroute: boolean): string {
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, created_at)
VALUES ('${WS_A}', 'Rivertown Electric', 'rivertown-pool', 'electrical', '5125550142',
        'hello@rivertown.example', '100 Example Way', 'Rivertown', 'TX', '78701', '2026-01-01T00:00:00.000Z'),
       ('${WS_B}', 'Hill Country Electric', 'hill-country-pool', 'electrical', '5125550199',
        'hello@hill.example', '1 Far St', 'Elsewhere', 'TX', '78799', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${OWNER_A}', '${WS_A}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
       ('${OWNER_B}', '${WS_B}', 'Sam', 'Hill', 'sam@hill.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, status, source, service_type, qualified_at, created_at, updated_at, created_by)
VALUES ('${LEAD}', '${WS_A}', 'Jane', 'Doe', 'jane@example.com', '${PHONE}', 'qualified', 'website', 'ev-charger-install',
        '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '${OWNER_A}');

INSERT INTO consent_records (id, workspace_id, lead_id, consumer_phone, consumer_email, fields, purpose, allow_network_reroute, source, consent_text, granted_at, created_at)
VALUES ('grant-a', '${WS_A}', '${LEAD}', '${PHONE}', 'jane@example.com', '["name","phone","email","job_details"]', 'quote-and-schedule', ${reroute ? 1 : 0}, 'public_form', 'form text', '2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z');
`;
}

function as(req: Request, userId: string, workspaceId: string): Request {
  const mutable = req as unknown as Record<string, unknown>;
  mutable['user'] = {
    id: userId,
    workspaceId,
    firstName: 'X',
    lastName: 'Y',
    email: '',
    role: 'owner',
  };
  mutable['workspaceId'] = workspaceId;
  return req;
}

function post(
  path: string,
  body: unknown,
  userId: string,
  workspaceId: string,
): Promise<Response> {
  return poolRouter.fetch(
    as(
      new Request(`https://api.greenput.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      userId,
      workspaceId,
    ),
    { DB: sqlite.db } as never,
  );
}

async function offer(): Promise<{ offerId: string }> {
  const res = await post(
    '/api/pool/offers',
    { leadId: LEAD, toWorkspaceId: WS_B },
    OWNER_A,
    WS_A,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    data: { offerId: string; consumerId: string };
  };
  return body.data;
}

describe('the pool mechanism', () => {
  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(true)],
    });
  });

  afterEach(() => sqlite.close());

  it('offer → accept moves the lead, bills NOTHING (WS-1), and grants the receiver its own consent record', async () => {
    const { offerId } = await offer();

    const res = await post(
      `/api/pool/offers/${offerId}/accept`,
      {},
      OWNER_B,
      WS_B,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { leadId: string; priceUsd: number; vertical: string };
    };
    // priceUsd/vertical stay on the shape as the quote for the booking
    // that will bill — the accept itself creates no fee.
    expect(body.data).toEqual({
      leadId: LEAD,
      priceUsd: 60,
      vertical: 'ev_charger',
    });

    const lead = sqlite.raw
      .prepare('SELECT workspace_id, accepted_at FROM leads WHERE id = ?')
      .get(LEAD) as { workspace_id: string; accepted_at: string | null };
    expect(lead.workspace_id).toBe(WS_B);
    expect(lead.accepted_at).toBeTruthy();

    // A pool accept is a transfer, not a booking: no meter row. The
    // receiver's fee fires when the lead books into their schedule.
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);

    expect(sqlite.rows('lead_transfers')).toHaveLength(1);

    const grants = sqlite.rows('consent_records') as {
      workspace_id: string;
      source: string;
      consumer_id: string | null;
    }[];
    const receiverGrant = grants.find((g) => g.workspace_id === WS_B);
    expect(receiverGrant?.source).toBe('pool_offer');
    expect(receiverGrant?.consumer_id).toBeTruthy();
    // The originator's grant got linked to the same consumer.
    const originGrant = grants.find((g) => g.workspace_id === WS_A);
    expect(originGrant?.consumer_id).toBe(receiverGrant?.consumer_id);
  });

  it('a second accept of the same offer is a 409 — exactly one move, no bill', async () => {
    const { offerId } = await offer();
    await post(`/api/pool/offers/${offerId}/accept`, {}, OWNER_B, WS_B);
    const second = await post(
      `/api/pool/offers/${offerId}/accept`,
      {},
      OWNER_B,
      WS_B,
    );
    expect(second.status).toBe(409);
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
    expect(sqlite.rows('lead_transfers')).toHaveLength(1);
  });

  it('decline leaves the lead with the originator, unbilled', async () => {
    const { offerId } = await offer();
    const res = await post(
      `/api/pool/offers/${offerId}/decline`,
      {},
      OWNER_B,
      WS_B,
    );
    expect(res.status).toBe(200);
    const lead = sqlite.raw
      .prepare('SELECT workspace_id FROM leads WHERE id = ?')
      .get(LEAD) as { workspace_id: string };
    expect(lead.workspace_id).toBe(WS_A);
    expect(sqlite.rows('lead_meter_events')).toHaveLength(0);
  });

  it('the offering workspace cannot accept its own offer (it is not the target)', async () => {
    const { offerId } = await offer();
    const res = await post(
      `/api/pool/offers/${offerId}/accept`,
      {},
      OWNER_A,
      WS_A,
    );
    expect(res.status).toBe(404);
  });
});

describe('the reroute consent gate', () => {
  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [seed(false)],
    });
  });

  afterEach(() => sqlite.close());

  it('without the reroute opt-in, the offer is refused 403 and nothing is created', async () => {
    const res = await post(
      '/api/pool/offers',
      { leadId: LEAD, toWorkspaceId: WS_B },
      OWNER_A,
      WS_A,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('NO_REROUTE_CONSENT');
    expect(sqlite.rows('lead_offers')).toHaveLength(0);
  });
});
