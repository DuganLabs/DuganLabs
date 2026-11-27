import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Subscription,
  Workspace,
  WorkspaceAvailability,
  WorkspaceUser,
} from '@greenput/shared/models';
import {
  readSettingsTab,
  renderSettingsRoute,
  withTimeout,
} from './settings.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';

const WORKSPACE: Workspace = {
  id: 'w1',
  name: 'Reed HVAC',
  trade: 'HVAC',
  phone: '5551234567',
  email: 'hello@reed.example',
  address: { street: '1 Main', city: 'Town', state: 'CA', zip: '94000' },
  licenseNumber: 'CA-123',
  serviceTypes: ['HVAC', 'Plumbing'],
  serviceArea: 'Town metro',
  serviceRadiusMiles: 30,
  createdAt: '2026-01-01T00:00:00Z',
};

function user(partial: Partial<WorkspaceUser>): WorkspaceUser {
  return {
    id: 'u1',
    firstName: 'Alex',
    lastName: 'Reed',
    email: 'alex@reed.com',
    role: 'owner',
    avatarInitials: 'AR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('renderSettingsRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders 9 tab buttons with Workspace selected by default', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const tabs = view.element.querySelectorAll('[data-bn-settings-tab]');
    expect(tabs).toHaveLength(9);
    expect(
      view.element
        .querySelector('[data-testid="settings-tab-workspace"]')
        ?.hasAttribute('data-bn-active'),
    ).toBe(true);
  });

  it('populates the workspace form from /api/workspace', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const value = (field: string): string =>
      (
        view.element.querySelector(
          `[data-testid="settings-workspace-${field}"]`,
        ) as HTMLInputElement
      ).value;
    expect(value('name')).toBe('Reed HVAC');
    // The address is nested on `Workspace`, and the license-number field is
    // `licenseNumber`. Both boxes were empty: the form read flat `street` and
    // a `license_number` key that exists in neither the row nor the model.
    expect(value('street')).toBe('1 Main');
    expect(value('city')).toBe('Town');
    expect(value('zip')).toBe('94000');
    expect(value('licenseNumber')).toBe('CA-123');
    // GP-039: the two answers onboarding stores and this tab edits.
    expect(value('serviceArea')).toBe('Town metro');
    expect(value('serviceRadiusMiles')).toBe('30');
  });

  it('saves the service area and radius through PATCH /api/workspace, and blank clears them (GP-039)', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const set = (field: string, value: string): void => {
      const input = view.element.querySelector(
        `[data-testid="settings-workspace-${field}"]`,
      ) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const submit = async (): Promise<void> => {
      const form = view.element.querySelector(
        '[data-bn-workspace-form]',
      ) as HTMLFormElement;
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await tick();
      await tick();
    };
    const patches = (): unknown[] =>
      fake.calls
        .filter(
          (c) =>
            c.method.toUpperCase() === 'PATCH' &&
            c.url.endsWith('/api/workspace'),
        )
        .map((c) => c.body);

    set('serviceArea', 'Springfield metro');
    set('serviceRadiusMiles', '40');
    await submit();
    expect(patches().at(-1)).toMatchObject({
      serviceArea: 'Springfield metro',
      // A number on the wire, not the string the box holds.
      serviceRadiusMiles: 40,
    });

    set('serviceArea', '   ');
    set('serviceRadiusMiles', '');
    await submit();
    expect(patches().at(-1)).toMatchObject({
      serviceArea: null,
      serviceRadiusMiles: null,
    });
  });

  it('renders API keys with a parsed scope list and the prefix', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/api-keys', () =>
      jsonResponse({
        data: [
          {
            id: 'k1',
            workspaceId: 'w1',
            name: 'CI key',
            keyPrefix: 'abcdefgh',
            scopes: ['read', 'leads'],
            createdAt: '2026-01-01T00:00:00Z',
            createdBy: 'u1',
          },
        ],
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="settings-tab-api-keys"]',
      ) as HTMLElement | null
    )?.click();
    await tick();
    await tick();

    const text = view.element.textContent ?? '';
    expect(text).toContain('CI key');
    expect(text).toContain('abcdefgh…');
    expect(text).toContain('read, leads');
    expect(text).not.toContain('["read"');
  });

  it('switches to the Team tab and renders users', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace/users', () =>
      jsonResponse({
        data: [
          user({ id: 'u1', firstName: 'Alex', lastName: 'Reed' }),
          user({ id: 'u2', firstName: 'Bea', lastName: 'Smith', role: 'tech' }),
        ],
      }),
    );
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="settings-tab-team"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('[data-bn-team-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toMatch(/Alex Reed/);
  });

  it('shows the empty state and no recheck button when no custom domain is configured', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/branding', () => jsonResponse({ data: {} }));
    fake.respond('/api/custom-domain', () =>
      jsonResponse({
        data: {
          hostname: null,
          status: 'none',
          verificationMethod: null,
          verificationValue: null,
          cnameTarget: 'fallback.greenput.com',
          failureReason: null,
          requestedAt: null,
          verifiedAt: null,
          lastCheckedAt: null,
          setupFeePaidAt: null,
        },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="settings-tab-branding"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    expect(
      view.element
        .querySelector('[data-testid="settings-custom-domain-empty"]')
        ?.hasAttribute('hidden'),
    ).toBe(false);
    expect(
      view.element
        .querySelector('[data-testid="settings-custom-domain-recheck"]')
        ?.hasAttribute('hidden'),
    ).toBe(true);
  });

  it('shows the CNAME target and an enabled recheck button while pending', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/branding', () => jsonResponse({ data: {} }));
    fake.respond('/api/custom-domain', () =>
      jsonResponse({
        data: {
          hostname: 'www.reedhvac.com',
          status: 'pending',
          verificationMethod: 'cname',
          verificationValue: 'fallback.greenput.com',
          cnameTarget: 'fallback.greenput.com',
          failureReason: null,
          requestedAt: '2026-09-10T00:00:00Z',
          verifiedAt: null,
          lastCheckedAt: null,
          setupFeePaidAt: null,
        },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="settings-tab-branding"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    expect(
      view.element.querySelector(
        '[data-testid="settings-custom-domain-hostname"]',
      )?.textContent,
    ).toBe('www.reedhvac.com');
    expect(
      view.element.querySelector('[data-testid="settings-custom-domain-cname"]')
        ?.textContent,
    ).toBe('fallback.greenput.com');
    expect(
      view.element
        .querySelector('[data-testid="settings-custom-domain-recheck"]')
        ?.hasAttribute('hidden'),
    ).toBe(false);
  });

  it('calls the recheck endpoint and refreshes the status on click', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/branding', () => jsonResponse({ data: {} }));
    let status: 'pending' | 'active' = 'pending';
    fake.respond(/\/api\/custom-domain$/, () =>
      jsonResponse({
        data: {
          hostname: 'www.reedhvac.com',
          status,
          verificationMethod: 'cname',
          verificationValue: 'fallback.greenput.com',
          cnameTarget: 'fallback.greenput.com',
          failureReason: null,
          requestedAt: '2026-09-10T00:00:00Z',
          verifiedAt: status === 'active' ? '2026-09-10T00:05:00Z' : null,
          lastCheckedAt: null,
          setupFeePaidAt: null,
        },
      }),
    );
    fake.respond('/api/custom-domain/recheck', () => {
      status = 'active';
      return jsonResponse({
        data: {
          hostname: 'www.reedhvac.com',
          status: 'active',
          verificationMethod: 'cname',
          verificationValue: 'fallback.greenput.com',
          cnameTarget: 'fallback.greenput.com',
          failureReason: null,
          requestedAt: '2026-09-10T00:00:00Z',
          verifiedAt: '2026-09-10T00:05:00Z',
          lastCheckedAt: '2026-09-10T00:05:00Z',
          setupFeePaidAt: null,
        },
      });
    });
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="settings-tab-branding"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="settings-custom-domain-recheck"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    await tick();

    expect(
      view.element.querySelector(
        '[data-testid="settings-custom-domain-status"]',
      )?.textContent,
    ).toBe('active');
    expect(
      view.element
        .querySelector('[data-testid="settings-custom-domain-recheck"]')
        ?.hasAttribute('hidden'),
    ).toBe(true);
  });

  it('renders the security tab passkey enrollment button', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="settings-tab-security"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      view.element.querySelector('[data-testid="settings-passkey-enroll"]'),
    ).not.toBeNull();
  });
});

