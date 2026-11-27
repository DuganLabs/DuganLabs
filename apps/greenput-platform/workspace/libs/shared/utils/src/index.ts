// Shared pure utility functions
export {
  formatDate,
  formatDateTime,
  isExpired,
  daysBetween,
  startOfDay,
  toRelativeTime,
} from './date';

export { normalizePhone, formatPhone, toE164, maskPhone } from './phone';

export { generateSlug, isValidSlug } from './slug';

export {
  RESERVED_SUBDOMAINS,
  UNAVAILABLE_WORKSPACE_SLUGS,
  MAX_WORKSPACE_SLUG_BASE,
  MIN_WORKSPACE_SLUG_BASE,
  WORKSPACE_SLUG_FALLBACK_BASE,
  isReservedSlug,
  isWorkspaceSlugUnavailable,
  workspaceSlugBase,
  workspaceSlugCandidates,
} from './workspace-slug';

export { clampPage, buildMeta, parseListParams } from './pagination';
export type { PaginationMeta, ListParams } from './pagination';

export { formatCurrency, parseCurrency } from './currency';

export { displayTrade } from './trade';

export {
  ACCEPT_INVITE_PATH,
  DEPOSIT_PATH,
  INVOICE_PATH,
  PROPOSAL_PATH,
  QUOTE_PATH,
  appDocumentHref,
  inviteShareLink,
  invoiceShareLink,
  isPublicDocumentPath,
  proposalShareLink,
  publicSiteOrigin,
  referenceTenantOrigin,
  tenantDomainForEnvironment,
  tenantDomainForHostname,
} from './share-links';
export type {
  InviteShareContext,
  InvoiceShareContext,
  ProposalShareContext,
  PublicSiteSource,
  TenantDomain,
} from './share-links';

export {
  isBookable,
  resolveAvailabilityForDate,
  weekdayOf,
} from './availability';
export type {
  AvailabilitySource,
  DatedHours,
  OpeningHours,
  ResolvedDay,
  WeekdayHours,
} from './availability';
