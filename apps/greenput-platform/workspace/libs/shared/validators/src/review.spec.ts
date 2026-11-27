import { describe, it, expect } from 'vitest';
import {
  CreateReviewSchema,
  UpdateReviewSchema,
  CreateReviewRequestSchema,
} from './review';

describe('CreateReviewSchema', () => {
  it('accepts valid review', () => {
    const result = CreateReviewSchema.safeParse({
      rating: 5,
      authorName: 'John Smith',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing rating', () => {
    const result = CreateReviewSchema.safeParse({ authorName: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects rating out of range', () => {
    expect(
      CreateReviewSchema.safeParse({ rating: 0, authorName: 'Test' }).success,
    ).toBe(false);
    expect(
      CreateReviewSchema.safeParse({ rating: 6, authorName: 'Test' }).success,
    ).toBe(false);
  });

  it('accepts boundary ratings 1 and 5', () => {
    expect(
      CreateReviewSchema.safeParse({ rating: 1, authorName: 'Test' }).success,
    ).toBe(true);
    expect(
      CreateReviewSchema.safeParse({ rating: 5, authorName: 'Test' }).success,
    ).toBe(true);
  });

  it('defaults platform to internal', () => {
    const result = CreateReviewSchema.safeParse({
      rating: 4,
      authorName: 'Test',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.platform).toBe('internal');
  });

  it('accepts all valid platforms', () => {
    for (const platform of [
      'internal',
      'google',
      'yelp',
      'nextdoor',
      'facebook',
    ]) {
      expect(
        CreateReviewSchema.safeParse({
          rating: 5,
          authorName: 'Test',
          platform,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects invalid platform', () => {
    expect(
      CreateReviewSchema.safeParse({
        rating: 5,
        authorName: 'Test',
        platform: 'twitter',
      }).success,
    ).toBe(false);
  });

  it('accepts null reviewUrl', () => {
    expect(
      CreateReviewSchema.safeParse({
        rating: 5,
        authorName: 'Test',
        reviewUrl: null,
      }).success,
    ).toBe(true);
  });

  it('accepts valid reviewUrl', () => {
    expect(
      CreateReviewSchema.safeParse({
        rating: 5,
        authorName: 'Test',
        reviewUrl: 'https://g.co/review/123',
      }).success,
    ).toBe(true);
  });

  it('rejects non-integer rating', () => {
    expect(
      CreateReviewSchema.safeParse({ rating: 4.5, authorName: 'Test' }).success,
    ).toBe(false);
  });

  it('rejects empty authorName', () => {
    expect(
      CreateReviewSchema.safeParse({ rating: 5, authorName: '' }).success,
    ).toBe(false);
  });
});

describe('UpdateReviewSchema', () => {
  it('rejects empty object', () => {
    const result = UpdateReviewSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts response fields', () => {
    const result = UpdateReviewSchema.safeParse({
      responded: true,
      responseText: 'Thank you!',
    });
    expect(result.success).toBe(true);
  });

  it('accepts updating rating alone', () => {
    expect(UpdateReviewSchema.safeParse({ rating: 3 }).success).toBe(true);
  });

  it('rejects invalid rating on update', () => {
    expect(UpdateReviewSchema.safeParse({ rating: 0 }).success).toBe(false);
  });

  it('accepts null responseText', () => {
    expect(UpdateReviewSchema.safeParse({ responseText: null }).success).toBe(
      true,
    );
  });

  it('rejects invalid platform on update', () => {
    expect(UpdateReviewSchema.safeParse({ platform: 'twitter' }).success).toBe(
      false,
    );
  });

  it('accepts valid platform on update', () => {
    expect(UpdateReviewSchema.safeParse({ platform: 'google' }).success).toBe(
      true,
    );
  });
});

describe('CreateReviewRequestSchema', () => {
  it('requires all fields', () => {
    const result = CreateReviewRequestSchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      jobId: '550e8400-e29b-41d4-a716-446655440001',
      channel: 'email',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing channel', () => {
    const result = CreateReviewRequestSchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      jobId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(result.success).toBe(false);
  });

  it('accepts sms channel', () => {
    expect(
      CreateReviewRequestSchema.safeParse({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        jobId: '550e8400-e29b-41d4-a716-446655440001',
        channel: 'sms',
      }).success,
    ).toBe(true);
  });

  it('rejects invalid channel', () => {
    expect(
      CreateReviewRequestSchema.safeParse({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        jobId: '550e8400-e29b-41d4-a716-446655440001',
        channel: 'push',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid customerId UUID', () => {
    expect(
      CreateReviewRequestSchema.safeParse({
        customerId: 'not-a-uuid',
        jobId: '550e8400-e29b-41d4-a716-446655440001',
        channel: 'email',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid jobId UUID', () => {
    expect(
      CreateReviewRequestSchema.safeParse({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        jobId: 'bad-id',
        channel: 'email',
      }).success,
    ).toBe(false);
  });
});
