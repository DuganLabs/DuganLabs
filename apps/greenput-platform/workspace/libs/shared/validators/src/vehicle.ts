import { z } from 'zod';

const vehicleStatus = z.enum(['active', 'inactive', 'maintenance']);

export const CreateVehicleSchema = z.object({
  name: z.string().min(1).max(255),
  make: z.string().max(100).optional().default(''),
  model: z.string().max(100).optional().default(''),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .optional(),
  licensePlate: z.string().max(20).nullable().optional(),
  vin: z.string().max(17).nullable().optional(),
  status: vehicleStatus.optional().default('active'),
  mileage: z.number().int().nonnegative().optional().default(0),
  notes: z.string().max(2000).optional().default(''),
});

export const UpdateVehicleSchema = z
  .object({
    name: z.string().min(1).max(255),
    make: z.string().max(100),
    model: z.string().max(100),
    year: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1),
    licensePlate: z.string().max(20).nullable(),
    vin: z.string().max(17).nullable(),
    status: vehicleStatus,
    mileage: z.number().int().nonnegative(),
    notes: z.string().max(2000),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type CreateVehicleInput = z.infer<typeof CreateVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof UpdateVehicleSchema>;
