import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import worker from '../index';
import type { Env } from '../env';
import { corsHeaders } from './auth';
import { createFakeKv } from '../test-helpers';

/**
 * WS-0 (PRD v1.5): the deposit CORS widening is REMOVED.
 *
 * There used to be one request-aware exception to the static CORS
 * policy: a verified workspace custom domain was echoed as an allowed
 * origin on the two public deposit endpoints, because the homeowner's
 * deposit-confirmation page was served from that domain. The page and
 * the endpoints were removed when the booking-deposit model was
 * revoked (2026-10-20), so the exception has nothing left to serve.
 * These tests pin the closure: even with a real deposit row whose
 * workspace owns an ACTIVE custom domain, that domain's origin earns
 * exactly the static policy on the old deposit paths — the same as on
 * every other route — through the header builder and through the real
 * worker (preflight and actual request).
 */

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000d1';
const OWNER = '00000000-0000-4000-8000-0000000000d2';
const LEAD = '00000000-0000-4000-8000-0000000000d3';
const CUSTOMER = '00000000-0000-4000-8000-0000000000d4';
const OPP = '00000000-0000-4000-8000-0000000000d5';
const JOB = '00000000-0000-4000-8000-0000000000d6';
const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

const DOMAIN = 'www.hipower.example';
const DOMAIN_ORIGIN = `https://${DOMAIN}`;
const STATIC_DEFAULT = 'https://greenput.com';

let sqlite: SqliteD1;

function seed(): string {
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, timezone, stripe_account_id, custom_hostname, custom_domain_status, created_at)
VALUES ('${WS}', 'Hi Power Electric', 'hi-power', 'electrical', '9495550100',
        'shop@hipower.example', '1 Main St', 'Irvine', 'CA', '92620', 'America/Los_Angeles', 'acct_test_123', '${DOMAIN}', 'active', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${OWNER}', '${WS}', 'Sheen', 'Oshin', 'sheen@hipower.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO customers (id, workspace_id, first_name, last_name, email, phone, preferred_contact, street, city, state, zip, notes, total_job_value, job_count, created_at, updated_at, created_by)
VALUES ('${CUSTOMER}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '+19495550100', 'phone',
        '2 Oak Ave', 'Irvine', 'CA', '92620', '', 0, 0,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '${OWNER}');

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, status, source, service_type, qualified_at, accepted_at, created_at, updated_at, created_by)
VALUES ('${LEAD}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '+19495550100', 'accepted', 'website', 'ev-charger-install',
        '2026-10-16T08:00:00.000Z', '2026-10-16T09:00:00.000Z',
        '2026-10-16T08:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}');

INSERT INTO opportunities (id, workspace_id, lead_id, customer_id, title, status, value, service_type, notes, closed_at, converted_to_job_id, created_at, updated_at, created_by)
VALUES ('${OPP}', '${WS}', '${LEAD}', '${CUSTOMER}', 'EV charger — Jane Doe', 'won', 0, 'ev-charger-install', '',
        '2026-10-16T09:00:00.000Z', '${JOB}',
        '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}');

INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status, street, city, state, zip, scheduled_start, scheduled_end, total, notes, created_at, updated_at, created_by, assigned_to)
VALUES ('${JOB}', '${WS}', '${OPP}', '${CUSTOMER}', '#1001', 'EV charger — Jane Doe', 'scheduled',
        '2 Oak Ave', 'Irvine', 'CA', '92620',
        '2026-10-20T17:00:00.000Z', '2026-10-20T19:00:00.000Z', 0, '',
        '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z', '${OWNER}', '${OWNER}');

INSERT INTO deposits (id, workspace_id, job_id, lead_id, customer_id, stripe_payment_intent_id, connected_account_id, amount_cents, currency, fee_cents, status, confirmation_token, created_at, updated_at)
VALUES ('dep-1', '${WS}', '${JOB}', '${LEAD}', '${CUSTOMER}', 'pi_test_1', 'acct_test_123', 12000, 'usd', 6000, 'pending', '${TOKEN}', '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z');
`;
}

function workerEnv(): Env {
  return {
    ENVIRONMENT: 'production',
    DB: sqlite.db,
    SESSIONS: createFakeKv(liveClock) as unknown as KVNamespace,
  } as Env;
}

const liveClock = {
  get now(): number {
    return Date.now();
  },
};

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (promise: Promise<unknown>) => {
      void promise?.catch?.(() => undefined);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
}

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [resolve(ROOT, 'schema.sql')],
    sql: [seed()],
  });
});

afterEach(() => {
  sqlite?.close();
});

describe('static CORS policy — no deposit widening (WS-0)', () => {
  it('does not echo a workspace custom-domain origin', () => {
    const headers = corsHeaders(DOMAIN_ORIGIN, workerEnv());
    expect(headers['Access-Control-Allow-Origin']).toBe(STATIC_DEFAULT);
  });

  it('still echoes a Greenput tenant origin under the static policy', () => {
    const headers = corsHeaders('https://hi-power.greenput.com', workerEnv());
    expect(headers['Access-Control-Allow-Origin']).toBe(
      'https://hi-power.greenput.com',
    );
  });
});

describe('deposit paths through the real worker (WS-0)', () => {
  it('answers the preflight from an active custom domain with the static default', async () => {
    const res = await worker.fetch(
      new Request(
        `https://api.greenput.com/api/public/deposits/${TOKEN}/session`,
        {
          method: 'OPTIONS',
          headers: {
            origin: DOMAIN_ORIGIN,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type',
          },
        },
      ),
      workerEnv(),
      makeCtx(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STATIC_DEFAULT);
  });

  it('serves nothing on the old status endpoint and does not echo the custom domain', async () => {
    const res = await worker.fetch(
      new Request(`https://api.greenput.com/api/public/deposits/${TOKEN}`, {
        method: 'GET',
        headers: { origin: DOMAIN_ORIGIN },
      }),
      workerEnv(),
      makeCtx(),
    );
    // The route is gone: the request falls through the public router
    // to the auth catch-all, which answers an unauthenticated caller
    // 401 — the same as every other unknown /api/public/* path. No
    // deposit data is served, and the origin earns only the static
    // policy.
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STATIC_DEFAULT);
    expect(await res.text()).not.toContain('12000');
  });
});
