import { z } from 'zod';

/** `#rrggbb`, six hex digits — what `branding.*_color` hold. */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color');
const hexColor = HexColorSchema;

export const UpdateBrandingSchema = z
  .object({
    logoUrl: z.string().url().nullable(),
    faviconUrl: z.string().url().nullable(),
    primaryColor: hexColor,
    secondaryColor: hexColor,
    accentColor: hexColor,
    fontFamily: z.string().min(1).max(200),
    customDomain: z.string().max(253).nullable(),
    emailFooter: z.string().max(5000),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateBrandingInput = z.infer<typeof UpdateBrandingSchema>;
