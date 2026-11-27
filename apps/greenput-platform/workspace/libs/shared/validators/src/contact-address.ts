import { z } from 'zod';

/**
 * The write side of the wire contract's nested shapes.
 *
 * `libs/shared/models` defines an entity ONCE, nested and camelCase — a Lead
 * has `contact: ContactInfo` and `address?: Address` (CLAUDE.md §5.0). Every
 * reader parses that shape, `apps/platform`'s API client methods are typed
 * `create(payload: Partial<Lead>)`, and the three create panels accordingly
 * post `contact: { email, phone, preferredContact }`.
 *
 * The create/update validators were flat: `email`, `phone`, `street` … each
 * `.optional().default('')`. A plain `z.object()` STRIPS unknown keys, so
 * `contact` and `address` were discarded in silence, every flat field fell to
 * its default, and the handler wrote empty strings and answered 201. A
 * contractor typed an email and a phone number into New lead and the row
 * landed blank — with no error, and, because nothing in the product can edit a
 * record yet, no way to put it back.
 *
 * The fix is here rather than in the three panels. Flattening the clients to
 * match the schemas would put the write shape permanently out of step with the
 * read shape and with `Partial<Lead>`, and §5.0 makes the nested model the one
 * definition of an entity.
 *
 * Flat keys are still ACCEPTED. `POST /api/leads` is a documented endpoint
 * reachable with an API key, and a third-party caller may already be sending
 * flat; breaking them to fix ourselves would trade one silent failure for a
 * loud one. Nested wins where both are present.
 *
 * Deliberately NOT `.strict()`. Rejecting unknown keys would turn today's
 * silent loss into a 400 on every save from the current client — a different
 * outage, shipped the same day.
 */

export const preferredContactEnum = z.enum(['email', 'phone', 'text']);

/** `ContactInfo` from the read model, every field optional on a write. */
export const ContactObjectSchema = z
  .object({
    email: z.string().email().max(255).optional(),
    phone: z.string().max(20).optional(),
    preferredContact: preferredContactEnum.optional(),
  })
  .optional();

/** `Address` from the read model, every field optional on a write. */
export const AddressObjectSchema = z
  .object({
    street: z.string().max(255).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(50).optional(),
    zip: z.string().max(20).optional(),
  })
  .optional();

export interface NestedContactAndAddress {
  contact?: z.infer<typeof ContactObjectSchema>;
  address?: z.infer<typeof AddressObjectSchema>;
}

/**
 * Fold the nested objects down onto the flat keys the route handlers bind,
 * so no handler and no SQL statement changes.
 *
 * Only keys the caller actually sent are copied: `contact: { email }` must not
 * blank out a `phone` that arrived flat, and on a PATCH — where the absence of
 * a key means "leave it alone" — writing `undefined` over it would be the same
 * data loss in a new place.
 */
export function flattenContactAndAddress<T extends NestedContactAndAddress>(
  value: T,
): Omit<T, 'contact' | 'address'> {
  const { contact, address, ...flat } = value;
  const out: Record<string, unknown> = { ...flat };

  if (contact?.email !== undefined) out['email'] = contact.email;
  if (contact?.phone !== undefined) out['phone'] = contact.phone;
  if (contact?.preferredContact !== undefined) {
    out['preferredContact'] = contact.preferredContact;
  }

  if (address?.street !== undefined) out['street'] = address.street;
  if (address?.city !== undefined) out['city'] = address.city;
  if (address?.state !== undefined) out['state'] = address.state;
  if (address?.zip !== undefined) out['zip'] = address.zip;

  return out as Omit<T, 'contact' | 'address'>;
}
