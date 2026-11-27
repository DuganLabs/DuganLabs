import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, newId } from '../lib/response';
import { validate } from '../middleware/validate';
import {
  StripeConnectLinkSchema,
  CreatePaymentIntentSchema,
  CreateDepositSchema,
} from '@greenput/shared/validators';
import {
  createConnectAccount,
  createAccountLink,
  createLoginLink,
  createPaymentIntent,
  invoiceSubscriptionId,
  receiptUrlForPaymentIntent,
  retrieveConnectAccount,
  subscriptionPeriodUnix,
  verifyWebhookSignature,
  StripeError,
} from '../lib/stripe';
import {
  reconcileLeadFeeCharge,
  retryLeadFeesForStripeCustomer,
} from '../lib/lead-fee-billing';
import { reconcileUsageTopUp } from '../lib/usage-balance';
import {
  createDepositForBooking,
  handleDepositWebhookEvent,
  loadDepositById,
} from '../lib/deposits';

export const paymentsRouter = Router({ base: '/api/payments' });

// GET /api/payments — list payments for workspace
paymentsRouter.get('/', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const perPage = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('perPage') ?? '25')),
  );
  const status = url.searchParams.get('status');
  const jobId = url.searchParams.get('jobId');

  let countSql =
    'SELECT COUNT(*) as total FROM payments WHERE workspace_id = ?';
  let listSql = 'SELECT * FROM payments WHERE workspace_id = ?';
  const binds: unknown[] = [workspaceId];

  if (status) {
    countSql += ' AND status = ?';
    listSql += ' AND status = ?';
    binds.push(status);
  }

  if (jobId) {
    countSql += ' AND job_id = ?';
    listSql += ' AND job_id = ?';
    binds.push(jobId);
  }

  listSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const countResult = await env.DB.prepare(countSql)
    .bind(...binds)
    .first<{ total: number }>();

  const total = countResult?.total ?? 0;

  const results = await env.DB.prepare(listSql)
    .bind(...binds, perPage, (page - 1) * perPage)
    .all();

  return json({
    data: results.results,
    meta: { total, page, perPage },
  });
});

// ── Booking deposits (DORMANT engine in lib/deposits.ts) ───────
// These routes are declared BEFORE /:id so the router does not read
// "deposits" as a payment id.

// POST /api/payments/deposits — the one remaining creation entry
// point for the dormant deposit engine: an authenticated operator
// action on an existing job. Schedule delivery has not created
// deposits since the model was revoked on 2026-10-20 (WS-0), and no
// homeowner-facing surface links to a deposit any more — see the
// DORMANT note at the top of lib/deposits.ts before adding a caller.
paymentsRouter.post(
  '/deposits',
  validate(CreateDepositSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (req as unknown as { validatedBody: { jobId: string } })
      .validatedBody;

    const outcome = await createDepositForBooking(env, {
      workspaceId,
      jobId: body.jobId,
      actorUserId: user.id,
    });

    if (!outcome.created) {
      switch (outcome.reason) {
        case 'job_not_found':
          return error('Job not found', 404, 'NOT_FOUND');
        case 'payments_unavailable':
          return error(
            'Payments are not configured',
            503,
            'PAYMENTS_UNAVAILABLE',
          );
        case 'no_connect_account':
          return error(
            'Payment processing not set up. Complete Stripe Connect onboarding first.',
            400,
            'NO_CONNECT_ACCOUNT',
          );
        case 'no_fee':
          return error(
            'This booking has no charged lead fee to size a deposit from.',
            422,
            'NO_FEE',
          );
        default:
          return error(
            'Stripe could not open the deposit intent. The failure is recorded on the deposit; retrying is safe.',
            502,
            'STRIPE_ERROR',
          );
      }
    }

    return json(
      {
        data: {
          deposit: outcome.deposit,
          ...(outcome.clientSecret
            ? { clientSecret: outcome.clientSecret }
            : {}),
        },
      },
      outcome.alreadyExisted ? 200 : 201,
    );
  },
);

