import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound } from '../lib/response';
import type { AdminSession } from '../middleware/admin-auth';
import { unauthorized } from '../lib/response';
import {
  createFlags,
  PANEL_PHOTO_FLAG,
  rolloutConfig,
} from '@greenput/shared/pricing';

/**
 * Turning a dark feature on, from the product, by the person who owns it.
 *
 * A flag that can only be flipped by an engineer running a command is not a
 * flag, it is a deploy. These two routes are the whole control surface: read
 * what exists, write one config. `@basenative/flags` owns the semantics
 * (enabled / percentage / rules); the `feature_flags` D1 table is the store,
 * chosen because the API Worker and the tenant-site Worker share `DB` but not
 * a KV namespace, and both of them have to agree about a flag that gates a
 * consumer-facing price.
 *
 * Flags are workspace-independent on purpose. `intake_panel_photo` gates a
 * storage binding and a review queue — infrastructure, not entitlement — so a
 * per-workspace copy would only invite half-on states where a homeowner can
 * upload a photo nobody has a queue for. Per-workspace targeting, when it is
 * wanted, is the package's `rules` on the same row.
 *
 * AUTHORITY. A global table needs a global authority. These routes used to
 * be gated on `requireRole('admin')`, which is a WORKSPACE role — any
 * customer who signs up and makes themselves admin of their own workspace —
 * so any tenant could flip a flag for every other tenant (GP-107). They are
 * now mounted under /api/admin/, behind the platform-admin session
 * (`requireAdmin`, `admin_users`, the gp_admin_session cookie — CLAUDE.md
 * §6.19), and check that session again here so the guard does not depend on
 * the mount alone.
 */

export const featureFlagsRouter = Router({ base: '/api/admin/feature-flags' });

interface FlagBody {
  enabled?: unknown;
  percentage?: unknown;
}

/** Flags this deployment knows about, with what each one costs to be wrong. */
const KNOWN_FLAGS: Record<string, string> = {
  [PANEL_PHOTO_FLAG]:
    'Lets a homeowner attach a photo of their panel to a quote form, and opens the contractor review queue that narrows the spanning range it produces. Off means the form still quotes — just always from the wider band.',
};

/** The platform admin on the request, or null. Set by requireAdmin. */
const adminOf = (req: IRequest): AdminSession | null => {
  const s = (req as unknown as { adminSession?: AdminSession }).adminSession;
  return s && s.isAdmin === true ? s : null;
};

// GET /api/feature-flags — every flag, and whether it is on right now
featureFlagsRouter.get('/', async (req: IRequest, env: Env) => {
  const admin = adminOf(req);
  if (!admin) return unauthorized();
  const flags = createFlags({ db: env.DB, updatedBy: admin.adminId });
  const configs = await flags.getAll();
  const names = new Set([...Object.keys(KNOWN_FLAGS), ...Object.keys(configs)]);

  const rows = await env.DB.prepare(
    'SELECT name, description, updated_at FROM feature_flags',
  ).all<{ name: string; description: string; updated_at: string }>();
  const stored = new Map(rows.results.map((r) => [r.name, r]));

  return json({
    data: [...names].sort().map((name) => ({
      name,
      enabled: configs[name] ?? false,
      description: stored.get(name)?.description || KNOWN_FLAGS[name] || '',
      updatedAt: stored.get(name)?.updated_at ?? null,
      /** No row at all — the ship-dark default, not an explicit "off". */
      configured: stored.has(name),
    })),
  });
});

// PATCH /api/feature-flags/:name — turn one on or off
featureFlagsRouter.patch('/:name', async (req: IRequest, env: Env) => {
  const admin = adminOf(req);
  if (!admin) return unauthorized();
  const name = req.params['name'];
  let body: FlagBody;
  try {
    body = await (req as unknown as Request).json();
  } catch {
    return error('Invalid JSON body', 400, 'BAD_REQUEST');
  }

  if (typeof body.enabled !== 'boolean') {
    return error('enabled must be true or false', 400, 'VALIDATION_ERROR');
  }
  if (
    body.percentage !== undefined &&
    (typeof body.percentage !== 'number' ||
      body.percentage < 0 ||
      body.percentage > 100)
  ) {
    return error(
      'percentage must be a number from 0 to 100',
      400,
      'VALIDATION_ERROR',
    );
  }
  // An unknown name is a typo, and a typo that silently creates a flag is a
  // feature that never turns on and nobody can find.
  if (!(name in KNOWN_FLAGS)) return notFound('Feature flag');

  // `rolloutConfig` and not an object literal: see its docstring — a
  // percentage written alongside `enabled: true` is silently a 100%
  // rollout in @basenative/flags 0.4.0.
  const percentage =
    typeof body.percentage === 'number' ? body.percentage : undefined;
  const config = rolloutConfig(body.enabled, percentage);

  await createFlags({ db: env.DB, updatedBy: admin.adminId }).setFlag(
    name,
    config,
  );
  await env.DB.prepare(
    "UPDATE feature_flags SET description = ? WHERE name = ? AND description = ''",
  )
    .bind(KNOWN_FLAGS[name], name)
    .run();

  // No activity_log row: that table is per-workspace (workspace_id NOT
  // NULL) and a platform admin has none. feature_flags.updated_by /
  // updated_at is the record of who flipped what, when.

  return json({ data: { name, enabled: body.enabled, config } });
});
