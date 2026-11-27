import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { dispatchNotification } from '@greenput/shared/notifications';
import type { Env } from '../env';
import { TWILIO_US_SMS_SEGMENT_MICRO_USD } from './usage-balance';
import { dispatchWorkspaceNotification } from './workspace-notifications';

const SCHEMA = resolve(__dirname, '../../../../schema.sql');

describe('workspace notification SMS billing', () => {
  let sqlite: SqliteD1;
  const urls: string[] = [];

  function env(overrides: Partial<Env> = {}): Env {
    return {
      DB: sqlite.db,
      ENVIRONMENT: 'test',
      STRIPE_SECRET_KEY: 'sk_test',
      TWILIO_ACCOUNT_SID: 'AC_TEST',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_FROM_NUMBER: '+15550001111',
      ...overrides,
    } as Env;
  }

  beforeEach(() => {
    sqlite = createSqliteD1({ files: [SCHEMA] });
    urls.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function seed(balance: number): { workspaceId: string; userId: string } {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    sqlite.raw
      .prepare(
        `INSERT INTO workspaces (id, name, slug, email, stripe_customer_id, usage_balance_micro_usd)
         VALUES (?, 'Shop', ?, ?, 'cus_test', ?)`,
      )
      .run(
        workspaceId,
        `shop-${workspaceId.slice(0, 8)}`,
        `${workspaceId}@example.com`,
        balance,
      );
    sqlite.raw
      .prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
         VALUES (?, ?, 'Ada', 'Owner', ?, 'owner', '')`,
      )
      .run(userId, workspaceId, `${userId}@example.com`);
    return { workspaceId, userId };
  }

  function prefer(userId: string, channel: 'email' | 'sms', enabled = 1): void {
    sqlite.raw
      .prepare(
        `INSERT INTO notification_preferences (id, user_id, event_type, channel, enabled)
         VALUES (?, ?, 'new_lead', ?, ?)`,
      )
      .run(crypto.randomUUID(), userId, channel, enabled);
  }

  function balanceOf(id: string): number {
    const row = sqlite.raw
      .prepare(
        'SELECT usage_balance_micro_usd AS n FROM workspaces WHERE id = ?',
      )
      .get(id) as { n: number };
    return Number(row.n);
  }

  function ledger(id: string): Array<Record<string, unknown>> {
    return sqlite.raw
      .prepare(
        `SELECT kind, amount_micro_usd, payment_status
           FROM workspace_usage_ledger WHERE workspace_id = ? ORDER BY created_at`,
      )
      .all(id) as Array<Record<string, unknown>>;
  }

  function logs(
    id: string,
  ): Array<{ channel: string; status: string; error_msg: string | null }> {
    return sqlite.raw
      .prepare(
        `SELECT channel, status, error_msg FROM notification_log
          WHERE workspace_id = ? ORDER BY channel`,
      )
      .all(id) as Array<{
      channel: string;
      status: string;
      error_msg: string | null;
    }>;
  }

  function stubTwilio(): void {
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('api.twilio.com')) {
          return new Response(JSON.stringify({ sid: 'SM_alert_1' }), {
            status: 201,
          });
        }
        throw new Error(`unhandled ${url}`);
      },
    );
  }

  it('debits the workspace balance for a lead-alert SMS', async () => {
    const { workspaceId, userId } = seed(5_000_000);
    prefer(userId, 'sms');
    stubTwilio();

    await dispatchWorkspaceNotification(env(), {
      type: 'new_lead',
      workspaceId,
      leadName: 'Ada',
      source: 'website',
    });

    expect(balanceOf(workspaceId)).toBe(
      5_000_000 - TWILIO_US_SMS_SEGMENT_MICRO_USD,
    );
    expect(ledger(workspaceId)).toEqual([
      expect.objectContaining({
        kind: 'sms_estimate',
        amount_micro_usd: -TWILIO_US_SMS_SEGMENT_MICRO_USD,
      }),
    ]);
    expect(urls).toEqual([expect.stringContaining('api.twilio.com')]);
    expect(logs(workspaceId)).toEqual([
      { channel: 'sms', status: 'sent', error_msg: null },
    ]);
  });

  it('does not debit or block when no billing hook is injected', async () => {
    const { workspaceId, userId } = seed(5_000_000);
    prefer(userId, 'sms');
    stubTwilio();

    await dispatchNotification(env(), {
      type: 'new_lead',
      workspaceId,
      leadName: 'Ada',
      source: 'website',
    });

    expect(balanceOf(workspaceId)).toBe(5_000_000);
    expect(ledger(workspaceId)).toEqual([]);
    expect(urls.some((url) => url.includes('api.twilio.com'))).toBe(true);
    expect(logs(workspaceId)).toEqual([
      { channel: 'sms', status: 'sent', error_msg: null },
    ]);
  });

  it('emails the notice when the usage balance blocks the SMS', async () => {
    const { workspaceId, userId } = seed(0);
    prefer(userId, 'sms');
    sqlite.raw
      .prepare(
        `INSERT INTO workspace_usage_ledger
           (id, workspace_id, kind, amount_micro_usd, balance_after_micro_usd,
            payment_status, description)
         VALUES (?, ?, 'topup', 0, 0, 'failed', 'top-up declined')`,
      )
      .run(crypto.randomUUID(), workspaceId);
    vi.stubGlobal('fetch', () => {
      throw new Error('blocked SMS must not call Twilio or Stripe');
    });

    await dispatchWorkspaceNotification(env(), {
      type: 'new_lead',
      workspaceId,
      leadName: 'Ada',
      source: 'website',
    });

    expect(balanceOf(workspaceId)).toBe(0);
    expect(ledger(workspaceId).map((row) => row['kind'])).toEqual(['topup']);
    expect(logs(workspaceId)).toEqual([
      { channel: 'email', status: 'sent', error_msg: null },
      { channel: 'sms', status: 'failed', error_msg: 'USAGE_EXHAUSTED' },
    ]);
  });

  it('does not send a second email when email was already selected', async () => {
    const { workspaceId, userId } = seed(0);
    prefer(userId, 'email');
    prefer(userId, 'sms');
    sqlite.raw
      .prepare(
        `INSERT INTO workspace_usage_ledger
           (id, workspace_id, kind, amount_micro_usd, balance_after_micro_usd,
            payment_status, description)
         VALUES (?, ?, 'topup', 0, 0, 'failed', 'top-up declined')`,
      )
      .run(crypto.randomUUID(), workspaceId);
    vi.stubGlobal('fetch', () => {
      throw new Error('blocked SMS must not call Twilio or Stripe');
    });

    await dispatchWorkspaceNotification(env(), {
      type: 'new_lead',
      workspaceId,
      leadName: 'Ada',
      source: 'website',
    });

    expect(logs(workspaceId)).toEqual([
      { channel: 'email', status: 'sent', error_msg: null },
      { channel: 'sms', status: 'failed', error_msg: 'USAGE_EXHAUSTED' },
    ]);
  });
});
