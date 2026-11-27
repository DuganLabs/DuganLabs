import { z } from 'zod';

export const CreateUserWorkspaceSchema = z.object({
  name: z.string().min(1, 'Workspace name is required').max(255).trim(),
  trade: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
});

export const SwitchWorkspaceSchema = z.object({
  workspaceId: z.string().uuid('workspaceId must be a valid UUID'),
});

export type CreateUserWorkspaceInput = z.infer<
  typeof CreateUserWorkspaceSchema
>;
export type SwitchWorkspaceInput = z.infer<typeof SwitchWorkspaceSchema>;
