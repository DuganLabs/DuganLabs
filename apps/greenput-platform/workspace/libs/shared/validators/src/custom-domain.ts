import { z } from 'zod';

// Loose hostname check: labels of letters/digits/hyphens (no leading/trailing
// hyphen), at least one dot, ASCII only. This is deliberately permissive —
// Cloudflare's own validation (and DNS itself) is the real gate; this just
// keeps obviously-wrong input (protocols, paths, ports, unicode homoglyphs)
// out of the database and out of the Cloudflare API call.
const HOSTNAME_PATTERN =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export const RequestCustomDomainSchema = z.object({
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .min(4)
    .max(255)
    .regex(
      HOSTNAME_PATTERN,
      'Enter a bare domain or subdomain, e.g. www.example.com (no https://, no path)',
    )
    .refine(
      (h) => !h.endsWith('.greenput.com') && !h.endsWith('.greenput.site'),
      'This is already a Greenput-owned domain',
    ),
});

export type RequestCustomDomainInput = z.infer<
  typeof RequestCustomDomainSchema
>;
