import { Router, IRequest } from 'itty-router';
import type { Env } from './env';
import { requireAuth, corsHeaders } from './middleware/auth';
import { applySecurityHeaders } from './middleware/security';
import { withErrorHandler } from './middleware/error-handler';
import { authRouter } from './routes/auth';
import { webauthnRouter } from './routes/webauthn';
import { invitationsRouter } from './routes/invitations';
import { leadsRouter } from './routes/leads';
import { dashboardRouter } from './routes/dashboard';
import { opportunitiesRouter } from './routes/opportunities';
import { jobsRouter } from './routes/jobs';
import { customersRouter } from './routes/customers';
import { campaignsRouter } from './routes/campaigns';
import { workspaceRouter } from './routes/workspace';
import { otpRouter } from './routes/otp';
import { chatRouter } from './routes/chat';
import { adminRouter } from './routes/admin';
import { billingRouter } from './routes/billing';
import { paymentsRouter } from './routes/payments';
import { twilioSmsWebhookRouter } from './routes/twilio-sms';
import { notificationPreferencesRouter } from './routes/notification-preferences';
import { filesRouter } from './routes/files';
import { estimatesRouter } from './routes/estimates';
import { changeOrdersRouter } from './routes/change-orders';
import { webhooksRouter } from './routes/webhooks';
import { publicRouter } from './routes/public';
import { consentRouter, publicConsentRouter } from './routes/consent';
import { poolRouter } from './routes/pool';
import { scheduleRouter } from './routes/schedule';
import { intakeRouter, publicIntakeRouter } from './routes/intake';
import { featureFlagsRouter } from './routes/feature-flags';
import { portalRouter } from './routes/customer-portal';
import { apiKeysRouter } from './routes/api-keys';
import { auditRouter } from './routes/audit';
import { complianceRouter } from './routes/compliance';
import { reportsRouter } from './routes/reports';
import { inventoryRouter } from './routes/inventory';
import { vehiclesRouter } from './routes/vehicles';
import { pluginsRouter } from './routes/plugins';
import { brandingRouter } from './routes/branding';
import { customDomainRouter } from './routes/custom-domains';
import { reviewsRouter } from './routes/reviews';
import { assetsRouter } from './routes/assets';
import { availabilityRouter } from './routes/availability';
import { monitoringRouter } from './routes/monitoring';
import { requireAdmin } from './middleware/admin-auth';
import { apiKeyAuth } from './middleware/api-key-auth';
import { requireBillingActive } from './middleware/billing-gate';
import {
  authRateLimit,
  otpRateLimit,
  publicRateLimit,
  generalRateLimit,
} from './middleware/rate-limit';
import { json, error } from './lib/response';
import { applySessionRenewal } from './lib/session';

export { ChatRoom } from './durable-objects/chat-room';

const router = Router();

// ── CORS preflight ────────────────────────────────────────────
// Exactly the static policy in middleware/auth.ts, preflight included.
// (WS-0 removed the one request-aware widening, which existed only for
// the homeowner deposit-confirmation endpoints.)
router.options(
  '*',
  async (req: IRequest, env: Env) =>
    new Response(null, {
      status: 204,
      headers: corsHeaders(
        (req as unknown as Request).headers.get('origin') ?? '',
        env,
      ),
    }),
);

// ── Public routes ─────────────────────────────────────────────
//
// authRateLimit's 5-a-minute budget is for CREDENTIAL SUBMISSIONS — the
// requests where someone is trying to prove who they are. Two endpoints under
// /api/auth/* are not that, and counting them turned ordinary use into a
// lockout:
//
//   webauthn/login/options  mints a challenge. /login fires it on mount (for
//     autofill) and again on the button, so merely LOOKING at the sign-in
//     screen twice spent most of the budget for actually signing in.
//   logout  tears down the caller's own session. Rate-limiting it traps
//     people signed in, and spends the budget they need to sign back in.
//
// Both ride the general 60-a-minute budget instead. What is left under
// authRateLimit is the guessable surface: password login, register, and
// webauthn/login/verify.
router.post(
  '/api/auth/webauthn/login/options',
  generalRateLimit,
  (req: IRequest, env: Env) =>
    webauthnRouter.fetch(req as unknown as Request, env),
);
router.post('/api/auth/logout', generalRateLimit, (req: IRequest, env: Env) =>
  authRouter.fetch(req as unknown as Request, env),
);

