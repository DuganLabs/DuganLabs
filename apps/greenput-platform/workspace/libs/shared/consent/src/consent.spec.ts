import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  CONSENT_TEXT_FORM_V1,
  findActiveConsent,
  hasSmsConsent,
  recordConsent,
  revokeConsent,
  type D1Like,
} from './consent';

const ROOT = resolve(__dirname, '../../../..');
const WS = '00000000-0000-4000-8000-0000000000e1';
const WS2 = '00000000-0000-4000-8000-0000000000e2';
const LEAD = '00000000-0000-4000-8000-0000000000e3';
const PHONE = '+19495550100';

let sqlite: SqliteD1;
let seq = 0;
const newId = () => `consent-${++seq}`;

function seed(): string {
  return `
INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'rivertown-consent', 'electrical', '5125550142',
        'hello@rivertown.example', '100 Example Way', 'Rivertown', 'TX', '78701', '2026-01-01T00:00:00.000Z'),
       ('${WS2}', 'Elsewhere Plumbing', 'elsewhere-consent', 'plumbing', '5125550199',
        'hello@elsewhere.example', '1 Far St', 'Elsewhere', 'TX', '78799', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-0000000000e9', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, service_type, created_at, updated_at, created_by)
VALUES ('${LEAD}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '${PHONE}', 'ev-charger-install',
        '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '00000000-0000-4000-8000-0000000000e9');
`;
}

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [resolve(ROOT, 'schema.sql')],
    sql: [seed()],
  });
});

afterEach(() => sqlite.close());

const db = () => sqlite.db as unknown as D1Like;

describe('recordConsent', () => {
  it('persists a grant-model record: grantee, fields, purpose, timestamp, source', async () => {
    const rec = await recordConsent({
      db: db(),
      newId,
      workspaceId: WS,
      leadId: LEAD,
      consumerPhone: PHONE,
      consumerEmail: 'Jane@Example.com',
      fields: ['name', 'phone', 'email', 'job_details'],
      source: 'public_form',
      consentText: CONSENT_TEXT_FORM_V1,
      now: '2026-10-16T10:00:00.000Z',
    });
    expect(rec.purpose).toBe('quote-and-schedule');
    expect(rec.allowNetworkReroute).toBe(false);
    expect(rec.grantedAt).toBe('2026-10-16T10:00:00.000Z');
    expect(rec.consumerEmail).toBe('jane@example.com');
    const rows = sqlite.rows('consent_records');
    expect(rows).toHaveLength(1);
  });

  it('rejects a field outside the grant model', async () => {
    await expect(
      recordConsent({
        db: db(),
        newId,
        workspaceId: WS,
        consumerPhone: PHONE,
        fields: ['phone', 'ssn' as never],
        source: 'public_form',
        consentText: CONSENT_TEXT_FORM_V1,
      }),
    ).rejects.toThrow(/Unknown consent field/);
  });

  it('rejects a grant with no contact path (the MCP contract rule)', async () => {
    await expect(
      recordConsent({
        db: db(),
        newId,
        workspaceId: WS,
        consumerPhone: PHONE,
        fields: ['name', 'job_details'],
        source: 'public_form',
        consentText: CONSENT_TEXT_FORM_V1,
      }),
    ).rejects.toThrow(/contact path/);
  });
});

describe('hasSmsConsent — no record, no send', () => {
  it('is false when nothing was ever granted', async () => {
    expect(await hasSmsConsent(db(), WS, PHONE)).toBe(false);
  });

  it('is true for an active phone grant, false for the other workspace', async () => {
    await recordConsent({
      db: db(),
      newId,
      workspaceId: WS,
      leadId: LEAD,
      consumerPhone: PHONE,
      fields: ['name', 'phone'],
      source: 'intake_quote',
      consentText: 'intake text',
    });
    expect(await hasSmsConsent(db(), WS, PHONE)).toBe(true);
    expect(await hasSmsConsent(db(), WS2, PHONE)).toBe(false);
  });

  it('is false for an email-only grant', async () => {
    await recordConsent({
      db: db(),
      newId,
      workspaceId: WS,
      consumerEmail: 'jane@example.com',
      fields: ['name', 'email'],
      source: 'public_form',
      consentText: CONSENT_TEXT_FORM_V1,
    });
    expect(await hasSmsConsent(db(), WS, PHONE)).toBe(false);
  });

  it('is false after revocation', async () => {
    await recordConsent({
      db: db(),
      newId,
      workspaceId: WS,
      leadId: LEAD,
      consumerPhone: PHONE,
      fields: ['phone'],
      source: 'public_form',
      consentText: CONSENT_TEXT_FORM_V1,
    });
    const revoked = await revokeConsent(db(), {
      workspaceId: WS,
      consumerPhone: PHONE,
      revokeSource: 'stop_text',
    });
    expect(revoked).toBe(1);
    expect(await hasSmsConsent(db(), WS, PHONE)).toBe(false);
    // The record itself is kept — revocation ends it, never erases it.
    const found = await findActiveConsent({
      db: db(),
      workspaceId: WS,
      consumerPhone: PHONE,
    });
    expect(found).toBeNull();
    expect(sqlite.rows('consent_records')).toHaveLength(1);
  });
});
