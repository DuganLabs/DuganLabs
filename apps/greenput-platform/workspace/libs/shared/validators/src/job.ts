import { z } from 'zod';
import {
  AddressObjectSchema,
  flattenContactAndAddress,
} from './contact-address';

const jobStatus = z.enum([
  'scheduled',
  'in_progress',
  'completed',
  'invoiced',
  'paid',
  'cancelled',
]);

export const LineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().nonnegative().default(0),
});

// Jobs carry an address and no contact. The address the New job panel posts is
// the one the dashboard run sheet prints, so losing it blanks the only line
// telling a technician where to go. See ./contact-address.ts.
export const CreateJobSchema = z
  .object({
    address: AddressObjectSchema,
    title: z.string().min(1).max(255),
    opportunityId: z.string().uuid(),
    customerId: z.string().uuid(),
    status: jobStatus.optional().default('scheduled'),
    street: z.string().max(255).optional().default(''),
    city: z.string().max(100).optional().default(''),
    state: z.string().max(50).optional().default(''),
    zip: z.string().max(20).optional().default(''),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
    total: z.number().nonnegative().optional().default(0),
    notes: z.string().max(5000).optional().default(''),
    lineItems: z.array(LineItemSchema).optional().default([]),
    // The technician doing the work (GP-034). Optional: a job can be booked
    // before anyone is picked. The route checks the id is a user in this
    // workspace with an assignable role — a schema cannot.
    assignedTo: z.string().uuid().optional(),
  })
  .transform(flattenContactAndAddress);

export const UpdateJobSchema = z
  .object({
    address: AddressObjectSchema,
    title: z.string().min(1).max(255),
    status: jobStatus,
    street: z.string().max(255),
    city: z.string().max(100),
    state: z.string().max(50),
    zip: z.string().max(20),
    scheduledStart: z.string().datetime(),
    scheduledEnd: z.string().datetime(),
    actualStart: z.string().datetime().nullable(),
    actualEnd: z.string().datetime().nullable(),
    total: z.number().nonnegative(),
    notes: z.string().max(5000),
    invoicedAt: z.string().datetime().nullable(),
    paidAt: z.string().datetime().nullable(),
    lineItems: z.array(LineItemSchema),
    // `null` unassigns; absent leaves the assignee alone (GP-034).
    assignedTo: z.string().uuid().nullable(),
  })
  .partial()
  .transform(flattenContactAndAddress)
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type UpdateJobInput = z.infer<typeof UpdateJobSchema>;