// GET /api/payments/deposits/:id — one deposit
paymentsRouter.get('/deposits/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const deposit = await loadDepositById(env, workspaceId, req.params['id']);
  if (!deposit) return error('Deposit not found', 404, 'NOT_FOUND');
  return json({ data: deposit });
});

// GET /api/payments/deposits?jobId= — the deposit for a job (at most one)
paymentsRouter.get('/deposits', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  const status = url.searchParams.get('status');

  let sql = 'SELECT * FROM deposits WHERE workspace_id = ?';
  const binds: unknown[] = [workspaceId];
  if (jobId) {
    sql += ' AND job_id = ?';
    binds.push(jobId);
  }
  if (status) {
    sql += ' AND status = ?';
    binds.push(status);
  }
  sql += ' ORDER BY created_at DESC';

  const results = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ data: results.results });
});

// GET /api/payments/connect — Stripe Connect state for Settings.
// Registered before /:id so "connect" is not read as a payment id.
paymentsRouter.get('/connect', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const workspace = await env.DB.prepare(
    'SELECT stripe_account_id FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<{ stripe_account_id: string | null }>();

  if (!workspace?.stripe_account_id) {
    return json({
      data: {
        status: 'not_started',
        chargesEnabled: false,
        payoutsEnabled: false,
      },
    });
  }
  if (!env.STRIPE_SECRET_KEY) {
    return json({
      data: {
        status: 'pending',
        chargesEnabled: false,
        payoutsEnabled: false,
      },
    });
  }
  try {
    const account = await retrieveConnectAccount(
      env,
      workspace.stripe_account_id,
    );
    const chargesEnabled = account.charges_enabled === true;
    const payoutsEnabled = account.payouts_enabled === true;
    return json({
      data: {
        // Login links only work once the account can actually take cards.
        // Until then the button keeps using an account-onboarding link.
        status: chargesEnabled && payoutsEnabled ? 'complete' : 'pending',
        chargesEnabled,
        payoutsEnabled,
      },
    });
  } catch (err) {
    if (err instanceof StripeError) {
      return error(err.message, err.status, err.code);
    }
    throw err;
  }
});

// GET /api/payments/:id — single payment
paymentsRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const payment = await env.DB.prepare(
    'SELECT * FROM payments WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params['id'], workspaceId)
    .first();

  if (!payment) return error('Payment not found', 404, 'NOT_FOUND');

  return json({ data: payment });
});

// POST /api/payments/connect/onboard — start Stripe Connect onboarding
paymentsRouter.post('/connect/onboard', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  if (!env.STRIPE_SECRET_KEY) {
    return error('Payments are not configured', 503, 'PAYMENTS_UNAVAILABLE');
  }

  const workspace = await env.DB.prepare(
    'SELECT * FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<Record<string, unknown>>();

  if (!workspace) return error('Workspace not found', 404);

  try {
    let stripeAccountId = workspace['stripe_account_id'] as string | null;

    if (!stripeAccountId) {
      const account = await createConnectAccount(env, {
        email: workspace['email'] as string,
        workspaceId,
      });
      stripeAccountId = account.id;

      await env.DB.prepare(
        'UPDATE workspaces SET stripe_account_id = ? WHERE id = ?',
      )
        .bind(stripeAccountId, workspaceId)
        .run();
    }

    const parsed = StripeConnectLinkSchema.safeParse(
      await req.json().catch(() => ({})),
    );
    const body = parsed.success
      ? parsed.data
      : { refreshUrl: undefined, returnUrl: undefined };

    const accountLink = await createAccountLink(env, {
      accountId: stripeAccountId,
      refreshUrl:
        body.refreshUrl ?? 'https://app.greenput.com/settings/payments',
      returnUrl: body.returnUrl ?? 'https://app.greenput.com/settings/payments',
    });

    return json({ data: { url: accountLink.url } });
  } catch (err) {
    if (err instanceof StripeError) {
      return error(err.message, err.status, err.code);
    }
    throw err;
  }
});

