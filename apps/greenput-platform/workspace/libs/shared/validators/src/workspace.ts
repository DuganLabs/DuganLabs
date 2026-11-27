import { z } from 'zod';

const userRole = z.enum(['owner', 'admin', 'tech', 'office']);

// `address` is the shape `Workspace` declares (libs/shared/models), and the
// settings form has always sent it nested. This schema only accepted the four
// flat keys, so zod dropped the object silently and a contractor's address was
// never saved. Both forms are accepted now — nested is the contract, flat is
// what an API-key caller may already be sending — and apps/api flattens.
const addressShape = z
  .object({
    street: z.string().max(255),
    city: z.string().max(100),
    state: z.string().max(50),
    zip: z.string().max(20),
  })
  .partial();

export const UpdateWorkspaceSchema = z
  .object({
    name: z.string().min(1).max(200),
    trade: z.string().max(100),
    phone: z.string().max(20),
    email: z.string().email().max(255),
    street: z.string().max(255),
    city: z.string().max(100),
    state: z.string().max(50),
    zip: z.string().max(20),
    address: addressShape,
    licenseNumber: z.string().max(50).nullable(),
    logoUrl: z.string().url().max(500).nullable(),
    // GP-039: editable from Settings → Company. `null` clears the area or
    // radius; `serviceTypes` replaces the whole list.
    serviceArea: z.string().max(200).nullable(),
    serviceRadiusMiles: z.number().int().min(1).max(500).nullable(),
    serviceTypes: z.array(z.string().min(1).max(100)).max(50),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const InviteUserSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255),
  role: userRole.optional().default('tech'),
  password: z.string().min(8).max(128).optional(),
});

export const UpdateUserRoleSchema = z.object({
  role: userRole,
});

export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;
export type InviteUserInput = z.infer<typeof InviteUserSchema>;
export type UpdateUserRoleInput = z.infer<typeof UpdateUserRoleSchema>;
