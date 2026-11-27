import { z } from 'zod';

const inventoryTransactionType = z.enum([
  'purchase',
  'usage',
  'adjustment',
  'return',
]);

export const CreateInventoryItemSchema = z.object({
  name: z.string().min(1).max(255),
  sku: z.string().max(100).optional(),
  description: z.string().max(2000).optional().default(''),
  category: z.string().max(100).optional().default('general'),
  quantity: z.number().int().nonnegative().optional().default(0),
  minQuantity: z.number().int().nonnegative().optional().default(0),
  unitCost: z.number().nonnegative().optional().default(0),
  unitPrice: z.number().nonnegative().optional().default(0),
  supplier: z.string().max(255).optional().default(''),
  location: z.string().max(255).optional().default(''),
});

export const UpdateInventoryItemSchema = z
  .object({
    name: z.string().min(1).max(255),
    sku: z.string().max(100).nullable(),
    description: z.string().max(2000),
    category: z.string().max(100),
    quantity: z.number().int().nonnegative(),
    minQuantity: z.number().int().nonnegative(),
    unitCost: z.number().nonnegative(),
    unitPrice: z.number().nonnegative(),
    supplier: z.string().max(255),
    location: z.string().max(255),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const AdjustInventorySchema = z.object({
  type: inventoryTransactionType,
  quantity: z.number().int().positive(),
  jobId: z.string().uuid().nullable().optional(),
  unitCost: z.number().nonnegative().optional(),
  notes: z.string().max(2000).optional().default(''),
});

export type CreateInventoryItemInput = z.infer<
  typeof CreateInventoryItemSchema
>;
export type UpdateInventoryItemInput = z.infer<
  typeof UpdateInventoryItemSchema
>;
export type AdjustInventoryInput = z.infer<typeof AdjustInventorySchema>;
