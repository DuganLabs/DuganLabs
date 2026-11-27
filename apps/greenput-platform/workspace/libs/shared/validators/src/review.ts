import { z } from 'zod';

const reviewPlatform = z.enum([
  'internal',
  'google',
  'yelp',
  'nextdoor',
  'facebook',
]);

const reviewRequestChannel = z.enum(['email', 'sms']);

const reviewRequestStatus = z.enum([
  'pending',
  'sent',
  'completed',
  'declined',
]);

export const CreateReviewSchema = z.object({
  customerId: z.string().uuid().nullable().optional().default(null),
  jobId: z.string().uuid().nullable().optional().default(null),
  platform: reviewPlatform.optional().default('internal'),
  rating: z.number().int().min(1).max(5),
  content: z.string().max(5000).optional().default(''),
  authorName: z.string().min(1).max(200),
  reviewUrl: z.string().url().nullable().optional().default(null),
});

export const UpdateReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    content: z.string().max(5000),
    authorName: z.string().min(1).max(200),
    platform: reviewPlatform,
    reviewUrl: z.string().url().nullable(),
    responded: z.boolean(),
    responseText: z.string().max(5000).nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const CreateReviewRequestSchema = z.object({
  customerId: z.string().uuid(),
  jobId: z.string().uuid(),
  channel: reviewRequestChannel,
});

export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;
export type UpdateReviewInput = z.infer<typeof UpdateReviewSchema>;
export type CreateReviewRequestInput = z.infer<
  typeof CreateReviewRequestSchema
>;
