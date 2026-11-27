import { expect, test } from '@playwright/test';
import { customersResponse, emptyList, mockApi } from '../fixtures/api-shapes';

// Fixtures come from ../fixtures/api-shapes.ts — a D1 row through the API's own
// serializer. The previous fixture here put `email` at the top level while the
// page reads `customer.contact.email`, and asserted only on the <h1>, so the
// "Cannot read properties of undefined (reading 'email')" that emptied this
// table in production never showed up.

test.describe('Customers Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [['/api/customers', customersResponse()]]);
  });

  test('should display the customers page', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Customers', {
      timeout: 15000,
    });
  });

  test('renders the customer, their contact and their lifetime value', async ({
    page,
  }) => {
    await page.goto('/customers', { waitUntil: 'load', timeout: 30000 });
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('Alice Smith', { timeout: 15000 });
    await expect(row).toContainText('alice@example.com');
    // 500000 cents.
    await expect(row).toContainText('$5,000');
    await expect(row).not.toContainText('undefined');
  });

  test('should show empty state when no customers', async ({ page }) => {
    await mockApi(page, [['/api/customers', emptyList]]);
    await page.goto('/customers', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Customers', {
      timeout: 15000,
    });
    await expect(page.locator('[data-bn-empty]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('should navigate to customers from dashboard', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    await page.click('a[href="/customers"]');
    await expect(page).toHaveURL(/\/customers/);
  });
});
