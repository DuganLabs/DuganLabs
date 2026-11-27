import { expect, test } from '@playwright/test';
import {
  emptyList,
  jobRow,
  jobsResponse,
  mockApi,
} from '../fixtures/api-shapes';

// The run sheet rides on /api/jobs (see renderRunSheet in
// apps/platform/src/routes/dashboard/dashboard.ts). The old fixtures here left
// that call to the `{ data: null }` catch-all, so the run sheet — the first
// thing on the page, and the part that read "--:--" in production — was never
// rendered by any test at all.

const STATS = {
  data: {
    leads: { thisMonth: 42, growth: 12.5 },
    jobs: { active: 8, dueThisWeek: 3 },
    revenue: { thisMonth: 12500000, growth: 8.3 },
    conversion: { rate: 35 },
    activity: [],
  },
};

const EMPTY_STATS = {
  data: {
    leads: { thisMonth: 0, growth: null },
    jobs: { active: 0, dueThisWeek: 0 },
    revenue: { thisMonth: 0, growth: null },
    conversion: { rate: 0 },
    activity: [],
  },
};

/** Today, so the job belongs on today's run sheet. */
function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 30, 0, 0);
  return d.toISOString();
}

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [
      ['/api/dashboard/stats', STATS],
      [
        '/api/jobs',
        jobsResponse([
          jobRow({
            scheduled_start: todayAt(9),
            scheduled_end: todayAt(11),
            total: 265213,
          }),
        ]),
      ],
    ]);
  });

  test('should display the dashboard page', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    // The route is titled "Today": the page was reordered to open on a day's
    // work (the run sheet) rather than on a grid of numbers, and the heading
    // says what the screen is for. `/dashboard` is unchanged.
    await expect(page.locator('h1')).toContainText('Today', {
      timeout: 15000,
    });
  });

  test('should display metric cards when data loads', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    await expect(page.getByLabel('New leads')).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('Active jobs')).toBeVisible();
    await expect(page.getByLabel('Revenue')).toBeVisible();
    await expect(page.getByLabel('Conversion rate')).toBeVisible();
  });

  test("today's run sheet shows a clock time, not --:--", async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    const item = page.locator('[data-bn-run-item]').first();
    await expect(item).toContainText('HVAC Installation', { timeout: 15000 });
    const time = item.locator('[data-bn-run-time]');
    await expect(time).not.toContainText('--:--');
    await expect(time).toContainText(/\d{2}:\d{2}/);
    // 265213 cents.
    await expect(item).toContainText('$2,652');
  });

  test('run sheet says so when nothing is booked', async ({ page }) => {
    await mockApi(page, [
      ['/api/dashboard/stats', EMPTY_STATS],
      ['/api/jobs', emptyList],
    ]);
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    await expect(page.getByText('Nothing booked')).toBeVisible({
      timeout: 15000,
    });
  });

  test('should show empty activity message', async ({ page }) => {
    await mockApi(page, [
      ['/api/dashboard/stats', EMPTY_STATS],
      ['/api/jobs', emptyList],
    ]);
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    // Post-migration copy: the empty activity feed uses the same
    // "No <thing> yet. Add a <thing> to get started." pattern as every
    // other empty state in the app (see renderActivity in
    // apps/platform/src/routes/dashboard/dashboard.ts), rather than the
    // old Angular "No recent activity." copy.
    await expect(page.getByText('No activity yet')).toBeVisible({
      timeout: 15000,
    });
  });
});
