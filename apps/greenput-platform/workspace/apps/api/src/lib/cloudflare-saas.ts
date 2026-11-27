import type { Env } from '../env';

/**
 * Cloudflare for SaaS ("SSL for SaaS") client for Cloudflare Workers.
 *
 * This is the mechanism behind contractor custom domains: a contractor
 * CNAMEs a hostname they own at `env.CUSTOM_DOMAIN_FALLBACK_ORIGIN`, and we
 * register that hostname as a Cloudflare "Custom Hostname" on our zone.
 * Cloudflare then validates domain control and issues/manages the TLS
 * certificate for it — see duganlabs-survey/greenput-custom-domains.md for
 * the full operational write-up (including the manual, owner-only account
 * setup this depends on: enabling Cloudflare for SaaS on the zone and
 * configuring the fallback origin).
 *
 * Uses fetch() directly against the Cloudflare REST API — no SDK — mirroring
 * apps/api/src/lib/stripe.ts.
 *
 * IMPORTANT: nothing in this module is called by any deployed code path in
 * this PR outside of apps/api/src/routes/custom-domains.ts, and this PR does
 * not call it against the real Cloudflare account (no CLOUDFLARE_API_TOKEN
 * is provisioned). Every call gracefully degrades to
 * CloudflareSaasNotConfiguredError until the owner sets it up.
 */

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

/** The DCV method we ask Cloudflare to use, in Greenput's own vocabulary.
 * 'cname' is the default and only method this PR wires end to end: the
 * contractor's one-time CNAME to the fallback origin is itself sufficient —
 * under the hood this maps to Cloudflare's `ssl.method: 'http'`, which
 * Cloudflare edge validates automatically once that CNAME resolves, with no
 * separate record for the contractor to add. 'txt' is modeled for a future
 * "verify before cutting over DNS" flow and is not implemented here. */
export type DcvMethod = 'cname' | 'txt';

function toCloudflareSslMethod(method: DcvMethod): 'http' | 'txt' {
  return method === 'txt' ? 'txt' : 'http';
}

export class CloudflareSaasNotConfiguredError extends Error {
  constructor() {
    super(
      'Cloudflare for SaaS is not configured on this Worker (missing ' +
        'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID). The domain request was ' +
        'recorded, but Greenput staff must finish setup in the Cloudflare ' +
        'dashboard/API by hand — see greenput-custom-domains.md.',
    );
    this.name = 'CloudflareSaasNotConfiguredError';
  }
}

export class CloudflareApiError extends Error {
  readonly status: number;
  readonly errors: ReadonlyArray<{ code: number; message: string }>;

  constructor(
    message: string,
    status: number,
    errors: ReadonlyArray<{ code: number; message: string }> = [],
  ) {
    super(message);
    this.name = 'CloudflareApiError';
    this.status = status;
    this.errors = errors;
  }
}

/** Trimmed shape of a Cloudflare for SaaS Custom Hostname object — only the
 * fields this app reads. Full reference:
 * https://developers.cloudflare.com/api/resources/custom_hostnames/ */
export interface CloudflareCustomHostname {
  id: string;
  hostname: string;
  /** Cloudflare's own hostname-activation status: 'pending', 'active',
   * 'moved', 'deleted', 'blocked', plus several 'test_*'/'pending_*'
   * variants. Greenput never stores this verbatim — see
   * mapCloudflareStatus, which buckets it into our 'verifying' | 'active' |
   * 'failed'. */
  status: string;
  ssl: {
    /** 'initializing' | 'pending_validation' | 'pending_issuance' |
     * 'pending_deployment' | 'active' | ...timed-out/expired variants. */
    status: string;
    method: 'http' | 'txt' | 'email';
    validation_records?: ReadonlyArray<{
      txt_name?: string;
      txt_value?: string;
      http_url?: string;
      http_body?: string;
    }>;
  };
  /** Cloudflare's own pre-issuance ownership check for the hostname —
   * populated for TXT-based ownership verification (independent of
   * ssl.method above). */
  ownership_verification?: { type: string; name: string; value: string };
}

interface CloudflareApiEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

async function cloudflareRequest<T>(
  env: Env,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
    throw new CloudflareSaasNotConfiguredError();
  }

  const response = await fetch(
    `${CLOUDFLARE_API}/zones/${env.CLOUDFLARE_ZONE_ID}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );

  const data = (await response.json()) as CloudflareApiEnvelope<T>;

  if (!response.ok || !data.success) {
    const first = data.errors?.[0];
    throw new CloudflareApiError(
      first?.message ?? 'Cloudflare API error',
      response.status,
      data.errors ?? [],
    );
  }

  return data.result;
}

/** Register a contractor's hostname as a Custom Hostname on our zone. This
 * is the API-side half of "create a custom hostname" — the contractor's
 * CNAME must already point at env.CUSTOM_DOMAIN_FALLBACK_ORIGIN, or
 * Cloudflare's validation will simply never complete (it does not fail
 * fast; it stays 'pending' until the DNS is correct or the hostname is
 * deleted). Throws CloudflareSaasNotConfiguredError if the zone/token
 * aren't set, or CloudflareApiError for a rejected request (e.g. the
 * hostname is already registered as a Custom Hostname elsewhere). */
export async function createCustomHostname(
  env: Env,
  hostname: string,
  method: DcvMethod = 'cname',
): Promise<CloudflareCustomHostname> {
  return cloudflareRequest<CloudflareCustomHostname>(
    env,
    'POST',
    '/custom_hostnames',
    {
      hostname,
      ssl: {
        method: toCloudflareSslMethod(method),
        type: 'dv',
        settings: { min_tls_version: '1.2' },
      },
    },
  );
}

/** Poll the current state of a previously-created Custom Hostname. This is
 * what the status-reconcile endpoint (routes/custom-domains.ts) calls to
 * find out whether Cloudflare has finished validating + issuing yet. */
export async function getCustomHostname(
  env: Env,
  cfHostnameId: string,
): Promise<CloudflareCustomHostname> {
  return cloudflareRequest<CloudflareCustomHostname>(
    env,
    'GET',
    `/custom_hostnames/${cfHostnameId}`,
  );
}

/** Remove a Custom Hostname — called when a workspace cancels/replaces its
 * custom domain. Cloudflare stops serving TLS for it immediately; DNS
 * cleanup (the contractor removing their CNAME) is on them. */
export async function deleteCustomHostname(
  env: Env,
  cfHostnameId: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    env,
    'DELETE',
    `/custom_hostnames/${cfHostnameId}`,
  );
}

/** Greenput's simplified 3-state projection of Cloudflare's much more
 * granular `status` + `ssl.status` enums — this is what actually lands in
 * `workspaces.custom_domain_status`. */
export function mapCloudflareStatus(
  record: Pick<CloudflareCustomHostname, 'status' | 'ssl'>,
): 'verifying' | 'active' | 'failed' {
  const FAILURE_MARKERS = ['timed_out', 'blocked', 'deleted'];
  if (
    FAILURE_MARKERS.some(
      (marker) =>
        record.status.includes(marker) || record.ssl.status.includes(marker),
    )
  ) {
    return 'failed';
  }
  if (record.status === 'active' && record.ssl.status === 'active') {
    return 'active';
  }
  return 'verifying';
}
