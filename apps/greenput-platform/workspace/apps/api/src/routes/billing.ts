import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, newId } from '../lib/response';
import { entity } from '../lib/serialize';
import {
  PER_SERVICE_LEAD_USD,
  WIRE_SUBSCRIPTION,
} from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';
import { getWorkspaceBillingState, markTrialExpired } from '../lib/billing';
import {
  listLeadCharges,
  PER_LEAD_USD,
  readLeadFeeOverrideUsd,
  summarizeWorkspaceMeter,
} from '../lib/lead-meter';
import { chargePendingLeadFees } from '../lib/lead-fee-billing';
import { leadReceiveReadiness } from '../lib/lead-billing-gate';
import { readUsageBalance, updateUsageSettings } from '../lib/usage-balance';
import {
  SubscribeBillingSchema,
  BillingPortalSchema,
  UpdateUsageBalanceSchema,
} from '@greenput/shared/validators';
import {
  createStripeCustomer,
  createSubscription,
  cancelSubscription,
  createPortalSession,
  subscriptionPeriodUnix,
  StripeError,
} from '../lib/stripe';

export const billingRouter = Router({ base: '/api/billing' });

// GET /api/billing/status — workspace billing state (any authed user)
billingRouter.get('/status', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const state = await getWorkspaceBillingState(env, workspaceId);
  // Persist auto-detected expiry so subsequent reads are consistent + the
  // gating middleware doesn't need to recompute.
  if (state.billingStatus === 'trial_expired') {
    await markTrialExpired(env, workspaceId);
  }
  return json({ data: state });
});

// GET /api/billing/meter — per-lead meter ledger summary (admin+)
billingRouter.get(
  '/meter',
  requireRole('admin'),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const summary = await summarizeWorkspaceMeter(env, workspaceId);
    const [leadFeeOverrideUsd, charges, receive] = await Promise.all([
      readLeadFeeOverrideUsd(env, workspaceId),
      listLeadCharges(env, workspaceId),
      leadReceiveReadiness(env, workspaceId),
    ]);
    return json({
      data: {
        summary,
        perLeadRates: PER_LEAD_USD,
        perServiceLeadRates: PER_SERVICE_LEAD_USD,
        leadFeeOverrideUsd,
        charges,
        receive,
      },
    });
  },
);

// POST /api/billing/lead-fees/collect — charge still-pending lead fees
// to the saved card. This is not a schedule: the contractor (or an admin)
// asks for it after adding a card or replacing a declined one. GET /meter
// stays free of side effects.
billingRouter.post(
  '/lead-fees/collect',
  requireRole('admin'),
  async (req: IRequest, env: Env) => {
    if (!env.STRIPE_SECRET_KEY) {
      return error('Billing is not configured', 503, 'BILLING_UNAVAILABLE');
    }
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const report = await chargePendingLeadFees(env, workspaceId);
    return json({ data: report });
  },
);

// GET /api/billing/usage — prepaid SMS balance. No side effects.
billingRouter.get(
  '/usage',
  requireRole('admin'),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const usage = await readUsageBalance(env, workspaceId);
    if (!usage) return error('Workspace not found', 404, 'NOT_FOUND');
    return json({ data: usage });
  },
);

