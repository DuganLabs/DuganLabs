import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, newId } from '../lib/response';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';
import { RequestCustomDomainSchema } from '@greenput/shared/validators';
import {
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
  mapCloudflareStatus,
  CloudflareApiError,
  CloudflareSaasNotConfiguredError,
} from '../lib/cloudflare-saas';

export const customDomainRouter = Router({ base: '/api/custom-domain' });

const DEFAULT_FALLBACK_ORIGIN = 'fallback.greenput.com';

interface WorkspaceDomainRow {
  custom_hostname: string | null;
  custom_domain_status: string;
  custom_domain_verification_method: string | null;
  custom_domain_verification_token: string | null;
  custom_domain_cf_hostname_id: string | null;
  custom_domain_failure_reason: string | null;
  custom_domain_requested_at: string | null;
  custom_domain_verified_at: string | null;
  custom_domain_last_checked_at: string | null;
  custom_domain_setup_fee_paid_at: string | null;
}

const DOMAIN_COLUMNS =
  'custom_hostname, custom_domain_status, custom_domain_verification_method, ' +
  'custom_domain_verification_token, custom_domain_cf_hostname_id, ' +
  'custom_domain_failure_reason, custom_domain_requested_at, ' +
  'custom_domain_verified_at, custom_domain_last_checked_at, ' +
  'custom_domain_setup_fee_paid_at';

function toResponseShape(row: WorkspaceDomainRow, env: Env) {
  const cnameTarget =
    env.CUSTOM_DOMAIN_FALLBACK_ORIGIN ?? DEFAULT_FALLBACK_ORIGIN;
  return {
    hostname: row.custom_hostname,
    status: row.custom_domain_status,
    verificationMethod: row.custom_domain_verification_method,
    // 'cname' is verified purely by the CNAME already in place — the value
    // to show the contractor IS the target. A future 'txt' method would
    // surface the actual TXT record content via the verification token here
    // instead.
    verificationValue:
      row.custom_domain_verification_method === 'txt'
        ? row.custom_domain_verification_token
        : row.custom_hostname
          ? cnameTarget
          : null,
    cnameTarget,
    failureReason: row.custom_domain_failure_reason,
    requestedAt: row.custom_domain_requested_at,
    verifiedAt: row.custom_domain_verified_at,
    lastCheckedAt: row.custom_domain_last_checked_at,
    setupFeePaidAt: row.custom_domain_setup_fee_paid_at,
  };
}

async function fetchDomainRow(
  env: Env,
  workspaceId: string,
): Promise<WorkspaceDomainRow | null> {
  return env.DB.prepare(`SELECT ${DOMAIN_COLUMNS} FROM workspaces WHERE id = ?`)
    .bind(workspaceId)
    .first<WorkspaceDomainRow>();
}

// GET /api/custom-domain — read-only status for the current workspace.
// Any authenticated workspace member can view it (mirrors GET /api/branding).
customDomainRouter.get('/', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const row = await fetchDomainRow(env, workspaceId);
  if (!row) return error('Workspace not found', 404, 'NOT_FOUND');
  return json({ data: toResponseShape(row, env) });
});

// POST /api/custom-domain — request/replace the workspace's custom domain.
// Owner/admin only: this creates a real external resource (a Cloudflare
// Custom Hostname) once Cloudflare for SaaS is configured, and the domain
// carries the one-time setup fee per the 2026-09-10 product decision.
customDomainRouter.post(
  '/',
  requireRole('admin'),
  validate(RequestCustomDomainSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const { hostname } = (
      req as unknown as { validatedBody: { hostname: string } }
    ).validatedBody;

    const claimedBy = await env.DB.prepare(
      `SELECT id FROM workspaces WHERE custom_hostname = ? AND id != ? LIMIT 1`,
    )
      .bind(hostname, workspaceId)
      .first<{ id: string }>();
    if (claimedBy) {
      return error(
        'This domain is already configured on another Greenput workspace.',
        409,
        'DOMAIN_TAKEN',
      );
    }

    let cfHostnameId: string | null = null;
    let status: 'pending' | 'verifying' | 'active' = 'pending';
    let cloudflareConfigured = true;

    try {
      const record = await createCustomHostname(env, hostname, 'cname');
      cfHostnameId = record.id;
      status =
        mapCloudflareStatus(record) === 'active' ? 'active' : 'verifying';
    } catch (err) {
      if (err instanceof CloudflareSaasNotConfiguredError) {
        // Expected until the owner finishes the manual Cloudflare setup —
        // record the request so it's visible and pick it up on the next
        // /recheck (or a future scheduled reconcile) once configured.
        cloudflareConfigured = false;
      } else if (err instanceof CloudflareApiError) {
        return error(err.message, 422, 'CLOUDFLARE_ERROR');
      } else {
        throw err;
      }
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE workspaces SET
         custom_hostname = ?,
         custom_domain_status = ?,
         custom_domain_verification_method = 'cname',
         custom_domain_verification_token = ?,
         custom_domain_cf_hostname_id = ?,
         custom_domain_failure_reason = NULL,
         custom_domain_requested_at = ?,
         custom_domain_verified_at = NULL,
         custom_domain_last_checked_at = ?
       WHERE id = ?`,
    )
      .bind(hostname, status, newId(), cfHostnameId, now, now, workspaceId)
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'workspace', ?, 'custom_domain_requested', ?, ?)`,
    )
      .bind(
        newId(),
        workspaceId,
        user.id,
        workspaceId,
        JSON.stringify({ hostname, cloudflareConfigured }),
        now,
      )
      .run();

    const row = await fetchDomainRow(env, workspaceId);
    return json(
      {
        data: {
          ...toResponseShape(row as WorkspaceDomainRow, env),
          cloudflareConfigured,
        },
      },
      201,
    );
  },
);

