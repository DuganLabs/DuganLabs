import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound } from '../lib/response';
import {
  findActiveConsent,
  revokeConsent,
  type D1Like,
} from '@greenput/shared/consent';

export const consentRouter = Router({ base: '/api/consent' });
export const publicConsentRouter = Router({ base: '/api/public/consent' });

const db = (env: Env) => env.DB as unknown as D1Like;

interface RevokeBody {
  phone?: string;
  email?: string;
  leadId?: string;
  slug?: string;
}

async function parseBody(req: IRequest): Promise<RevokeBody | null> {
  try {
    return (await (req as unknown as Request).json()) as RevokeBody;
  } catch {
    return null;
  }
}

// GET /api/consent?phone=|email=|leadId= — the workspace's view of a
// consumer's active consent record (what was granted, when, from where).
consentRouter.get('/', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  const url = new URL(req.url);
  const record = await findActiveConsent({
    db: db(env),
    workspaceId,
    consumerPhone: url.searchParams.get('phone') ?? undefined,
    consumerEmail: url.searchParams.get('email') ?? undefined,
    leadId: url.searchParams.get('leadId') ?? undefined,
  });
  if (!record) return notFound('Consent record');
  return json({ data: record });
});

// POST /api/consent/revoke — staff revoking on the consumer's behalf
// (they asked in person, by email, by phone). Revocation is recorded
// with its source and ends every active record matching the identity.
consentRouter.post('/revoke', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  const body = await parseBody(req);
  if (!body || (!body.phone && !body.email && !body.leadId)) {
    return error(
      'phone, email, or leadId is required.',
      400,
      'VALIDATION_ERROR',
    );
  }
  const revoked = await revokeConsent(db(env), {
    workspaceId,
    consumerPhone: body.phone,
    consumerEmail: body.email,
    leadId: body.leadId,
    revokeSource: 'staff_on_request',
  });
  return json({ data: { revoked } });
});

// POST /api/public/consent/revoke — the consumer's own STOP path. No
// session: revoking is always safe to honour, and a consumer who never
// had an account must still be able to end messaging. Identified by the
// workspace slug + their phone or email.
publicConsentRouter.post('/revoke', async (req: IRequest, env: Env) => {
  const body = await parseBody(req);
  if (!body?.slug || (!body.phone && !body.email)) {
    return error(
      'slug and phone or email are required.',
      400,
      'VALIDATION_ERROR',
    );
  }
  const workspace = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE slug = ? LIMIT 1',
  )
    .bind(body.slug)
    .first<{ id: string }>();
  if (!workspace) return notFound('Workspace');

  const revoked = await revokeConsent(db(env), {
    workspaceId: workspace.id,
    consumerPhone: body.phone,
    consumerEmail: body.email,
    revokeSource: 'consumer_stop',
  });
  return json({ data: { revoked } });
});