// WebAuthn register needs auth; login is public — auth is checked inside handlers
router.all(
  '/api/auth/webauthn/register/*',
  requireAuth,
  (req: IRequest, env: Env) =>
    webauthnRouter.fetch(req as unknown as Request, env),
);
router.all('/api/auth/webauthn/*', authRateLimit, (req: IRequest, env: Env) =>
  webauthnRouter.fetch(req as unknown as Request, env),
);
// Managing your own recovery number needs a session; recovering an account
// obviously cannot. Same split, and the same ordering requirement, as
// webauthn's register/* above — the authenticated prefix has to be matched
// before the public catch-all that would otherwise swallow it.
router.all(
  '/api/auth/otp/recovery*',
  otpRateLimit,
  requireAuth,
  (req: IRequest, env: Env) => otpRouter.fetch(req as unknown as Request, env),
);
router.all('/api/auth/otp/*', otpRateLimit, (req: IRequest, env: Env) =>
  otpRouter.fetch(req as unknown as Request, env),
);
// Teammate invitations (GP-008). Both public — the holder has no session
// yet — and both ahead of the /api/auth/* catch-all. The preview is fired on
// mount by the accept screen, so like login/options it rides the general
// budget; accepting burns a token and mints a session, which is a
// credential submission and spends the auth budget.
router.get(
  '/api/auth/invite/:token',
  generalRateLimit,
  (req: IRequest, env: Env) =>
    invitationsRouter.fetch(req as unknown as Request, env),
);
router.post(
  '/api/auth/invite/:token/accept',
  authRateLimit,
  (req: IRequest, env: Env) =>
    invitationsRouter.fetch(req as unknown as Request, env),
);
// /me requires auth middleware to populate req.user — must be before the catch-all
router.get('/api/auth/me', requireAuth, (req: IRequest, env: Env) =>
  authRouter.fetch(req as unknown as Request, env),
);
router.all('/api/auth/*', authRateLimit, (req: IRequest, env: Env) =>
  authRouter.fetch(req as unknown as Request, env),
);
// WebSocket upgrade for chat rooms (GP-055). Session-cookie authenticated
// like every other /api/chat route: the browser sends `gp_session` on the
// handshake because app.greenput.com and api.greenput.com are same-site and
// the cookie is SameSite=Lax with Domain=.greenput.com. Registered ahead of
// the requireAuth catch-all below because the DO's 101 must not pass through
// the sub-router dispatch that wraps every other response.
router.get('/api/chat/rooms/:id/ws', requireAuth, (req: IRequest, env: Env) =>
  chatRouter.fetch(req as unknown as Request, env),
);

// ── Admin routes ──────────────────────────────────────────────
//
// itty-router matches in REGISTRATION order and the first handler to return a
// Response wins, so every specific path below has to be registered before the
// /api/admin/auth/* catch-all that would otherwise swallow it. /auth/me used to
// sit *after* that catch-all under a comment claiming it had to come first,
// which made its requireAdmin dead code — the catch-all reached the handler
// with no adminSession attached, so /auth/me answered 401 to a signed-in admin.
//
// Budgets follow the same split as /api/auth/* above: authRateLimit's 5 a
// minute is for CREDENTIAL SUBMISSIONS, and anything a page fires on load
// (status, me, a WebAuthn challenge) rides the general 60-a-minute budget so
// merely opening the admin sign-in screen cannot spend the budget needed to
// sign in. Before this, the whole admin auth mount had NO limiter at all —
// alone among the auth mounts.
//
// Admin passkey registration requires an admin session
router.all(
  '/api/admin/auth/webauthn/register/*',
  generalRateLimit,
  requireAdmin,
  (req: IRequest, env: Env) =>
    adminRouter.fetch(req as unknown as Request, env),
);
// Mints a challenge, fired on mount by the sign-in screen — not a submission
router.post(
  '/api/admin/auth/webauthn/login/options',
  generalRateLimit,
  (req: IRequest, env: Env) =>
    adminRouter.fetch(req as unknown as Request, env),
);
// /me requires admin session — must be before the catch-all
router.get(
  '/api/admin/auth/me',
  generalRateLimit,
  requireAdmin,
  (req: IRequest, env: Env) =>
    adminRouter.fetch(req as unknown as Request, env),
);
// Public reads/teardown of the caller's own session — must be before the
// catch-all so they do not spend the credential budget
router.get(
  '/api/admin/auth/status',
  generalRateLimit,
  (req: IRequest, env: Env) =>
    adminRouter.fetch(req as unknown as Request, env),
);
router.post(
  '/api/admin/auth/logout',
  generalRateLimit,
  (req: IRequest, env: Env) =>
    adminRouter.fetch(req as unknown as Request, env),
);
// What is left is the guessable surface: setup (gated on ADMIN_SETUP_TOKEN by
// requireAdminSetupToken inside the router) and webauthn/login/verify.
router.all('/api/admin/auth/*', authRateLimit, (req: IRequest, env: Env) =>
  adminRouter.fetch(req as unknown as Request, env),
);
// Feature flags are a platform-wide setting, so they live under the platform
// admin's authority, not a workspace role (GP-107). Registered before the
// catch-all below, which would otherwise hand them to adminRouter.
router.all(
  '/api/admin/feature-flags*',
  requireAdmin,
  (req: IRequest, env: Env) =>
    featureFlagsRouter.fetch(req as unknown as Request, env),
);
// All other admin endpoints require admin session
router.all('/api/admin/*', requireAdmin, (req: IRequest, env: Env) =>
  adminRouter.fetch(req as unknown as Request, env),
);

