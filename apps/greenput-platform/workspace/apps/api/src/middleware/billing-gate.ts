import { IRequest } from 'itty-router';
import type { Env } from '../env';
import { error } from '../lib/response';
import { getWorkspaceBillingState, markTrialExpired } from '../lib/billing';

/**
 * Methods that perform mutations and therefore consume billable capacity.
 * Reads (GET, HEAD, OPTIONS) pass through even on expired trials so the
 * contractor can still see their own data and pay to reactivate.
 */
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Path prefixes always allowed regardless of billing state. Lets a user with
 * an expired trial still pay (billing/payments) or update their workspace
 * profile (workspace) so they can reactivate.
 */
const ALWAYS_ALLOWED_PREFIXES = [
  '/api/billing/',
  '/api/payments/',
  '/api/workspace',
  '/api/auth/',
  '/api/admin/',
  '/api/monitoring/',
  '/api/health',
  '/api/public/',
  '/api/portal/',
  '/api/notifications',
];

/**
 * Block mutating requests when the workspace's billing state forbids new work
 * (trial expired, past due, canceled). Returns 402 Payment Required with a
 * machine-readable code so the SPA can route the user to the upgrade flow.
 *
 * Reads pass through. Allow-listed paths pass through. Active + trialing
 * workspaces pass through.
 */
export async function requireBillingActive(
  req: IRequest,
  env: Env,
): Promise<Response | void> {
  const method = (req as unknown as Request).method;
  if (!MUTATION_METHODS.has(method)) return;

  const url = new URL(req.url);
  for (const prefix of ALWAYS_ALLOWED_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return;
  }

  const workspaceId = (req as unknown as { workspaceId?: string }).workspaceId;
  if (workspaceId === undefined) return; // requireAuth will reject if needed

  const state = await getWorkspaceBillingState(env, workspaceId);
  if (state.canMutate) return;

  // Persist auto-detected expiry so the next read agrees.
  if (state.billingStatus === 'trial_expired') {
    await markTrialExpired(env, workspaceId);
  }

  return error(
    `Billing is ${state.billingStatus.replace('_', ' ')}. Add a payment method to continue.`,
    402,
    `BILLING_${state.billingStatus.toUpperCase()}`,
  );
}
