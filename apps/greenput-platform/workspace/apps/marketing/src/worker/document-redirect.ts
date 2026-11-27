/**
 * Quote, proposal, and invoice pages live on the contractor's site.
 * greenput.com and www do not render them; they send the visitor to the
 * workspace that owns the document, or to the reference micro-site when
 * nothing does.
 */
import {
  isPublicDocumentPath,
  publicSiteOrigin,
  referenceTenantOrigin,
  tenantDomainForHostname,
  type PublicSiteSource,
} from '@greenput/shared/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OwnerRow {
  slug: string | null;
  custom_hostname: string | null;
  custom_domain_status: string | null;
}

interface QueryDb {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T>() => Promise<T | null>;
    };
  };
}

function asQueryDb(db: unknown): QueryDb | null {
  if (
    typeof db === 'object' &&
    db !== null &&
    'prepare' in db &&
    typeof (db as { prepare?: unknown }).prepare === 'function'
  ) {
    return db as QueryDb;
  }
  return null;
}

function ownerOf(row: OwnerRow | null): PublicSiteSource | null {
  if (!row?.slug) return null;
  return {
    slug: row.slug,
    customHostname: row.custom_hostname,
    customDomainStatus: row.custom_domain_status,
  };
}

async function lookupOwner(
  pathname: string,
  db: QueryDb | null,
): Promise<PublicSiteSource | null> {
  if (!db) return null;
  const proposal = /^\/proposal\/([^/]+)$/.exec(pathname);
  const invoice = /^\/invoice\/([^/]+)$/.exec(pathname);
  const session = /^\/quote\/s\/([^/]+)/.exec(pathname);
  const id = proposal?.[1] ?? invoice?.[1] ?? session?.[1];
  if (!id || !UUID.test(id)) return null;
  const sql = proposal
    ? `SELECT w.slug AS slug, w.custom_hostname AS custom_hostname,
              w.custom_domain_status AS custom_domain_status
       FROM estimates e
       JOIN workspaces w ON w.id = e.workspace_id
       WHERE e.id = ?
       LIMIT 1`
    : invoice
      ? `SELECT w.slug AS slug, w.custom_hostname AS custom_hostname,
                w.custom_domain_status AS custom_domain_status
         FROM jobs j
         JOIN workspaces w ON w.id = j.workspace_id
         WHERE j.invoice_token = ?
         LIMIT 1`
      : `SELECT w.slug AS slug, w.custom_hostname AS custom_hostname,
                w.custom_domain_status AS custom_domain_status
         FROM pricing_quote_sessions s
         JOIN workspaces w ON w.id = s.workspace_id
         WHERE s.id = ?
         LIMIT 1`;
  try {
    const row = await db.prepare(sql).bind(id).first<OwnerRow>();
    return ownerOf(row);
  } catch {
    return null;
  }
}

/** Absolute URL for a document path, or null when this path is not one. */
export async function documentLocation(
  hostname: string,
  pathname: string,
  search: string,
  db: unknown,
): Promise<string | null> {
  if (!isPublicDocumentPath(pathname)) return null;
  const domain = tenantDomainForHostname(hostname);
  const owner = await lookupOwner(pathname, asQueryDb(db));
  const origin =
    (owner ? publicSiteOrigin(owner, domain) : null) ??
    referenceTenantOrigin(hostname);
  const query = search && !search.startsWith('?') ? `?${search}` : search;
  return `${origin}${pathname}${query}`;
}
