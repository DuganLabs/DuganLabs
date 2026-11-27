import type { Env } from '../env';

/**
 * Workspace billing lifecycle helpers. Source of truth for "is this workspace
 * allowed to perform a billable action right now."
 *
 * The billing_status column on workspaces is the single field consulted by
 * gating middleware. The lifecycle:
 *
 *   trialing      → set on registration, expires at trial_ends_at
 *   active        → paying customer with a current Stripe subscription
 *   past_due      → Stripe webhook flipped this on payment failure
 *   trial_expired → trial ended without payment method on file
 *   canceled      → owner cancelled and grace period ended
 */

export const TRIAL_DAYS = 14;

export type BillingStatus =
  'trialing' | 'active' | 'past_due' | 'canceled' | 'trial_expired';

export interface WorkspaceBillingState {
  readonly billingStatus: BillingStatus;
  readonly trialStartedAt: string | null;
  readonly trialEndsAt: string | null;
  readonly daysLeftInTrial: number | null;
  readonly canMutate: boolean;
}

interface WorkspaceBillingRow {
  readonly billing_status: string | null;
  readonly trial_started_at: string | null;
  readonly trial_ends_at: string | null;
}

/**
 * Read the billing state for a workspace. Returns a synthetic 'trialing' state
 * if the row predates the billing_pipeline migration (defensive — pre-migration
 * rows have NULL billing_status from older inserts that bypassed the DEFAULT).
 */
export async function getWorkspaceBillingState(
  env: Env,
  workspaceId: string,
  now: Date = new Date(),
): Promise<WorkspaceBillingState> {
  const row = await env.DB.prepare(
    'SELECT billing_status, trial_started_at, trial_ends_at FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<WorkspaceBillingRow>();

  if (!row) {
    return {
      billingStatus: 'canceled',
      trialStartedAt: null,
      trialEndsAt: null,
      daysLeftInTrial: null,
      canMutate: false,
    };
  }

  const rawStatus = (row.billing_status ?? 'trialing') as BillingStatus;
  const trialEndsAt = row.trial_ends_at;
  const trialStartedAt = row.trial_started_at;

  // Auto-flip expired trials. We don't write back here (read path); a
  // separate sweep job + the gating middleware do that.
  let effectiveStatus: BillingStatus = rawStatus;
  let daysLeft: number | null = null;
  if (trialEndsAt !== null) {
    const ends = new Date(trialEndsAt).getTime();
    const ms = ends - now.getTime();
    daysLeft = Math.max(0, Math.ceil(ms / 86_400_000));
    if (rawStatus === 'trialing' && ms <= 0) {
      effectiveStatus = 'trial_expired';
    }
  }

  return {
    billingStatus: effectiveStatus,
    trialStartedAt,
    trialEndsAt,
    daysLeftInTrial: daysLeft,
    canMutate: effectiveStatus === 'trialing' || effectiveStatus === 'active',
  };
}

/**
 * Compute the trial_ends_at timestamp for a fresh registration.
 */
export function computeTrialEndsAt(startedAt: Date = new Date()): string {
  return new Date(startedAt.getTime() + TRIAL_DAYS * 86_400_000).toISOString();
}

/**
 * Mark a workspace's trial as expired. Idempotent — safe to call from a sweep
 * job or from the gating middleware on first detection.
 */
export async function markTrialExpired(
  env: Env,
  workspaceId: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE workspaces SET billing_status = 'trial_expired' WHERE id = ? AND billing_status = 'trialing'",
  )
    .bind(workspaceId)
    .run();
}
