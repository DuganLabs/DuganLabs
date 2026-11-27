import { expect, test } from '@playwright/test';
import {
  emptyList,
  leadRow,
  leadsResponse,
  mockApi,
} from '../fixtures/api-shapes';

// The fixture is built from a D1 row through the API's own serializer (see
// ../fixtures/api-shapes.ts), so it cannot drift from what /api/leads sends.
// The previous fixture here hand-wrote a `contact: {}` object and asserted only
// on the <h1>, which is why "Cannot read properties of undefined (reading
// 'email')" and an empty board shipped past a green suite.

test.describe('Leads Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [['/api/leads', leadsResponse()]]);
  });

  test('should display the leads page with data', async ({ page }) => {
    await page.goto('/leads', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Leads', { timeout: 15000 });
  });

  test('renders the lead, its contact and its value', async ({ page }) => {
    await page.goto('/leads', { waitUntil: 'load', timeout: 30000 });
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('John Doe', { timeout: 15000 });
    // `lead.contact.email` — the read that threw.
    await expect(row).toContainText('john@example.com');
    // 265213 cents.
    await expect(row).toContainText('$2,652');
    await expect(row).not.toContainText('undefined');
    await expect(row).not.toContainText('NaN');
  });

  test('shows every lead the API returns', async ({ page }) => {
    await mockApi(page, [
      [
        '/api/leads',
        leadsResponse([
          leadRow({ id: 'lead-1', first_name: 'John', status: 'new' }),
          leadRow({
            id: 'lead-2',
            first_name: 'Bea',
            last_name: 'Ruiz',
            email: 'bea@example.com',
            status: 'qualified',
          }),
        ]),
      ],
    ]);
    await page.goto('/leads', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('tbody tr')).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('tbody')).toContainText('bea@example.com');
  });

  test('should show empty state when no leads', async ({ page }) => {
    await mockApi(page, [['/api/leads', emptyList]]);
    await page.goto('/leads', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Leads', { timeout: 15000 });
    await expect(page.locator('[data-bn-empty]').first()).toBeVisible({
      timeout: 15000,
    });
  });
});
