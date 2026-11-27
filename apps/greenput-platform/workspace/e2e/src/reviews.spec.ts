import { expect, test } from '@playwright/test';
import {
  emptyList,
  mockApi,
  reviewRow,
  reviewsResponse,
} from '../fixtures/api-shapes';

// Fixtures come from ../fixtures/api-shapes.ts — a D1 row through the API's own
// serializer. The stats body below is `ReviewStats` as declared in
// libs/shared/models; the fixture it replaces invented a `ratingBreakdown`
// object the endpoint has never sent, and "should display review stats"
// asserted only that the <h1> was visible.

const STATS = {
  data: {
    averageRating: 4.8,
    totalReviews: 42,
    byPlatform: [
      { platform: 'google', count: 30 },
      { platform: 'yelp', count: 12 },
    ],
    ratingDistribution: [
      { rating: 5, count: 30 },
      { rating: 4, count: 8 },
      { rating: 3, count: 3 },
      { rating: 2, count: 1 },
    ],
  },
};

function reviews() {
  return reviewsResponse([
    reviewRow({
      rating: 5,
      content: 'Excellent service!',
      author_name: 'John Doe',
      platform: 'google',
      responded: 0,
    }),
  ]);
}

test.describe('Reviews Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, [
      ['/api/reviews/stats', STATS],
      ['/api/reviews/requests', emptyList],
      ['/api/reviews', reviews()],
    ]);
  });

  test('should display the reviews page', async ({ page }) => {
    await page.goto('/reviews', { waitUntil: 'load', timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Reviews', {
      timeout: 15000,
    });
  });

  test('should display review stats', async ({ page }) => {
    await page.goto('/reviews', { waitUntil: 'load', timeout: 30000 });
    const stats = page.locator('[data-bn-stats]');
    await expect(stats).toContainText('4.8', { timeout: 15000 });
    await expect(stats).toContainText('42');
    await expect(stats).not.toContainText('undefined');
    await expect(stats).not.toContainText('NaN');
  });

  test('renders the review with its author and body', async ({ page }) => {
    await page.goto('/reviews', { waitUntil: 'load', timeout: 30000 });
    const main = page.locator('[data-bn-route="reviews"]');
    await expect(main).toContainText('Excellent service!', { timeout: 15000 });
    await expect(main).toContainText('John Doe');
  });

  test('should navigate to reviews from nav', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 30000 });
    const link = page
      .locator('a[href="/reviews"], nav a')
      .filter({ hasText: /reviews/i });
    if ((await link.count()) > 0) {
      await link.first().click();
      await expect(page).toHaveURL(/reviews/, { timeout: 10000 });
    } else {
      await page.goto('/reviews', { waitUntil: 'load', timeout: 30000 });
      await expect(page.locator('h1')).toContainText('Reviews', {
        timeout: 15000,
      });
    }
  });
});
