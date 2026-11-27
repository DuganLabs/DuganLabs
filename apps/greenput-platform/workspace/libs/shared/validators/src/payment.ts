import { z } from 'zod';

export const StripeConnectLinkSchema = z.object({
  refreshUrl: z.string().url().optional(),
  returnUrl: z.string().url().optional(),
});

export const CreatePaymentIntentSchema = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
  amount: z.number().positive('amount must be a positive number'),
  currency: z.string().length(3).optional().default('usd'),
  description: z.string().max(500).optional(),
});

export const CreateDepositSchema = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
});

export const CustomerPortalMagicLinkSchema = z.object({
  email: z.string().email('Valid email is required'),
});

export type StripeConnectLinkInput = z.infer<typeof StripeConnectLinkSchema>;
export type CreatePaymentIntentInput = z.infer<
  typeof CreatePaymentIntentSchema
>;
export type CreateDepositInput = z.infer<typeof CreateDepositSchema>;
export type CustomerPortalMagicLinkInput = z.infer<
  typeof CustomerPortalMagicLinkSchema
>;
