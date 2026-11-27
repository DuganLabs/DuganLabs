import { afterEach, describe, expect, it } from 'vitest';
import type {
  Review,
  ReviewRequest,
  ReviewStats,
} from '@greenput/shared/models';
import { renderReviewsRoute } from './reviews.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function review(partial: Partial<Review>): Review {
  return {
    id: 'r1',
    workspaceId: 'w1',
    platform: 'google',
    rating: 5,
    content: 'Great work!',
    authorName: 'Sam Reed',
    responded: false,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

const EMPTY = { data: [], meta: { total: 0, page: 1, perPage: 25 } };
const NO_STATS: ReviewStats = {
  averageRating: null,
  totalReviews: 0,
  byPlatform: [],
  ratingDistribution: [],
};

const STATS: ReviewStats = {
  averageRating: 4.7,
  totalReviews: 23,
  byPlatform: [
    { platform: 'google', count: 18 },
    { platform: 'yelp', count: 5 },
  ],
  ratingDistribution: [],
};

describe('renderReviewsRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    // Cleanup any modal mounted on document.body
    document
      .querySelectorAll('dialog[data-bn="dialog"]')
      .forEach((el) => el.remove());
  });

  it('shows the average rating and renders review cards', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/reviews/stats', () => jsonResponse({ data: STATS }));
    fake.respond('/api/reviews/requests', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/reviews', () =>
      jsonResponse({
        data: [review({ id: 'r1', authorName: 'Sam Reed' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderReviewsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    expect(view.element.querySelector('[data-bn-stats] h2')?.textContent).toBe(
      '4.7',
    );
    const cards = view.element.querySelectorAll(
      '[data-bn-review-list] article',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toMatch(/Sam Reed/);
  });

  it('opens the respond modal when "Respond" is clicked', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/reviews/stats', () => jsonResponse({ data: STATS }));
    fake.respond('/api/reviews/requests', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/reviews', () =>
      jsonResponse({
        data: [review({ id: 'r1' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderReviewsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    expect(document.querySelector('dialog[data-bn="dialog"]')).toBeNull();
    (
      view.element.querySelector(
        '[data-testid="reviews-respond-r1"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    const dialog = document.querySelector(
      'dialog[data-bn="dialog"]',
    ) as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/reviews/stats', () => jsonResponse({ data: STATS }));
    fake.respond('/api/reviews/requests', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/reviews', () =>
      jsonResponse({
        data: [review({ id: 'r1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderReviewsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const pager = view.element.querySelector('[data-bn-pagination]');
    expect(pager).not.toBeNull();
    expect(pager?.hasAttribute('hidden')).toBe(false);
    expect(
      pager?.querySelector('[data-bn-pagination-summary]')?.textContent,
    ).toContain('60');

    (
      view.element.querySelector(
        '[data-testid="reviews-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/reviews') && /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });
  /* GP-047. Both empty states told the contractor to request a review when
     no control in the product could, and the subtitle promised Google, Yelp
     and Nextdoor on a page connected to none of them. String assertions,
     because the defect is a string. */
  it('empty states name only controls that exist, and the subtitle promises no platform', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/reviews/stats', () => jsonResponse({ data: NO_STATS }));
    fake.respond('/api/reviews/requests', () => jsonResponse(EMPTY));
    fake.respond('/api/reviews', () => jsonResponse(EMPTY));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderReviewsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const subtitle =
      view.element.querySelector(':scope > header p')?.textContent ?? '';
    expect(subtitle).toBe(
      'Collect and respond to reviews recorded in Greenput.',
    );
    expect(subtitle).not.toMatch(/Google|Yelp|Nextdoor/);

    const empty = view.element.querySelector('[data-bn-empty]');
    expect(empty?.hasAttribute('hidden')).toBe(false);
    expect(empty?.textContent).toBe(
      'No reviews yet. Reviews appear here once customers leave them.',
    );
    // Not an instruction to request anything: this tab has no such control.
    expect(empty?.textContent).not.toMatch(/request/i);

    (
      view.element.querySelector(
        '[data-testid="reviews-tab-requests"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(empty?.hasAttribute('hidden')).toBe(false);
    // The control it names is the one that exists: Request review on a paid
    // job on /jobs. Nothing on this page is "sent".
    expect(empty?.textContent).toBe(
      'No review requests yet. Request one from a paid job on the Jobs page and it appears here.',
    );
    expect(empty?.textContent).not.toMatch(/sent/i);
  });

  /* GP-008: links, not sending. A recorded request is pending, and the card
     says so rather than "Sent" or "Pending send". */
  it('a pending request says it was recorded and that Greenput did not send it', async () => {
    const request: ReviewRequest = {
      id: 'rr1',
      workspaceId: 'w1',
      customerId: 'c1',
      jobId: 'j1',
      channel: 'sms',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const fake = createFakeFetch();
    fake.respond('/api/reviews/stats', () => jsonResponse({ data: NO_STATS }));
    fake.respond('/api/reviews/requests', () =>
      jsonResponse({
        data: [request],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/reviews', () => jsonResponse(EMPTY));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderReviewsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    (
      view.element.querySelector(
        '[data-testid="reviews-tab-requests"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    const card = view.element.querySelector('[data-bn-review-list] article');
    expect(card).not.toBeNull();
    expect(card?.textContent).toMatch(/Recorded/);
    expect(card?.textContent).toMatch(/Greenput does not send it/);
    expect(card?.textContent).not.toMatch(/\bSent\b/);
    expect(card?.querySelector('[data-bn-status="pending"]')).not.toBeNull();
  });
});
