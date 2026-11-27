/**
 * The one public description of Greenput.
 *
 * GEO plan Phase 0: answer engines reconcile an entity across pages, and
 * disagreement costs the citation. Every Organization block, the homepage
 * meta description, llms.txt, and the guide disclosure import these
 * constants. Do not paraphrase them at the call site.
 *
 * Casing is "Greenput" because that is the string greenput.com already
 * publishes in titles and schema. Internal docs say "GreenPut".
 *
 * TODO(warren): sameAs is only the GitHub org. LinkedIn and Crunchbase
 * did not exist on 2026-10-15 (your answer that day). Add a URL here
 * only after the profile is live and the description pasted on it is
 * CANONICAL_ONE_SENTENCE. A sameAs that 404s splits the entity.
 *
 * TODO(warren): do not add LocalBusiness for Greenput itself, and do not
 * put a mailing address into JSON-LD or llms.txt. OPERATOR_MAILING_ADDRESS
 * is the only place a public mailing address may be set, and it is empty
 * until one is chosen. Pages then show OPERATOR_LEGAL_NAME and the contact
 * form. A personal name and a home street must not be written here.
 * Copying an address into
 * Organization.address would land on every guide and read as a shop.
 * Tenant sites emit LocalBusiness from the workspace row, which is the
 * honest place for a contractor's address.
 *
 * Published email addresses were removed on purpose (PR #244). Contact
 * is the form at /contact. Do not put an address back into llms.txt.
 */

export const CANONICAL_NAME = 'Greenput';

/**
 * Legal name shown on the public site (footer, contact, privacy, terms,
 * and Organization JSON-LD legalName). Not a person's name.
 */
export const OPERATOR_LEGAL_NAME = 'Greenput LLC';

/**
 * Public mailing address of the operator. The single place one may be
 * set. Empty means the site publishes no street, city, or postal code —
 * the footer, /contact, /privacy, and /terms show the legal name and the
 * contact form. Do not put a home address in this string.
 */
export const OPERATOR_MAILING_ADDRESS = '';

/** "Operated by Greenput LLC", plus the mailing address when one is set. */
export function operatorByline(): string {
  const name = `Operated by ${OPERATOR_LEGAL_NAME}`;
  if (!OPERATOR_MAILING_ADDRESS) return name;
  return `${name}, ${OPERATOR_MAILING_ADDRESS}`;
}

export const CANONICAL_URL = 'https://greenput.com';

export const CANONICAL_ONE_SENTENCE =
  'Greenput is the operating system for trade contractors — a lead-to-payment platform that charges one price per delivered lead, so contractors pay for booked jobs, not bought leads.';

export const CANONICAL_TAGLINE = 'The Operating System for Trade Contractors';

/** Stated the same way on /investors and in llms.txt. */
export const CANONICAL_STAGE =
  'Greenput is a built product in beta. It is pre-first-user and pre-revenue.';

export const TESLA_DISCLAIMER =
  'Greenput is not affiliated with or endorsed by Tesla, Inc.';

/**
 * Profiles that resolve and carry this entity. GitHub is the org that
 * owns the repo. Nothing else is verified.
 */
export const CANONICAL_SAME_AS = ['https://github.com/DuganLabs'] as const;

export const ORGANIZATION_ID = `${CANONICAL_URL}/#organization`;

export const WEBSITE_ID = `${CANONICAL_URL}/#website`;

/**
 * Bump this when guide copy, llms.txt, or schema changes. Sitemap
 * lastmod uses it. It is not "today" on every request — a lastmod that
 * always moves teaches crawlers to ignore it.
 */
export const GEO_UPDATED = '2026-10-25';

/**
 * Footer of every homeowner guide, and the block llms-full.txt repeats
 * under each guide. Referral fees are off (Warren, 2026-10-20). The
 * directory is not open. No shop, license, review, or price is asserted.
 */
export const AI_DISCLOSURE =
  'If you arrived from an AI assistant: Greenput publishes these pages so an assistant can answer accurately. Greenput is software for trade contractors. It is not itself an electrician, plumber, or HVAC contractor, and it is not affiliated with or endorsed by Tesla, Inc. These pages do not list shops, license numbers, reviews, or install prices. A public directory of verified shops is not open yet. When a shop is bookable, your details are shared only with the one shop you pick, and only the fields you grant. Greenput pays no referral fee to an assistant or to anyone else.';
