/**
 * `/reviews` — reviews list with stats panel + respond modal.
 *
 * Mirrors [ReviewsComponent](apps/platform/src/app/features/reviews/reviews.component.ts).
 */

import { effect, signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  Review,
  ReviewRequest,
  ReviewStats,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { statusBadge } from '../shared/badge.js';
import { formatRelativeTime } from '../../lib/format.js';
import { buildPanelForm } from '../shared/panel.js';
import { field as formField } from '../shared/field.js';
import { mountDialog, type DialogMount } from '../shared/dialog.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import type { RouteView } from '../types.js';

export function renderReviewsRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);

  const tab = signal<'reviews' | 'requests'>('reviews');
  const respondingTo = signal<Review | null>(null);
  const responseText = signal('');
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  const page = signal(1);
  const reviewsResource = createResource<ApiResponse<Review[]>>(
    () => deps.reviews.list({ page: page() }),
    { auto: true },
  );
  // Only the reviews tab pages; on the requests tab the pager reports no
  // rows and hides itself.
  const pager = mountPagination({
    page,
    total: () =>
      tab() === 'reviews' ? (reviewsResource.data()?.meta?.total ?? 0) : 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'reviews',
    label: 'Review pages',
    noun: 'reviews',
    loading: reviewsResource.loading,
  });
  cleanups.push(pager.dispose);
  const requestsResource = createResource<ApiResponse<ReviewRequest[]>>(
    () => deps.reviews.listRequests(),
    { auto: true },
  );
  const statsResource = createResource<{ data: ReviewStats }>(
    () => deps.reviews.stats(),
    { auto: true },
  );

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Reviews'),
      // What the page does, and only that: nothing here is connected to
      // Google, Yelp or Nextdoor, and a response posted here is published
      // nowhere but Greenput (GP-047).
      el('p', {}, 'Collect and respond to reviews recorded in Greenput.'),
    ),
  );

  // ── stats summary ──────────────────────────────────────────────────────
  const statsCard = el('aside', { 'data-bn-card': '', 'data-bn-stats': '' });

  function renderStats(stats: ReviewStats | undefined): void {
    clear(statsCard);
    const avg = stats?.averageRating;
    const total = stats?.totalReviews ?? 0;
    statsCard.append(
      el(
        'header',
        {},
        el('span', { 'data-bn-stats-icon': '', 'aria-hidden': 'true' }, '★'),
        el(
          'div',
          {},
          el(
            'h2',
            {},
            avg === null || avg === undefined ? '—' : avg.toFixed(1),
          ),
          el(
            'p',
            {},
            `${total} review${total === 1 ? '' : 's'} across all platforms`,
          ),
        ),
      ),
    );
    if (stats?.byPlatform.length) {
      const dl = el('dl', { 'data-bn-stats-platforms': '' });
      for (const row of stats.byPlatform) {
        dl.append(el('dt', {}, row.platform), el('dd', {}, String(row.count)));
      }
      statsCard.append(dl);
    }
  }
  renderStats(undefined);
  cleanups.push(
    effect(() => {
      renderStats(statsResource.data()?.data);
    }).dispose,
  );

  // ── tabs ───────────────────────────────────────────────────────────────
  const tabs = el('div', { 'data-bn-segmented': '', role: 'tablist' });
  function renderTabs(active: 'reviews' | 'requests'): void {
    clear(tabs);
    for (const value of ['reviews', 'requests'] as const) {
      const btn = el(
        'button',
        {
          type: 'button',
          'data-bn-button': '',
          'data-testid': `reviews-tab-${value}`,
          role: 'tab',
          'aria-selected': active === value ? 'true' : 'false',
        },
        value === 'reviews' ? 'Reviews' : 'Requests',
      );
      if (active === value) btn.setAttribute('data-bn-active', '');
      btn.addEventListener('click', () => tab.set(value));
      tabs.append(btn);
    }
  }
  renderTabs('reviews');
  cleanups.push(
    effect(() => {
      renderTabs(tab());
    }).dispose,
  );

  const list = el('div', { 'data-bn-review-list': '' });
  const empty = el('p', { 'data-bn-empty': '', hidden: true });
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading…',
  );

  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'reviews' },
    header,
    statsCard,
    tabs,
    loadingNode,
    errorNode,
    empty,
    list,
    pager.element,
  );

  // ── respond modal ──────────────────────────────────────────────────────
  let modalDialog: DialogMount | null = null;
  let modalDispose: Cleanup | null = null;

  function teardownModal(): void {
    modalDispose?.();
    modalDispose = null;
    modalDialog?.dispose();
    modalDialog = null;
  }

  cleanups.push(
    effect(() => {
      const review = respondingTo();
      if (!review) {
        teardownModal();
        return;
      }
      teardownModal();
      const textarea = el('textarea', {
        'data-bn-input': '',
        'data-testid': 'reviews-response-input',
        placeholder: 'Thanks for the feedback…',
      }) as HTMLTextAreaElement;
      textarea.value = responseText.peek();
      on(textarea, 'input', () => {
        responseText.set(textarea.value);
      });
      const form = buildPanelForm({
        body: [
          el(
            'blockquote',
            { 'data-bn-quote': '' },
            review.content || '(no comment)',
          ),
          formField('Public response', textarea),
        ],
        submitting,
        submitError,
        submitLabel: 'Post response',
        onSubmit: async () => {
          const text = responseText.peek().trim();
          if (!text) return;
          submitting.set(true);
          submitError.set(null);
          try {
            await deps.reviews.respond(review.id, text);
            respondingTo.set(null);
            responseText.set('');
            await reviewsResource.reload();
          } catch (err) {
            submitError.set(
              err instanceof Error ? err.message : 'Could not post response.',
            );
          } finally {
            submitting.set(false);
          }
        },
        onCancel: () => {
          respondingTo.set(null);
          responseText.set('');
        },
      });
      modalDispose = form.dispose;
      modalDialog = mountDialog({
        id: 'reviews-respond',
        title: `Respond to ${review.authorName}`,
        body: [form.element],
        size: 'lg',
        onClose: () => {
          respondingTo.set(null);
          responseText.set('');
        },
      });
      modalDialog.open();
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const mode = tab();
      if (mode === 'reviews') {
        const items = reviewsResource.data()?.data ?? [];
        const isLoading = reviewsResource.loading();
        const err = reviewsResource.error();
        toggle(loadingNode, isLoading && items.length === 0);
        toggle(errorNode, err !== null);
        if (err)
          errorNode.textContent = `Could not load reviews: ${err.message}`;
        const hasData = items.length > 0;
        toggle(empty, !isLoading && err === null && !hasData);
        empty.textContent =
          'No reviews yet. Reviews appear here once customers leave them.';
        toggle(list, hasData);
        renderReviewList(list, items, (review) => {
          respondingTo.set(review);
          responseText.set(review.responseText ?? '');
        });
      } else {
        const items = requestsResource.data()?.data ?? [];
        const isLoading = requestsResource.loading();
        const err = requestsResource.error();
        toggle(loadingNode, isLoading && items.length === 0);
        toggle(errorNode, err !== null);
        if (err)
          errorNode.textContent = `Could not load requests: ${err.message}`;
        const hasData = items.length > 0;
        toggle(empty, !isLoading && err === null && !hasData);
        // Names the one control that can make a request: Request review on a
        // paid job on /jobs (GP-047). Nothing here is "sent" — see the card.
        empty.textContent =
          'No review requests yet. Request one from a paid job on the Jobs page and it appears here.';
        toggle(list, hasData);
        renderRequestList(list, items);
      }
    }).dispose,
  );

  return {
    element: root,
    dispose: () => {
      teardownModal();
      reviewsResource.dispose();
      requestsResource.dispose();
      statsResource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

function renderReviewList(
  container: HTMLElement,
  reviews: Review[],
  onRespond: (review: Review) => void,
): void {
  clear(container);
  for (const review of reviews) {
    const stars = el('div', {
      'data-bn-stars': '',
      role: 'img',
      'aria-label': `${review.rating} of 5 stars`,
    });
    for (let i = 0; i < 5; i++) {
      stars.append(
        el(
          'span',
          {
            'data-bn-star': i < review.rating ? 'filled' : 'empty',
            'aria-hidden': 'true',
          },
          '★',
        ),
      );
    }

    const respondBtn = el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-bn-variant': review.responded ? 'ghost' : 'secondary',
        'data-testid': `reviews-respond-${review.id}`,
      },
      review.responded ? 'Edit response' : 'Respond',
    );
    respondBtn.addEventListener('click', () => onRespond(review));

    const card = el(
      'article',
      { 'data-bn-card': '' },
      el(
        'header',
        {},
        el(
          'span',
          { 'data-bn-platform-icon': '', 'aria-hidden': 'true' },
          platformIcon(review.platform),
        ),
        el(
          'div',
          {},
          el('h2', {}, review.authorName || 'Anonymous'),
          el(
            'p',
            {},
            `${review.platform} · ${formatRelativeTime(review.createdAt)}`,
          ),
        ),
        stars,
      ),
      el('p', { 'data-bn-review-body': '' }, review.content || '(no comment)'),
      review.responded
        ? el(
            'p',
            { 'data-bn-review-response': '' },
            el('strong', {}, 'Your response: '),
            review.responseText ?? '',
          )
        : null,
      el('footer', {}, respondBtn),
    );
    container.append(card);
  }
}

function renderRequestList(
  container: HTMLElement,
  requests: ReviewRequest[],
): void {
  clear(container);
  for (const req of requests) {
    container.append(
      el(
        'article',
        { 'data-bn-card': '' },
        el(
          'header',
          {},
          el('span', { 'data-bn-icon': '', 'aria-hidden': 'true' }, '📩'),
          el(
            'div',
            {},
            el('h2', {}, `Request via ${req.channel.toUpperCase()}`),
            // Greenput sends nothing (GP-008): a request is recorded when
            // the contractor copies the message on /jobs, and stays
            // `pending` — the product never claims it was sent.
            el(
              'p',
              {},
              req.sentAt
                ? `Sent ${formatRelativeTime(req.sentAt)}`
                : `Recorded ${formatRelativeTime(req.createdAt)} · send the message yourself — Greenput does not send it`,
            ),
          ),
          statusBadge(req.status, req.status),
        ),
      ),
    );
  }
}

function platformIcon(platform: string): string {
  const icons: Record<string, string> = {
    google: 'G',
    yelp: 'Y',
    nextdoor: 'N',
    facebook: 'F',
    internal: '★',
  };
  return icons[platform] ?? '★';
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}
