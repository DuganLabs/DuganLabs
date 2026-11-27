import { z } from 'zod';

const campaignStatus = z.enum(['draft', 'active', 'paused', 'completed']);
const campaignChannel = z.enum([
  'email',
  'sms',
  'postcard',
  'social',
  'google',
]);

export const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  channel: campaignChannel,
  startDate: z.string().datetime(),
  status: campaignStatus.optional().default('draft'),
  targetArea: z.string().max(200).nullable().optional().default(null),
  budget: z.number().nonnegative().nullable().optional().default(null),
  spent: z.number().nonnegative().optional().default(0),
  endDate: z.string().datetime().nullable().optional().default(null),
  notes: z.string().max(5000).optional().default(''),
});

export const UpdateCampaignSchema = z
  .object({
    name: z.string().min(1).max(200),
    status: campaignStatus,
    channel: campaignChannel,
    targetArea: z.string().max(200).nullable(),
    budget: z.number().nonnegative().nullable(),
    spent: z.number().nonnegative(),
    leadsGenerated: z.number().int().nonnegative(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().nullable(),
    notes: z.string().max(5000),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;
