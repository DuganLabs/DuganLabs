import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { consentRouter, publicConsentRouter } from './consent';
import { publicRouter } from './public';

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000f1';
const OWNER = '00000000-0000-4000-8000-0000000000f2';
const PHONE = '+19495550100';

let sqlite: SqliteD1;

function seed(): string {
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'rivertown', 'electrical', '5125550142',
        'hello@rivertown.example', '100 Example Way', 'Rivertown', 'TX', '78701', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${OWNER}', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO consent_records (id, workspace_id, lead_id, consumer_phone, consumer_email, fields, purpose, allow_network_reroute, source, consent_text, granted_at, created_at)
VALUES ('consent-1', '${WS}', NULL, '${PHONE}', '', '["name","phone"]', 'quote-and-schedule', 0, 'public_form', 'form text', '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z');
`;
}

function authed(req: Request): Request {
  const mutable = req as unknown as Record<string, unknown>;
  mutable['user'] = {
    id: OWNER,
    workspaceId: WS,
    firstName: 'Dana',
    lastName: 'Ortiz',
    email: '',
    role: 'owner',
  };
  mutable['workspaceId'] = WS;
  return req;
}

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [resolve(ROOT, 'schema.sql')],
    sql: [seed()],
  });
});

afterEach(() => sqlite.close());

describe('consent routes', () => {
  it('GET /api/consent returns the active record for a phone', async () => {
    const res = await consentRouter.fetch(
      authed(
        new Request(
          `https://api.greenput.com/api/consent?phone=${encodeURIComponent(PHONE)}`,
        ),
      ),
      { DB: sqlite.db } as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; fields: string[]; source: string };
    };
    expect(body.data.id).toBe('consent-1');
    expect(body.data.fields).toEqual(['name', 'phone']);
    expect(body.data.source).toBe('public_form');
  });

  it('POST /api/consent/revoke ends the record; GET then 404s', async () => {
    const res = await consentRouter.fetch(
      authed(
        new Request('https://api.greenput.com/api/consent/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone: PHONE }),
        }),
      ),
      { DB: sqlite.db } as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { revoked: number } };
    expect(body.data.revoked).toBe(1);

    const after = await consentRouter.fetch(
      authed(
        new Request(
          `https://api.greenput.com/api/consent?phone=${encodeURIComponent(PHONE)}`,
        ),
      ),
      { DB: sqlite.db } as never,
    );
    expect(after.status).toBe(404);
  });

  it('POST /api/public/consent/revoke works without a session (the STOP path)', async () => {
    const res = await publicConsentRouter.fetch(
      new Request('https://api.greenput.com/api/public/consent/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'rivertown', phone: PHONE }),
      }),
      { DB: sqlite.db } as never,
    );
    expect(res.status).toBe(200);
    const rows = sqlite.rows('consent_records') as {
      revoked_at: string | null;
      revoke_source: string | null;
    }[];
    expect(rows[0]?.revoked_at).toBeTruthy();
    expect(rows[0]?.revoke_source).toBe('consumer_stop');
  });
});

describe('public lead capture with consent', () => {
  it('records consent only when the form asserts the checkbox', async () => {
    const post = (consent?: { granted: boolean }) =>
      publicRouter.fetch(
        new Request('https://api.greenput.com/api/public/leads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slug: 'rivertown',
            firstName: 'Jane',
            lastName: 'Doe',
            phone: PHONE,
            serviceType: 'ev-charger-install',
            ...(consent ? { consent } : {}),
          }),
        }),
        { DB: sqlite.db } as never,
      );

    expect((await post()).status).toBe(201);
    expect(sqlite.rows('consent_records')).toHaveLength(1); // only the seed

    expect((await post({ granted: false })).status).toBe(201);
    expect(sqlite.rows('consent_records')).toHaveLength(1);

    expect((await post({ granted: true })).status).toBe(201);
    const rows = sqlite.rows('consent_records') as {
      source: string;
      consumer_phone: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[1]?.source).toBe('public_form');
    expect(rows[1]?.consumer_phone).toBe(PHONE);
  });
});
