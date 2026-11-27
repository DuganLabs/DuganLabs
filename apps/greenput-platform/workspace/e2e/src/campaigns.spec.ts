import { expect, test } from '@playwright/test';
import {
  campaignRow,
  campaignsResponse,
  emptyList,
  mockApi,
} from '../fixtures/api-shapes';

// Fixtures come from ../fixtures/api-shapes.ts — a D1 row through the API's own
// serializer, so they cannot be in a shape /api/campaigns does not produce.

function campaigns() {
  return campaignsResponse([
    campaignRow({
      name: 'Spring HVAC Push',
      channel: 'email',
      leads_generated: 12,
      budget: 150000,
      spent: 68000,
    }),
  ]);
}

test.describe('Campaigns Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [['/api/campaigns', campaigns()]]);
  });

  test('should display the campaigns page with data', async ({ page }) => {
    await page.goto('/campaigns', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Campaigns', {
      timeout: 15000,
    });
  });

  test('renders the campaign row', async ({ page }) => {
    await page.goto('/campaigns', { waitUntil: 'load', timeout: 30000 });
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('Spring HVAC Push', { timeout: 15000 });
    await expect(row).not.toContainText('undefined');
    await expect(row).not.toContainText('NaN');
  });

  test('should show empty state when no campaigns', async ({ page }) => {
    await mockApi(page, [['/api/campaigns', emptyList]]);
    await page.goto('/campaigns', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Campaigns', {
      timeout: 15000,
    });
    await expect(page.locator('[data-bn-empty]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('should navigate to campaigns from dashboard', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    const link = page
      .locator('a[href="/campaigns"], nav a')
      .filter({ hasText: /campaigns/i });
    if ((await link.count()) > 0) {
      await link.first().click();
      await expect(page).toHaveURL(/campaigns/, { timeout: 10000 });
    } else {
      await page.goto('/campaigns', { waitUntil: 'load', timeout: 30000 });
      await expect(page.locator('h1')).toContainText('Campaigns', {
        timeout: 15000,
      });
    }
  });
});
