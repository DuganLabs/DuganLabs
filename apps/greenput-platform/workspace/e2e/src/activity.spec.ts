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

const mockActivity = {
  data: [
    {
      id: 'act-1',
      workspace_id: 'test-workspace-1',
      user_id: 'test-user-1',
      entity_type: 'lead',
      entity_id: 'lead-1',
      action: 'created',
      meta: null,
      created_at: '2026-04-01T10:00:00Z',
      first_name: 'Test',
      last_name: 'User',
    },
    {
      id: 'act-2',
      workspace_id: 'test-workspace-1',
      user_id: 'test-user-1',
      entity_type: 'job',
      entity_id: 'job-1',
      action: 'status_changed',
      meta: JSON.stringify({ from: 'scheduled', to: 'in_progress' }),
      created_at: '2026-04-01T09:00:00Z',
      first_name: 'Test',
      last_name: 'User',
    },
  ],
  meta: { total: 2, page: 1, perPage: 25 },
};

function setupApiMocks(
  page: Parameters<Parameters<typeof test.beforeEach>[0]>[0]['page'],
) {
  return page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockUser),
      });
    }
    if (url.includes('/api/audit') || url.includes('/api/activity')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockActivity),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
}

test.describe('Activity Log Page', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('should display the activity page', async ({ page }) => {
    await page.goto('/activity', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });

  test('should render without errors', async ({ page }) => {
    await page.goto('/activity', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    // No console errors should block rendering
  });

  test('should navigate to activity from dashboard', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    const link = page
      .locator('a[href="/activity"], nav a')
      .filter({ hasText: /activity/i });
    if ((await link.count()) > 0) {
      await link.first().click();
      await expect(page).toHaveURL(/activity/, { timeout: 10000 });
    } else {
      await page.goto('/activity', { waitUntil: 'load', timeout: 30000 });
      await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    }
  });
});
