import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error } from '../lib/response';
import {
  getRecentErrors,
  ingestClientErrors,
  type ClientErrorEvent,
} from '../lib/error-tracker';

export const monitoringRouter = Router({ base: '/api/monitoring' });

const MAX_BATCH_SIZE = 50;

// GET /api/monitoring/errors — List recent error events (admin-only)
monitoringRouter.get('/errors', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam
    ? Math.min(Math.max(1, parseInt(limitParam, 10)), 200)
    : 50;
  const severity = url.searchParams.get('severity');
  const category = url.searchParams.get('category');

  let errors = await getRecentErrors(env, limit);

  // Apply optional filters
  if (severity) {
    errors = errors.filter((e) => e.severity === severity);
  }
  if (category) {
    errors = errors.filter((e) => e.category === category);
  }

  return json({ data: errors });
});

// POST /api/monitoring/errors — Ingest a batch of client-side errors
// (any authenticated user; route auth is enforced upstream in index.ts)
monitoringRouter.post('/errors', async (req: IRequest, env: Env) => {
  let body: { errors?: unknown };
  try {
    body = (await req.json()) as { errors?: unknown };
  } catch {
    return error('Invalid JSON body', 400, 'INVALID_BODY');
  }

  if (!Array.isArray(body.errors)) {
    return error('Body must include errors array', 400, 'INVALID_BODY');
  }

  if (body.errors.length === 0) {
    return json({ data: { ingested: 0 } });
  }

  if (body.errors.length > MAX_BATCH_SIZE) {
    return error(
      `Batch exceeds max size of ${MAX_BATCH_SIZE}`,
      400,
      'BATCH_TOO_LARGE',
    );
  }

  const sessionUser = (
    req as unknown as { user?: { id: string; workspaceId: string } }
  ).user;

  const ingested = await ingestClientErrors(
    env,
    body.errors as ClientErrorEvent[],
    {
      userId: sessionUser?.id,
      workspaceId: sessionUser?.workspaceId,
    },
  );

  return json({ data: { ingested } });
});
