import { expect, test } from '@playwright/test';
import {
  emptyList,
  jobRow,
  jobsResponse,
  mockApi,
  opportunitiesResponse,
  scheduleResponse,
} from '../fixtures/api-shapes';

// Fixtures come from ../fixtures/api-shapes.ts — a D1 row through the API's own
// serializer. In production every Scheduled cell on this page read "Invalid
// Date" and the calendar had no events, because the API sent `scheduled_start`
// and the page reads `job.scheduledStart`. The old fixture here spelled it
// camelCase anyway and asserted only on the <h1>, so the suite stayed green.

/** Today, so the job lands inside the week the calendar opens on. */
function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const START = todayAt(10);
const END = todayAt(12);

const ROW = jobRow({
  scheduled_start: START,
  scheduled_end: END,
  total: 265213,
});

function jobs() {
  return jobsResponse([ROW]);
}

test.describe('Jobs Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [
      ['/api/opportunities', opportunitiesResponse([])],
      // The calendar fetches its own week (GP-006); more specific path first.
      ['/api/jobs/schedule', scheduleResponse([ROW])],
      ['/api/jobs', jobs()],
    ]);
  });

  test('should display the jobs page with data', async ({ page }) => {
    await page.goto('/jobs', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Jobs', { timeout: 15000 });
  });

  test('the Scheduled cell shows a real date, not "Invalid Date"', async ({
    page,
  }) => {
    await page.goto('/jobs', { waitUntil: 'load', timeout: 30000 });
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('#1001', { timeout: 15000 });
    await expect(row).not.toContainText('Invalid Date');
    // A month-and-day label ("Apr 10"), whatever the runner's locale.
    await expect(row).toContainText(/[A-Z][a-z]{2}\s\d{1,2}/);
    // 265213 cents.
    await expect(row).toContainText('$2,652');
  });

  test('the calendar places the job as an event', async ({ page }) => {
    await page.goto('/jobs', { waitUntil: 'load', timeout: 30000 });
    await page.locator('[data-testid="jobs-view-calendar"]').click();
    await expect(page.locator('[data-bn-jobs-calendar]')).toContainText(
      'HVAC Installation',
      { timeout: 15000 },
    );
  });

  test('should show empty state when no jobs', async ({ page }) => {
    await mockApi(page, [
      ['/api/opportunities', opportunitiesResponse([])],
      ['/api/jobs/schedule', scheduleResponse([])],
      ['/api/jobs', emptyList],
    ]);
    await page.goto('/jobs', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Jobs', { timeout: 15000 });
    await expect(page.locator('[data-bn-empty]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('should navigate to jobs from dashboard', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    await page.click('a[href="/jobs"]');
    await expect(page).toHaveURL(/\/jobs/);
  });
});
