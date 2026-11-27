import { z } from 'zod';

const VALID_SCOPES = [
  'read',
  'write',
  'leads',
  'jobs',
  'customers',
  'campaigns',
] as const;

const scopeEnum = z.enum(VALID_SCOPES);

export const CreateApiKeySchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer')
    .trim(),
  scopes: z
    .array(scopeEnum)
    .min(1, 'At least one scope is required')
    .optional()
    .default(['read']),
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be an ISO 8601 date string' })
    .refine((val) => new Date(val) > new Date(), {
      message: 'expiresAt must be in the future',
    })
    .optional(),
});

export const UpdateApiKeySchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name cannot be empty')
      .max(100, 'Name must be 100 characters or fewer')
      .trim()
      .optional(),
    scopes: z
      .array(scopeEnum)
      .min(1, 'At least one scope is required')
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.scopes !== undefined, {
    message: 'At least one field must be provided',
  });

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
export type UpdateApiKeyInput = z.infer<typeof UpdateApiKeySchema>;
