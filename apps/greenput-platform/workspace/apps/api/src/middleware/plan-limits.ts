import { IRequest } from 'itty-router';
import type { Env } from '../env';
import { error } from '../lib/response';

/**
 * Plan limits define resource caps per subscription tier.
 */
interface PlanLimits {
  maxLeads: number;
  maxUsers: number;
  maxJobs: number;
  maxCampaigns: number;
  maxFileStorageMB: number;
  maxApiKeys: number;
  features: {
    webhooks: boolean;
    estimates: boolean;
    reports: boolean;
    apiAccess: boolean;
    customBranding: boolean;
  };
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  starter: {
    maxLeads: 100,
    maxUsers: 3,
    maxJobs: 50,
    maxCampaigns: 3,
    maxFileStorageMB: 500,
    maxApiKeys: 0,
    features: {
      webhooks: false,
      estimates: true,
      reports: false,
      apiAccess: false,
      customBranding: false,
    },
  },
  pro: {
    maxLeads: 1000,
    maxUsers: 10,
    maxJobs: 500,
    maxCampaigns: 20,
    maxFileStorageMB: 5000,
    maxApiKeys: 5,
    features: {
      webhooks: true,
      estimates: true,
      reports: true,
      apiAccess: true,
      customBranding: false,
    },
  },
  business: {
    maxLeads: 10000,
    maxUsers: 50,
    maxJobs: 5000,
    maxCampaigns: 100,
    maxFileStorageMB: 50000,
    maxApiKeys: 20,
    features: {
      webhooks: true,
      estimates: true,
      reports: true,
      apiAccess: true,
      customBranding: true,
    },
  },
  enterprise: {
    maxLeads: Infinity,
    maxUsers: Infinity,
    maxJobs: Infinity,
    maxCampaigns: Infinity,
    maxFileStorageMB: Infinity,
    maxApiKeys: Infinity,
    features: {
      webhooks: true,
      estimates: true,
      reports: true,
      apiAccess: true,
      customBranding: true,
    },
  },
};

/**
 * Get current plan for a workspace. Defaults to 'starter' if no subscription.
 */
async function getWorkspacePlan(
  env: Env,
  workspaceId: string,
): Promise<string> {
  const sub = await env.DB.prepare(
    "SELECT plan FROM subscriptions WHERE workspace_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(workspaceId)
    .first<{ plan: string }>();

  return sub?.plan ?? 'starter';
}

/**
 * Get the plan limits for a workspace.
 */
export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS['starter'];
}

/**
 * Middleware to check resource limits before creating a new resource.
 */
export function checkLimit(
  resource: 'leads' | 'users' | 'jobs' | 'campaigns' | 'api_keys',
) {
  const resourceToTable: Record<string, string> = {
    leads: 'leads',
    users: 'users',
    jobs: 'jobs',
    campaigns: 'campaigns',
    api_keys: 'api_keys',
  };

  const resourceToLimitKey: Record<string, keyof PlanLimits> = {
    leads: 'maxLeads',
    users: 'maxUsers',
    jobs: 'maxJobs',
    campaigns: 'maxCampaigns',
    api_keys: 'maxApiKeys',
  };

  return async (req: IRequest, env: Env): Promise<Response | void> => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const plan = await getWorkspacePlan(env, workspaceId);
    const limits = getPlanLimits(plan);
    const maxCount = limits[resourceToLimitKey[resource]] as number;

    if (maxCount === Infinity) return; // no limit

    const table = resourceToTable[resource];
    const count = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM ${table} WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .first<{ cnt: number }>();

    if (count && count.cnt >= maxCount) {
      return error(
        `Plan limit reached: your ${plan} plan allows up to ${maxCount} ${resource}. Upgrade to add more.`,
        403,
        'PLAN_LIMIT_EXCEEDED',
      );
    }
  };
}

/**
 * Middleware to check if a feature is enabled on the current plan.
 */
export function requireFeature(feature: keyof PlanLimits['features']) {
  return async (req: IRequest, env: Env): Promise<Response | void> => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const plan = await getWorkspacePlan(env, workspaceId);
    const limits = getPlanLimits(plan);

    if (!limits.features[feature]) {
      return error(
        `This feature requires a higher plan. Your current plan (${plan}) does not include ${feature}.`,
        403,
        'FEATURE_NOT_AVAILABLE',
      );
    }
  };
}
