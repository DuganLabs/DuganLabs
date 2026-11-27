import { test, expect } from '@playwright/test';

test.describe('Preview deployment smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    // Mock all API calls to prevent cross-origin issues on preview deployments
    await page.route('**/api/**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      }),
    );
  });

  test('login page loads and renders', async ({ page }) => {
    // Capture console errors for debugging
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) =>
      consoleErrors.push(`PAGE ERROR: ${err.message}`),
    );

    const response = await page.goto('/login', {
      waitUntil: 'load',
      timeout: 20000,
    });
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);

    // Dump page state for debugging if the app hasn't rendered
    const h1Count = await page.locator('h1').count();
    if (h1Count === 0) {
      const url = page.url();
      const bodyHTML = await page.evaluate(() =>
        document.body.innerHTML.substring(0, 2000),
      );
      const allText = await page.evaluate(() =>
        document.body.innerText.substring(0, 500),
      );
      console.log(`[DEBUG] URL: ${url}`);
      console.log(`[DEBUG] h1 count: ${h1Count}`);
      console.log(`[DEBUG] Body HTML: ${bodyHTML}`);
      console.log(`[DEBUG] Visible text: ${allText}`);
      console.log(`[DEBUG] Console errors: ${consoleErrors.join(' | ')}`);
    }

    // Wait for the app to bootstrap and render. Post-migration, the login
    // card shows the "Greenput" brand heading (see <h1 id="login-title">
    // in apps/platform/src/routes/login/login.ts) rather than the old
    // Angular "Welcome" copy.
    await expect(page.locator('h1')).toContainText('Greenput', {
      timeout: 10000,
    });
  });

  test('unauthenticated users are redirected to login', async ({ page }) => {
    await page.goto('/dashboard', {
      waitUntil: 'load',
      timeout: 20000,
    });

    // Auth guard should redirect to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });
});