describe('Security → recovery phone', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  async function openSecurity(
    configure: (f: FakeFetcher) => void = () => undefined,
  ) {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    configure(fake);
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    (
      view.element.querySelector(
        '[data-testid="settings-tab-security"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    return { element: view.element, fake };
  }

  function q<T extends HTMLElement>(root: HTMLElement, id: string): T {
    const node = root.querySelector<T>(`[data-testid="${id}"]`);
    if (!node) throw new Error(`missing [data-testid="${id}"]`);
    return node;
  }

  // Removing the recovery number used to answer "keep at least two passkeys,
  // or you can be locked out" whatever the account actually had — advice for a
  // situation the reader is not in, one click after their last way in was gone.
  it('refuses to quietly delete the last way into an account', async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    const { element, fake } = await openSecurity((f) => {
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: true, masked: '••• ••• 0199' } }),
      );
      f.respond(/webauthn\/credentials$/, () =>
        jsonResponse({ data: { count: 0, credentials: [] } }),
      );
    });

    q<HTMLButtonElement>(element, 'settings-recovery-remove').click();
    await tick();
    await tick();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(String(confirmSpy.mock.calls[0]?.[0])).toMatch(/no passkey/i);
    // Declined, so nothing was deleted.
    expect(
      fake.calls.some(
        (c) => c.method === 'DELETE' && c.url.includes('/otp/recovery'),
      ),
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  it('says what was actually lost when the account had no passkey', async () => {
    vi.stubGlobal('confirm', () => true);
    const { element } = await openSecurity((f) => {
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: true, masked: '••• ••• 0199' } }),
      );
      f.respond(/webauthn\/credentials$/, () =>
        jsonResponse({ data: { count: 0, credentials: [] } }),
      );
    });

    q<HTMLButtonElement>(element, 'settings-recovery-remove').click();
    await tick();
    await tick();

    const text = element.textContent ?? '';
    expect(text).toMatch(/no way to sign in after this session/i);
    expect(text).not.toMatch(/keep at least two passkeys/i);
    vi.unstubAllGlobals();
  });

  it('reads the current recovery number on mount', async () => {
    const { fake } = await openSecurity((f) =>
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: true, masked: '••• ••• 0199' } }),
      ),
    );
    expect(
      fake.calls.some((c) => c.url.endsWith('/api/auth/otp/recovery')),
    ).toBe(true);
  });

  it('shows the masked number rather than the whole one', async () => {
    const { element } = await openSecurity((f) =>
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: true, masked: '••• ••• 0199' } }),
      ),
    );
    const summary = q(element, 'settings-recovery-summary').textContent ?? '';
    expect(summary).toContain('0199');
    expect(summary).not.toContain('9495550199');
  });

  it('warns that losing every passkey with no recovery number loses the account', async () => {
    const { element } = await openSecurity((f) =>
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: false, masked: null } }),
      ),
    );
    expect(q(element, 'settings-recovery-summary').textContent).toMatch(
      /losing the account/i,
    );
  });

  it('tells the owner not to use the business line, which is published', async () => {
    const { element } = await openSecurity((f) =>
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: false, masked: null } }),
      ),
    );
    const summary = q(element, 'settings-recovery-summary').textContent ?? '';
    expect(summary).toMatch(/business line/i);
    expect(summary).toMatch(/published/i);
  });

  it('tells a caller with a trunk-prefixed number to add the country code, not an area code (GP-056)', async () => {
    const { element, fake } = await openSecurity((f) => {
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: false, masked: null } }),
      );
      f.respond('/api/auth/otp/recovery/start', () =>
        jsonResponse({ data: { sent: true } }),
      );
    });

    // Already has its area code; what it lacks is a country code.
    q<HTMLInputElement>(element, 'settings-recovery-phone').value =
      '020 7946 0958';
    q<HTMLButtonElement>(element, 'settings-recovery-send').click();
    await tick();

    expect(fake.calls.some((c) => c.url.endsWith('/recovery/start'))).toBe(
      false,
    );
    const message = q(element, 'settings-recovery-message');
    expect(message.hidden).toBe(false);
    expect(message.hasAttribute('data-bn-error')).toBe(true);
    const text = message.textContent ?? '';
    expect(text).not.toContain('area code');
    expect(text).toContain('country code');
    expect(text).toContain('+1 949 555 0199');
    expect(text).toContain('+44 20 7946 0958');
  });

  it('normalises the number before asking for a code', async () => {
    const { element, fake } = await openSecurity((f) => {
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: false, masked: null } }),
      );
      f.respond('/api/auth/otp/recovery/start', () =>
        jsonResponse({ data: { sent: true } }),
      );
    });

    q<HTMLInputElement>(element, 'settings-recovery-phone').value =
      '(949) 555-0199';
    q<HTMLButtonElement>(element, 'settings-recovery-send').click();
    await tick();

    const call = fake.calls.find((c) => c.url.endsWith('/recovery/start'));
    expect(call?.body).toEqual({ phone: '+19495550199' });
  });

  it('never stores a number that was not proved by a code', async () => {
    // Two steps on purpose: a recovery channel nobody has shown they can
    // receive is not a recovery channel, and a typo here is a silent lockout
    // discovered on the day it matters.
    const { element } = await openSecurity((f) => {
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: false, masked: null } }),
      );
      f.respond('/api/auth/otp/recovery/start', () =>
        jsonResponse({ data: { sent: true } }),
      );
    });

    expect(
      q(element, 'settings-recovery-code').closest('[data-bn-field]'),
    ).toHaveProperty('hidden', true);

    q<HTMLInputElement>(element, 'settings-recovery-phone').value =
      '9495550199';
    q<HTMLButtonElement>(element, 'settings-recovery-send').click();
    await tick();

    expect(
      q(element, 'settings-recovery-code').closest('[data-bn-field]'),
    ).toHaveProperty('hidden', false);
    expect(q(element, 'settings-recovery-confirm').hidden).toBe(false);
  });

  it('surfaces the API refusal when the business number is used', async () => {
    const { element } = await openSecurity((f) => {
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: false, masked: null } }),
      );
      f.respond('/api/auth/otp/recovery/start', () =>
        jsonResponse(
          {
            error: {
              code: 'PHONE_IS_PUBLIC',
              message:
                'Use a personal number, not your business line. Your business number is published on your website, so anyone could use it to sign in as you.',
            },
          },
          { status: 400 },
        ),
      );
    });

    q<HTMLInputElement>(element, 'settings-recovery-phone').value =
      '5551234567';
    q<HTMLButtonElement>(element, 'settings-recovery-send').click();
    await tick();

    const message = q(element, 'settings-recovery-message');
    expect(message.hidden).toBe(false);
    expect(message.textContent).toMatch(/business line/i);
    expect(message.hasAttribute('data-bn-error')).toBe(true);
  });

  it('updates the summary after the code is confirmed', async () => {
    const { element } = await openSecurity((f) => {
      f.respond(/\/api\/auth\/otp\/recovery$/, () =>
        jsonResponse({ data: { configured: false, masked: null } }),
      );
      f.respond('/api/auth/otp/recovery/start', () =>
        jsonResponse({ data: { sent: true } }),
      );
      f.respond('/api/auth/otp/recovery/confirm', () =>
        jsonResponse({ data: { configured: true, masked: '••• ••• 0199' } }),
      );
    });

    q<HTMLInputElement>(element, 'settings-recovery-phone').value =
      '9495550199';
    q<HTMLButtonElement>(element, 'settings-recovery-send').click();
    await tick();
    q<HTMLInputElement>(element, 'settings-recovery-code').value = '123456';
    q<HTMLButtonElement>(element, 'settings-recovery-confirm').click();
    await tick();

    expect(q(element, 'settings-recovery-summary').textContent).toContain(
      '0199',
    );
    expect(q(element, 'settings-recovery-remove').hidden).toBe(false);
  });
});

