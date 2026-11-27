import { z } from 'zod';

export const AdminSetupSchema = z.object({
  email: z.string().email('Valid email is required'),
  displayName: z.string().max(255).optional().default(''),
});

export type AdminSetupInput = z.infer<typeof AdminSetupSchema>;