// ── Monitoring routes ─────────────────────────────────────────
// Client-side error ingestion: any authenticated user can POST a batch.
// Read endpoints (GET) remain admin-only.
router.post(
  '/api/monitoring/errors',
  authRateLimit,
  requireAuth,
  (req: IRequest, env: Env) =>
    monitoringRouter.fetch(req as unknown as Request, env),
);
router.all('/api/monitoring/*', requireAdmin, (req: IRequest, env: Env) =>
  monitoringRouter.fetch(req as unknown as Request, env),
);

// The share card and the square mark used to be served from here under
// /api/public/brand/*. They moved to their own Worker, apps/brand-assets at
// brand.greenput.com (GP-108): the rasterizer is 2.4 MB of WASM, and this is
// the Worker every authenticated request goes through. Nothing here builds
// those URLs either — apps/tenant-site does, via libs/shared/design.

// ── Public pricing form (no auth) ────────────────────────────
// The homeowner filling in an enrichment form is never logged in. Must be
// registered BEFORE the /api/public/* catch-all below, which would otherwise
// swallow it.
router.all('/api/public/intake/*', publicRateLimit, (req: IRequest, env: Env) =>
  publicIntakeRouter.fetch(req as unknown as Request, env),
);

// ── Public consent revocation (no auth — the consumer STOP path) ──
// Must precede the /api/public/* catch-all below.
router.all(
  '/api/public/consent/*',
  publicRateLimit,
  (req: IRequest, env: Env) =>
    publicConsentRouter.fetch(req as unknown as Request, env),
);

// ── Public lead capture / workspace info (no auth) ──────────
router.all('/api/public/*', publicRateLimit, (req: IRequest, env: Env) =>
  publicRouter.fetch(req as unknown as Request, env),
);

// ── Public webhook endpoint (signature-verified, no session) ──
router.post('/api/payments/webhook', (req: IRequest, env: Env) =>
  paymentsRouter.fetch(req as unknown as Request, env),
);

// Twilio status callback for contractor SMS. Signature-verified, no session.
// Registered beside the Stripe webhook, before the auth catch-all.
router.post('/api/webhooks/twilio/sms', (req: IRequest, env: Env) =>
  twilioSmsWebhookRouter.fetch(req as unknown as Request, env),
);

// ── Customer portal routes (own auth via gp_portal cookie) ───
router.all('/api/portal/*', publicRateLimit, (req: IRequest, env: Env) =>
  portalRouter.fetch(req as unknown as Request, env),
);

