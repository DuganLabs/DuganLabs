import { test as base } from '@playwright/test';

interface MockApiHelpers {
  mockApi: (path: string, response: object, status?: number) => Promise<void>;
  mockApiError: (path: string, status: number, body?: object) => Promise<void>;
  mockApiDelay: (
    path: string,
    response: object,
    delayMs: number,
  ) => Promise<void>;
  mockApiEmpty: (path: string) => Promise<void>;
}

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

/**
 * Sets up common API mocks for all test fixtures:
 * - Mocks /api/auth/me to return a test user (prevents auth redirect)
 * - Adds catch-all for any unhandled /api/** calls (prevents hanging)
 */
async function setupBaseMocks(
  page: import('@playwright/test').Page,
): Promise<void> {
  // Log browser console errors and failed network requests for CI debugging
  if (process.env['CI']) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[browser error] ${msg.text()}`);
    });
    page.on('requestfailed', (req) => {
      console.log(
        `[request failed] ${req.url()} - ${req.failure()?.errorText}`,
      );
    });
  }

  // Catch-all for any unhandled API calls — prevents cross-origin hangs
  // Registered FIRST so it has LOWEST priority (Playwright: last registered = highest priority)
  await page.route('**/api/**', (route) => {
    if (process.env['CI'])
      console.log(`[mock catch-all] ${route.request().url()}`);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });

  // Mock auth endpoint — registered AFTER catch-all so it takes priority
  await page.route('**/api/auth/me*', (route) => {
    if (process.env['CI']) console.log(`[mock auth] ${route.request().url()}`);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockUser),
    });
  });
}

export const test = base.extend<MockApiHelpers>({
  mockApi: async ({ page }, use) => {
    await setupBaseMocks(page);

    const fn = async (
      path: string,
      response: object,
      status = 200,
    ): Promise<void> => {
      await page.route(`**/api${path}*`, (route) => {
        if (process.env['CI'])
          console.log(`[mock ${path}] ${route.request().url()}`);
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(response),
        });
      });
    };
    await use(fn);
  },

  mockApiError: async ({ page }, use) => {
    await setupBaseMocks(page);

    const fn = async (
      path: string,
      status: number,
      body?: object,
    ): Promise<void> => {
      await page.route(`**/api${path}*`, (route) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body ?? { message: 'Error' }),
        }),
      );
    };
    await use(fn);
  },

  mockApiDelay: async ({ page }, use) => {
    await setupBaseMocks(page);

    const fn = async (
      path: string,
      response: object,
      delayMs: number,
    ): Promise<void> => {
      await page.route(`**/api${path}*`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(response),
        });
      });
    };
    await use(fn);
  },

  mockApiEmpty: async ({ page }, use) => {
    await setupBaseMocks(page);

    const fn = async (path: string): Promise<void> => {
      await page.route(`**/api${path}*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            meta: { total: 0, page: 1, perPage: 25 },
          }),
        }),
      );
    };
    await use(fn);
  },
});

export { expect } from '@playwright/test';
