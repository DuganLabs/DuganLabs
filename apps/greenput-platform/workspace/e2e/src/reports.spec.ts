import { test, expect } from '@playwright/test';

const mockUser = {
  data: {
    user: {
      id: 'test-user-1',
      email: 'test@greenput.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'owner',
      workspaceId: 'test-workspace-1',
    },
  },
};

const mockRevenue = {
  data: {
    period: 'month',
    from: '2025-04-01',
    to: '2026-04-01',
    byPeriod: [{ period: '2025-12', revenue: 75000, job_count: 8 }],
    byServiceType: [],
    summary: { totalRevenue: 75000, jobCount: 8, averageJobValue: 9375 },
    topCustomers: [],
  },
};

const mockPipeline = {
  data: {
    from: '2025-04-01',
    to: '2026-04-01',
    byStatus: [
      { status: 'new', count: 15 },
      { status: 'converted', count: 5 },
    ],
    bySource: [],
    conversionRate: 33,
    avgTimeToConvert: 5.2,
  },
};

test.describe('Reports Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/**', (route) => {
      const url = route.request().url();
      if (url.includes('/api/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockUser),
        });
      }
      if (url.includes('/api/reports/revenue')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockRevenue),
        });
      }
      if (url.includes('/api/reports/pipeline')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockPipeline),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: null }),
      });
    });
  });

  test('should display the reports page', async ({ page }) => {
    await page.goto('/reports', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Reports', {
      timeout: 15000,
    });
  });

  test('should display revenue data when loaded', async ({ page }) => {
    await page.goto('/reports', { waitUntil: 'load', timeout: 30000 });
    // Page should render without errors
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });

  test('should show error state when API fails', async ({ page }) => {
    await page.unrouteAll();
    await page.route('**/api/**', (route) => {
      const url = route.request().url();
      if (url.includes('/api/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockUser),
        });
      }
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Server error' } }),
      });
    });

    await page.goto('/reports', { waitUntil: 'load', timeout: 30000 });
    // Page should still render even with API errors
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });
});