// ── Availability (GP-101) ─────────────────────────────────────────────────

const NOT_BOOKABLE: WorkspaceAvailability = {
  bookingLeadHours: 24,
  bookingHorizonDays: 30,
  travelBufferMinutes: 30,
  concurrentJobs: 1,
  bookable: false,
  week: [],
  exceptions: [],
};

const WEEKDAYS_OPEN: WorkspaceAvailability = {
  timezone: 'America/Chicago',
  bookingLeadHours: 48,
  bookingHorizonDays: 21,
  travelBufferMinutes: 45,
  concurrentJobs: 2,
  bookable: true,
  week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `avail-${weekday}`,
    weekday,
    isOpen: weekday >= 1 && weekday <= 5,
    ...(weekday >= 1 && weekday <= 5
      ? { opensAt: '07:30', closesAt: '16:00' }
      : {}),
  })),
  exceptions: [
    { id: 'exc-1', date: '2026-12-25', isOpen: false, reason: 'Christmas' },
  ],
};

describe('Settings → Billing (GP-048)', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    vi.restoreAllMocks();
  });

  // Midday UTC so `toLocaleDateString('en-US')` lands on the same calendar
  // day in any zone a CI box might run in.
  const SUBSCRIPTION: Subscription = {
    id: 'sub-1',
    plan: 'pro',
    status: 'active',
    currentPeriodStart: '2026-09-01T12:00:00.000Z',
    currentPeriodEnd: '2026-10-01T12:00:00.000Z',
    cancelAtPeriodEnd: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
  };

  function apiError(status: number, code: string, message: string): Response {
    return jsonResponse({ error: { code, message } }, { status });
  }

  const EMPTY_METER = {
    summary: {
      pendingCount: 0,
      pendingUsd: 0,
      invoicedCount: 0,
      invoicedUsd: 0,
    },
    perLeadRates: {},
    leadFeeOverrideUsd: null as number | null,
    charges: [] as Array<{
      id: string;
      leadId: string;
      serviceType: string;
      priceUsd: number;
      status: string;
      paymentStatus: string | null;
      createdAt: string;
    }>,
  };

  const EMPTY_USAGE = {
    balanceMicroUsd: 0,
    topupCents: 1000,
    thresholdCents: 200,
    entries: [] as Array<{
      id: string;
      kind: string;
      amountMicroUsd: number;
      balanceAfterMicroUsd: number;
      twilioMessageSid: string | null;
      segments: number | null;
      paymentStatus: string | null;
      description: string;
      createdAt: string;
    }>,
  };

  async function openBilling(
    fake: FakeFetcher,
    extras?: {
      meter?: () => Response;
      connect?: () => Response;
      usage?: () => Response;
    },
  ): Promise<{ element: HTMLElement; deps: ReturnType<typeof buildTestDeps> }> {
    const meter = extras?.meter ?? (() => jsonResponse({ data: EMPTY_METER }));
    fake.respond('/api/billing/meter', meter);
    fake.respond(
      '/api/billing/usage',
      extras?.usage ?? (() => jsonResponse({ data: EMPTY_USAGE })),
    );
    fake.respond(
      /\/api\/payments\/connect$/,
      extras?.connect ??
        (() =>
          jsonResponse({
            data: {
              status: 'not_started',
              chargesEnabled: false,
              payoutsEnabled: false,
            },
          })),
    );
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    (
      view.element.querySelector(
        '[data-testid="settings-tab-billing"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    return { element: view.element, deps };
  }

  const q = (root: HTMLElement, id: string): HTMLElement =>
    root.querySelector(`[data-testid="${id}"]`) as HTMLElement;

  it('renders Renews from currentPeriodEnd — the field the API emits, not "—"', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: SUBSCRIPTION }),
    );
    const { element } = await openBilling(fake);

    expect(q(element, 'settings-billing-summary').hasAttribute('hidden')).toBe(
      false,
    );
    expect(q(element, 'settings-billing-plan').textContent).toBe('pro');
    expect(q(element, 'settings-billing-status').textContent).toBe('active');
    const renews = q(element, 'settings-billing-renews').textContent ?? '';
    expect(renews).not.toBe('—');
    expect(renews).toBe(
      new Date('2026-10-01T12:00:00.000Z').toLocaleDateString('en-US'),
    );
    expect(renews).toMatch(/2026/);
    expect(q(element, 'settings-billing-none').hasAttribute('hidden')).toBe(
      true,
    );
    expect(q(element, 'settings-billing-portal').hasAttribute('hidden')).toBe(
      false,
    );
  });

  it('says the period ends, not renews, when cancelAtPeriodEnd is set', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: { ...SUBSCRIPTION, cancelAtPeriodEnd: true } }),
    );
    const { element } = await openBilling(fake);
    expect(q(element, 'settings-billing-renews').textContent).toBe(
      `Ends ${new Date('2026-10-01T12:00:00.000Z').toLocaleDateString('en-US')}`,
    );
  });

  it('says billing is not set up when there is no subscription, and offers no dead button', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    const { element } = await openBilling(fake);

    const none = q(element, 'settings-billing-none');
    expect(none.hasAttribute('hidden')).toBe(false);
    expect(none.textContent).toContain(
      'Billing is not set up for this workspace yet',
    );
    expect(q(element, 'settings-billing-summary').hasAttribute('hidden')).toBe(
      true,
    );
    expect(q(element, 'settings-billing-portal').hasAttribute('hidden')).toBe(
      true,
    );
  });

  it('shows the API message for 503 BILLING_UNAVAILABLE and re-enables the button', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: SUBSCRIPTION }),
    );
    fake.respond('/api/billing/portal', () =>
      apiError(503, 'BILLING_UNAVAILABLE', 'Billing is not configured'),
    );
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { element } = await openBilling(fake);

    const btn = q(element, 'settings-billing-portal') as HTMLButtonElement;
    const note = q(element, 'settings-billing-portal-error');
    expect(note.hasAttribute('hidden')).toBe(true);

    btn.click();
    // Busy while the request is in flight.
    expect(btn.disabled).toBe(true);
    expect(btn.hasAttribute('data-bn-busy')).toBe(true);
    expect(btn.textContent).toBe('Opening portal…');
    await tick();
    await tick();
    await tick();

    expect(note.hasAttribute('hidden')).toBe(false);
    expect(note.textContent).toBe('Billing is not configured');
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute('data-bn-busy')).toBe(false);
    expect(btn.textContent).toBe('Open Stripe portal');
    expect(open).not.toHaveBeenCalled();
    expect(
      fake.calls.filter((c) => c.url.includes('/api/billing/portal')),
    ).toHaveLength(1);
  });

  it('shows the API message for 400 NO_CUSTOMER and re-enables the button', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: SUBSCRIPTION }),
    );
    fake.respond('/api/billing/portal', () =>
      apiError(
        400,
        'NO_CUSTOMER',
        'No billing account found. Subscribe to a plan first.',
      ),
    );
    vi.spyOn(window, 'open').mockImplementation(() => null);
    const { element } = await openBilling(fake);

    const btn = q(element, 'settings-billing-portal') as HTMLButtonElement;
    btn.click();
    expect(btn.disabled).toBe(true);
    await tick();
    await tick();
    await tick();

    const note = q(element, 'settings-billing-portal-error');
    expect(note.hasAttribute('hidden')).toBe(false);
    expect(note.textContent).toBe(
      'No billing account found. Subscribe to a plan first.',
    );
    expect(btn.disabled).toBe(false);
  });

  it('opens the portal URL in a new tab and clears an earlier error', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: SUBSCRIPTION }),
    );
    let fail = true;
    fake.respond('/api/billing/portal', () =>
      fail
        ? apiError(503, 'BILLING_UNAVAILABLE', 'Billing is not configured')
        : jsonResponse({ data: { url: 'https://billing.stripe.com/p/x' } }),
    );
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { element } = await openBilling(fake);
    const btn = q(element, 'settings-billing-portal') as HTMLButtonElement;
    const note = q(element, 'settings-billing-portal-error');

    btn.click();
    await tick();
    await tick();
    await tick();
    expect(note.hasAttribute('hidden')).toBe(false);

    fail = false;
    btn.click();
    await tick();
    await tick();
    await tick();
    expect(note.hasAttribute('hidden')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      'https://billing.stripe.com/p/x',
      '_blank',
      'noopener',
    );
  });

  it('says so when the portal answers without a URL instead of doing nothing', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: SUBSCRIPTION }),
    );
    fake.respond('/api/billing/portal', () => jsonResponse({ data: {} }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { element } = await openBilling(fake);
    const btn = q(element, 'settings-billing-portal') as HTMLButtonElement;
    btn.click();
    await tick();
    await tick();
    await tick();
    const note = q(element, 'settings-billing-portal-error');
    expect(note.hasAttribute('hidden')).toBe(false);
    expect(note.textContent).toContain('did not return a portal link');
    expect(open).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
  });

  it('shows the grandfathered lead-fee rate and a charge row', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    const { element } = await openBilling(fake, {
      meter: () =>
        jsonResponse({
          data: {
            ...EMPTY_METER,
            summary: {
              pendingCount: 1,
              pendingUsd: 1,
              invoicedCount: 0,
              invoicedUsd: 0,
            },
            leadFeeOverrideUsd: 1,
            charges: [
              {
                id: 'm1',
                leadId: 'lead-1',
                serviceType: 'electrical',
                priceUsd: 1,
                status: 'pending',
                paymentStatus: null,
                createdAt: '2026-10-20T00:00:00.000Z',
              },
            ],
          },
        }),
    });

    expect(q(element, 'settings-lead-fees-rate').textContent).toContain(
      '$1 per booked lead',
    );
    // WS-1: the fee is metered at booking, never at accept.
    expect(q(element, 'settings-lead-fees-rate').textContent).not.toContain(
      'accepted lead',
    );
    expect(q(element, 'settings-lead-fees-rate').textContent).toContain(
      'grandfathered',
    );
    expect(q(element, 'settings-lead-fees-pending').textContent).toContain(
      '1 pending ($1)',
    );
    expect(element.textContent).toContain('electrical');
    const link = element.querySelector(
      'a[href="/leads/lead-1"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(element.textContent).toContain('Pending');
    expect(
      q(element, 'settings-lead-fees-collect').hasAttribute('hidden'),
    ).toBe(false);
  });

  it('says when a card is required and when delivery is paused', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    const { element } = await openBilling(fake, {
      meter: () =>
        jsonResponse({
          data: {
            ...EMPTY_METER,
            receive: {
              billingConfigured: true,
              cardOnFile: false,
              deliveryPaused: true,
              message:
                'Lead delivery is paused until the card is updated and the outstanding fee is collected. A card on file is required before this workspace can accept or auto-book a lead.',
            },
          },
        }),
    });
    expect(q(element, 'settings-lead-fees-receive').textContent).toContain(
      'Lead delivery is paused',
    );
    expect(q(element, 'settings-lead-fees-receive').textContent).toContain(
      'card on file is required',
    );
  });

  it('hides Charge saved card when nothing is pending', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    const { element } = await openBilling(fake);
    expect(
      q(element, 'settings-lead-fees-collect').hasAttribute('hidden'),
    ).toBe(true);
  });

  it('charges pending lead fees from the saved card', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    fake.respond('/api/billing/lead-fees/collect', () =>
      jsonResponse({ data: { attempted: 1, paid: 1, stillPending: 0 } }),
    );
    const { element } = await openBilling(fake, {
      meter: () =>
        jsonResponse({
          data: {
            ...EMPTY_METER,
            summary: {
              pendingCount: 1,
              pendingUsd: 1,
              invoicedCount: 0,
              invoicedUsd: 0,
            },
          },
        }),
    });
    const btn = q(element, 'settings-lead-fees-collect') as HTMLButtonElement;
    expect(btn.hasAttribute('hidden')).toBe(false);
    btn.click();
    await tick();
    await tick();
    await tick();
    const call = fake.calls.find((c) =>
      c.url.includes('/api/billing/lead-fees/collect'),
    );
    expect(call?.method).toBe('POST');
  });

  it('opens Stripe Connect onboarding from the billing tab', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    fake.respond('/api/payments/connect/onboard', () =>
      jsonResponse({ data: { url: 'https://connect.stripe.com/setup/s' } }),
    );
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { element } = await openBilling(fake);
    const btn = q(element, 'settings-connect-onboard') as HTMLButtonElement;
    expect(btn.textContent).toBe('Set up Stripe to get paid');
    btn.click();
    await tick();
    await tick();
    await tick();
    expect(open).toHaveBeenCalledWith(
      'https://connect.stripe.com/setup/s',
      '_blank',
      'noopener',
    );
    const call = fake.calls.find((c) =>
      c.url.includes('/api/payments/connect/onboard'),
    );
    expect(call?.method).toBe('POST');
    expect(call?.body).toMatchObject({
      returnUrl: `${window.location.origin}/settings?tab=billing`,
      refreshUrl: `${window.location.origin}/settings?tab=billing`,
    });
  });

  it('opens the Express dashboard once Connect is complete', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    fake.respond('/api/payments/connect/login', () =>
      jsonResponse({ data: { url: 'https://connect.stripe.com/express/e' } }),
    );
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { element } = await openBilling(fake, {
      connect: () =>
        jsonResponse({
          data: {
            status: 'complete',
            chargesEnabled: true,
            payoutsEnabled: true,
          },
        }),
    });
    const btn = q(element, 'settings-connect-onboard') as HTMLButtonElement;
    expect(q(element, 'settings-connect-status').textContent).toContain(
      'Card payments are connected',
    );
    expect(btn.textContent).toBe('Open Stripe Express');
    btn.click();
    await tick();
    await tick();
    await tick();
    expect(open).toHaveBeenCalledWith(
      'https://connect.stripe.com/express/e',
      '_blank',
      'noopener',
    );
    expect(
      fake.calls.some((c) => c.url.includes('/api/payments/connect/onboard')),
    ).toBe(false);
    expect(
      fake.calls.some(
        (c) =>
          c.url.includes('/api/payments/connect/login') && c.method === 'POST',
      ),
    ).toBe(true);
  });

  it('opens the customer portal to add a card for lead fees', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    fake.respond('/api/billing/payment-method', () =>
      jsonResponse({ data: { url: 'https://billing.stripe.com/p/card' } }),
    );
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { element } = await openBilling(fake);
    const btn = q(element, 'settings-lead-fees-card') as HTMLButtonElement;
    btn.click();
    await tick();
    await tick();
    await tick();
    expect(open).toHaveBeenCalledWith(
      'https://billing.stripe.com/p/card',
      '_blank',
      'noopener',
    );
    const call = fake.calls.find((c) =>
      c.url.includes('/api/billing/payment-method'),
    );
    expect(call?.method).toBe('POST');
    expect(call?.body).toMatchObject({
      returnUrl: `${window.location.origin}/settings?tab=billing`,
    });
  });

  it('shows the SMS balance, the top-up defaults, and usage history', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/billing/subscription', () =>
      jsonResponse({ data: null }),
    );
    const { element } = await openBilling(fake, {
      usage: () => {
        const last = fake.calls[fake.calls.length - 1];
        if (last?.method === 'PATCH') {
          return jsonResponse({
            data: {
              ...EMPTY_USAGE,
              topupCents: 2000,
              thresholdCents: 500,
            },
          });
        }
        return jsonResponse({
          data: {
            ...EMPTY_USAGE,
            balanceMicroUsd: 10_000_000 - 8300,
            entries: [
              {
                id: 'led-1',
                kind: 'sms_estimate',
                amountMicroUsd: -8300,
                balanceAfterMicroUsd: 10_000_000 - 8300,
                twilioMessageSid: 'SM1',
                segments: 1,
                paymentStatus: null,
                description: 'SMS',
                createdAt: '2026-10-22T00:00:00.000Z',
              },
            ],
          },
        });
      },
    });

    expect(q(element, 'settings-usage-balance').textContent).toContain(
      '$9.9917',
    );
    expect(q(element, 'settings-usage-balance').textContent).toContain(
      '$0.0083',
    );
    expect((q(element, 'settings-usage-topup') as HTMLInputElement).value).toBe(
      '10.00',
    );
    expect(
      (q(element, 'settings-usage-threshold') as HTMLInputElement).value,
    ).toBe('2.00');
    expect(q(element, 'settings-usage').textContent).toContain('SMS');
    expect(q(element, 'settings-usage').textContent).toContain('-$0.0083');
    expect((q(element, 'settings-usage-save') as HTMLButtonElement).type).toBe(
      'button',
    );

    (q(element, 'settings-usage-topup') as HTMLInputElement).value = '20';
    (q(element, 'settings-usage-threshold') as HTMLInputElement).value = '5';
    (q(element, 'settings-usage-save') as HTMLButtonElement).click();
    await tick();
    await tick();
    await tick();
    const patch = fake.calls.find(
      (c) => c.url.includes('/api/billing/usage') && c.method === 'PATCH',
    );
    expect(patch?.body).toEqual({ topupCents: 2000, thresholdCents: 500 });
  });
});

