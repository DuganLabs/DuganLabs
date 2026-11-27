import type {
  Review,
  ReviewRequest,
  ReviewStats,
  ApiResponse,
} from '@greenput/shared/models';

let reviewCounter = 0;
let requestCounter = 0;

export function createReview(overrides: Partial<Review> = {}): Review {
  reviewCounter++;
  return {
    id: `rev-${reviewCounter}`,
    workspaceId: 'ws-1',
    platform: 'google',
    rating: 5,
    content: `Great service! Very professional. (Review ${reviewCounter})`,
    authorName: `Customer ${reviewCounter}`,
    responded: false,
    createdAt: '2025-01-15T10:00:00Z',
    fetchedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

export function createReviewList(
  n: number,
  overrides: Partial<Review> = {},
): Review[] {
  return Array.from({ length: n }, () => createReview(overrides));
}

export function createReviewResponse(
  reviews: Review[] = createReviewList(3),
): ApiResponse<Review[]> {
  return {
    data: reviews,
    meta: { total: reviews.length, page: 1, perPage: 25 },
  };
}

export function createEmptyReviewResponse(): ApiResponse<Review[]> {
  return {
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  };
}

export function createReviewStats(
  overrides: Partial<ReviewStats> = {},
): ReviewStats {
  return {
    averageRating: 4.7,
    totalReviews: 24,
    byPlatform: [
      { platform: 'google', count: 18 },
      { platform: 'yelp', count: 6 },
    ],
    ratingDistribution: [
      { rating: 5, count: 16 },
      { rating: 4, count: 6 },
      { rating: 3, count: 2 },
    ],
    ...overrides,
  };
}

export function createReviewRequest(
  overrides: Partial<ReviewRequest> = {},
): ReviewRequest {
  requestCounter++;
  return {
    id: `rreq-${requestCounter}`,
    workspaceId: 'ws-1',
    customerId: 'cust-1',
    jobId: 'job-1',
    channel: 'email',
    status: 'pending',
    createdAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

export function createReviewRequestResponse(
  requests: ReviewRequest[] = [createReviewRequest()],
): ApiResponse<ReviewRequest[]> {
  return {
    data: requests,
    meta: { total: requests.length, page: 1, perPage: 25 },
  };
}

export function resetReviewCounters(): void {
  reviewCounter = 0;
  requestCounter = 0;
}
