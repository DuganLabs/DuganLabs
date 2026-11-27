import { describe, expect, it } from 'vitest';
import { resolveRoute } from '@basenative/router';
import { HOME_ROUTE, LOGIN_ROUTE, ROUTE_TABLE } from './table.js';

describe('ROUTE_TABLE', () => {
  it('exposes every Angular route', () => {
    const names = ROUTE_TABLE.map((r) => r.name).sort();
    expect(names).toEqual([
      'accept-invite',
      'activity',
      'campaigns',
      'chat',
      'chat-list',
      'customer-detail',
      'customers',
      'dashboard',
      'estimate-detail',
      'estimates',
      'inventory',
      'job-detail',
      'jobs',
      'lead-detail',
      'leads',
      'login',
      'not-found',
      'onboarding',
      'opportunities',
      'opportunity-detail',
      'placeholder',
      'plugins',
      'recover',
      'reports',
      'reviews',
      'settings',
      'vehicles',
    ]);
  });

  it('protects every authenticated route', () => {
    const protectedNames = ROUTE_TABLE.filter(
      (r) => r.meta?.requiresAuth === true,
    )
      .map((r) => r.name)
      .sort();
    expect(protectedNames).toEqual([
      'activity',
      'campaigns',
      'chat',
      'chat-list',
      'customer-detail',
      'customers',
      'dashboard',
      'estimate-detail',
      'estimates',
      'inventory',
      'job-detail',
      'jobs',
      'lead-detail',
      'leads',
      'opportunities',
      'opportunity-detail',
      'plugins',
      'reports',
      'reviews',
      'settings',
      'vehicles',
    ]);
    expect(
      ROUTE_TABLE.find((r) => r.name === 'login')?.meta?.requiresAuth,
    ).toBeUndefined();
    expect(
      ROUTE_TABLE.find((r) => r.name === 'onboarding')?.meta?.requiresAuth,
    ).toBeUndefined();
    // /recover is the door for someone with no session at all. Guarding it
    // would redirect a locked-out owner to /login, which is where they came
    // from, which is the dead end the route exists to end.
    expect(
      ROUTE_TABLE.find((r) => r.name === 'recover')?.meta?.requiresAuth,
    ).toBeUndefined();
    // An invited teammate has no session either — the screen is how they
    // get one (GP-008).
    expect(
      ROUTE_TABLE.find((r) => r.name === 'accept-invite')?.meta?.requiresAuth,
    ).toBeUndefined();
  });

  it('uses the bare layout for every signed-out screen', () => {
    const bare = ROUTE_TABLE.filter((r) => r.meta?.bareLayout === true).map(
      (r) => r.name,
    );
    expect(bare.sort()).toEqual([
      'accept-invite',
      'login',
      'onboarding',
      'recover',
    ]);
  });

  it('puts /recover ahead of the catch-all so it cannot be swallowed', () => {
    const recover = ROUTE_TABLE.findIndex((r) => r.name === 'recover');
    const notFound = ROUTE_TABLE.findIndex((r) => r.name === 'not-found');
    expect(recover).toBeGreaterThanOrEqual(0);
    expect(recover).toBeLessThan(notFound);
  });

  it('chat route uses :id param syntax', () => {
    expect(ROUTE_TABLE.find((r) => r.name === 'chat')?.path).toBe('/chat/:id');
  });

  it('/chat resolves to the Messages list, not to not-found — the whole of GP-055', () => {
    const routes = ROUTE_TABLE as unknown as Array<{
      path: string;
      name: string;
    }>;
    expect(resolveRoute(routes, '/chat').name).toBe('chat-list');
    expect(resolveRoute(routes, '/chat/room-1')).toMatchObject({
      name: 'chat',
      params: { id: 'room-1' },
    });
    expect(ROUTE_TABLE.find((r) => r.name === 'chat-list')?.meta).toEqual({
      requiresAuth: true,
      title: 'Messages',
    });
    const list = ROUTE_TABLE.findIndex((r) => r.name === 'chat-list');
    const notFound = ROUTE_TABLE.findIndex((r) => r.name === 'not-found');
    expect(list).toBeLessThan(notFound);
  });

  it('gives every pipeline entity a detail route (GP-003)', () => {
    const path = (name: string) =>
      ROUTE_TABLE.find((r) => r.name === name)?.path;
    expect(path('lead-detail')).toBe('/leads/:id');
    expect(path('customer-detail')).toBe('/customers/:id');
    expect(path('job-detail')).toBe('/jobs/:id');
    expect(path('opportunity-detail')).toBe('/opportunities/:id');
    expect(path('estimate-detail')).toBe('/estimates/:id');
  });

  it('puts every /:id route ahead of the catch-all — the one ordering mistake that sends them to not-found', () => {
    const notFound = ROUTE_TABLE.findIndex((r) => r.path === '/*path');
    const paramRoutes = ROUTE_TABLE.filter((r) => r.path.includes('/:'));
    expect(paramRoutes.length).toBeGreaterThanOrEqual(7);
    for (const route of paramRoutes) {
      expect(
        ROUTE_TABLE.indexOf(route),
        `${route.path} must precede '/*path'`,
      ).toBeLessThan(notFound);
    }
  });

  it('exposes stable HOME and LOGIN constants', () => {
    expect(HOME_ROUTE).toBe('/dashboard');
    expect(LOGIN_ROUTE).toBe('/login');
  });

  it('has a catch-all not-found route as the very last entry', () => {
    const last = ROUTE_TABLE[ROUTE_TABLE.length - 1];
    expect(last?.name).toBe('not-found');
    expect(last?.path).toBe('/*path');
    expect(last?.meta?.title).toBe('Page not found');
  });
});