// POST /api/payments/connect/login — Stripe Express dashboard for an
// account that has already finished onboarding. Account Links of type
// account_onboarding are for the incomplete account; a finished one
// uses a login link.
paymentsRouter.post('/connect/login', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  if (!env.STRIPE_SECRET_KEY) {
    return error('Payments are not configured', 503, 'PAYMENTS_UNAVAILABLE');
  }
  const workspace = await env.DB.prepare(
    'SELECT stripe_account_id FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<{ stripe_account_id: string | null }>();
  if (!workspace?.stripe_account_id) {
    return error(
      'Payment processing not set up. Complete Stripe Connect onboarding first.',
      400,
      'NO_CONNECT_ACCOUNT',
    );
  }
  try {
    const link = await createLoginLink(env, workspace.stripe_account_id);
    return json({ data: { url: link.url } });
  } catch (err) {
    if (err instanceof StripeError) {
      return error(err.message, err.status, err.code);
    }
    throw err;
  }
});

// POST /api/payments/intent — create a payment intent for a job
paymentsRouter.post(
  '/intent',
  validate(CreatePaymentIntentSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;

    if (!env.STRIPE_SECRET_KEY) {
      return error('Payments are not configured', 503, 'PAYMENTS_UNAVAILABLE');
    }

    const body = (
      req as unknown as {
        validatedBody: {
          jobId: string;
          amount: number;
          currency: string;
          description?: string;
        };
      }
    ).validatedBody;

    // Verify job belongs to workspace
    const job = await env.DB.prepare(
      'SELECT * FROM jobs WHERE id = ? AND workspace_id = ?',
    )
      .bind(body.jobId, workspaceId)
      .first<Record<string, unknown>>();

    if (!job) return error('Job not found', 404, 'NOT_FOUND');

    // Get workspace's Stripe Connect account
    const workspace = await env.DB.prepare(
      'SELECT stripe_account_id FROM workspaces WHERE id = ?',
    )
      .bind(workspaceId)
      .first<{ stripe_account_id: string | null }>();

    if (!workspace?.stripe_account_id) {
      return error(
        'Payment processing not set up. Complete Stripe Connect onboarding first.',
        400,
        'NO_CONNECT_ACCOUNT',
      );
    }

    try {
      const paymentIntent = await createPaymentIntent(env, {
        amount: body.amount,
        currency: body.currency,
        connectedAccountId: workspace.stripe_account_id,
        description: body.description ?? `Payment for job ${job['job_number']}`,
        metadata: {
          workspace_id: workspaceId,
          job_id: body.jobId,
        },
      });

      const now = new Date().toISOString();
      const paymentId = newId();

      await env.DB.prepare(
        `INSERT INTO payments (
        id, workspace_id, job_id, customer_id, stripe_payment_intent_id,
        amount, currency, status, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          paymentId,
          workspaceId,
          body.jobId,
          job['customer_id'],
          paymentIntent.id,
          body.amount,
          body.currency ?? 'usd',
          'pending',
          body.description ?? `Payment for job ${job['job_number']}`,
          now,
          now,
        )
        .run();

      await env.DB.prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'job', ?, 'payment_created', ?, ?)`,
      )
        .bind(
          newId(),
          workspaceId,
          user.id,
          body.jobId,
          JSON.stringify({
            paymentId,
            amount: body.amount,
            currency: body.currency ?? 'usd',
          }),
          now,
        )
        .run();

      return json(
        {
          data: {
            paymentId,
            clientSecret: paymentIntent.client_secret,
            stripePaymentIntentId: paymentIntent.id,
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

// POST /api/payments/webhook — Stripe webhook handler (no auth — verified via signature)
paymentsRouter.post('/webhook', async (req: IRequest, env: Env) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return error('Webhook not configured', 503);
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return error('Missing stripe-signature header', 400, 'MISSING_SIGNATURE');
  }

  const rawBody = await req.text();
  const valid = await verifyWebhookSignature(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );

  if (!valid) {
    return error('Invalid signature', 401, 'INVALID_SIGNATURE');
  }

  const event = JSON.parse(rawBody) as {
    type: string;
    data: { object: Record<string, unknown> };
  };

  const now = new Date().toISOString();

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      // receipt_url is on the Charge (latest_charge). PaymentIntent.charges
      // was removed in API version 2022-11-15 and is absent on
      // 2025-02-24.acacia. A missing charge does not fail the webhook.
      const receiptUrl = await receiptUrlForPaymentIntent(env, pi);
      await env.DB.prepare(
        'UPDATE payments SET status = ?, payment_method_type = ?, receipt_url = ?, updated_at = ? WHERE stripe_payment_intent_id = ?',
      )
        .bind(
          'succeeded',
          (pi['payment_method_types'] as string[] | undefined)?.[0] ?? null,
          receiptUrl,
          now,
          pi['id'],
        )
        .run();
      await reconcileLeadFeeCharge(env, 'succeeded', pi, now);
      await reconcileUsageTopUp(env, 'succeeded', pi);
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      await env.DB.prepare(
        'UPDATE payments SET status = ?, updated_at = ? WHERE stripe_payment_intent_id = ?',
      )
        .bind('failed', now, pi['id'])
        .run();
      await reconcileLeadFeeCharge(env, 'failed', pi, now);
      await reconcileUsageTopUp(env, 'failed', pi);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const period = subscriptionPeriodUnix(sub);
      const cancelAtEnd = sub['cancel_at_period_end'] ? 1 : 0;
      if (period) {
        await env.DB.prepare(
          `UPDATE subscriptions SET
            status = ?,
            cancel_at_period_end = ?,
            current_period_start = ?,
            current_period_end = ?,
            updated_at = ?
          WHERE stripe_subscription_id = ?`,
        )
          .bind(
            sub['status'],
            cancelAtEnd,
            new Date(period.start * 1000).toISOString(),
            new Date(period.end * 1000).toISOString(),
            now,
            sub['id'],
          )
          .run();
      } else {
        // Period missing (neither the acacia fields nor the basil item
        // fields). Update status only — do not write an invalid date.
        await env.DB.prepare(
          `UPDATE subscriptions SET
            status = ?,
            cancel_at_period_end = ?,
            updated_at = ?
          WHERE stripe_subscription_id = ?`,
        )
          .bind(sub['status'], cancelAtEnd, now, sub['id'])
          .run();
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await env.DB.prepare(
        'UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?',
      )
        .bind('canceled', now, sub['id'])
        .run();
      break;
    }

    case 'invoice.payment_failed':
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice.marked_uncollectible':
    case 'invoice.voided': {
      const invoice = event.data.object;
      if (event.type === 'invoice.payment_failed') {
        // Acacia: invoice.subscription. Basil: parent.subscription_details.
        // A lead fee is a PaymentIntent, not an invoice, so an invoice
        // with no subscription id (including invoice.paid) changes nothing.
        const subId = invoiceSubscriptionId(invoice);
        if (subId) {
          await env.DB.prepare(
            'UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?',
          )
            .bind('past_due', now, subId)
            .run();
        }
      }
      break;
    }

    case 'payment_method.attached':
    case 'customer.updated':
    case 'setup_intent.succeeded':
      // A new or replaced card. Collect any lead fee that is still
      // pending for this customer. No matching workspace is a no-op.
      await retryLeadFeesForStripeCustomer(env, event.type, event.data.object);
      break;

    default:
      // Unhandled event type — acknowledge receipt
      break;
  }

  // Booking deposits reconcile off the same events (lib/deposits.ts):
  // an authorization landing, a declined card, an authorization voided
  // or expired out of band. Job payments above key on the payments
  // table; deposits key on their own — an intent belongs to at most one
  // of them, so the two never fight over an event.
  if (event.type.startsWith('payment_intent.')) {
    await handleDepositWebhookEvent(env, event);
  }

  return json({ received: true });
});
