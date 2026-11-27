import { z } from 'zod';
import {
  AddressObjectSchema,
  ContactObjectSchema,
  flattenContactAndAddress,
} from './contact-address';

const preferredContact = z.enum(['email', 'phone', 'text']);
const consentMethod = z.enum(['form', 'verbal', 'email']);

// New customer posts BOTH nested objects — contact and the service address —
// so this schema lost seven fields per save, not three. See
// ./contact-address.ts.
export const CreateCustomerSchema = z
  .object({
    contact: ContactObjectSchema,
    address: AddressObjectSchema,
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    company: z.string().max(200).nullable().optional().default(null),
    email: z.string().email().max(255).optional().default(''),
    phone: z.string().max(20).optional().default(''),
    preferredContact: preferredContact.optional().default('phone'),
    street: z.string().max(255).optional().default(''),
    city: z.string().max(100).optional().default(''),
    state: z.string().max(50).optional().default(''),
    zip: z.string().max(20).optional().default(''),
    notes: z.string().max(5000).optional().default(''),
    consentGivenAt: z.string().datetime().nullable().optional().default(null),
    consentMethod: consentMethod.nullable().optional().default(null),
  })
  .transform(flattenContactAndAddress);

export const UpdateCustomerSchema = z
  .object({
    contact: ContactObjectSchema,
    address: AddressObjectSchema,
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    company: z.string().max(200).nullable(),
    email: z.string().email().max(255),
    phone: z.string().max(20),
    preferredContact: preferredContact,
    street: z.string().max(255),
    city: z.string().max(100),
    state: z.string().max(50),
    zip: z.string().max(20),
    notes: z.string().max(5000),
    consentGivenAt: z.string().datetime().nullable(),
    consentMethod: consentMethod.nullable(),
  })
  .partial()
  .transform(flattenContactAndAddress)
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
