import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import {
  json,
  error,
  notFound,
  unauthorized,
  newId,
  paginate,
} from '../lib/response';
import { validate } from '../middleware/validate';
import { CustomerPortalMagicLinkSchema } from '@greenput/shared/validators';

export const portalRouter = Router({ base: '/api/portal' });

const PORTAL_SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const MAGIC_LINK_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface PortalSession {
  customerId: string;
  workspaceId: string;
  email: string;
  firstName: string;
  lastName: string;
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function buildPortalCookie(token: string, env: Env, maxAge: number): string {
  const parts = [`gp_portal=${token}`, 'HttpOnly', 'Secure', 'Path=/'];
  parts.push(`Max-Age=${maxAge}`);

  if (env.ENVIRONMENT === 'production') {
    parts.push('Domain=.greenput.com');
    parts.push('SameSite=Lax');
  } else if (env.ENVIRONMENT === 'staging') {
    parts.push('Domain=.greenput.site');
    parts.push('SameSite=Lax');
  } else {
    parts.push('SameSite=Lax');
  }

  return parts.join('; ');
}

async function requirePortalAuth(
  request: Request & { portalUser?: PortalSession },
  env: Env,
): Promise<Response | void> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const token = getCookieValue(cookieHeader, 'gp_portal');

  if (!token) return unauthorized();

  const raw = await env.SESSIONS.get(`portal:${token}`);
  if (!raw) return unauthorized();

  try {
    const session: PortalSession = JSON.parse(raw);
    (request as unknown as Record<string, unknown>).portalUser = session;
  } catch {
    return unauthorized();
  }
}

