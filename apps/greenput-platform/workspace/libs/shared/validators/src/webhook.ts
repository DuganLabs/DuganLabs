import { z } from 'zod';

export const CreateWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z
    .array(z.string().min(1).max(100))
    .min(1, 'At least one event is required'),
});

export const UpdateWebhookSchema = z
  .object({
    url: z.string().url().max(2048),
    events: z.array(z.string().min(1).max(100)).min(1),
    active: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type CreateWebhookInput = z.infer<typeof CreateWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookSchema>;