// POST /api/custom-domain/recheck — poll Cloudflare now instead of waiting
// for a scheduled reconcile (none is wired up in this PR — see
// duganlabs-survey/greenput-custom-domains.md). This is also the "Retry"
// action the platform settings UI calls.
customDomainRouter.post(
  '/recheck',
  requireRole('admin'),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const row = await fetchDomainRow(env, workspaceId);

    if (!row || !row.custom_hostname) {
      return error('No custom domain is configured', 404, 'NOT_FOUND');
    }

    if (!row.custom_domain_cf_hostname_id) {
      // Never made it to Cloudflare (not configured at request time, or the
      // create call failed after the DB write in some earlier version) —
      // nothing to poll yet.
      return json({
        data: {
          ...toResponseShape(row, env),
          note: 'Not yet registered with Cloudflare — ask the Greenput team to finish setup.',
        },
      });
    }

    try {
      const record = await getCustomHostname(
        env,
        row.custom_domain_cf_hostname_id,
      );
      const mapped = mapCloudflareStatus(record);
      const now = new Date().toISOString();

      await env.DB.prepare(
        `UPDATE workspaces SET
           custom_domain_status = ?,
           custom_domain_verified_at = CASE WHEN ? = 'active' THEN COALESCE(custom_domain_verified_at, ?) ELSE custom_domain_verified_at END,
           custom_domain_failure_reason = ?,
           custom_domain_last_checked_at = ?
         WHERE id = ?`,
      )
        .bind(
          mapped,
          mapped,
          now,
          mapped === 'failed'
            ? 'Cloudflare could not verify the domain — double-check the CNAME record and retry.'
            : null,
          now,
          workspaceId,
        )
        .run();
    } catch (err) {
      if (err instanceof CloudflareSaasNotConfiguredError) {
        return json({
          data: {
            ...toResponseShape(row, env),
            note: 'Cloudflare for SaaS is not configured on this environment yet.',
          },
        });
      }
      throw err;
    }

    const updated = await fetchDomainRow(env, workspaceId);
    return json({ data: toResponseShape(updated as WorkspaceDomainRow, env) });
  },
);

// DELETE /api/custom-domain — cancel/remove the custom domain.
customDomainRouter.delete(
  '/',
  requireRole('admin'),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const row = await fetchDomainRow(env, workspaceId);

    if (!row || !row.custom_hostname) {
      return error('No custom domain is configured', 404, 'NOT_FOUND');
    }

    if (row.custom_domain_cf_hostname_id) {
      try {
        await deleteCustomHostname(env, row.custom_domain_cf_hostname_id);
      } catch (err) {
        if (!(err instanceof CloudflareSaasNotConfiguredError)) throw err;
      }
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE workspaces SET
         custom_hostname = NULL,
         custom_domain_status = 'none',
         custom_domain_verification_method = NULL,
         custom_domain_verification_token = NULL,
         custom_domain_cf_hostname_id = NULL,
         custom_domain_failure_reason = NULL,
         custom_domain_requested_at = NULL,
         custom_domain_verified_at = NULL,
         custom_domain_last_checked_at = ?
       WHERE id = ?`,
    )
      .bind(now, workspaceId)
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
       VALUES (?, ?, ?, 'workspace', ?, 'custom_domain_removed', ?)`,
    )
      .bind(newId(), workspaceId, user.id, workspaceId, now)
      .run();

    return json({ data: { deleted: true } });
  },
);

// PATCH /api/custom-domain/setup-fee — record (not charge) the one-time
// setup fee fact. Whoever actually invoices/collects the fee today is a
// manual, off-platform step (see the open questions in
// greenput-custom-domains.md); this endpoint just lets that fact be
// recorded against the workspace once it happens.
customDomainRouter.patch(
  '/setup-fee',
  requireRole('admin'),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const body = (await req.json().catch(() => ({}))) as { paid?: boolean };
    const paid = body.paid !== false;
    const now = new Date().toISOString();

    await env.DB.prepare(
      `UPDATE workspaces SET custom_domain_setup_fee_paid_at = ? WHERE id = ?`,
    )
      .bind(paid ? now : null, workspaceId)
      .run();

    const row = await fetchDomainRow(env, workspaceId);
    return json({ data: toResponseShape(row as WorkspaceDomainRow, env) });
  },
);
