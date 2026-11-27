import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardStats, Job } from '@greenput/shared/models';
import { renderDashboardRoute } from './dashboard.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

const STATS: DashboardStats = {
  leads: { thisMonth: 24, growth: 12 },
  jobs: { active: 8, dueThisWeek: 3 },
  // Integer cents, which is what /api/dashboard/stats returns: it is
  // SUM(jobs.total), and jobs.total is cents once migration 023 has run. This
  // fixture said 18450 and the tile asserted "$18,450" — the fixture was in
  // dollars and the reader agreed with it, so between them they hid that the
  // tile had no /100.
  revenue: { thisMonth: 1845000, growth: -5 },
  conversion: { rate: 64 },
  activity: [
    {
      id: '1',
      entity_type: 'lead',
      entity_id: '1',
      action: 'created',
      meta: null,
      created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      first_name: 'Mike',
      last_name: 'Torres',
    },
    {
      id: '2',
      entity_type: 'job',
      entity_id: '2',
      action: 'completed',
      meta: null,
      created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      first_name: 'Sarah',
      last_name: 'Chen',
    },
  ],
};

describe('renderDashboardRoute', () => {
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders 4 KPI cards and the activity list once stats arrive', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/dashboard/stats', () => jsonResponse({ data: STATS }));
    const deps = buildTestDeps({ fetch: fake.fetch });

    const view = renderDashboardRoute(deps);
    dispose = view.dispose;

    document.body.append(view.element);
    await tick();
    await tick();

    const cards = view.element.querySelectorAll('[data-bn-kpi-card]');
    expect(cards).toHaveLength(4);
    expect(
      view.element.querySelector('[data-bn-kpi="leads"] dd')?.textContent,
    ).toBe('24');
    expect(
      view.element.querySelector('[data-bn-kpi="jobs"] dd')?.textContent,
    ).toBe('8');
    expect(
      view.element.querySelector('[data-bn-kpi="revenue"] dd')?.textContent,
    ).toBe('$18,450');
    expect(
      view.element.querySelector('[data-bn-kpi="conversion"] dd')?.textContent,
    ).toBe('64%');

    const items = view.element.querySelectorAll('[data-bn-activity-item]');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toMatch(/Lead created by Mike Torres/);
  });

  /* GP-007. The run sheet is the screen a contractor has open on site, so
     the job's next step lives on it: Start on a scheduled job, Finish on a
     running one, and the sheet re-renders from the reloaded list. */
  it('puts Start / Finish on the run sheet and PATCHes the transition', async () => {
    const now = new Date();
    const todayJob = (partial: Partial<Job>): Job => ({
      id: 'j1',
      opportunityId: 'o1',
      customerId: 'c1',
      jobNumber: 'JOB-001',
      title: 'Panel upgrade',
      status: 'scheduled',
      address: { street: '1 Main', city: 'Town', state: 'CA', zip: '94000' },
      scheduledStart: now.toISOString(),
      scheduledEnd: now.toISOString(),
      lineItems: [],
      total: 250000,
      notes: '',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-15T00:00:00Z',
      createdBy: 'u1',
      ...partial,
    });
    let status: Job['status'] = 'scheduled';
    const fake = createFakeFetch();
    fake.respond('/api/dashboard/stats', () => jsonResponse({ data: STATS }));
    fake.respond('/api/jobs/j1', () => {
      status = 'in_progress';
      return jsonResponse({ data: todayJob({ status }) });
    });
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: [todayJob({ status })],
        meta: { total: 1, page: 1, perPage: 100 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderDashboardRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const start = view.element.querySelector(
      '[data-testid="run-start-j1"]',
    ) as HTMLElement | null;
    expect(start).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="run-finish-j1"]'),
    ).toBeNull();

    start!.click();
    await tick();
    await tick();
    const patched = fake.calls.find(
      (call) => call.method === 'PATCH' && call.url.includes('/api/jobs/j1'),
    );
    expect(patched).toBeDefined();
    expect((patched?.body as { status: string }).status).toBe('in_progress');
    expect(typeof (patched?.body as { actualStart?: string }).actualStart).toBe(
      'string',
    );

    // Reloaded: the row now offers Finish and reads as on site.
    await tick();
    expect(
      view.element.querySelector('[data-testid="run-finish-j1"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="run-start-j1"]'),
    ).toBeNull();
  });

  it('flags revenue trend as down when growth is negative', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/dashboard/stats', () => jsonResponse({ data: STATS }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderDashboardRoute(deps);
    dispose = view.dispose;

    await tick();
    await tick();

    const revenueMeta = view.element.querySelector(
      '[data-bn-kpi="revenue"] [data-bn-kpi-meta]',
    );
    expect(revenueMeta?.getAttribute('data-bn-trend')).toBe('down');
    expect(revenueMeta?.textContent).toMatch(/-5%/);
  });

  it('shows error state when fetch fails', async () => {
    const fake = createFakeFetch();
    fake.respond(
      '/api/dashboard/stats',
      () =>
        new Response(
          JSON.stringify({ error: { code: 'oops', message: 'kaboom' } }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderDashboardRoute(deps);
    dispose = view.dispose;

    await tick();
    await tick();

    const status = view.element.querySelector('[role="status"]');
    expect(status?.hasAttribute('hidden')).toBe(false);
    expect(status?.textContent).toMatch(/Could not load/);
  });

  it("uses the user's first name in the greeting", async () => {
    const fake = createFakeFetch();
    fake.respond('/api/dashboard/stats', () => jsonResponse({ data: STATS }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    deps.auth.setUser({
      id: 'u1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'owner',
      workspaceId: 'w1',
    });
    const view = renderDashboardRoute(deps);
    dispose = view.dispose;

    expect(view.element.querySelector('header p')?.textContent).toBe(
      'Welcome back, Jane.',
    );
  });

  /* GP-062. "Week view" landed on the Jobs list; the calendar had no URL. */
  it('points "Week view" at the calendar, not the list', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/dashboard/stats', () => jsonResponse({ data: STATS }));
    const view = renderDashboardRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    expect(
      view.element
        .querySelector('[data-testid="dashboard-open-calendar"]')
        ?.getAttribute('href'),
    ).toBe('/jobs?view=calendar');
  });
});
