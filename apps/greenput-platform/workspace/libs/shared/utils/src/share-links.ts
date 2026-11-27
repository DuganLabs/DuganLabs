import type { ShareLink } from '@greenput/shared/models';

/**
 * The links a contractor sends THEMSELVES (GP-008).
 *
 * Nothing in this product delivers mail or SMS yet, so "Mark invoiced",
 * "Mark sent" and "Invite teammate" each hand back a public URL and a message
 * with the URL in it, for the contractor to paste into whatever they already
 * use. This module is the ONE place those URLs are shaped: apps/api builds
 * them into the action's response, apps/platform builds the same ones for a
 * row that was actioned earlier, and apps/tenant-site matches the paths when
 * a homeowner opens one. Rename a path here and all three move together;
 * rename it in one of them and the others' tests fail.
 */

/** Path of the public invoice page on a tenant site, followed by the token. */
export const INVOICE_PATH = '/invoice/';
/**
 * Path prefix of the removed booking-deposit confirmation page on a
 * tenant site (WS-0, PRD v1.5). The deposit model was revoked on
 * 2026-10-20 ("No deposit at booking. Ever."), the page is gone, and
 * no share link may point a homeowner at it. The constant remains so
 * the tenant Worker can recognise an old /deposit/<token> link and
 * answer it with a plain not-found instead of a deposit surface, and
 * so robots rules can keep the prefix disallowed.
 */
export const DEPOSIT_PATH = '/deposit/';
/** Path of the public proposal page on a tenant site, followed by the estimate id. */
export const PROPOSAL_PATH = '/proposal/';
/** Path of the instant-price form on a tenant site. */
export const QUOTE_PATH = '/quote';

const DOCUMENT_ROOTS = [QUOTE_PATH, '/proposal', '/invoice'] as const;

/** Quote, proposal, and invoice pages. They belong to a contractor's site. */
export function isPublicDocumentPath(pathname: string): boolean {
  const path =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;
  return DOCUMENT_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

/**
 * Where the signed-in app should send a document URL. The apex resolves
 * which contractor owns it; this only leaves `app.` so the page is not the
 * platform's own 404.
 */
export function appDocumentHref(
  hostname: string,
  pathname: string,
  search = '',
): string | null {
  if (!isPublicDocumentPath(pathname)) return null;
  const domain = tenantDomainForHostname(hostname);
  if (hostname.toLowerCase() !== `app.${domain}`) return null;
  const query = search && !search.startsWith('?') ? `?${search}` : search;
  return `https://${domain}${pathname}${query}`;
}

/** The reference micro-site, when a document has no owning workspace. */
export function referenceTenantOrigin(hostname: string): string {
  return `https://demo.${tenantDomainForHostname(hostname)}`;
}
/** Path of the accept-invite screen on the platform, followed by the token. */
export const ACCEPT_INVITE_PATH = '/accept-invite/';

/** Which registrable domain the tenant micro-sites hang off. */
export type TenantDomain = 'greenput.com' | 'greenput.site';

/**
 * The tenant domain for a Worker's `ENVIRONMENT` var: staging sites are
 * `<slug>.greenput.site`; everything else — production, development, preview
 * — builds a production URL, because that is the only one a homeowner can
 * open. (Preview tenants are reached by `?slug=` on a workers.dev host, which
 * is not a link to hand a customer.)
 */
export function tenantDomainForEnvironment(
  environment: string | null | undefined,
): TenantDomain {
  return environment === 'staging' ? 'greenput.site' : 'greenput.com';
}

/** The same decision from the hostname the platform SPA is served on. */
export function tenantDomainForHostname(hostname: string): TenantDomain {
  return hostname === 'greenput.site' || hostname.endsWith('.greenput.site')
    ? 'greenput.site'
    : 'greenput.com';
}

/**
 * The three workspace facts a public origin depends on. Named the way the
 * wire model spells them; a caller holding a D1 row maps `slug`,
 * `custom_hostname`, `custom_domain_status` onto them.
 */
export interface PublicSiteSource {
  slug?: string | null;
  customHostname?: string | null;
  customDomainStatus?: string | null;
}

/**
 * The public origin of a workspace's site: its custom domain once Cloudflare
 * has activated it, otherwise `<slug>.<domain>`. Null when the workspace has
 * no slug — five live rows carry NULL — because there is then no address at
 * all, and a URL built on `null.greenput.com` would be a lie with a
 * hostname in it. Mirrors `tenantOriginFor` in apps/tenant-site/src/render.ts,
 * which decides canonical URLs from the same three columns.
 */
export function publicSiteOrigin(
  workspace: PublicSiteSource,
  domain: TenantDomain,
): string | null {
  if (workspace.customDomainStatus === 'active' && workspace.customHostname) {
    return `https://${workspace.customHostname}`;
  }
  if (!workspace.slug) return null;
  return `https://${workspace.slug}.${domain}`;
}

export interface InvoiceShareContext {
  businessName: string;
  customerFirstName?: string | null;
  jobTitle?: string | null;
}

export function invoiceShareLink(
  origin: string,
  token: string,
  ctx: InvoiceShareContext,
): ShareLink {
  const url = `${origin}${INVOICE_PATH}${token}`;
  const forWhat = ctx.jobTitle ? ` for ${ctx.jobTitle}` : '';
  return {
    url,
    message: `${greeting(ctx.customerFirstName)}here is your invoice from ${ctx.businessName}${forWhat}. You can view or print it here: ${url}`,
  };
}

// WS-0 (PRD v1.5, FR-0.2): the deposit share link that used to live
// here — an SMS telling the homeowner to "add your card for the
// refundable deposit" at /deposit/<token> — is removed. The deposit
// model was revoked on 2026-10-20, so no outbound message may carry a
// deposit link or deposit copy. Do not re-add a builder like it
// without a new settled model.

export interface ProposalShareContext {
  businessName: string;
  customerFirstName?: string | null;
  title?: string | null;
}

export function proposalShareLink(
  origin: string,
  estimateId: string,
  ctx: ProposalShareContext,
): ShareLink {
  const url = `${origin}${PROPOSAL_PATH}${estimateId}`;
  const forWhat = ctx.title ? ` for ${ctx.title}` : '';
  return {
    url,
    message: `${greeting(ctx.customerFirstName)}here is your quote from ${ctx.businessName}${forWhat}: ${url}`,
  };
}

export interface InviteShareContext {
  businessName: string;
  inviteeFirstName: string;
  /** ISO timestamp the invitation stops working. */
  expiresAt: string;
}

export function inviteShareLink(
  appOrigin: string,
  token: string,
  ctx: InviteShareContext,
): ShareLink {
  const url = `${appOrigin}${ACCEPT_INVITE_PATH}${token}`;
  return {
    url,
    message: `${greeting(ctx.inviteeFirstName)}you have been invited to join ${ctx.businessName} on Greenput. Open this link to create your passkey and sign in: ${url} — it works once and expires on ${expiryDate(ctx.expiresAt)}.`,
    expiresAt: ctx.expiresAt,
  };
}

function greeting(firstName: string | null | undefined): string {
  return firstName ? `Hi ${firstName}, ` : '';
}

function expiryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
