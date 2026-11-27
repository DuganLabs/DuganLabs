import { z } from 'zod';
import {
  AddressObjectSchema,
  ContactObjectSchema,
  flattenContactAndAddress,
} from './contact-address';

const leadStatus = z.enum([
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'converted',
]);

const leadSource = z.enum([
  'website',
  'referral',
  'campaign',
  'manual',
  'google',
  'nextdoor',
  'other',
]);

const preferredContact = z.enum(['email', 'phone', 'text']);

// The nested `contact` / `address` objects the platform's New lead panel
// actually posts, folded onto the flat keys the handler binds. See
// ./contact-address.ts for why the fix is here and not in the panel.
export const CreateLeadSchema = z
  .object({
    contact: ContactObjectSchema,
    address: AddressObjectSchema,
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email().max(255).optional().default(''),
    phone: z.string().max(20).optional().default(''),
    preferredContact: preferredContact.optional().default('phone'),
    street: z.string().max(255).optional().default(''),
    city: z.string().max(100).optional().default(''),
    state: z.string().max(50).optional().default(''),
    zip: z.string().max(20).optional().default(''),
    status: leadStatus.optional().default('new'),
    source: leadSource.optional().default('manual'),
    campaignId: z.string().uuid().nullable().optional().default(null),
    serviceType: z.string().max(100).optional().default(''),
    estimatedValue: z
      .number()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    notes: z.string().max(5000).optional().default(''),
  })
  .transform(flattenContactAndAddress);

export const UpdateLeadSchema = z
  .object({
    contact: ContactObjectSchema,
    address: AddressObjectSchema,
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email().max(255),
    phone: z.string().max(20),
    preferredContact: preferredContact,
    street: z.string().max(255),
    city: z.string().max(100),
    state: z.string().max(50),
    zip: z.string().max(20),
    status: leadStatus,
    source: leadSource,
    campaignId: z.string().uuid().nullable(),
    serviceType: z.string().max(100),
    estimatedValue: z.number().nonnegative().nullable(),
    notes: z.string().max(5000),
  })
  .partial()
  // Flatten BEFORE the emptiness check, so a PATCH carrying only
  // `contact: { phone }` counts as a field rather than reading as empty.
  .transform(flattenContactAndAddress)
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

// The closed set on leads.withdrawn_reason (GP-105) — LEAD_WITHDRAWN_REASONS
// in libs/shared/models, repeated here the way leadStatus is above. The
// column carries no CHECK on a migrated database (ALTER TABLE cannot add
// one), so this schema is the enforcement point for the staff route; the
// tenant site's cancel form checks the same set. The body is optional
// altogether: the platform's Withdraw dialog may send none.
const withdrawnReason = z.enum([
  'schedule_no_longer_works',
  'chose_another_provider',
  'no_longer_needed',
  'other',
]);

export const WithdrawLeadSchema = z.object({
  reason: withdrawnReason.optional(),
});

export const ConvertLeadSchema = z.object({
  title: z.string().max(255).optional(),
  value: z.number().nonnegative().optional(),
});

export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;
export type ConvertLeadInput = z.infer<typeof ConvertLeadSchema>;
export type WithdrawLeadInput = z.infer<typeof WithdrawLeadSchema>;