describe('readSettingsTab', () => {
  it('opens the tab the URL names', () => {
    expect(readSettingsTab('?tab=availability')).toBe('availability');
    expect(readSettingsTab('?tab=security')).toBe('security');
  });
  it('falls back to the first tab for anything else', () => {
    expect(readSettingsTab('')).toBe('workspace');
    expect(readSettingsTab('?tab=nope')).toBe('workspace');
    expect(readSettingsTab('?other=1')).toBe('workspace');
  });
});

describe('Settings → Availability', () => {
  let dispose: (() => void) | null = null;
  const originalUrl = window.location.href;
  afterEach(() => {
    dispose?.();
    dispose = null;
    window.history.replaceState({}, '', originalUrl);
  });

  function input(root: Element, testid: string): HTMLInputElement {
    const node = root.querySelector<HTMLInputElement>(
      `[data-testid="${testid}"]`,
    );
    if (!node) throw new Error(`no [data-testid="${testid}"]`);
    return node;
  }

  async function mount(fake: FakeFetcher): Promise<HTMLElement> {
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    (
      view.element.querySelector(
        '[data-testid="settings-tab-availability"]',
      ) as HTMLElement | null
    )?.click();
    await tick();
    await tick();
    return view.element;
  }

  it('renders the seven rows from the API, Monday first', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/availability', () =>
      jsonResponse({ data: WEEKDAYS_OPEN }),
    );
    const root = await mount(fake);

    const toggles = root.querySelectorAll<HTMLInputElement>(
      '[data-testid^="settings-availability-open-"]',
    );
    expect(toggles).toHaveLength(7);
    expect(
      Array.from(toggles).map((t) => t.getAttribute('data-testid')),
    ).toEqual(
      [1, 2, 3, 4, 5, 6, 0].map((d) => `settings-availability-open-${d}`),
    );
    expect(Array.from(toggles).map((t) => t.checked)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(input(root, 'settings-availability-opens-1').value).toBe('07:30');
    expect(input(root, 'settings-availability-closes-1').value).toBe('16:00');
    // A closed day's time boxes are there but not editable.
    expect(input(root, 'settings-availability-opens-0').disabled).toBe(true);
    expect(input(root, 'settings-availability-opens-1').disabled).toBe(false);

    expect(input(root, 'settings-availability-timezone').value).toBe(
      'America/Chicago',
    );
    expect(input(root, 'settings-availability-bookingLeadHours').value).toBe(
      '48',
    );
    expect(input(root, 'settings-availability-bookingHorizonDays').value).toBe(
      '21',
    );
    expect(input(root, 'settings-availability-travelBufferMinutes').value).toBe(
      '45',
    );
    expect(input(root, 'settings-availability-concurrentJobs').value).toBe('2');

    const exceptions = root.querySelectorAll(
      '[data-bn-availability-exception]',
    );
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.textContent).toContain('2026-12-25');
    expect(exceptions[0]?.textContent).toContain('Closed');
    expect(exceptions[0]?.textContent).toContain('Christmas');

    expect(
      root.querySelector('[data-testid="settings-availability-notice"]')
        ?.textContent,
    ).toContain('Bookable');
  });

  it('says, in words, that a workspace with no rows is not bookable', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/availability', () =>
      jsonResponse({ data: NOT_BOOKABLE }),
    );
    const root = await mount(fake);

    const toggles = root.querySelectorAll<HTMLInputElement>(
      '[data-testid^="settings-availability-open-"]',
    );
    expect(toggles).toHaveLength(7);
    expect(Array.from(toggles).every((t) => !t.checked)).toBe(true);
    expect(
      root.querySelector('[data-testid="settings-availability-notice"]')
        ?.textContent,
    ).toContain('Not bookable');
    expect(
      root.querySelector('[data-testid="settings-availability-no-exceptions"]'),
    ).not.toBeNull();
  });

  it('saving PUTs the whole week, the exceptions and the numbers in one body', async () => {
    const fake = createFakeFetch();
    let current: WorkspaceAvailability = NOT_BOOKABLE;
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/availability', () => jsonResponse({ data: current }));
    const root = await mount(fake);

    const timezone = input(root, 'settings-availability-timezone');
    timezone.value = 'America/Chicago';
    timezone.dispatchEvent(new Event('input', { bubbles: true }));

    const monday = input(root, 'settings-availability-open-1');
    monday.checked = true;
    monday.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    const opens = input(root, 'settings-availability-opens-1');
    expect(opens.disabled).toBe(false);
    opens.value = '09:00';
    opens.dispatchEvent(new Event('input', { bubbles: true }));

    const lead = input(root, 'settings-availability-bookingLeadHours');
    lead.value = '12';
    lead.dispatchEvent(new Event('input', { bubbles: true }));

    input(root, 'settings-availability-exception-date').value = '2026-12-25';
    input(root, 'settings-availability-exception-reason').value = 'Christmas';
    input(root, 'settings-availability-exception-add').click();
    await tick();
    expect(
      root.querySelectorAll('[data-bn-availability-exception]'),
    ).toHaveLength(1);

    // What the Worker will answer once the write lands.
    current = { ...WEEKDAYS_OPEN, exceptions: [] };
    const form = root.querySelector('[data-bn-availability-form]');
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    await tick();

    const put = fake.calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/availability');
    const body = put?.body as {
      timezone: string | null;
      bookingLeadHours: number;
      bookingHorizonDays: number;
      travelBufferMinutes: number;
      concurrentJobs: number;
      week: Array<{
        weekday: number;
        isOpen: boolean;
        opensAt: string;
        closesAt: string;
      }>;
      exceptions: Array<{ date: string; isOpen: boolean; reason?: string }>;
    };
    expect(body.timezone).toBe('America/Chicago');
    expect(body.bookingLeadHours).toBe(12);
    expect(body.bookingHorizonDays).toBe(30);
    expect(body.travelBufferMinutes).toBe(30);
    expect(body.concurrentJobs).toBe(1);
    expect(body.week).toHaveLength(7);
    expect(new Set(body.week.map((d) => d.weekday)).size).toBe(7);
    expect(body.week.find((d) => d.weekday === 1)).toEqual({
      weekday: 1,
      isOpen: true,
      opensAt: '09:00',
      closesAt: '17:00',
    });
    expect(body.week.find((d) => d.weekday === 0)?.isOpen).toBe(false);
    expect(body.exceptions).toEqual([
      { date: '2026-12-25', isOpen: false, reason: 'Christmas' },
    ]);

    // The response is what the form shows afterwards, not what it sent.
    expect(
      root.querySelector('[data-testid="settings-availability-notice"]')
        ?.textContent,
    ).toContain('Bookable');
    expect(input(root, 'settings-availability-bookingLeadHours').value).toBe(
      '48',
    );
  });

  it('refuses to add a second exception on the same date', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/availability', () =>
      jsonResponse({ data: WEEKDAYS_OPEN }),
    );
    const root = await mount(fake);
    input(root, 'settings-availability-exception-date').value = '2026-12-25';
    input(root, 'settings-availability-exception-add').click();
    await tick();
    expect(
      root.querySelectorAll('[data-bn-availability-exception]'),
    ).toHaveLength(1);
    input(root, 'settings-availability-exception-remove-2026-12-25').click();
    await tick();
    expect(
      root.querySelectorAll('[data-bn-availability-exception]'),
    ).toHaveLength(0);
  });

  it('opens straight on the tab when the URL asks for it', async () => {
    window.history.replaceState({}, '', '/settings?tab=availability');
    const fake = createFakeFetch();
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    fake.respond('/api/availability', () =>
      jsonResponse({ data: NOT_BOOKABLE }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    expect(
      view.element
        .querySelector('[data-testid="settings-tab-availability"]')
        ?.hasAttribute('data-bn-active'),
    ).toBe(true);
    expect(
      view.element.querySelector('[data-testid="settings-availability-save"]'),
    ).not.toBeNull();
    expect(fake.calls.some((c) => c.url === '/api/availability')).toBe(true);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise beats the clock', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'late')).resolves.toBe(
      'ok',
    );
  });

  it('rejects with the given message when nothing happens', async () => {
    // The "Adding…" forever case: a browser with no usable authenticator can
    // leave credentials.create() pending with no visible prompt.
    await expect(
      withTimeout(new Promise(() => undefined), 5, 'no prompt appeared'),
    ).rejects.toThrow('no prompt appeared');
  });

  it('lets the promise own rejection through unchanged', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('real failure')), 50, 'late'),
    ).rejects.toThrow('real failure');
  });
});

