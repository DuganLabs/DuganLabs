import { expect, test } from '@playwright/test';
import {
  emptyList,
  mockApi,
  opportunitiesResponse,
  opportunityRow,
} from '../fixtures/api-shapes';

// Fixtures come from ../fixtures/api-shapes.ts — a D1 row through the API's own
// serializer. Every assertion here used to be `expect(h1).toBeVisible()`,
// including the one named "should show pipeline kanban or list", so the page
// could render a board of nothing and pass.

function opportunities() {
  return opportunitiesResponse([
    opportunityRow({
      id: 'opp-1',
      title: 'Electrical Panel Upgrade',
      status: 'open',
      value: 350000,
      service_type: 'Electrical',
    }),
    opportunityRow({
      id: 'opp-2',
      lead_id: 'lead-2',
      title: 'HVAC Installation',
      status: 'proposal_sent',
      value: 520000,
      service_type: 'HVAC',
    }),
  ]);
}

test.describe('Opportunities Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [['/api/opportunities', opportunities()]]);
  });

  test('should display the opportunities page', async ({ page }) => {
    await page.goto('/opportunities', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });

  test('shows both deals with their values', async ({ page }) => {
    await page.goto('/opportunities', { waitUntil: 'load', timeout: 30000 });
    const main = page.locator('[data-bn-route="opportunities"]');
    await expect(main).toContainText('Electrical Panel Upgrade', {
      timeout: 15000,
    });
    await expect(main).toContainText('HVAC Installation');
    // 350000 and 520000 cents.
    await expect(main).toContainText('$3,500');
    await expect(main).toContainText('$5,200');
    await expect(main).not.toContainText('NaN');
  });

  test('should handle empty opportunities state', async ({ page }) => {
    await mockApi(page, [['/api/opportunities', emptyList]]);
    await page.goto('/opportunities', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-bn-empty]').first()).toBeVisible({
      timeout: 15000,
    });
  });
});