// ── POST /api/portal/magic-link ────────────────────────────────
// Send a magic link email to a customer (no auth required)
portalRouter.post(
  '/magic-link',
  validate(CustomerPortalMagicLinkSchema),
  async (req: IRequest, env: Env) => {
    const body = (req as unknown as { validatedBody: { email: string } })
      .validatedBody;
    const email = body.email.toLowerCase().trim();

    // Find customer by email
    const customer = await env.DB.prepare(
      'SELECT id, workspace_id, first_name, last_name, email FROM customers WHERE email = ?',
    )
      .bind(email)
      .first<{
        id: string;
        workspace_id: string;
        first_name: string;
        last_name: string;
        email: string;
      }>();

    // Always return success to prevent email enumeration
    if (!customer) {
      return json({ data: { sent: true } });
    }

    // Generate magic link token
    const token = newId();
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();

    await env.DB.prepare(
      `INSERT INTO portal_tokens (id, customer_id, workspace_id, token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId(),
        customer.id,
        customer.workspace_id,
        token,
        expiresAt,
        new Date().toISOString(),
      )
      .run();

    // Build the magic link URL
    const portalBase =
      env.ENVIRONMENT === 'production'
        ? 'https://portal.greenput.com'
        : env.ENVIRONMENT === 'staging'
          ? 'https://portal.greenput.site'
          : 'http://localhost:8790';

    const magicLink = `${portalBase}/verify?token=${token}`;

    // Log the link (in production, integrate with email service)
    console.log(`[Portal] Magic link for ${email}: ${magicLink}`);

    return json({ data: { sent: true } });
  },
);

// ── GET /api/portal/verify ─────────────────────────────────────
// Verify magic link token and create portal session
portalRouter.get('/verify', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return error('Token is required', 400, 'MISSING_TOKEN');
  }

  const record = await env.DB.prepare(
    `SELECT pt.*, c.first_name, c.last_name, c.email
     FROM portal_tokens pt
     JOIN customers c ON c.id = pt.customer_id
     WHERE pt.token = ? AND pt.used_at IS NULL`,
  )
    .bind(token)
    .first<{
      id: string;
      customer_id: string;
      workspace_id: string;
      token: string;
      expires_at: string;
      first_name: string;
      last_name: string;
      email: string;
    }>();

  if (!record) {
    return error('Invalid or already used token', 400, 'INVALID_TOKEN');
  }

  if (new Date(record.expires_at) < new Date()) {
    return error('Token has expired', 400, 'TOKEN_EXPIRED');
  }

  // Mark token as used
  await env.DB.prepare('UPDATE portal_tokens SET used_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), record.id)
    .run();

  // Create portal session in KV
  const sessionToken = newId();
  const sessionData: PortalSession = {
    customerId: record.customer_id,
    workspaceId: record.workspace_id,
    email: record.email,
    firstName: record.first_name,
    lastName: record.last_name,
  };

  await env.SESSIONS.put(
    `portal:${sessionToken}`,
    JSON.stringify(sessionData),
    {
      expirationTtl: PORTAL_SESSION_TTL,
    },
  );

  const response = json({
    data: {
      customer: {
        id: record.customer_id,
        email: record.email,
        firstName: record.first_name,
        lastName: record.last_name,
      },
    },
  });

  const headers = new Headers(response.headers);
  headers.append(
    'Set-Cookie',
    buildPortalCookie(sessionToken, env, PORTAL_SESSION_TTL),
  );

  return new Response(response.body, { status: 200, headers });
});

// ── GET /api/portal/jobs ───────────────────────────────────────
// List jobs for the authenticated customer
portalRouter.get(
  '/jobs',
  requirePortalAuth,
  async (req: IRequest, env: Env) => {
    const session = (req as unknown as { portalUser: PortalSession })
      .portalUser;
    const url = new URL(req.url);
    const { limit, offset, page } = paginate(url);

    const status = url.searchParams.get('status');

    let where = 'WHERE customer_id = ? AND workspace_id = ?';
    const params: unknown[] = [session.customerId, session.workspaceId];

    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }

    const [rows, countRow] = await Promise.all([
      env.DB.prepare(
        `SELECT id, job_number, title, status, scheduled_start, scheduled_end, total, invoiced_at, paid_at
       FROM jobs ${where}
       ORDER BY scheduled_start DESC
       LIMIT ? OFFSET ?`,
      )
        .bind(...params, limit, offset)
        .all(),
      env.DB.prepare(`SELECT COUNT(*) AS total FROM jobs ${where}`)
        .bind(...params)
        .first<{ total: number }>(),
    ]);

    return json({
      data: rows.results,
      meta: { total: countRow?.total ?? 0, page, perPage: limit },
    });
  },
);

// ── GET /api/portal/jobs/:id ───────────────────────────────────
// Get job details with line items
portalRouter.get(
  '/jobs/:id',
  requirePortalAuth,
  async (req: IRequest, env: Env) => {
    const session = (req as unknown as { portalUser: PortalSession })
      .portalUser;
    const jobId = req.params!['id'];

    const job = await env.DB.prepare(
      `SELECT id, job_number, title, status, street, city, state, zip,
            scheduled_start, scheduled_end, actual_start, actual_end,
            total, notes, invoiced_at, paid_at
     FROM jobs
     WHERE id = ? AND customer_id = ? AND workspace_id = ?`,
    )
      .bind(jobId, session.customerId, session.workspaceId)
      .first();

    if (!job) return notFound('Job');

    const lineItems = await env.DB.prepare(
      'SELECT id, description, quantity, unit_price, total FROM job_line_items WHERE job_id = ?',
    )
      .bind(jobId)
      .all();

    return json({
      data: {
        ...job,
        lineItems: lineItems.results,
      },
    });
  },
);

// ── GET /api/portal/estimates ──────────────────────────────────
// List estimates (only sent/accepted/rejected/expired — not drafts)
portalRouter.get(
  '/estimates',
  requirePortalAuth,
  async (req: IRequest, env: Env) => {
    const session = (req as unknown as { portalUser: PortalSession })
      .portalUser;
    const url = new URL(req.url);
    const { limit, offset, page } = paginate(url);

    const [rows, countRow] = await Promise.all([
      env.DB.prepare(
        `SELECT id, estimate_number, title, status, total, valid_until, sent_at, accepted_at
       FROM estimates
       WHERE customer_id = ? AND workspace_id = ? AND status IN ('sent', 'accepted', 'rejected', 'expired')
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      )
        .bind(session.customerId, session.workspaceId, limit, offset)
        .all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM estimates
       WHERE customer_id = ? AND workspace_id = ? AND status IN ('sent', 'accepted', 'rejected', 'expired')`,
      )
        .bind(session.customerId, session.workspaceId)
        .first<{ total: number }>(),
    ]);

    return json({
      data: rows.results,
      meta: { total: countRow?.total ?? 0, page, perPage: limit },
    });
  },
);

// ── GET /api/portal/invoices ───────────────────────────────────
// List invoiced/paid jobs
portalRouter.get(
  '/invoices',
  requirePortalAuth,
  async (req: IRequest, env: Env) => {
    const session = (req as unknown as { portalUser: PortalSession })
      .portalUser;
    const url = new URL(req.url);
    const { limit, offset, page } = paginate(url);

    const [rows, countRow] = await Promise.all([
      env.DB.prepare(
        `SELECT id, job_number, title, status, total, invoiced_at, paid_at
       FROM jobs
       WHERE customer_id = ? AND workspace_id = ? AND status IN ('invoiced', 'paid')
       ORDER BY invoiced_at DESC
       LIMIT ? OFFSET ?`,
      )
        .bind(session.customerId, session.workspaceId, limit, offset)
        .all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM jobs
       WHERE customer_id = ? AND workspace_id = ? AND status IN ('invoiced', 'paid')`,
      )
        .bind(session.customerId, session.workspaceId)
        .first<{ total: number }>(),
    ]);

    return json({
      data: rows.results,
      meta: { total: countRow?.total ?? 0, page, perPage: limit },
    });
  },
);
