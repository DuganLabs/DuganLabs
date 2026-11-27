import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as deposits from './deposits';

/**
 * WS-0 (PRD v1.5): the booking-deposit model was revoked on 2026-10-20.
 * The engine in ./deposits.ts stays dormant ONLY to settle and reconcile
 * rows that already exist. Everything that served the homeowner
 * confirmation flow is unreachable since #262 and is removed; these
 * tests keep it from coming back by accident.
 */
const ROOT = resolve(__dirname, '../../../..');

describe('dead deposit surfaces stay removed', () => {
  it('the API engine exposes no homeowner confirmation-session surface', () => {
    const exported = Object.keys(deposits);
    expect(exported).not.toContain('getDepositConfirmationSession');
    expect(exported).not.toContain('loadDepositByConfirmationToken');
    // What stays: settlement and reconciliation for existing rows.
    expect(exported).toEqual(
      expect.arrayContaining([
        'releaseDeposit',
        'applyDeposit',
        'forfeitDeposit',
        'handleDepositWebhookEvent',
      ]),
    );
  });

  it('the tenant site carries no deposit confirmation page module', () => {
    expect(existsSync(resolve(ROOT, 'apps/tenant-site/src/deposit.ts'))).toBe(
      false,
    );
  });

  it('a delivery outcome has no deposit fields', () => {
    const source = readFileSync(
      resolve(ROOT, 'apps/api/src/lib/schedule-delivery.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /deposit(Id|Status|AmountCents|ConfirmationUrl)\??:/,
    );
  });
});
