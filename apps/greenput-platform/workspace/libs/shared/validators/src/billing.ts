import { z } from 'zod';

export const SubscribeBillingSchema = z.object({
  priceId: z.string().min(1, 'priceId is required'),
});

export const BillingPortalSchema = z.object({
  returnUrl: z.string().url('returnUrl must be a valid URL').optional(),
});

/** Settings → Billing. Top-up is a Stripe charge, so it stays in cents. */
export const UpdateUsageBalanceSchema = z
  .object({
    topupCents: z
      .number()
      .int()
      .min(50, 'Top-up must be at least $0.50')
      .max(100_000, 'Top-up cannot exceed $1000'),
    thresholdCents: z.number().int().min(0, 'Threshold cannot be negative'),
  })
  .refine((value) => value.thresholdCents < value.topupCents, {
    message: 'Threshold must be less than the top-up amount',
    path: ['thresholdCents'],
  });

export type SubscribeBillingInput = z.infer<typeof SubscribeBillingSchema>;
export type BillingPortalInput = z.infer<typeof BillingPortalSchema>;
export type UpdateUsageBalanceInput = z.infer<typeof UpdateUsageBalanceSchema>;
