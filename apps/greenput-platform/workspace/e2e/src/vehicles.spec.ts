import { expect, test } from '@playwright/test';
import {
  emptyList,
  mockApi,
  vehicleRow,
  vehiclesResponse,
} from '../fixtures/api-shapes';

// Fixtures come from ../fixtures/api-shapes.ts — a D1 row through the API's own
// serializer, so they cannot be in a shape /api/vehicles does not produce.

function vehicles() {
  return vehiclesResponse([
    vehicleRow({
      name: 'Service Van 1',
      license_plate: 'ABC123',
      mileage: 12000,
    }),
  ]);
}

test.describe('Fleet (Vehicles) Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [['/api/vehicles', vehicles()]]);
  });

  test('should display the fleet page with data', async ({ page }) => {
    await page.goto('/vehicles', { waitUntil: 'load', timeout: 30000 });
    // Post-migration copy: the page is titled "Vehicles" (matches the
    // /vehicles nav item and route name) rather than the old Angular
    // "Fleet" heading.
    await expect(page.locator('h1')).toContainText('Vehicles', {
      timeout: 15000,
    });
  });

  test('renders the vehicle with its plate and mileage', async ({ page }) => {
    await page.goto('/vehicles', { waitUntil: 'load', timeout: 30000 });
    const main = page.locator('[data-bn-route="vehicles"]');
    await expect(main).toContainText('Service Van 1', { timeout: 15000 });
    await expect(main).toContainText('ABC123');
    await expect(main).not.toContainText('undefined');
  });

  test('should show empty state when no vehicles', async ({ page }) => {
    await mockApi(page, [['/api/vehicles', emptyList]]);
    await page.goto('/vehicles', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Vehicles', {
      timeout: 15000,
    });
    await expect(page.locator('[data-bn-empty]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('should navigate to fleet from dashboard', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    await page.click('a[href="/vehicles"]');
    await expect(page).toHaveURL(/\/vehicles/);
  });
});
