import { expect, test } from '@playwright/test';
import {
  emptyList,
  estimateRow,
  estimatesResponse,
  mockApi,
} from '../fixtures/api-shapes';

// Fixtures come from ../fixtures/api-shapes.ts — a D1 row through the API's own
// serializer, so they cannot be in a shape /api/estimates does not produce.
// Amounts are cents; `taxRate` is a percentage.

function estimates() {
  return estimatesResponse([
    estimateRow({
      title: 'HVAC Replacement',
      status: 'draft',
      line_items:
        '[{"description":"Condenser","quantity":1,"unitPrice":420000,"total":420000}]',
      subtotal: 420000,
      tax_rate: 8.5,
      tax_amount: 35700,
      total: 455700,
    }),
  ]);
}

test.describe('Estimates Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [['/api/estimates', estimates()]]);
  });

  test('should display the estimates page with data', async ({ page }) => {
    await page.goto('/estimates', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Estimates', {
      timeout: 15000,
    });
  });

  test('renders the estimate and its total', async ({ page }) => {
    await page.goto('/estimates', { waitUntil: 'load', timeout: 30000 });
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('HVAC Replacement', { timeout: 15000 });
    // 455700 cents.
    await expect(row).toContainText('$4,557');
    await expect(row).not.toContainText('undefined');
    await expect(row).not.toContainText('NaN');
  });

  test('should show empty state when no estimates', async ({ page }) => {
    await mockApi(page, [['/api/estimates', emptyList]]);
    await page.goto('/estimates', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Estimates', {
      timeout: 15000,
    });
    await expect(page.locator('[data-bn-empty]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('should navigate to estimates page directly', async ({ page }) => {
    await page.goto('/estimates', { waitUntil: 'load', timeout: 30000 });
    await expect(page).toHaveURL(/estimates/);
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });
});
