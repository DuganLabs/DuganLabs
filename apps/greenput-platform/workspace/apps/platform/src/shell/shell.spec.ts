import { afterEach, describe, expect, it } from 'vitest';
import { renderShell } from './shell.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../test/helpers.js';

describe('renderShell', () => {
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
    history.replaceState(null, '', '/');
  });

  it('shows the bare layout for /login', async () => {
    history.replaceState(null, '', '/login');
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    const shell = renderShell(deps);
    dispose = shell.dispose;
    document.body.append(shell.element);
    await tick();

    expect(shell.element.querySelector('[data-bn-shell-header]')).toBeNull();
    expect(shell.element.querySelector('[data-bn-bare]')).not.toBeNull();
  });

  it('shows the full chrome for /dashboard with the user avatar populated', async () => {
    history.replaceState(null, '', '/dashboard');
    const fake = createFakeFetch();
    fake.respond('/api/dashboard/stats', () =>
      jsonResponse({
        data: {
          leads: { thisMonth: 0, growth: null },
          jobs: { active: 0, dueThisWeek: 0 },
          revenue: { thisMonth: 0, growth: null },
          conversion: { rate: 0 },
          activity: [],
        },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    deps.auth.setUser({
      id: 'u1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'owner',
      workspaceId: 'w1',
    });
    const shell = renderShell(deps);
    dispose = shell.dispose;
    document.body.append(shell.element);
    await tick();
    await tick();

    expect(
      shell.element.querySelector('[data-bn-shell-header]'),
    ).not.toBeNull();
    expect(shell.element.querySelector('[data-bn-avatar]')?.textContent).toBe(
      'JD',
    );
    expect(
      shell.element.querySelector('[data-bn-user-name]')?.textContent,
    ).toBe('Jane Doe');
  });

  it('marks the active nav item based on the URL', async () => {
    history.replaceState(null, '', '/activity');
    const fake = createFakeFetch();
    fake.respond('/api/audit', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    deps.auth.setUser({
      id: 'u1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'owner',
      workspaceId: 'w1',
    });
    const shell = renderShell(deps);
    dispose = shell.dispose;
    document.body.append(shell.element);
    await tick();
    await tick();

    // The same route now renders as an anchor in both the desktop nav and
    // the mobile drawer (only one is visible per breakpoint via CSS, but
    // both exist in the DOM) — every one of them should be marked active.
    const activeLinks = shell.element.querySelectorAll('a[data-bn-active]');
    expect(activeLinks.length).toBeGreaterThan(0);
    for (const link of activeLinks) {
      expect(link.getAttribute('href')).toBe('/activity');
    }
  });

  it('reaches Messages from the nav and renders the list at /chat (GP-055)', async () => {
    history.replaceState(null, '', '/chat');
    const fake = createFakeFetch();
    fake.respond('/api/chat/unread', () => jsonResponse({ data: [] }));
    fake.respond('/api/chat/rooms', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 50 } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    deps.auth.setUser({
      id: 'u1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'owner',
      workspaceId: 'w1',
    });
    const shell = renderShell(deps);
    dispose = shell.dispose;
    document.body.append(shell.element);
    await tick();
    await tick();

    const link = shell.element.querySelector('[data-testid="shell-nav-chat"]');
    expect(link?.getAttribute('href')).toBe('/chat');
    expect(link?.textContent).toContain('Messages');
    expect(link?.hasAttribute('data-bn-active')).toBe(true);
    expect(
      shell.element.querySelector('[data-bn-route="chat-list"]'),
    ).not.toBeNull();
    expect(
      shell.element.querySelector('[data-testid="not-found-route"]'),
    ).toBeNull();
    expect(document.title).toBe('Messages · Greenput');
  });

  it('renders a not-found view with a link home for an unknown route', async () => {
    history.replaceState(null, '', '/does-not-exist');
    const fake = createFakeFetch();
    const deps = buildTestDeps({ fetch: fake.fetch });
    deps.auth.setUser({
      id: 'u1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'owner',
      workspaceId: 'w1',
    });
    const shell = renderShell(deps);
    dispose = shell.dispose;
    document.body.append(shell.element);
    await tick();

    const notFoundView = shell.element.querySelector(
      '[data-testid="not-found-route"]',
    );
    expect(notFoundView).not.toBeNull();
    expect(
      notFoundView?.querySelector('a[href="/dashboard"]')?.textContent,
    ).toMatch(/dashboard/i);
    expect(document.title).toBe('Page not found · Greenput');
  });
});