// PATCH /api/billing/usage — top-up amount and threshold. Does not charge.
billingRouter.patch(
  '/usage',
  requireRole('admin'),
  validate(UpdateUsageBalanceSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (
      req as unknown as {
        validatedBody: { topupCents: number; thresholdCents: number };
      }
    ).validatedBody;
    const usage = await updateUsageSettings(env, workspaceId, body);
    if (!usage) return error('Workspace not found', 404, 'NOT_FOUND');
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'workspace', ?, 'usage_balance_updated', ?, ?)`,
    )
      .bind(
        newId(),
        workspaceId,
        user.id,
        workspaceId,
        JSON.stringify({
          topupCents: body.topupCents,
          thresholdCents: body.thresholdCents,
        }),
        now,
      )
      .run();
    return json({ data: usage });
  },
);

// GET /api/billing/subscription — current subscription (admin+)
billingRouter.get(
  '/subscription',
  requireRole('admin'),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

    const subscription = await env.DB.prepare(
      'SELECT * FROM subscriptions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1',
    )
      .bind(workspaceId)
      .first<Record<string, unknown>>();

    // Through the wire contract, like every other read: camelCase
    // `currentPeriodEnd` for the panel's Renews cell, and the Stripe ids
    // stay off the wire. A workspace with no row answers `data: null`.
    return entity(WIRE_SUBSCRIPTION, subscription);
  },
);

// POST /api/billing/subscribe — create subscription (owner only)
billingRouter.post(
  '/subscribe',
  requireRole('owner'),
  validate(SubscribeBillingSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string; role: string } })
      .user;

    if (!env.STRIPE_SECRET_KEY) {
      return error('Billing is not configured', 503, 'BILLING_UNAVAILABLE');
    }

    const body = (req as unknown as { validatedBody: { priceId: string } })
      .validatedBody;

    // Get workspace to check if Stripe customer already exists
    const workspace = await env.DB.prepare(
      'SELECT * FROM workspaces WHERE id = ?',
    )
      .bind(workspaceId)
      .first<Record<string, unknown>>();

    if (!workspace) return error('Workspace not found', 404);

    try {
      // Create or reuse Stripe customer
      let stripeCustomerId = workspace['stripe_customer_id'] as string | null;

      if (!stripeCustomerId) {
        const customer = await createStripeCustomer(env, {
          email: workspace['email'] as string,
          name: workspace['name'] as string,
          workspaceId,
        });
        stripeCustomerId = customer.id;

        await env.DB.prepare(
          'UPDATE workspaces SET stripe_customer_id = ? WHERE id = ?',
        )
          .bind(stripeCustomerId, workspaceId)
          .run();
      }

      const subscription = await createSubscription(env, {
        customerId: stripeCustomerId,
        priceId: body.priceId,
      });
      const period = subscriptionPeriodUnix(
        subscription as unknown as Record<string, unknown>,
      );
      if (!period) {
        return error(
          'Stripe did not return a billing period for the subscription',
          502,
          'STRIPE_PERIOD_MISSING',
        );
      }

      const now = new Date().toISOString();
      const subId = newId();

      await env.DB.prepare(
        `INSERT INTO subscriptions (
        id, workspace_id, stripe_subscription_id, stripe_customer_id,
        plan, status, current_period_start, current_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          subId,
          workspaceId,
          subscription.id,
          stripeCustomerId,
          'starter', // default plan, can be mapped from priceId
          subscription.status,
          new Date(period.start * 1000).toISOString(),
          new Date(period.end * 1000).toISOString(),
          now,
          now,
        )
        .run();

      await env.DB.prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'workspace', ?, 'subscribed', ?, ?)`,
      )
        .bind(
          newId(),
          workspaceId,
          user.id,
          workspaceId,
          JSON.stringify({ plan: 'starter', subscriptionId: subscription.id }),
          now,
        )
        .run();

      return json(
        {
          data: {
            subscriptionId: subId,
            stripeSubscriptionId: subscription.id,
          },
        },
        201,
      );
    } catch (err) {
      if (err instanceof StripeError) {
        return error(err.message, err.status, err.code);
      }
      throw err;
    }
  },
);

// POST /api/billing/cancel — cancel subscription (owner only)
billingRouter.post(
  '/cancel',
  requireRole('owner'),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

    if (!env.STRIPE_SECRET_KEY) {
      return error('Billing is not configured', 503, 'BILLING_UNAVAILABLE');
    }

    const sub = await env.DB.prepare(
      "SELECT * FROM subscriptions WHERE workspace_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    )
      .bind(workspaceId)
      .first<Record<string, unknown>>();

    if (!sub)
      return error('No active subscription found', 404, 'NO_SUBSCRIPTION');

    try {
      await cancelSubscription(env, sub['stripe_subscription_id'] as string);

      const now = new Date().toISOString();
      await env.DB.prepare(
        'UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?',
      )
        .bind(now, sub['id'])
        .run();

      return json({
        data: { canceled: true, endsAt: sub['current_period_end'] },
      });
    } catch (err) {
      if (err instanceof StripeError) {
        return error(err.message, err.status, err.code);
      }
      throw err;
    }
  },
);

// POST /api/billing/portal — redirect to Stripe Customer Portal (admin+)
billingRouter.post(
  '/portal',
  requireRole('admin'),
  validate(BillingPortalSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

    if (!env.STRIPE_SECRET_KEY) {
      return error('Billing is not configured', 503, 'BILLING_UNAVAILABLE');
    }

    const workspace = await env.DB.prepare(
      'SELECT stripe_customer_id FROM workspaces WHERE id = ?',
    )
      .bind(workspaceId)
      .first<{ stripe_customer_id: string | null }>();

    if (!workspace?.stripe_customer_id) {
      return error(
        'No billing account found. Subscribe to a plan first.',
        400,
        'NO_CUSTOMER',
      );
    }

    const body = (req as unknown as { validatedBody: { returnUrl?: string } })
      .validatedBody;
    const returnUrl = body.returnUrl ?? 'https://app.greenput.com/settings';

    try {
      const session = await createPortalSession(env, {
        customerId: workspace.stripe_customer_id,
        returnUrl,
      });

      return json({ data: { url: session.url } });
    } catch (err) {
      if (err instanceof StripeError) {
        return error(err.message, err.status, err.code);
      }
      throw err;
    }
  },
);

// POST /api/billing/payment-method — Customer Portal for the lead-fee
// customer. Creates the Stripe customer (metadata.workspace_id) when the
// workspace does not have one yet, so a contractor can save a card before
// the next accept, or after one that could not be collected. The
// subscription portal above stays unchanged: it still refuses when there
// is no customer, because that button means "manage the subscription."
billingRouter.post(
  '/payment-method',
  requireRole('admin'),
  validate(BillingPortalSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    if (!env.STRIPE_SECRET_KEY) {
      return error('Billing is not configured', 503, 'BILLING_UNAVAILABLE');
    }
    const workspace = await env.DB.prepare(
      'SELECT id, name, email, stripe_customer_id FROM workspaces WHERE id = ?',
    )
      .bind(workspaceId)
      .first<{
        id: string;
        name: string;
        email: string;
        stripe_customer_id: string | null;
      }>();
    if (!workspace) return error('Workspace not found', 404);

    try {
      let customerId = workspace.stripe_customer_id;
      if (!customerId) {
        const customer = await createStripeCustomer(env, {
          email: workspace.email,
          name: workspace.name,
          workspaceId,
          idempotencyKey: `lead-fee-customer-${workspaceId}`,
        });
        customerId = customer.id;
        await env.DB.prepare(
          `UPDATE workspaces SET stripe_customer_id = ?
            WHERE id = ? AND stripe_customer_id IS NULL`,
        )
          .bind(customerId, workspaceId)
          .run();
      }
      const body = (req as unknown as { validatedBody: { returnUrl?: string } })
        .validatedBody;
      const session = await createPortalSession(env, {
        customerId,
        returnUrl:
          body.returnUrl ?? 'https://app.greenput.com/settings?tab=billing',
      });
      return json({ data: { url: session.url } });
    } catch (err) {
      if (err instanceof StripeError) {
        return error(err.message, err.status, err.code);
      }
      throw err;
    }
  },
);