// GP-008. Inviting used to create a row nothing could ever sign in to. The
// API now answers with the accept-invite link, and the Team tab shows it for
// the owner to pass on — nothing sends it, and the copy never says it did.
describe('renderSettingsRoute team invite link (GP-008)', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  function q<T extends HTMLElement>(root: HTMLElement, id: string): T {
    const node = root.querySelector<T>(`[data-testid="${id}"]`);
    if (!node) throw new Error(`missing ${id}`);
    return node;
  }

  it('shows the invite link to copy after creating an invitation', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace/users', () =>
      jsonResponse({ data: [user({ id: 'u1' })] }),
    );
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    // A POST to /api/workspace/users is the invite and answers with the
    // link; every GET is the list, which the fake above answers.
    const invitePost = () =>
      jsonResponse({
        data: user({
          id: 'u2',
          firstName: 'Bea',
          lastName: 'Smith',
          role: 'tech',
        }),
        share: {
          url: 'https://app.greenput.com/accept-invite/tok-9',
          message:
            'Hi Bea, you have been invited to join Reed HVAC on Greenput. Open this link to create your passkey and sign in: https://app.greenput.com/accept-invite/tok-9 — it works once and expires on September 20.',
          expiresAt: '2026-09-20T00:00:00.000Z',
        },
      });
    const posts: string[] = [];
    const deps = buildTestDeps({
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (init?.method === 'POST' && url.endsWith('/api/workspace/users')) {
          posts.push(String(init.body));
          return Promise.resolve(invitePost());
        }
        return fake.fetch(input, init);
      }) as typeof fetch,
    });
    const view = renderSettingsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    q(view.element, 'settings-tab-team').click();
    await tick();
    await tick();

    q(view.element, 'settings-invite-toggle').click();
    await tick();
    expect(q(view.element, 'settings-invite-submit').textContent).toBe(
      'Create invite link',
    );
    for (const [id, value] of [
      ['settings-invite-firstName', 'Bea'],
      ['settings-invite-lastName', 'Smith'],
      ['settings-invite-email', 'bea@example.com'],
    ] as const) {
      const input = q<HTMLInputElement>(view.element, id);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const form = view.element.querySelector('form[data-bn-invite-form]');
    if (!form) throw new Error('missing invite form');
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await tick();
    await tick();
    await tick();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('bea@example.com');
    const card = q(view.element, 'settings-invite-share');
    expect(card.hasAttribute('hidden')).toBe(false);
    expect(q(view.element, 'settings-invite-share-heading').textContent).toBe(
      'Invite link ready to share',
    );
    expect(
      q<HTMLInputElement>(view.element, 'settings-invite-share-url').value,
    ).toBe('https://app.greenput.com/accept-invite/tok-9');
    expect(
      q(view.element, 'settings-invite-share-expires').textContent,
    ).toMatch(/works once and expires/);
    expect(card.textContent).not.toMatch(/invite sent/i);
  });
});
