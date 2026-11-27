import { expect, test } from '@playwright/test';
import {
  emptyList,
  inventoryResponse,
  inventoryRow,
  mockApi,
} from '../fixtures/api-shapes';

// Fixtures come from ../fixtures/api-shapes.ts — a D1 row through the API's own
// serializer. The fixture this replaces invented `unit` and `reorderPoint`,
// fields no row and no model has ever had, and asserted only on the <h1>.

function inventory() {
  return inventoryResponse([
    inventoryRow({
      id: 'inv-1',
      name: 'Circuit Breaker 20A',
      sku: 'CB-20A',
      description: '20-amp circuit breaker',
      category: 'electrical',
      quantity: 24,
      min_quantity: 5,
      unit_cost: 1200,
      unit_price: 2400,
      location: 'Shelf A1',
    }),
  ]);
}

test.describe('Inventory Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [['/api/inventory', inventory()]]);
  });

  test('should display the inventory page', async ({ page }) => {
    await page.goto('/inventory', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Inventory', {
      timeout: 15000,
    });
  });

  test('renders the item, its stock level and unit price', async ({ page }) => {
    await page.goto('/inventory', { waitUntil: 'load', timeout: 30000 });
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('Circuit Breaker 20A', { timeout: 15000 });
    await expect(row).toContainText('CB-20A');
    // 2400 cents.
    await expect(row).toContainText('$24');
    await expect(row).not.toContainText('undefined');
    await expect(row).not.toContainText('NaN');
  });

  test('should show empty state when no inventory', async ({ page }) => {
    await mockApi(page, [['/api/inventory', emptyList]]);
    await page.goto('/inventory', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Inventory', {
      timeout: 15000,
    });
    await expect(page.locator('[data-bn-empty]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('should navigate to inventory page directly', async ({ page }) => {
    await page.goto('/inventory', { waitUntil: 'load', timeout: 30000 });
    await expect(page).toHaveURL(/\/inventory/);
  });
});
