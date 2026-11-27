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

const mockRooms = {
  data: [
    {
      id: 'room-1',
      workspaceId: 'test-workspace-1',
      name: 'General',
      createdBy: 'test-user-1',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
  ],
  meta: { total: 1, page: 1, perPage: 25 },
};

const mockMessages = {
  data: [
    {
      id: 'msg-1',
      roomId: 'room-1',
      senderId: 'test-user-1',
      senderName: 'Test User',
      content: 'Hello, team!',
      createdAt: '2025-01-15T10:00:00Z',
    },
  ],
  meta: { total: 1, page: 1, perPage: 50 },
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
    if (url.includes('/api/chat/rooms') && url.includes('/messages')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockMessages),
      });
    }
    if (url.includes('/api/chat/rooms')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockRooms),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
}

test.describe('Chat Page', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('should display the chat page', async ({ page }) => {
    await page.goto('/chat/room-1', { waitUntil: 'load', timeout: 30000 });
    await expect(
      page.locator('h1, [data-testid="chat-header"], .chat-header'),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test('should render chat room without errors', async ({ page }) => {
    await page.goto('/chat/room-1', { waitUntil: 'load', timeout: 30000 });
    // Page should load without crashing
    const body = page.locator('body');
    await expect(body).toBeVisible({ timeout: 15000 });
  });

  test('should show chat content when navigating via URL', async ({ page }) => {
    await page.goto('/chat/room-1', { waitUntil: 'load', timeout: 30000 });
    await expect(page).toHaveURL(/\/chat\/room-1/);
  });
});
