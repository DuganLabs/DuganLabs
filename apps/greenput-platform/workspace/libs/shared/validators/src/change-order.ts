import { z } from 'zod';

// A change order's lines use the estimate line shape, with two differences:
// amounts must be whole cents, and a negative unitPrice is allowed (a credit).
const changeOrderLineItem = z.object({
  type: z.enum(['labor', 'material']).default('labor'),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().int(),
});

export const CreateChangeOrderSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    estimateId: z.string().uuid().optional(),
    title: z.string().min(1).max(255),
    reason: z.string().max(2000).optional().default(''),
    lineItems: z.array(changeOrderLineItem).min(1).max(100),
  })
  .refine((d) => (d.jobId === undefined) !== (d.estimateId === undefined), {
    message: 'Exactly one of jobId or estimateId is required',
    path: ['jobId'],
  });

export const DecideChangeOrderSchema = z.object({
  note: z.string().max(2000).optional().default(''),
});

export type CreateChangeOrderInput = z.infer<typeof CreateChangeOrderSchema>;
export type DecideChangeOrderInput = z.infer<typeof DecideChangeOrderSchema>;
