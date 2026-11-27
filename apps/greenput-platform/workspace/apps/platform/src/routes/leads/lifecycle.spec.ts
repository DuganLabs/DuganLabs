import { afterEach, describe, expect, it } from 'vitest';
import type { Lead } from '@greenput/shared/models';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';
import {
  createLeadLifecycle,
  isLifecycleActionName,
  lifecycleAction,
  lifecycleStage,
  type LeadLifecycle,
} from './lifecycle.js';

function lead(partial: Partial<Lead>): Lead {
  return {
    id: 'l1',
    firstName: 'Alex',
    lastName: 'Reed',
    contact: {
      email: 'a@r.com',
      phone: '5551234567',
      preferredContact: 'phone',
    },
    status: 'new',
    source: 'website',
    notes: '',
    serviceType: 'HVAC',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

describe('lifecycleStage / lifecycleAction', () => {
  it('reads the stage from the timestamps, never from status', () => {
    expect(lifecycleStage(lead({ status: 'qualified' }))).toBe('new');
    expect(lifecycleStage(lead({ qualifiedAt: '2026-04-02T00:00:00Z' }))).toBe(
      'qualified',
    );
    expect(
      lifecycleStage(
        lead({
          qualifiedAt: '2026-04-02T00:00:00Z',
          acceptedAt: '2026-04-03T00:00:00Z',
        }),
      ),
    ).toBe('accepted');
    expect(
      lifecycleStage(
        lead({
          acceptedAt: '2026-04-03T00:00:00Z',
          withdrawnAt: '2026-04-04T00:00:00Z',
        }),
      ),
    ).toBe('withdrawn');
  });

  it('offers exactly one action per stage and none once withdrawn', () => {
    expect(lifecycleAction(lead({}))?.action).toBe('qualify');
    expect(lifecycleAction(lead({ qualifiedAt: 'x' }))?.action).toBe('accept');
    expect(lifecycleAction(lead({ acceptedAt: 'x' }))?.action).toBe('withdraw');
    expect(lifecycleAction(lead({ withdrawnAt: 'x' }))).toBeNull();
  });

  it('isLifecycleActionName guards the closed set', () => {
    expect(isLifecycleActionName('qualify')).toBe(true);
    expect(isLifecycleActionName('convert')).toBe(false);
  });
});

describe('createLeadLifecycle', () => {
  let lifecycle: LeadLifecycle | null = null;
  afterEach(() => {
    lifecycle?.dispose();
    lifecycle = null;
  });

  it('Qualify posts, announces and reloads', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads/l1/qualify', () =>
      jsonResponse({ data: lead({}) }),
    );
    const notices: string[] = [];
    let reloads = 0;
    lifecycle = createLeadLifecycle(buildTestDeps({ fetch: fake.fetch }), {
      notify: (m) => notices.push(m),
      reload: async () => {
        reloads += 1;
      },
    });
    lifecycle.run('qualify', lead({}));
    await tick();
    await tick();
    expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/leads/l1/qualify',
    ]);
    expect(notices).toEqual(['Qualified Alex Reed.']);
    expect(reloads).toBe(1);
  });

  it('Accept states the fee before Confirm is enabled, and reports it bills at booking (WS-1)', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads/l1/fee', () =>
      jsonResponse({
        data: { leadId: 'l1', vertical: 'ev_charger', priceUsd: 60 },
      }),
    );
    fake.respond('/api/leads/l1/accept', () =>
      jsonResponse({
        data: {
          lead: lead({}),
          meterEvent: null,
          alreadyAccepted: false,
          charge: null,
        },
      }),
    );
    const notices: string[] = [];
    lifecycle = createLeadLifecycle(buildTestDeps({ fetch: fake.fetch }), {
      notify: (m) => notices.push(m),
      reload: async () => undefined,
    });
    lifecycle.run('accept', lead({ qualifiedAt: 'x' }));
    const confirm = document.querySelector(
      '[data-testid="leads-accept-confirm"]',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await tick();
    await tick();
    expect(
      document.querySelector('[data-testid="leads-accept-fee"]')?.textContent,
    ).toBe('Lead fee: $60 (EV charger)');
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await tick();
    await tick();
    expect(notices).toEqual([
      'Accepted Alex Reed — the $60 lead fee bills at booking.',
    ]);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('keeps Confirm disabled when the workspace cannot receive a lead', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads/l1/fee', () =>
      jsonResponse({
        data: {
          leadId: 'l1',
          vertical: 'ev_charger',
          priceUsd: 60,
          receive: {
            ok: false,
            code: 'CARD_REQUIRED',
            message:
              'A card on file is required before this workspace can accept or auto-book a lead.',
          },
        },
      }),
    );
    lifecycle = createLeadLifecycle(buildTestDeps({ fetch: fake.fetch }), {
      notify: () => undefined,
      reload: async () => undefined,
    });
    lifecycle.run('accept', lead({ qualifiedAt: 'x' }));
    const confirm = document.querySelector(
      '[data-testid="leads-accept-confirm"]',
    ) as HTMLButtonElement;
    await tick();
    await tick();
    expect(confirm.disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="leads-accept-fee"]')?.textContent,
    ).toContain('card on file is required');
  });

  // WS-1 removed the accept-time charge, so there is no "card declined
  // at accept" outcome to report any more: accept returns charge: null
  // and the notice says the fee bills at booking (pinned above). The
  // receive-block that pauses delivery is pinned by 'keeps Confirm
  // disabled when the workspace cannot receive a lead'.

  it('Withdraw sends the chosen reason', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads/l1/withdraw', () =>
      jsonResponse({
        data: { lead: lead({}), meterEventAdjustment: 'left_unchanged' },
      }),
    );
    const notices: string[] = [];
    lifecycle = createLeadLifecycle(buildTestDeps({ fetch: fake.fetch }), {
      notify: (m) => notices.push(m),
      reload: async () => undefined,
    });
    lifecycle.run('withdraw', lead({ acceptedAt: 'x' }));
    const reason = document.querySelector(
      '[data-testid="leads-withdraw-reason"]',
    ) as HTMLSelectElement;
    reason.value = 'no_longer_needed';
    (
      document.querySelector(
        '[data-testid="leads-withdraw-confirm"]',
      ) as HTMLElement
    ).click();
    await tick();
    await tick();
    const call = fake.calls.find((c) => c.url.endsWith('/withdraw'));
    expect(call?.body).toEqual({ reason: 'no_longer_needed' });
    expect(notices[0]).toContain('lead fee stands');
  });
});
