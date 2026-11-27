import { z } from 'zod';

const estimateStatus = z.enum([
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
]);

// The same two words as ESTIMATE_LINE_ITEM_TYPES in libs/shared/models.
// Defaulted so the API callers that predate the field keep working; the
// platform editor always sends it (GP-038).
const estimateLineItemType = z.enum(['labor', 'material']);

const estimateLineItem = z.object({
  type: estimateLineItemType.default('labor'),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().nonnegative().default(0),
});

export const CreateEstimateSchema = z.object({
  title: z.string().min(1).max(255),
  opportunityId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional().default(''),
  validUntil: z.string().datetime().optional(),
  taxRate: z.number().min(0).max(100).optional().default(0),
  lineItems: z.array(estimateLineItem).optional().default([]),
});

export const UpdateEstimateSchema = z
  .object({
    title: z.string().min(1).max(255),
    status: estimateStatus,
    customerId: z.string().uuid().nullable(),
    notes: z.string().max(5000),
    validUntil: z.string().datetime().nullable(),
    taxRate: z.number().min(0).max(100),
    lineItems: z.array(estimateLineItem),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type CreateEstimateInput = z.infer<typeof CreateEstimateSchema>;
export type UpdateEstimateInput = z.infer<typeof UpdateEstimateSchema>;
