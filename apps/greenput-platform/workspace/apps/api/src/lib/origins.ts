import type { Env } from '../env';
import {
  publicSiteOrigin,
  tenantDomainForEnvironment,
} from '@greenput/shared/utils';

/**
 * Where the two kinds of share link (GP-008) point.
 *
 * A share link is built HERE, in the action's response, and handed to the
 * contractor — so the origin has to be one a homeowner or an invited
 * teammate can actually open, not the one this request happened to arrive on.
 */

/** The platform SPA origins an invite link may point at, by environment. */
const APP_ORIGIN_BY_ENVIRONMENT: Record<string, string> = {
  production: 'https://app.greenput.com',
  staging: 'https://app.greenput.site',
  development: 'http://localhost:4200',
};

/**
 * The platform origins this API already serves (see getAllowedOrigin in
 * middleware/auth.ts). Only these may be echoed back into a link: an Origin
 * header is caller-controlled, and a link that points wherever the caller
 * says is an invitation to phish the invitee.
 */
const APP_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/app\.greenput\.(com|site)$/,
  /^https:\/\/([a-z0-9-]+\.)?greenput-app(-staging)?\.pages\.dev$/,
  /^http:\/\/localhost:\d+$/,
];

/**
 * The origin of the platform SPA — where `/accept-invite/:token` lives.
 *
 * The request's own Origin when it is a known platform host (this is what
 * makes a preview deployment's link open on that preview), otherwise the
 * environment's canonical one. Preview has no canonical host of its own and
 * falls back to production's, which is still a Greenput door.
 */
export function appOrigin(
  env: Pick<Env, 'ENVIRONMENT'>,
  requestOrigin: string | null | undefined,
): string {
  if (
    requestOrigin &&
    APP_ORIGIN_PATTERNS.some((pattern) => pattern.test(requestOrigin))
  ) {
    return requestOrigin;
  }
  return (
    APP_ORIGIN_BY_ENVIRONMENT[env.ENVIRONMENT] ??
    APP_ORIGIN_BY_ENVIRONMENT['production']
  );
}

/** The three `workspaces` columns a public site address depends on. */
export interface WorkspaceOriginRow {
  slug?: string | null;
  custom_hostname?: string | null;
  custom_domain_status?: string | null;
}

/**
 * The public origin of a workspace's micro-site (apps/tenant-site), or null
 * when the workspace has no slug and therefore no address. Same three columns
 * and the same active-only custom-domain rule as `tenantOriginFor` in
 * apps/tenant-site/src/render.ts, via the shared helper.
 */
export function tenantOrigin(
  env: Pick<Env, 'ENVIRONMENT'>,
  workspace: WorkspaceOriginRow,
): string | null {
  return publicSiteOrigin(
    {
      slug: workspace.slug,
      customHostname: workspace.custom_hostname,
      customDomainStatus: workspace.custom_domain_status,
    },
    tenantDomainForEnvironment(env.ENVIRONMENT),
  );
}
