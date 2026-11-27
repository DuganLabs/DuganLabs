import type { ApiClient } from '@basenative/fetch';
import type {
  ApiResponse,
  Review,
  ReviewRequest,
  ReviewRequestChannel,
  ReviewStats,
} from '@greenput/shared/models';

export type ReviewListParams = {
  page?: number;
  perPage?: number;
  platform?: string;
  rating?: number;
};

export interface ReviewsApi {
  list(params?: ReviewListParams): Promise<ApiResponse<Review[]>>;
  stats(): Promise<{ data: ReviewStats }>;
  respond(id: string, responseText: string): Promise<{ data: Review }>;
  listRequests(): Promise<ApiResponse<ReviewRequest[]>>;
  /**
   * Record a review request. Greenput sends nothing (GP-008: links, not
   * sending); the row comes back `pending` and the contractor sends the
   * message themselves. `channel` is how they say they will send it.
   */
  request(
    customerId: string,
    jobId: string,
    channel: ReviewRequestChannel,
  ): Promise<{ data: ReviewRequest }>;
}

export function createReviewsApi(api: ApiClient): ReviewsApi {
  return {
    list: (params = {}) => api.get('/api/reviews', params),
    stats: () => api.get('/api/reviews/stats'),
    respond: (id, responseText) =>
      api.patch(`/api/reviews/${id}`, { responseText, responded: true }),
    listRequests: () => api.get('/api/reviews/requests'),
    request: (customerId, jobId, channel) =>
      api.post('/api/reviews/requests', { customerId, jobId, channel }),
  };
}
