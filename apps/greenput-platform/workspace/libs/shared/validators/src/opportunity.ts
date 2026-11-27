import { z } from 'zod';

const opportunityStatus = z.enum([
  'open',
  'proposal_sent',
  'negotiating',
  'won',
  'lost',
]);

export const CreateOpportunitySchema = z.object({
  title: z.string().min(1).max(255),
  leadId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional().default(null),
  status: opportunityStatus.optional().default('open'),
  value: z.number().nonnegative().optional().default(0),
  serviceType: z.string().max(100).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
});

export const UpdateOpportunitySchema = z
  .object({
    title: z.string().min(1).max(255),
    status: opportunityStatus,
    value: z.number().nonnegative(),
    serviceType: z.string().max(100),
    notes: z.string().max(5000),
    customerId: z.string().uuid().nullable(),
    proposalSentAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime().nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const ConvertOpportunitySchema = z.object({
  title: z.string().max(255).optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  notes: z.string().max(5000).optional(),
});

export type CreateOpportunityInput = z.infer<typeof CreateOpportunitySchema>;
export type UpdateOpportunityInput = z.infer<typeof UpdateOpportunitySchema>;
export type ConvertOpportunityInput = z.infer<typeof ConvertOpportunitySchema>;
