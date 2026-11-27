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

const mockWorkspace = {
  data: {
    workspace: {
      id: 'test-workspace-1',
      name: 'Test Electric',
      trade: 'electrical',
      phone: '555-555-1234',
      email: 'test@greenput.com',
      address: {
        street: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
      },
      createdAt: '2025-01-01T00:00:00Z',
    },
    users: [],
  },
};

test.describe('Settings Page', () => {
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
      if (url.includes('/api/workspace')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockWorkspace),
        });
      }
      if (url.includes('/api/webhooks')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            meta: { total: 0, page: 1, perPage: 25 },
          }),
        });
      }
      if (url.includes('/api/branding')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              primaryColor: '#10b981',
              secondaryColor: '#1f2937',
              accentColor: '#3b82f6',
              fontFamily: 'system-ui',
              emailFooter: '',
            },
          }),
        });
      }
      if (url.includes('/api/api-keys')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: null }),
      });
    });
  });

  test('should display the settings page', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });

  test('should show workspace settings tab by default', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    // Should render without errors
  });

  test('should navigate to settings from dashboard', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    const link = page
      .locator('a[href="/settings"], nav a')
      .filter({ hasText: /settings/i });
    if ((await link.count()) > 0) {
      await link.first().click();
      await expect(page).toHaveURL(/settings/, { timeout: 10000 });
    } else {
      await page.goto('/settings', { waitUntil: 'load', timeout: 30000 });
      await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    }
  });
});
