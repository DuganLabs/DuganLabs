import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthErrorKind } from '@basenative/auth-webauthn';
import { DEFAULT_BRAND_PRIMARY_COLOR } from '@greenput/shared/models';
import {
  PASSKEY_BUTTON_LABELS,
  PASSKEY_STEP_MESSAGES,
  renderOnboardingRoute,
} from './onboarding.js';
import {
  buildTestDeps,
  createFakeFetch,
  createFakeWebAuthn,
  setWebAuthnAvailable,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';

describe('renderOnboardingRoute', () => {
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    localStorage.clear();
  });

  // Regression for a bug where every keystroke replaced the whole step body
  // (an effect re-rendered on the full `data` signal instead of just
  // `step`), destroying and recreating the focused `<input>` on each
  // character — blurring the field and, on mobile, closing the keyboard.
  it('keeps focus, node identity, and caret position while typing into a field', async () => {
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();

    const input = view.element.querySelector(
      '[data-testid="onboarding-firstName"]',
    ) as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    const typeChar = (el: HTMLInputElement, ch: string): void => {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0, start) + ch + el.value.slice(end);
      const caret = start + ch.length;
      el.setSelectionRange(caret, caret);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const word = 'Alexander';
    for (const ch of word) {
      typeChar(input, ch);
      await tick();

      // A full re-render (the historical bug) replaces the <input> with a
      // fresh node and drops focus to <body> — assert both never happen.
      expect(document.activeElement).toBe(input);
      expect(
        view.element.querySelector('[data-testid="onboarding-firstName"]'),
      ).toBe(input);
      expect(input.selectionStart).toBe(input.value.length);
    }

    expect(input.value).toBe(word);
  });

  it('starts on step 1 with the next button disabled', async () => {
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();

    expect(view.element.querySelector('h1')?.textContent).toMatch(
      /^Step 1 of /,
    );
    const next = view.element.querySelector(
      '[data-testid="onboarding-next"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('enables next when step 1 fields are filled and email is valid', async () => {
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();

    const set = (testid: string, value: string): void => {
      const input = view.element.querySelector(
        `[data-testid="${testid}"]`,
      ) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('onboarding-firstName', 'Alex');
    set('onboarding-lastName', 'Reed');
    set('onboarding-ownerEmail', 'alex@reed.com');
    set('onboarding-companyName', 'Reed HVAC');
    await tick();

    const next = view.element.querySelector(
      '[data-testid="onboarding-next"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    next.click();
    await tick();

    expect(view.element.querySelector('h1')?.textContent).toMatch(
      /^Step 2 of /,
    );
  });

  it('persists progress to localStorage between mounts', async () => {
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const v1 = renderOnboardingRoute(deps);
    document.body.append(v1.element);
    await tick();
    const fnInput = v1.element.querySelector(
      '[data-testid="onboarding-firstName"]',
    ) as HTMLInputElement;
    fnInput.value = 'Alex';
    fnInput.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    v1.dispose();
    v1.element.remove();

    const v2 = renderOnboardingRoute(deps);
    dispose = v2.dispose;
    document.body.append(v2.element);
    await tick();

    const fnInput2 = v2.element.querySelector(
      '[data-testid="onboarding-firstName"]',
    ) as HTMLInputElement;
    expect(fnInput2.value).toBe('Alex');
  });

  it('toggles services on step 2 and lights up the chip', async () => {
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();

    // Skip to step 2 by setting valid step-1 fields and clicking next.
    const set = (testid: string, value: string): void => {
      const input = view.element.querySelector(
        `[data-testid="${testid}"]`,
      ) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('onboarding-firstName', 'A');
    set('onboarding-lastName', 'R');
    set('onboarding-ownerEmail', 'a@b.com');
    set('onboarding-companyName', 'C');
    await tick();
    (
      view.element.querySelector(
        '[data-testid="onboarding-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    const before = view.element.querySelector(
      '[data-testid="onboarding-service-HVAC"]',
    ) as HTMLButtonElement;
    expect(before.hasAttribute('data-bn-selected')).toBe(false);
    before.click();
    await tick();
    // Step body re-renders on toggle, so we have to re-query.
    const after = view.element.querySelector(
      '[data-testid="onboarding-service-HVAC"]',
    ) as HTMLButtonElement;
    expect(after.hasAttribute('data-bn-selected')).toBe(true);
  });

  it('sends the address fields collected on step 1 to /api/auth/register on completion', async () => {
    const fake = createFakeFetch();
    fake.respond(
      '/api/auth/register',
      () =>
        new Response(
          JSON.stringify({
            data: {
              user: { id: 'u1', email: 'a@b.com', role: 'owner' },
              workspace: { id: 'ws-1', name: 'Reed HVAC' },
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();

    const set = (testid: string, value: string): void => {
      const input = view.element.querySelector(
        `[data-testid="${testid}"]`,
      ) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const clickNext = async (): Promise<void> => {
      (
        view.element.querySelector(
          '[data-testid="onboarding-next"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
    };

    // Step 1 — account + company + address.
    set('onboarding-firstName', 'Alex');
    set('onboarding-lastName', 'Reed');
    set('onboarding-ownerEmail', 'alex@reed.com');
    set('onboarding-companyName', 'Reed HVAC');
    set('onboarding-address', '742 Evergreen Terrace');
    set('onboarding-city', 'Springfield');
    set('onboarding-state', 'OR');
    set('onboarding-zip', '97477');
    await tick();
    await clickNext();

    // Step 2 — pick a service.
    (
      view.element.querySelector(
        '[data-testid="onboarding-service-HVAC"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await clickNext();

    // Step 3 — service area.
    set('onboarding-serviceArea', 'Springfield metro');
    await tick();
    await clickNext();

    // Step 4 (branding) is optional — skip through.
    await clickNext();

    // Step 5 — review. "Continue" is now "Create workspace" and calls complete().
    await clickNext();

    const registerCall = fake.calls.find((c) =>
      c.url.includes('/api/auth/register'),
    );
    expect(registerCall).toBeDefined();
    expect(registerCall?.body).toMatchObject({
      street: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'OR',
      zip: '97477',
    });
  });
});

// ── GP-039: every answer the wizard asks for reaches the register body ───
//
// Nine steps used to collect sixteen answers and send ten. The service area
// and radius, the team size, the brand colour and an integrations list were
// reviewed and discarded; the multi-select service grid collapsed to its
// first entry. Team size and integrations are gone; everything else is sent.
describe('onboarding — what is asked is what is sent (GP-039)', () => {
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    localStorage.clear();
  });

  async function mountWizard(): Promise<{
    root: HTMLElement;
    fake: FakeFetcher;
  }> {
    const fake = createFakeFetch();
    stubHappyApi(fake);
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    return { root: view.element, fake };
  }

  function registerBody(fake: FakeFetcher): Record<string, unknown> {
    const call = fake.calls.find((c) => c.url.includes('/api/auth/register'));
    if (!call) throw new Error('no register call was made');
    return call.body as Record<string, unknown>;
  }

  /** Steps 1–3 with two services, an area and a radius; lands on branding. */
  async function walkToBranding(root: HTMLElement): Promise<void> {
    setField(root, 'onboarding-firstName', 'Alex');
    setField(root, 'onboarding-lastName', 'Reed');
    setField(root, 'onboarding-ownerEmail', 'alex@reed.com');
    setField(root, 'onboarding-companyName', 'Reed HVAC');
    await tick();
    await clickPrimary(root);

    // Two services, in this order. The grid says "pick all that apply".
    q<HTMLButtonElement>(root, 'onboarding-service-HVAC').click();
    await tick();
    q<HTMLButtonElement>(root, 'onboarding-service-Plumbing').click();
    await tick();
    await clickPrimary(root);

    setField(root, 'onboarding-serviceArea', 'Springfield metro');
    setField(root, 'onboarding-serviceRadius', '40');
    await tick();
    await clickPrimary(root);
  }

  it('sends every service picked, not just the first', async () => {
    const { root, fake } = await mountWizard();
    await walkToBranding(root);
    await clickPrimary(root); // branding — leave the defaults
    await clickPrimary(root); // review → register

    const body = registerBody(fake);
    // Before GP-039 this was `trade: 'HVAC'` and nothing else.
    expect(body['serviceTypes']).toEqual(['HVAC', 'Plumbing']);
    // `trade` stays the first entry, for the readers that still want one.
    expect(body['trade']).toBe('HVAC');
  });

  it('sends the service area, the radius, the brand colour and the logo URL', async () => {
    const { root, fake } = await mountWizard();
    await walkToBranding(root);

    setField(root, 'onboarding-brandColor', '#3d8b5e');
    setField(root, 'onboarding-logoUrl', 'https://reed.example/logo.png');
    await tick();
    await clickPrimary(root); // branding
    await clickPrimary(root); // review → register

    expect(registerBody(fake)).toMatchObject({
      serviceArea: 'Springfield metro',
      serviceRadiusMiles: 40,
      brandColor: '#3d8b5e',
      logoUrl: 'https://reed.example/logo.png',
    });
  });

  it('shows the same default green the branding table stores, so nothing drifts', async () => {
    const { root, fake } = await mountWizard();
    await walkToBranding(root);
    expect(q<HTMLInputElement>(root, 'onboarding-brandColor').value).toBe(
      DEFAULT_BRAND_PRIMARY_COLOR,
    );
    await clickPrimary(root);
    await clickPrimary(root);
    expect(registerBody(fake)['brandColor']).toBe(DEFAULT_BRAND_PRIMARY_COLOR);
  });

  it('omits the logo URL when the field is left blank, rather than sending an empty string', async () => {
    const { root, fake } = await mountWizard();
    await walkToBranding(root);
    await clickPrimary(root);
    await clickPrimary(root);
    expect('logoUrl' in registerBody(fake)).toBe(false);
  });

  it('reaches the review in five steps without a team-size or integrations screen', async () => {
    const { root } = await mountWizard();
    expect(root.querySelector('h1')?.textContent).toBe('Step 1 of 7');

    const neverRendered = [
      '[data-testid^="onboarding-teamSize-"]',
      '[data-testid^="onboarding-integration-"]',
    ];
    await walkToBranding(root);
    for (const selector of neverRendered) {
      expect(root.querySelector(selector)).toBeNull();
    }
    await clickPrimary(root);
    for (const selector of neverRendered) {
      expect(root.querySelector(selector)).toBeNull();
    }

    expect(root.querySelector('h1')?.textContent).toBe('Step 5 of 7');
    expect(root.querySelector('[data-bn-onboarding-summary]')).not.toBeNull();
  });

  it('reads back on the review only what is stored', async () => {
    const { root } = await mountWizard();
    await walkToBranding(root);
    setField(root, 'onboarding-brandColor', '#3d8b5e');
    await tick();
    await clickPrimary(root);

    const terms = Array.from(root.querySelectorAll('dt')).map(
      (dt) => dt.textContent,
    );
    expect(terms).toContain('Services');
    expect(terms).toContain('Service area');
    expect(terms).toContain('Brand colour');
    expect(terms).not.toContain('Team size');
    expect(terms).not.toContain('Integrations');
    const summary = root.querySelector('[data-bn-onboarding-summary]');
    expect(summary?.textContent).toContain('HVAC, Plumbing');
    expect(summary?.textContent).toContain('Springfield metro (40 mi radius)');
    expect(summary?.textContent).toContain('#3d8b5e');
  });

  it('does not gate the branding step: it is optional and says so', async () => {
    const { root } = await mountWizard();
    await walkToBranding(root);
    expect(primary(root).disabled).toBe(false);
  });
});

// ── The passkey step ──────────────────────────────────────────────────────
//
// Everything below exists because of what production looked like on the day
// it was written: six users, zero rows in `webauthn_credentials`, and a
// wizard that went from a 201 straight to "You are all set!". The account the
// owner used to read that sentence had no passkey and no password, and the
// only thing keeping him signed in was a cookie with a seven-day life.
//
// These assert the *properties* that make that impossible — a credential
// before the congratulation, a way out of every failure, a button that always
// says something true — rather than the sentences themselves, which are free
// to be reworded.

function q<T extends Element>(root: Element, testid: string): T {
  const node = root.querySelector<T>(`[data-testid="${testid}"]`);
  if (!node) {
    throw new Error(`no [data-testid="${testid}"] in the rendered step`);
  }
  return node;
}

function primary(root: Element): HTMLButtonElement {
  return q<HTMLButtonElement>(root, 'onboarding-next');
}

function setField(root: Element, testid: string, value: string): void {
  const input = q<HTMLInputElement>(root, testid);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function clickPrimary(root: Element): Promise<void> {
  primary(root).click();
  await tick();
}

/**
 * Registration succeeds, and /api/auth/me reports a session **only after it
 * has** — which is the whole point. A stub that answers 200 from the start
 * cannot tell a store that re-read the session from one that never needed to.
 */
function stubHappyApi(fake: FakeFetcher, registerStatus = 201): void {
  const registered = (): boolean =>
    fake.calls.some((c) => c.url.includes('/api/auth/register'));
  fake.respond(
    '/api/auth/register',
    () =>
      new Response(
        JSON.stringify({
          data: {
            user: { id: 'u1', email: 'alex@reed.com', role: 'owner' },
            workspace: { id: 'ws-1', name: 'Reed HVAC' },
          },
        }),
        {
          status: registerStatus,
          headers: { 'content-type': 'application/json' },
        },
      ),
  );
  fake.respond('/api/auth/me', () =>
    registered()
      ? new Response(
          JSON.stringify({
            data: {
              user: {
                id: 'u1',
                email: 'alex@reed.com',
                firstName: 'Alex',
                lastName: 'Reed',
                role: 'owner',
                workspaceId: 'ws-1',
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      : new Response(
          JSON.stringify({
            error: { code: 'UNAUTHORIZED', message: 'No session' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
  );
}

/** Fill steps 1–4 and land on step 5, the Review screen. */
async function walkToReview(root: Element): Promise<void> {
  setField(root, 'onboarding-firstName', 'Alex');
  setField(root, 'onboarding-lastName', 'Reed');
  setField(root, 'onboarding-ownerEmail', 'alex@reed.com');
  setField(root, 'onboarding-companyName', 'Reed HVAC');
  setField(root, 'onboarding-companyPhone', '(949) 555-0199');
  await tick();
  await clickPrimary(root);

  q<HTMLButtonElement>(root, 'onboarding-service-HVAC').click();
  await tick();
  await clickPrimary(root);

  setField(root, 'onboarding-serviceArea', 'Springfield metro');
  await tick();
  await clickPrimary(root);

  await clickPrimary(root); // 4 branding — optional
}

describe('onboarding — passkey enrolment step', () => {
  let dispose: (() => void) | null = null;
  let restoreWebAuthn: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    restoreWebAuthn?.();
    restoreWebAuthn = null;
    localStorage.clear();
  });

  interface Harness {
    readonly root: HTMLElement;
    readonly fake: FakeFetcher;
    readonly deps: ReturnType<typeof buildTestDeps>;
    readonly webauthn: ReturnType<typeof createFakeWebAuthn>;
  }

  interface MountOptions {
    readonly available?: boolean;
    readonly register?: () => Promise<void>;
    readonly registerStatus?: number;
    readonly stub?: (fake: FakeFetcher) => void;
  }

  async function mount(options: MountOptions = {}): Promise<Harness> {
    restoreWebAuthn = setWebAuthnAvailable(options.available ?? true);
    const fake = createFakeFetch();
    if (options.stub) options.stub(fake);
    else stubHappyApi(fake, options.registerStatus);
    const webauthn = createFakeWebAuthn(options.register);
    const deps = buildTestDeps({ fetch: fake.fetch, webauthn });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    return { root: view.element, fake, deps, webauthn };
  }

  /** Walk all the way through registration and stop on the passkey step. */
  async function mountAtPasskeyStep(
    options: MountOptions = {},
  ): Promise<Harness> {
    const h = await mount(options);
    await walkToReview(h.root);
    await clickPrimary(h.root); // step 5 → registers → step 6
    await tick();
    return h;
  }

  // ── D1: the congratulation is now a claim that gets checked ─────────────

  it('lands on the passkey step after registration, not on a congratulation', async () => {
    const { root } = await mountAtPasskeyStep();

    expect(
      root.querySelector('[data-testid="onboarding-passkey-lede"]'),
    ).not.toBeNull();
    expect(root.querySelector('h1')?.textContent).not.toBe('You are all set!');
    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.idle);
  });

  it('offers no way back from the passkey step, because the step behind it registers', async () => {
    const { root } = await mountAtPasskeyStep();

    expect(
      q<HTMLButtonElement>(root, 'onboarding-back').hasAttribute('hidden'),
    ).toBe(true);
  });

  it('says "You are all set!" only once a credential exists', async () => {
    const { root, webauthn } = await mountAtPasskeyStep();

    await clickPrimary(root); // "Add a passkey"
    await tick();
    expect(webauthn.registerCalls).toHaveLength(1);
    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.enrolled);

    await clickPrimary(root); // "Continue" → step 9
    expect(root.querySelector('h1')?.textContent).toBe('You are all set!');
    expect(
      root.querySelector('[data-bn-check]')?.hasAttribute('data-bn-tone'),
    ).toBe(false);
  });

  it('refuses to say "You are all set!" when enrolment was declined', async () => {
    const { root } = await mountAtPasskeyStep();

    q<HTMLButtonElement>(root, 'onboarding-passkey-decline').click();
    await tick();
    await clickPrimary(root); // "Continue without a passkey" → step 9

    expect(root.querySelector('h1')?.textContent).not.toBe('You are all set!');
    // The medallion carries the same news as the sentence beside it.
    expect(
      root.querySelector('[data-bn-check]')?.getAttribute('data-bn-tone'),
    ).toBe('warn');
    // The route to the fix is a link now, not a sentence naming a screen with
    // no way to reach it. Assert the control, which is what someone locked out
    // in seven days actually needs.
    const fix = q<HTMLAnchorElement>(root, 'onboarding-done-settings');
    expect(fix.hidden).toBe(false);
    expect(fix.getAttribute('href')).toBe('/settings');
  });

  it('points at Settings → Availability, the one place the hours live (GP-101)', async () => {
    const { root } = await mountAtPasskeyStep();
    await clickPrimary(root); // enrol
    await tick();
    await clickPrimary(root); // → step 9
    await tick();

    // Signup does not collect hours; nothing can be booked until they exist.
    const link = q<HTMLAnchorElement>(root, 'onboarding-done-availability');
    expect(link.hidden).toBe(false);
    expect(link.getAttribute('href')).toBe('/settings?tab=availability');
    expect(q<HTMLElement>(root, 'onboarding-done-hours').textContent).toContain(
      'when you work',
    );
    expect(
      q<HTMLElement>(root, 'onboarding-done-card-copy').textContent,
    ).toContain('card on file is required');
    // WS-1: the lead fee is metered at booking, never at accept.
    expect(
      q<HTMLElement>(root, 'onboarding-done-card-copy').textContent,
    ).toContain('charged when a job is booked');
    expect(
      q<HTMLElement>(root, 'onboarding-done-card-copy').textContent,
    ).not.toMatch(/accepted lead is charged/i);
    expect(q<HTMLButtonElement>(root, 'onboarding-done-card').type).toBe(
      'button',
    );
  });

  it('hides the fix link once a passkey exists', async () => {
    const { root } = await mountAtPasskeyStep();
    await clickPrimary(root); // enrol
    await tick();
    await clickPrimary(root); // → step 9
    await tick();

    expect(root.querySelector('h1')?.textContent).toBe('You are all set!');
    expect(q<HTMLAnchorElement>(root, 'onboarding-done-settings').hidden).toBe(
      true,
    );
  });

  // ── D2: the session the store did not know about ────────────────────────

  it('re-reads the session after registering, so the new cookie is not invisible', async () => {
    const { root, fake, deps } = await mount();

    // Boot-time check, as main.ts does it — before any cookie exists. It
    // caches the miss, which is what used to make everything after it
    // unreachable.
    await deps.auth.checkSession();
    expect(deps.auth.sessionChecked()).toBe(true);
    expect(deps.auth.isAuthenticated()).toBe(false);

    await walkToReview(root);
    await clickPrimary(root);
    await tick();

    const order = fake.calls
      .map((c) => c.url)
      .filter(
        (u) => u.includes('/api/auth/register') || u.includes('/api/auth/me'),
      );
    expect(order.at(-1)).toContain('/api/auth/me');
    expect(deps.auth.isAuthenticated()).toBe(true);
  });

  // ── D4: the wizard that would not reset ─────────────────────────────────

  it('does not write the finished step back to localStorage', async () => {
    await mountAtPasskeyStep();

    // The old bug needed a tick to show itself: removeItem ran, then the
    // persist effect re-ran on the step change and put the key back.
    await tick();
    await tick();
    expect(localStorage.getItem('gp_onboarding')).toBeNull();
  });

  it('returns to the passkey step on a reload, not to an empty step 1', async () => {
    // The account exists from the 201 onward. Landing on step 1 after a
    // refresh left someone signed in with zero credentials, no gate on
    // screen, and a form whose only outcome was a 409 — production's exact
    // broken state, recreated silently by pressing F5.
    const { root } = await mountAtPasskeyStep();
    dispose?.();
    dispose = null;
    root.remove();

    const second = await mount();
    expect(
      second.root.querySelector('[data-testid="onboarding-passkey-lede"]'),
    ).not.toBeNull();
    expect(second.root.querySelector('h1')?.textContent).not.toMatch(
      /^Step 1 of /,
    );
  });

  it('starts a fresh wizard once the passkey step has been resolved', async () => {
    // D4 still holds: the marker survives a reload, not a decision. Declining
    // is a decision, so /onboarding stops re-asking — Settings -> Security is
    // where an un-enrolled account gets fixed from then on.
    const { root } = await mountAtPasskeyStep();
    q<HTMLButtonElement>(root, 'onboarding-passkey-decline').click();
    await tick();
    dispose?.();
    dispose = null;
    root.remove();

    const second = await mount();
    expect(second.root.querySelector('h1')?.textContent).toMatch(/^Step 1 of /);
  });

  it('rescues a browser whose stored step is one of the old post-registration screens', async () => {
    // What the shipped build left behind: step 8 was "You are all set!", it
    // was persisted, and /onboarding opened on it forever.
    localStorage.setItem(
      'gp_onboarding',
      JSON.stringify({ step: 8, data: { firstName: 'Alex' } }),
    );

    const { root } = await mount();

    expect(root.querySelector('h1')?.textContent).toMatch(/^Step 5 of /);
    expect(root.querySelector('[data-bn-onboarding-summary]')).not.toBeNull();
  });

  // ── D5: the button that said "Saving…" forever ───────────────────────────

  function stubRegisterFailure(
    status: number,
    code: string,
    message: string,
  ): (fake: FakeFetcher) => void {
    return (fake) =>
      fake.respond(
        '/api/auth/register',
        () =>
          new Response(JSON.stringify({ error: { code, message } }), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
      );
  }

  it('puts the button back after a failed registration instead of leaving it mid-save', async () => {
    const { root } = await mount({
      stub: stubRegisterFailure(500, 'SERVER_ERROR', 'Database unavailable'),
    });

    await walkToReview(root);
    await clickPrimary(root);
    await tick();

    const button = primary(root);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Create workspace');
    expect(q(root, 'onboarding-error').hasAttribute('hidden')).toBe(false);
  });

  it('gives a duplicate-account refusal somewhere to go, since retrying cannot work', async () => {
    const { root } = await mount({
      stub: stubRegisterFailure(
        409,
        'DUPLICATE',
        'An account with this email already exists',
      ),
    });

    await walkToReview(root);
    await clickPrimary(root);
    await tick();

    expect(q<HTMLElement>(root, 'onboarding-error-wayout').hidden).toBe(false);
    // The server's message is a fragment with no full stop and the way-out
    // sentence follows it inline; without one they run together.
    expect(q(root, 'onboarding-error').textContent).toContain(
      'already exists. Already have an account?',
    );
    expect(q(root, 'onboarding-error-login').getAttribute('href')).toBe(
      '/login',
    );
    expect(q(root, 'onboarding-error-recover').getAttribute('href')).toBe(
      '/recover',
    );
  });

  it('hides the way-out links for failures that retrying can fix', async () => {
    const { root } = await mount({
      stub: stubRegisterFailure(500, 'SERVER_ERROR', 'nope'),
    });

    await walkToReview(root);
    await clickPrimary(root);
    await tick();

    expect(q<HTMLElement>(root, 'onboarding-error-wayout').hidden).toBe(true);
  });

  // ── Declining, failing, and being unable ────────────────────────────────

  function domError(name: string, message: string): Error {
    return Object.assign(new Error(message), { name });
  }

  it('shows the fallback and offers a retry when the prompt is dismissed', async () => {
    const { root } = await mountAtPasskeyStep({
      register: () =>
        Promise.reject(
          domError('NotAllowedError', 'The operation was aborted'),
        ),
    });

    await clickPrimary(root);
    await tick();

    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.failed);
    expect(q<HTMLElement>(root, 'onboarding-passkey-fallback').hidden).toBe(
      false,
    );
    expect(q(root, 'onboarding-passkey-note').textContent).toBe(
      PASSKEY_STEP_MESSAGES.cancelled,
    );
    // Never "check your connection" when the network was never the problem.
    expect(q(root, 'onboarding-passkey-note').textContent).not.toMatch(
      /connection/i,
    );
  });

  it('retries enrolment from the failed state', async () => {
    let attempt = 0;
    const { root, webauthn } = await mountAtPasskeyStep({
      register: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(domError('NotAllowedError', 'dismissed'))
          : Promise.resolve();
      },
    });

    await clickPrimary(root);
    await tick();
    await clickPrimary(root); // "Try again"
    await tick();

    expect(webauthn.registerCalls).toHaveLength(2);
    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.enrolled);
  });

  it('says what a rate limit is, rather than blaming the network', async () => {
    const limited = Object.assign(new Error('Too many requests'), {
      name: 'ApiError',
      status: 429,
      code: 'RATE_LIMITED',
    });
    const { root } = await mountAtPasskeyStep({
      register: () => Promise.reject(limited),
    });

    await clickPrimary(root);
    await tick();

    expect(q(root, 'onboarding-passkey-note').textContent).toBe(
      PASSKEY_STEP_MESSAGES['rate-limited'],
    );
  });

  it('never offers a button it knows cannot work on a browser without WebAuthn', async () => {
    const { root, webauthn } = await mountAtPasskeyStep({ available: false });

    // The fallback is already on screen — nobody has to press something to
    // discover the device cannot do this.
    expect(q<HTMLElement>(root, 'onboarding-passkey-fallback').hidden).toBe(
      false,
    );
    expect(q<HTMLElement>(root, 'onboarding-passkey-decline').hidden).toBe(
      true,
    );
    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.unsupported);

    await clickPrimary(root);
    expect(webauthn.registerCalls).toHaveLength(0);
    expect(root.querySelector('h1')?.textContent).not.toBe('You are all set!');
  });

  it('points an unenrolled owner at both fallbacks, with a link that resolves', async () => {
    const { root } = await mountAtPasskeyStep({ available: false });

    const fallback = q<HTMLElement>(root, 'onboarding-passkey-fallback');
    expect(fallback.querySelectorAll('li')).toHaveLength(2);
    expect(q(root, 'onboarding-passkey-settings').getAttribute('href')).toBe(
      '/settings',
    );
  });

  it('disables the button while the authenticator sheet is up, and only then', async () => {
    let release: (() => void) | null = null;
    const { root } = await mountAtPasskeyStep({
      register: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });

    await clickPrimary(root);
    await tick();
    expect(primary(root).disabled).toBe(true);
    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.enrolling);

    release?.();
    await tick();
    expect(primary(root).disabled).toBe(false);
  });

  // ── The invariants, as tables ───────────────────────────────────────────

  it('has a non-empty label for every phase, so the button can never be blank', () => {
    for (const [phase, label] of Object.entries(PASSKEY_BUTTON_LABELS)) {
      expect(label.length, phase).toBeGreaterThan(0);
    }
  });

  it('has a sentence for every failure kind, and none of them is a bare retry', () => {
    const kinds: AuthErrorKind[] = [
      'rate-limited',
      'offline',
      'no-credential',
      'cancelled',
      'no-prompt',
      'unsupported',
      'server',
      'unknown',
    ];
    for (const kind of kinds) {
      const message = PASSKEY_STEP_MESSAGES[kind];
      expect(message, kind).toBeTruthy();
      expect(message.length, kind).toBeGreaterThan(20);
    }
    // The one sentence that was wrong for four of these now belongs to
    // exactly one of them.
    const blamesNetwork = kinds.filter((k) =>
      /connection/i.test(PASSKEY_STEP_MESSAGES[k]),
    );
    expect(blamesNetwork).toEqual(['offline']);
  });
});

describe('onboarding — things toggled with `hidden` must actually disappear', () => {
  /**
   * A `display` rule in an author stylesheet outranks the UA's
   * `[hidden] { display: none }`. So every node this route both styles with
   * `display` and toggles with `hidden` has to carry its own `[hidden]` guard —
   * and `el.hidden = true` passing a unit test is no evidence that it did.
   *
   * The fallback panel shipped for one browser run with `display: grid` and no
   * guard: it was permanently on screen, including behind "Waiting for your
   * device…", telling someone mid-enrolment that their enrolment had failed.
   * Caught in Chromium, not here — so these assert the computed style, which
   * is the thing that was wrong.
   */
  let dispose: (() => void) | null = null;
  let restoreWebAuthn: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    restoreWebAuthn?.();
    restoreWebAuthn = null;
    localStorage.clear();
  });

  async function atPasskeyStep(available: boolean): Promise<HTMLElement> {
    restoreWebAuthn = setWebAuthnAvailable(available);
    const fake = createFakeFetch();
    stubHappyApi(fake);
    const deps = buildTestDeps({
      fetch: fake.fetch,
      webauthn: createFakeWebAuthn(),
    });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await walkToReview(view.element);
    await clickPrimary(view.element);
    await tick();
    return view.element;
  }

  it('keeps the fallback out of the layout until it is wanted', async () => {
    const root = await atPasskeyStep(true);

    const fallback = q<HTMLElement>(root, 'onboarding-passkey-fallback');
    expect(fallback.hidden).toBe(true);
    expect(getComputedStyle(fallback).display).toBe('none');

    q<HTMLButtonElement>(root, 'onboarding-passkey-decline').click();
    await tick();
    expect(getComputedStyle(fallback).display).not.toBe('none');
  });

  it('keeps the decline button out of the layout once it is moot', async () => {
    const root = await atPasskeyStep(false);

    const decline = q<HTMLElement>(root, 'onboarding-passkey-decline');
    expect(decline.hidden).toBe(true);
    expect(getComputedStyle(decline).display).toBe('none');
  });

  it('does not render the fallback during enrolment', async () => {
    // The specific frame that was wrong: phase `enrolling`, nothing decided,
    // and a panel on screen explaining what to do because it had not worked.
    let release: (() => void) | null = null;
    restoreWebAuthn = setWebAuthnAvailable(true);
    const fake = createFakeFetch();
    stubHappyApi(fake);
    const deps = buildTestDeps({
      fetch: fake.fetch,
      webauthn: createFakeWebAuthn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await walkToReview(view.element);
    await clickPrimary(view.element);
    await tick();

    await clickPrimary(view.element);
    await tick();
    expect(primary(view.element).textContent).toBe(
      PASSKEY_BUTTON_LABELS.enrolling,
    );
    expect(
      getComputedStyle(
        q<HTMLElement>(view.element, 'onboarding-passkey-fallback'),
      ).display,
    ).toBe('none');

    release?.();
    await tick();
  });
});

describe('onboarding — bailing out of an attempt that is still pending', () => {
  /**
   * Measured in Chromium: an authenticator that never answers holds
   * `navigator.credentials.create()` pending for ~57 seconds before the browser
   * itself gives up. For that whole time the primary button is correctly
   * disabled — so if it were the only control on the screen, the step would be
   * a minute-long dead end with a spinner for a sentence. The decline button
   * stays.
   */
  let dispose: (() => void) | null = null;
  let restoreWebAuthn: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    restoreWebAuthn?.();
    restoreWebAuthn = null;
    localStorage.clear();
  });

  interface Pending {
    readonly root: HTMLElement;
    reject(err: unknown): void;
    resolve(): void;
  }

  async function atPendingEnrolment(): Promise<Pending> {
    restoreWebAuthn = setWebAuthnAvailable(true);
    const fake = createFakeFetch();
    stubHappyApi(fake);
    let settle: {
      resolve: () => void;
      reject: (e: unknown) => void;
    } | null = null;
    const deps = buildTestDeps({
      fetch: fake.fetch,
      webauthn: createFakeWebAuthn(
        () =>
          new Promise<void>((resolve, reject) => {
            settle = { resolve, reject };
          }),
      ),
    });
    const view = renderOnboardingRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await walkToReview(view.element);
    await clickPrimary(view.element); // register → step 8
    await tick();
    await clickPrimary(view.element); // "Add a passkey" → pending
    await tick();
    return {
      root: view.element,
      reject: (err) => settle?.reject(err),
      resolve: () => settle?.resolve(),
    };
  }

  it('leaves a way out on screen while the prompt is pending', async () => {
    const { root } = await atPendingEnrolment();

    expect(primary(root).disabled).toBe(true);
    const decline = q<HTMLElement>(root, 'onboarding-passkey-decline');
    expect(decline.hidden).toBe(false);
    expect(getComputedStyle(decline).display).not.toBe('none');
  });

  it('honours the bail-out even though the attempt is still in flight', async () => {
    const { root } = await atPendingEnrolment();

    q<HTMLButtonElement>(root, 'onboarding-passkey-decline').click();
    await tick();

    expect(primary(root).disabled).toBe(false);
    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.declined);
    expect(q<HTMLElement>(root, 'onboarding-passkey-fallback').hidden).toBe(
      false,
    );
  });

  it('does not overturn the bail-out when the attempt later fails', async () => {
    const { root, reject } = await atPendingEnrolment();

    q<HTMLButtonElement>(root, 'onboarding-passkey-decline').click();
    await tick();

    reject(Object.assign(new Error('too late'), { name: 'NotAllowedError' }));
    await tick();
    await tick();

    // The user decided. A rejection arriving a minute afterwards is not news
    // they need, and it must not replace the instructions they are reading.
    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.declined);
    expect(q<HTMLElement>(root, 'onboarding-passkey-fallback').hidden).toBe(
      false,
    );
  });

  it('does accept a success that arrives after the bail-out', async () => {
    const { root, resolve } = await atPendingEnrolment();

    q<HTMLButtonElement>(root, 'onboarding-passkey-decline').click();
    await tick();

    resolve();
    await tick();
    await tick();

    // A credential really does exist now. That is a fact about the account, not
    // a screen state, and every sentence downstream depends on it — including
    // whether "You are all set!" is true.
    expect(primary(root).textContent).toBe(PASSKEY_BUTTON_LABELS.enrolled);
  });
});
