import { afterEach, describe, expect, it } from 'vitest';
import {
  ENROL_FAILED_MESSAGE,
  INVITE_MESSAGES,
  classifyInviteError,
  renderAcceptInviteRoute,
} from './accept-invite.js';
import {
  buildTestDeps,
  createFakeFetch,
  createFakeWebAuthn,
  jsonResponse,
  tick,
  type FakeFetcher,
  type FakeWebAuthn,
} from '../../test/helpers.js';

const TOKEN = '11111111-2222-4333-8444-555555555555';
const USER = {
  id: 'u2',
  email: 'bea@example.com',
  firstName: 'Bea',
  lastName: 'Smith',
  role: 'tech',
  workspaceId: 'ws-1',
};

function q<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const node = root.querySelector<T>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`missing ${id}`);
  return node;
}

describe('renderAcceptInviteRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    window.history.replaceState(null, '', '/');
  });

  function mount(
    configure: (fake: FakeFetcher) => void,
    webauthn: FakeWebAuthn = createFakeWebAuthn(),
  ) {
    const fake = createFakeFetch();
    configure(fake);
    const deps = buildTestDeps({ fetch: fake.fetch, webauthn });
    const view = renderAcceptInviteRoute(deps, { token: TOKEN });
    document.body.append(view.element);
    dispose = () => {
      view.dispose();
      view.element.remove();
    };
    return { view, fake, deps, webauthn };
  }

  it('renders who the invitation is for and enables the one button', async () => {
    const { view, fake } = mount((f) => {
      f.respond(`/api/auth/invite/${TOKEN}`, () =>
        jsonResponse({
          data: {
            firstName: 'Bea',
            lastName: 'Smith',
            workspaceName: 'Rivertown Electric',
            expiresAt: '2026-09-20T00:00:00.000Z',
          },
        }),
      );
    });
    await tick();
    await tick();
    expect(fake.calls[0]?.url).toContain(`/api/auth/invite/${TOKEN}`);
    expect(fake.calls[0]?.method).toBe('GET');
    expect(q(view.element, 'accept-invite-who').textContent).toContain(
      'Hi Bea, you have been invited to join Rivertown Electric',
    );
    expect(
      q<HTMLButtonElement>(view.element, 'accept-invite-submit').disabled,
    ).toBe(false);
  });

  it('accepts, refreshes the session, enrols a passkey, and goes to the dashboard', async () => {
    const { view, fake, webauthn } = mount((f) => {
      f.respond(`/api/auth/invite/${TOKEN}/accept`, () =>
        jsonResponse({ data: { user: USER } }),
      );
      f.respond(`/api/auth/invite/${TOKEN}`, () =>
        jsonResponse({
          data: {
            firstName: 'Bea',
            lastName: 'Smith',
            workspaceName: 'Rivertown Electric',
            expiresAt: '2026-09-20T00:00:00.000Z',
          },
        }),
      );
      f.respond('/api/auth/me', () => jsonResponse({ data: { user: USER } }));
    });
    await tick();
    await tick();

    q(view.element, 'accept-invite-submit').click();
    await tick();
    await tick();
    await tick();

    const accept = fake.calls.find((c) => c.url.includes('/accept'));
    expect(accept?.method).toBe('POST');
    expect(fake.calls.some((c) => c.url.includes('/api/auth/me'))).toBe(true);
    expect(webauthn.registerCalls).toHaveLength(1);
    // The accept happened BEFORE the passkey ceremony — enrolment needs the
    // session the accept minted.
    const acceptIndex = fake.calls.findIndex((c) => c.url.includes('/accept'));
    const meIndex = fake.calls.findIndex((c) => c.url.includes('/api/auth/me'));
    expect(acceptIndex).toBeLessThan(meIndex);
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('says so, and points at Settings, when the passkey ceremony fails after the accept', async () => {
    const { view, fake } = mount(
      (f) => {
        f.respond(`/api/auth/invite/${TOKEN}/accept`, () =>
          jsonResponse({ data: { user: USER } }),
        );
        f.respond(`/api/auth/invite/${TOKEN}`, () =>
          jsonResponse({
            data: {
              firstName: 'Bea',
              lastName: 'Smith',
              workspaceName: 'Rivertown Electric',
              expiresAt: '2026-09-20T00:00:00.000Z',
            },
          }),
        );
        f.respond('/api/auth/me', () => jsonResponse({ data: { user: USER } }));
      },
      createFakeWebAuthn(() => Promise.reject(new Error('NotAllowedError'))),
    );
    await tick();
    await tick();
    q(view.element, 'accept-invite-submit').click();
    await tick();
    await tick();
    await tick();

    expect(fake.calls.some((c) => c.url.includes('/accept'))).toBe(true);
    expect(q(view.element, 'accept-invite-error').textContent).toBe(
      ENROL_FAILED_MESSAGE,
    );
    expect(
      q(view.element, 'accept-invite-settings-link').hasAttribute('hidden'),
    ).toBe(false);
    expect(window.location.pathname).not.toBe('/dashboard');
  });

  it('explains a used, expired or unknown invitation instead of offering the button', async () => {
    const { view } = mount((f) => {
      f.respond(
        `/api/auth/invite/${TOKEN}`,
        () =>
          new Response(
            JSON.stringify({
              error: { code: 'INVITE_USED', message: 'used' },
            }),
            { status: 410, headers: { 'content-type': 'application/json' } },
          ),
      );
    });
    await tick();
    await tick();
    expect(q(view.element, 'accept-invite-error').textContent).toBe(
      INVITE_MESSAGES.used,
    );
    expect(q(view.element, 'accept-invite-submit').hidden).toBe(true);
  });

  it('classifies the API refusals', () => {
    expect(classifyInviteError({ code: 'INVITE_USED' })).toBe('used');
    expect(classifyInviteError({ code: 'INVITE_EXPIRED' })).toBe('expired');
    expect(classifyInviteError({ code: 'ALREADY_ENROLLED' })).toBe('enrolled');
    expect(classifyInviteError({ code: 'INVITE_NOT_FOUND' })).toBe('missing');
    expect(classifyInviteError(new Error('x'))).toBe('missing');
  });
});
