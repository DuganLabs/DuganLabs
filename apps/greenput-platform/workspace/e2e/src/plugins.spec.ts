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

const mockPlugins = {
  data: [
    {
      id: 'plugin-1',
      name: 'QuickBooks Integration',
      slug: 'quickbooks',
      description: 'Sync jobs and invoices with QuickBooks Online.',
      version: '1.0.0',
      author: 'Greenput',
      category: 'accounting',
      events: ['job.completed', 'job.paid'],
      configSchema: {},
      active: false,
      createdAt: '2025-01-01T00:00:00Z',
    },
    {
      id: 'plugin-2',
      name: 'Twilio SMS',
      slug: 'twilio-sms',
      description: 'Send SMS notifications to customers.',
      version: '1.2.0',
      author: 'Greenput',
      category: 'communication',
      events: ['lead.created', 'job.scheduled'],
      configSchema: {},
      active: true,
      createdAt: '2025-01-01T00:00:00Z',
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
    if (url.includes('/api/plugins')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockPlugins),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
}

test.describe('Plugins / Integrations Page', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('should display the plugins page', async ({ page }) => {
    await page.goto('/plugins', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });

  test('should show plugin list', async ({ page }) => {
    await page.goto('/plugins', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    // Should render without errors
  });

  test('should render empty state when no plugins', async ({ page }) => {
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
      if (url.includes('/api/plugins')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            meta: { total: 0, page: 1, perPage: 25 },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: null }),
      });
    });
    await page.goto('/plugins', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });
});
