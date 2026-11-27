import { describe, it, expect } from 'vitest';
import { getPlanLimits, checkLimit, requireFeature } from './plan-limits';

function makeDb(plan: string, count: number) {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: () => {
          if (sql.includes('subscriptions')) return Promise.resolve({ plan });
          if (sql.includes('COUNT(*)')) return Promise.resolve({ cnt: count });
          return Promise.resolve(null);
        },
      }),
    }),
  };
}

function makeEnv(plan: string, count = 0) {
  return { DB: makeDb(plan, count) } as never;
}

function makeReq(workspaceId = 'ws-1') {
  return { workspaceId } as never;
}

describe('plan-limits', () => {
  describe('getPlanLimits', () => {
    it('returns starter limits for unknown plan', () => {
      const limits = getPlanLimits('unknown');
      expect(limits.maxLeads).toBe(100);
      expect(limits.maxUsers).toBe(3);
    });

    it('returns correct starter limits', () => {
      const limits = getPlanLimits('starter');
      expect(limits.maxLeads).toBe(100);
      expect(limits.maxUsers).toBe(3);
      expect(limits.maxJobs).toBe(50);
      expect(limits.maxCampaigns).toBe(3);
      expect(limits.features.webhooks).toBe(false);
      expect(limits.features.reports).toBe(false);
      expect(limits.features.apiAccess).toBe(false);
    });

    it('returns correct pro limits', () => {
      const limits = getPlanLimits('pro');
      expect(limits.maxLeads).toBe(1000);
      expect(limits.maxUsers).toBe(10);
      expect(limits.features.webhooks).toBe(true);
      expect(limits.features.reports).toBe(true);
      expect(limits.features.apiAccess).toBe(true);
      expect(limits.features.customBranding).toBe(false);
    });

    it('returns correct business limits', () => {
      const limits = getPlanLimits('business');
      expect(limits.maxLeads).toBe(10000);
      expect(limits.maxUsers).toBe(50);
      expect(limits.features.customBranding).toBe(true);
    });

    it('returns unlimited for enterprise', () => {
      const limits = getPlanLimits('enterprise');
      expect(limits.maxLeads).toBe(Infinity);
      expect(limits.maxUsers).toBe(Infinity);
      expect(limits.maxJobs).toBe(Infinity);
      expect(limits.features.webhooks).toBe(true);
      expect(limits.features.customBranding).toBe(true);
    });
  });

  describe('exports', () => {
    it('exports checkLimit function', async () => {
      const mod = await import('./plan-limits');
      expect(typeof mod.checkLimit).toBe('function');
    });

    it('exports requireFeature function', async () => {
      const mod = await import('./plan-limits');
      expect(typeof mod.requireFeature).toBe('function');
    });

    it('checkLimit returns middleware function', async () => {
      const { checkLimit } = await import('./plan-limits');
      const middleware = checkLimit('leads');
      expect(typeof middleware).toBe('function');
    });

    it('requireFeature returns middleware function', async () => {
      const { requireFeature } = await import('./plan-limits');
      const middleware = requireFeature('webhooks');
      expect(typeof middleware).toBe('function');
    });
  });

  describe('getPlanLimits edge cases', () => {
    it('starter has estimates feature enabled', () => {
      expect(getPlanLimits('starter').features.estimates).toBe(true);
    });

    it('starter has maxApiKeys of 0', () => {
      expect(getPlanLimits('starter').maxApiKeys).toBe(0);
    });

    it('pro has maxApiKeys of 5', () => {
      expect(getPlanLimits('pro').maxApiKeys).toBe(5);
    });

    it('business has maxFileStorageMB of 50000', () => {
      expect(getPlanLimits('business').maxFileStorageMB).toBe(50000);
    });

    it('enterprise has infinite maxCampaigns', () => {
      expect(getPlanLimits('enterprise').maxCampaigns).toBe(Infinity);
    });
  });

  describe('checkLimit middleware', () => {
    it('returns undefined (allows) when count is below limit', async () => {
      const middleware = checkLimit('leads');
      const result = await middleware(makeReq(), makeEnv('starter', 50));
      expect(result).toBeUndefined();
    });

    it('returns undefined (allows) when count equals limit minus 1', async () => {
      const middleware = checkLimit('campaigns');
      // starter max campaigns = 3, count = 2
      const result = await middleware(makeReq(), makeEnv('starter', 2));
      expect(result).toBeUndefined();
    });

    it('returns 403 when count equals the plan limit', async () => {
      const middleware = checkLimit('leads');
      // starter maxLeads = 100, count = 100
      const result = await middleware(makeReq(), makeEnv('starter', 100));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
      const body = await (result as Response).json();
      expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    });

    it('returns 403 when count exceeds the plan limit', async () => {
      const middleware = checkLimit('jobs');
      // starter maxJobs = 50, count = 99
      const result = await middleware(makeReq(), makeEnv('starter', 99));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
    });

    it('returns undefined for enterprise (infinite limit)', async () => {
      const middleware = checkLimit('leads');
      const result = await middleware(makeReq(), makeEnv('enterprise', 999999));
      expect(result).toBeUndefined();
    });
  });

  describe('requireFeature middleware', () => {
    it('returns undefined (allows) when feature is enabled on plan', async () => {
      const middleware = requireFeature('webhooks');
      const result = await middleware(makeReq(), makeEnv('pro'));
      expect(result).toBeUndefined();
    });

    it('returns 403 when feature is not available on plan', async () => {
      const middleware = requireFeature('webhooks');
      const result = await middleware(makeReq(), makeEnv('starter'));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
      const body = await (result as Response).json();
      expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE');
    });

    it('returns undefined for customBranding on business plan', async () => {
      const middleware = requireFeature('customBranding');
      const result = await middleware(makeReq(), makeEnv('business'));
      expect(result).toBeUndefined();
    });

    it('returns 403 for customBranding on pro plan', async () => {
      const middleware = requireFeature('customBranding');
      const result = await middleware(makeReq(), makeEnv('pro'));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
    });
  });
});