// ── Public health check (must be BEFORE the auth catch-all below) ──
router.get('/api/health', async (_req: IRequest, env: Env) => {
  const start = Date.now();
  try {
    await env.DB.prepare('SELECT 1').first();
    return json({
      data: {
        status: 'ok',
        version: '1.0.0',
        db: 'ok',
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    return json(
      {
        data: {
          status: 'degraded',
          db: 'error',
          latencyMs: Date.now() - start,
          timestamp: new Date().toISOString(),
        },
      },
      503,
    );
  }
});

// ── Protected routes ──────────────────────────────────────────
// apiKeyAuth runs first: if a Bearer gp_ token is present it authenticates
// via API key and skips session auth; otherwise it falls through so
// requireAuth can check the session cookie.
router.all(
  '/api/*',
  generalRateLimit,
  apiKeyAuth,
  requireAuth,
  requireBillingActive,
  (req: IRequest, env: Env) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/api-keys'))
      return apiKeysRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/leads'))
      return leadsRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/dashboard'))
      return dashboardRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/opportunities'))
      return opportunitiesRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/jobs'))
      return jobsRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/customers'))
      return customersRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/campaigns'))
      return campaignsRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/workspace'))
      return workspaceRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/billing'))
      return billingRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/payments'))
      return paymentsRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/chat'))
      return chatRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/notifications'))
      return notificationPreferencesRouter.fetch(
        req as unknown as Request,
        env,
      );
    if (url.pathname.startsWith('/api/files'))
      return filesRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/intake'))
      return intakeRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/consent'))
      return consentRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/pool'))
      return poolRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/schedule'))
      return scheduleRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/estimates'))
      return estimatesRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/change-orders'))
      return changeOrdersRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/webhooks'))
      return webhooksRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/audit'))
      return auditRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/compliance'))
      return complianceRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/reports'))
      return reportsRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/inventory'))
      return inventoryRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/vehicles'))
      return vehiclesRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/plugins'))
      return pluginsRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/branding'))
      return brandingRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/custom-domain'))
      return customDomainRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/reviews'))
      return reviewsRouter.fetch(req as unknown as Request, env);
    if (url.pathname.startsWith('/api/assets'))
      return assetsRouter.fetch(req as unknown as Request, env);
    // Admin-only inside the router (requireRole('admin') on every handler);
    // requireAuth above supplies the session it checks.
    if (url.pathname.startsWith('/api/availability'))
      return availabilityRouter.fetch(req as unknown as Request, env);
    return error('Not found', 404, 'NOT_FOUND');
  },
);

router.all('*', () => error('Not found', 404, 'NOT_FOUND'));

/** Core router fetch — handles routing, CORS, and security headers. */
async function routerFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let response = await router.fetch(request, env, ctx);

  // A WebSocket upgrade is the one response that cannot be rebuilt: the 101
  // carries the socket itself, and `new Response(body, …)` drops it. Headers
  // on a 101 are never read by the browser anyway.
  if (response.status === 101) return response;

  // Apply CORS headers
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request.headers.get('origin') ?? '', env)).forEach(
    ([k, v]) => headers.set(k, v),
  );

  response = new Response(response.body, {
    status: response.status,
    headers,
  });

  // Apply security headers
  return applySecurityHeaders(response, env);
}

/**
 * Worker entry point — wrapped with structured error handling.
 * The withErrorHandler middleware:
 *  - Generates X-Request-ID for every request
 *  - Logs request start/end with timing
 *  - Catches unhandled errors with classification + D1 persistence
 *  - Returns structured ApiError responses
 */
const handleFetch = withErrorHandler(routerFetch);

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const response = await handleFetch(request, env, ctx);
    if (response.status === 101) return response;

    // Ensure CORS + security headers are applied even on error responses
    // from the error handler (which may not have gone through routerFetch).
    const headers = new Headers(response.headers);
    if (!headers.has('Access-Control-Allow-Origin')) {
      Object.entries(
        corsHeaders(request.headers.get('origin') ?? '', env),
      ).forEach(([k, v]) => headers.set(k, v));
    }

    // Drain any sliding-session renewal staged by requireAuth. It has to happen
    // HERE rather than inside routerFetch: requireAuth writes KV before the
    // handler runs, so if the handler throws, withErrorHandler builds a 500 from
    // scratch and routerFetch never resumes — the KV entry would have slid
    // forward while the browser's Max-Age did not. This is the one point every
    // response passes through, error responses included.
    applySessionRenewal(request, headers);

    return applySecurityHeaders(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      env,
    );
  },
};
